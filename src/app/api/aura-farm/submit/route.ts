import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase/config';
import { doc, getDoc, setDoc, collection, writeBatch, serverTimestamp, arrayUnion, deleteField } from 'firebase/firestore';

/**
 * POST /api/aura-farm/submit
 *
 * Receives the completed session's question attempts.
 * Supports two modes via `isFinal` flag:
 * 
 * - isFinal=false (batch submit): Updates streaks, chapter stats, dailyDots.
 *   Does NOT create a session document. Used for intermediate batch submits.
 * 
 * - isFinal=true (final submit): Does everything above AND creates the session
 *   document with ALL cumulative attempts. Returns sessionId for analysis.
 *
 * Body:
 * {
 *   studentId: string;
 *   subjectId: string;
 *   chapterBinaryCode: string;
 *   attempts: { questionId, timeSpentSeconds, isCorrect, isAttempted, topicTag, difficulty, attemptTimestamp }[];
 *   isFinal?: boolean; // default false
 *   allAttempts?: { ... }[]; // ALL cumulative attempts, only used when isFinal=true
 * }
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { studentId, subjectId, chapterBinaryCode, attempts, isFinal = false, allAttempts } = body;

        if (!studentId || !subjectId || !chapterBinaryCode || !attempts || !Array.isArray(attempts)) {
            return NextResponse.json(
                { error: 'Missing required fields' },
                { status: 400 }
            );
        }

        // Clean way to get YYYY-MM-DD in IST natively without external libs
        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

        let score = 0;
        let totalTimeSpent = 0;
        let totalAttempted = 0;

        const newQuestionsSeenIds: string[] = [];
        const mistakePoolUpdates: Record<string, number | ReturnType<typeof deleteField>> = {};

        // Prepare stats from current batch
        for (const attempt of attempts) {
            if (attempt.isAttempted) totalAttempted++;
            if (attempt.isCorrect) score++;
            totalTimeSpent += attempt.timeSpentSeconds;
        }

        // Run transaction to ensure atomicity
        const batch = writeBatch(db);

        // 2. Update aura_farm_chapter_stats
        const chapterStatsId = `${studentId}_${chapterBinaryCode}`;
        const chapterStatsRef = doc(db, 'aura_farm_chapter_stats', chapterStatsId);

        // We'll read the current state to update mistake pool
        const chapterStatsDoc = await getDoc(chapterStatsRef);
        let existingQuestionsSeen: string[] = [];
        let existingMistakePool: Record<string, number> = {};

        if (chapterStatsDoc.exists()) {
            const data = chapterStatsDoc.data();
            existingQuestionsSeen = data?.questionsSeen || [];
            existingMistakePool = data?.mistakePool || {};
        }

        for (const attempt of attempts) {
            if (!existingQuestionsSeen.includes(attempt.questionId)) {
                newQuestionsSeenIds.push(attempt.questionId);
            }

            if (attempt.isCorrect) {
                if (existingMistakePool[attempt.questionId] !== undefined) {
                    const currentCount = existingMistakePool[attempt.questionId];
                    if (currentCount + 1 >= 3) {
                        // Mastered: remove from pool
                        mistakePoolUpdates[`mistakePool.${attempt.questionId}`] = deleteField();
                    } else {
                        mistakePoolUpdates[`mistakePool.${attempt.questionId}`] = currentCount + 1;
                    }
                }
            } else if (attempt.isAttempted) {
                // Incorrect: Reset count to 0 or add to pool
                mistakePoolUpdates[`mistakePool.${attempt.questionId}`] = 0;
            } else {
                // Skipped: also add to mistake pool so it reappears in the 30% quota
                mistakePoolUpdates[`mistakePool.${attempt.questionId}`] = 0;
            }
        }

        const chapterStatsUpdate: any = {
            studentId,
            chapterBinaryCode,
            subjectId,
            ...mistakePoolUpdates
        };

        if (newQuestionsSeenIds.length > 0) {
            chapterStatsUpdate.questionsSeen = arrayUnion(...newQuestionsSeenIds);
        }

        batch.set(chapterStatsRef, chapterStatsUpdate, { merge: true });

        // 3. Update aura_farm_user_stats — accumulate daily count + streak logic
        const userStatsRef = doc(db, 'aura_farm_user_stats', studentId);
        const userStatsDoc = await getDoc(userStatsRef);

        let currentStreak = 0;
        let longestStreak = 0;
        let lastActivityDate = null;
        let dailyDots: Record<string, number> = {};

        if (userStatsDoc.exists()) {
            const data = userStatsDoc.data();
            currentStreak = data?.currentStreak || 0;
            longestStreak = data?.longestStreak || 0;
            lastActivityDate = data?.lastActivityDate;
            dailyDots = data?.dailyDots || {};

            // Backward compat: convert old boolean dailyDots to numbers
            for (const key of Object.keys(dailyDots)) {
                if (dailyDots[key] === true as any) {
                    dailyDots[key] = 10; // old format was boolean, assume 10 (minimum for a dot)
                }
            }
        }

        let userStatsUpdates: any = {};

        // Always accumulate the daily question count
        const previousDayCount = dailyDots[todayStr] || 0;
        const newDayCount = previousDayCount + totalAttempted;
        dailyDots[todayStr] = newDayCount;

        // Check if we just crossed the 10-question threshold for streak
        const streakAlreadyUpdatedToday = lastActivityDate === todayStr;
        const justCrossed10 = previousDayCount < 10 && newDayCount >= 10;

        if (justCrossed10 && !streakAlreadyUpdatedToday) {
            // First time crossing 10 today — update streak
            if (lastActivityDate) {
                const lastDate = new Date(lastActivityDate);
                const todayDate = new Date(todayStr);
                const diffTime = Math.abs(todayDate.getTime() - lastDate.getTime());
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                if (diffDays === 1) {
                    currentStreak++;
                } else if (diffDays > 1) {
                    currentStreak = 1;
                }
            } else {
                currentStreak = 1;
            }

            if (currentStreak > longestStreak) {
                longestStreak = currentStreak;
            }

            userStatsUpdates = {
                currentStreak,
                longestStreak,
                lastActivityDate: todayStr,
                dailyDots
            };
        } else {
            // Just update the dailyDots count (and lastActivityDate if streak already counted)
            userStatsUpdates = {
                dailyDots,
                ...(streakAlreadyUpdatedToday ? {} : { lastActivityDate: todayStr })
            };
        }

        if (Object.keys(userStatsUpdates).length > 0) {
            batch.set(userStatsRef, userStatsUpdates, { merge: true });
        }

        // 4. Only create session document on final submit
        let sessionId: string | null = null;

        if (isFinal) {
            // Use allAttempts (cumulative) if provided, otherwise fall back to attempts
            const finalAttempts = (allAttempts && Array.isArray(allAttempts) && allAttempts.length > 0)
                ? allAttempts
                : attempts;

            // Compute totals from ALL cumulative attempts
            let finalScore = 0;
            let finalTimeSpent = 0;
            for (const att of finalAttempts) {
                if (att.isCorrect) finalScore++;
                finalTimeSpent += att.timeSpentSeconds;
            }

            const sessionRef = doc(collection(db, 'aura_farm_sessions'));
            const sessionPayload = {
                studentId,
                subjectId,
                chapterBinaryCode,
                attempts: finalAttempts,
                completedAt: serverTimestamp(),
                totalTimeSpent: finalTimeSpent,
                score: finalScore,
                totalQuestions: finalAttempts.length
            };

            batch.set(sessionRef, sessionPayload);
            sessionId = sessionRef.id;
        }

        // Commit transaction
        await batch.commit();

        return NextResponse.json({
            success: true,
            ...(sessionId ? { sessionId } : {}),
            streakUpdated: justCrossed10 && !streakAlreadyUpdatedToday,
            dailyTotal: newDayCount
        });

    } catch (error: any) {
        console.error('[aura-farm/submit] Error:', error);
        return NextResponse.json(
            { error: error.message || 'Internal server error' },
            { status: 500 }
        );
    }
}
