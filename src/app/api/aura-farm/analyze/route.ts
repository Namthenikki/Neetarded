import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase/config';
import { doc, getDoc, getDocs, updateDoc, serverTimestamp, collection, query, where } from 'firebase/firestore';
import { auraFarmMentorAnalysisFlow } from '@/ai/flows/aura-farm-mentor';
import { AuraFarmSession, AuraFarmAIAnalysis, TopicAnalysisItem, SessionSummary } from '@/types/aura';
import { QUIZ_SUBJECTS } from '@/lib/quiz-data';

/**
 * POST /api/aura-farm/analyze
 *
 * Accepts a sessionId, fetches the session data, sends question texts to AI
 * for topic classification and analysis, saves the result, and returns everything.
 */
export async function POST(req: NextRequest) {
    try {
        const { sessionId } = await req.json();

        if (!sessionId) {
            return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
        }

        const sessionRef = doc(db, 'aura_farm_sessions', sessionId);
        const sessionDoc = await getDoc(sessionRef);

        if (!sessionDoc.exists()) {
            return NextResponse.json({ error: 'Session not found' }, { status: 404 });
        }

        const sessionData = sessionDoc.data() as AuraFarmSession;

        // If analysis already exists, just return it
        if ((sessionData as any).aiAnalysis) {
            return NextResponse.json({
                analysis: (sessionData as any).aiAnalysis,
                sessionAttempts: sessionData.attempts
            });
        }

        // ===== COMPUTE SESSION SUMMARY (server-side, exact math) =====
        const totalQuestions = sessionData.attempts.length;
        const totalAttempted = sessionData.attempts.filter((a: any) => a.isAttempted).length;
        const totalCorrect = sessionData.attempts.filter((a: any) => a.isCorrect).length;
        const totalIncorrect = sessionData.attempts.filter((a: any) => a.isAttempted && !a.isCorrect).length;
        const totalSkipped = sessionData.attempts.filter((a: any) => !a.isAttempted).length;
        const accuracy = totalAttempted > 0 ? Math.round((totalCorrect / totalAttempted) * 100) : 0;

        const sessionSummary: SessionSummary = {
            totalQuestions,
            totalAttempted,
            totalCorrect,
            totalIncorrect,
            totalSkipped,
            accuracy
        };

        // ===== RESOLVE CHAPTER & SUBJECT NAMES =====
        let chapterName = 'Unknown Chapter';
        let subjectName = 'Unknown Subject';

        // Try to get chapter name from QUIZ_SUBJECTS
        const subjectData = QUIZ_SUBJECTS.find(s => s.id === sessionData.subjectId);
        if (subjectData) {
            subjectName = subjectData.name;
            const chapter = subjectData.chapters?.find((c: any) => c.binaryCode === sessionData.chapterBinaryCode);
            if (chapter) {
                chapterName = chapter.name;
            }
        }

        // If no chapter name found from QUIZ_SUBJECTS, try fetching from a question in the DB
        if (chapterName === 'Unknown Chapter') {
            const chapterKey = `#${sessionData.subjectId}-${sessionData.chapterBinaryCode}`;
            const qBankRef = collection(db, 'QuestionBank');
            const qQuery = query(qBankRef, where('chapter_code', '==', chapterKey));
            const snap = await getDocs(qQuery);
            if (!snap.empty) {
                const firstQ = snap.docs[0].data();
                chapterName = firstQ.chapter_name || chapterName;
            }
        }

        // ===== FETCH USER NAME =====
        const userRef = doc(db, 'users', sessionData.studentId);
        const userDoc = await getDoc(userRef);
        const studentName = userDoc.exists() ? userDoc.data()?.name || 'Student' : 'Student';

        // ===== FETCH FULL QUESTION DETAILS FROM QUESTIONBANK =====
        // Fetch complete question data (text, options, explanation, images) for all attempts
        const questionDetailsMap: Record<string, any> = {};
        const allQuestionIds = sessionData.attempts.map((a: any) => a.questionId).filter(Boolean);

        // Fetch in batches of 10 (Firestore 'in' limit)
        for (let i = 0; i < allQuestionIds.length; i += 10) {
            const batchIds = allQuestionIds.slice(i, i + 10);
            const qQuery = query(collection(db, 'QuestionBank'), where('__name__', 'in', batchIds));
            const snap = await getDocs(qQuery);
            snap.docs.forEach(d => {
                const data = d.data();
                const oj = data.optimized_json || {};
                questionDetailsMap[d.id] = {
                    text: oj.text || 'No text available',
                    options: oj.options || [],
                    correctOptionId: oj.correctOptionId || '',
                    explanation: oj.explanation || '',
                    explanationImageUrl: oj.explanationImageUrl || '',
                    imageUrl: oj.imageUrl || '',
                    chapter_name: data.chapter_name || '',
                };
            });
        }

        const questionDetails = sessionData.attempts.map((att: any, index: number) => {
            const qDetails = questionDetailsMap[att.questionId] || {};
            return {
                questionNumber: index + 1,
                questionText: att.questionText || qDetails.text || 'No text available',
                isCorrect: att.isCorrect,
                isAttempted: att.isAttempted !== undefined ? att.isAttempted : true,
                timeSpentSeconds: att.timeSpentSeconds,
                difficulty: att.difficulty || 'Medium'
            };
        });

        const scorePercentage = accuracy;
        const timeTakenMinutes = parseFloat((sessionData.totalTimeSpent / 60).toFixed(2));

        const inputPayload = {
            studentName,
            totalQuestions: sessionData.totalQuestions,
            totalAttempted,
            totalSkipped,
            totalIncorrect,
            correctAnswers: totalCorrect,
            scorePercentage,
            timeTakenMinutes,
            chapterName,
            subjectName,
            questionDetails
        };

        // ===== RUN AI FLOW =====
        const aiOutput = await auraFarmMentorAnalysisFlow(inputPayload);

        // ===== EXACT MATH OVERRIDES =====
        const attemptedQuestions = sessionData.attempts.filter((a: any) => a.isAttempted);
        let exactAverageTime = 0;
        let exactSlowest = { topic: 'None', timeTaken: 0, isCorrect: false };
        let exactFastest = { topic: 'None', timeTaken: Infinity, isCorrect: false };

        // Build AI-classified topic map for each question
        const questionTopicMap: Record<number, string> = {};
        if (aiOutput.questionTopics) {
            for (const qt of aiOutput.questionTopics) {
                questionTopicMap[qt.questionNumber] = qt.classifiedTopic;
            }
        }

        if (attemptedQuestions.length > 0) {
            exactAverageTime = parseFloat((sessionData.totalTimeSpent / attemptedQuestions.length).toFixed(2));

            sessionData.attempts.forEach((q: any, idx: number) => {
                if (!q.isAttempted && q.isAttempted !== undefined) return;
                // For old sessions without isAttempted field, include all
                if (q.isAttempted === undefined || q.isAttempted) {
                    const topic = questionTopicMap[idx + 1] || 'Unclassified';
                    if (q.timeSpentSeconds > exactSlowest.timeTaken) {
                        exactSlowest = { topic, timeTaken: q.timeSpentSeconds, isCorrect: q.isCorrect };
                    }
                    if (q.timeSpentSeconds < exactFastest.timeTaken) {
                        exactFastest = { topic, timeTaken: q.timeSpentSeconds, isCorrect: q.isCorrect };
                    }
                }
            });
        }
        if (exactFastest.timeTaken === Infinity) exactFastest.timeTaken = 0;

        // ===== COMPUTE TOPIC ANALYSIS FROM AI-CLASSIFIED TOPICS =====
        const topicStatsMap: Record<string, { attempted: number; correct: number; incorrect: number; skipped: number; totalTime: number }> = {};

        sessionData.attempts.forEach((att: any, idx: number) => {
            const topic = questionTopicMap[idx + 1] || 'Unclassified';
            if (!topicStatsMap[topic]) {
                topicStatsMap[topic] = { attempted: 0, correct: 0, incorrect: 0, skipped: 0, totalTime: 0 };
            }
            if (att.isAttempted !== undefined ? att.isAttempted : true) {
                topicStatsMap[topic].attempted++;
                topicStatsMap[topic].totalTime += att.timeSpentSeconds;
                if (att.isCorrect) {
                    topicStatsMap[topic].correct++;
                } else {
                    topicStatsMap[topic].incorrect++;
                }
            } else {
                topicStatsMap[topic].skipped++;
            }
        });

        const computedTopicAnalysis: TopicAnalysisItem[] = Object.entries(topicStatsMap).map(([topic, stats]) => {
            const avgTime = stats.attempted > 0 ? parseFloat((stats.totalTime / stats.attempted).toFixed(1)) : 0;
            let status: TopicAnalysisItem['status'] = 'not_attempted';
            if (stats.attempted === 0) {
                status = 'not_attempted';
            } else {
                const acc = (stats.correct / stats.attempted) * 100;
                if (acc >= 70 && avgTime < 80) {
                    status = 'strong';
                } else if (acc < 50) {
                    status = 'weak';
                } else {
                    status = 'needs_practice';
                }
            }
            return { topic, ...stats, avgTime, status };
        });

        // Merge AI topic analysis insights with computed stats
        const finalTopicAnalysis: TopicAnalysisItem[] = computedTopicAnalysis.map(computed => {
            const aiTopic = aiOutput.topicAnalysis?.find(t => t.topic === computed.topic);
            return {
                ...computed,
                status: aiTopic?.status || computed.status,
            };
        });

        // ===== BUILD FINAL ANALYSIS =====
        const analysisPayload: AuraFarmAIAnalysis = {
            sessionId: sessionDoc.id,
            studentId: sessionData.studentId,
            timePerformanceBreakdown: {
                ...aiOutput.timePerformanceBreakdown,
                averageTimePerQuestion: exactAverageTime,
                slowestQuestion: exactSlowest,
                fastestQuestion: exactFastest
            },
            sessionSummary,
            topicAnalysis: finalTopicAnalysis,
            redFlags: aiOutput.redFlags,
            practiceRecommendations: aiOutput.practiceRecommendations || [],
            mentorVerdict: aiOutput.mentorVerdict,
            createdAt: serverTimestamp() as any
        };

        // Enrich session attempts with AI-classified topics AND full question details
        const enrichedAttempts = sessionData.attempts.map((att: any, idx: number) => {
            const qDetails = questionDetailsMap[att.questionId] || {};
            return {
                ...att,
                topicTag: questionTopicMap[idx + 1] || att.topicTag || 'Unclassified',
                // Include full question details for results page
                questionText: att.questionText || qDetails.text || '',
                options: qDetails.options || [],
                correctOptionId: att.correctOptionId || qDetails.correctOptionId || '',
                explanation: qDetails.explanation || '',
                explanationImageUrl: qDetails.explanationImageUrl || '',
                questionImageUrl: qDetails.imageUrl || att.questionImageUrl || '',
            };
        });

        // Save back to session to avoid re-running if fetched again
        await updateDoc(sessionRef, {
            aiAnalysis: analysisPayload,
            attempts: enrichedAttempts // Save with classified topics
        });

        // ===== PERSIST CLASSIFIED TOPICS TO QUESTIONBANK (permanent) =====
        // Write ai_classified_topic to each QuestionBank doc so future sessions
        // don't need AI to re-classify the same questions.
        try {
            const { writeBatch: firestoreWriteBatch } = await import('firebase/firestore');
            const topicWriteBatch = firestoreWriteBatch(db);
            let batchCount = 0;

            for (let i = 0; i < sessionData.attempts.length; i++) {
                const att = sessionData.attempts[i] as any;
                const classifiedTopic = questionTopicMap[i + 1];
                if (classifiedTopic && att.questionId) {
                    const qDocRef = doc(db, 'QuestionBank', att.questionId);
                    topicWriteBatch.update(qDocRef, { ai_classified_topic: classifiedTopic });
                    batchCount++;
                }
            }

            if (batchCount > 0) {
                await topicWriteBatch.commit();
                console.log(`[aura-farm/analyze] Persisted AI topics for ${batchCount} questions to QuestionBank`);
            }
        } catch (topicWriteError: any) {
            // Non-critical — log but don't fail the analysis
            console.error('[aura-farm/analyze] Failed to persist topics to QuestionBank:', topicWriteError.message);
        }

        return NextResponse.json({
            success: true,
            analysis: analysisPayload,
            sessionAttempts: enrichedAttempts
        });

    } catch (error: any) {
        console.error('[aura-farm/analyze] Error:', error);

        return NextResponse.json(
            {
                error: 'AI Analysis failed. Returning basic stats.',
                fallbackStats: {
                    message: 'The AI Mentor is currently unavailable. Please check your raw timings and accuracy below.',
                }
            },
            { status: 500 }
        );
    }
}
