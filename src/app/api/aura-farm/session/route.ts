import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase/config';
import { collection, doc, getDoc, getDocs, query, where, setDoc } from 'firebase/firestore';

/**
 * GET /api/aura-farm/session
 *
 * Fetches a batch of 10 questions for a specific user and chapter.
 * Uses a strict 70/30 split (7 new, 3 from mistake pool).
 * If the mistake pool is < 3, pads with more new questions.
 * If new pool is < 7, pads with more mistake questions.
 *
 * Students can keep requesting new batches indefinitely.
 * When all questions have been seen, returns { exhausted: true }
 * and the client can choose to reshuffle.
 *
 * Query Params:
 * - studentId: string
 * - subjectId: string (e.g., '1B0')
 * - chapterBinaryCode: string (e.g., '010010')
 * - forceReshuffle: string ('true') — used after congrats screen to get reshuffled questions
 */
export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const studentId = searchParams.get('studentId');
        const subjectId = searchParams.get('subjectId');
        const chapterBinaryCode = searchParams.get('chapterBinaryCode');
        const forceReshuffle = searchParams.get('forceReshuffle') === 'true';

        if (!studentId || !subjectId || !chapterBinaryCode) {
            return NextResponse.json(
                { error: 'Missing required parameters: studentId, subjectId, chapterBinaryCode' },
                { status: 400 }
            );
        }

        const chapterStatsId = `${studentId}_${chapterBinaryCode}`;
        const chapterStatsRef = doc(db, 'aura_farm_chapter_stats', chapterStatsId);
        const chapterStatsDoc = await getDoc(chapterStatsRef);

        let questionsSeen: string[] = [];
        let mistakePool: Record<string, number> = {};

        if (chapterStatsDoc.exists()) {
            const data = chapterStatsDoc.data();
            questionsSeen = data?.questionsSeen || [];
            mistakePool = data?.mistakePool || {};
        }

        // Fetch all approved questions for this chapter
        const chapterKey = `#${subjectId}-${chapterBinaryCode}`;
        const qBankRef = collection(db, 'QuestionBank');
        const qQuery = query(qBankRef, where('chapter_code', '==', chapterKey), where('training_status', '==', 'approved'));
        const questionsSnapshot = await getDocs(qQuery);

        if (questionsSnapshot.empty) {
            return NextResponse.json(
                { error: 'No approved questions found for this chapter.' },
                { status: 404 }
            );
        }

        const allQuestions = questionsSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        // Exhaustion check: if all questions have been seen
        if (questionsSeen.length >= allQuestions.length && allQuestions.length > 0) {
            if (!forceReshuffle) {
                // Return exhausted flag so client can show congrats message first
                return NextResponse.json({
                    exhausted: true,
                    questions: [],
                    totalAvailable: allQuestions.length,
                    seenCount: questionsSeen.length,
                    mistakePoolSize: Object.keys(mistakePool).length
                });
            }

            // Force reshuffle: reset questionsSeen and continue
            questionsSeen = [];
            await setDoc(chapterStatsRef, { questionsSeen: [] }, { merge: true });
        }

        // --- Strict 70/30 split logic ---
        const BATCH_SIZE = 10;
        const TARGET_NEW = 7;      // 70% new/unseen
        const TARGET_MISTAKES = 3; // 30% from mistake pool

        const mistakeQuestionIds = Object.keys(mistakePool);

        // Mistake candidates: questions in the mistake pool that exist in the DB
        const mistakeCandidates = allQuestions
            .filter(q => mistakeQuestionIds.includes(q.id))
            .sort(() => Math.random() - 0.5);

        // New candidates: questions not seen yet AND not in mistake pool
        const newCandidates = allQuestions
            .filter(q => !questionsSeen.includes(q.id) && !mistakeQuestionIds.includes(q.id))
            .sort(() => Math.random() - 0.5);

        // Pick from each pool
        let selectedMistakes = mistakeCandidates.slice(0, TARGET_MISTAKES);
        let selectedNew = newCandidates.slice(0, TARGET_NEW);

        // Pad if mistake pool is insufficient — fill with more new questions
        if (selectedMistakes.length < TARGET_MISTAKES) {
            const deficit = TARGET_MISTAKES - selectedMistakes.length;
            const extraNew = newCandidates.slice(selectedNew.length, selectedNew.length + deficit);
            selectedNew = [...selectedNew, ...extraNew];
        }

        // Pad if new pool is insufficient — fill with more mistake questions
        if (selectedNew.length < TARGET_NEW) {
            const deficit = TARGET_NEW - selectedNew.length;
            const extraMistakes = mistakeCandidates.slice(selectedMistakes.length, selectedMistakes.length + deficit);
            selectedMistakes = [...selectedMistakes, ...extraMistakes];
        }

        // If both pools combined are still < BATCH_SIZE, pad with previously seen (non-mistake) questions
        let sessionQuestions = [...selectedNew, ...selectedMistakes];
        if (sessionQuestions.length < BATCH_SIZE) {
            const seenNonMistake = allQuestions
                .filter(q => questionsSeen.includes(q.id) && !mistakeQuestionIds.includes(q.id))
                .sort(() => Math.random() - 0.5);
            const remaining = BATCH_SIZE - sessionQuestions.length;
            sessionQuestions = [...sessionQuestions, ...seenNonMistake.slice(0, remaining)];
        }

        // Final shuffle so mistakes and new are interleaved randomly
        sessionQuestions.sort(() => Math.random() - 0.5);

        // Format for frontend
        const formattedQuestions = sessionQuestions.map((q: any) => ({
            id: q.id,
            questionNumber: q.optimized_json?.questionNumber || 0,
            text: q.optimized_json?.text || '',
            options: q.optimized_json?.options || [],
            correctOptionId: q.optimized_json?.correctOptionId || '',
            explanation: q.optimized_json?.explanation || '',
            imageUrl: q.optimized_json?.imageUrl || '',
            source: q.source_paper || '',
            topicTag: q.ai_classified_topic || q.sub_topic_name || q.topic_name || q.chapter_name || 'Unclassified',
            difficulty: q.difficulty || 'medium'
        }));

        return NextResponse.json({
            exhausted: false,
            questions: formattedQuestions,
            totalAvailable: allQuestions.length,
            seenCount: questionsSeen.length,
            mistakePoolSize: mistakeQuestionIds.length
        });

    } catch (error: any) {
        console.error('[aura-farm/session] Error:', error);
        return NextResponse.json(
            { error: error.message || 'Internal server error' },
            { status: 500 }
        );
    }
}
