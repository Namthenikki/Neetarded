import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { QUIZ_SUBJECTS } from '@/lib/quiz-data';

/**
 * POST /api/custom-quiz/generate
 *
 * Generates a custom quiz by pulling approved questions from the QuestionBank
 * for the specified chapters.
 *
 * Body:
 * {
 *   "title": string,
 *   "chapterCodes": string[],      // e.g. ["#2P0-010110", "#1B0-011101"]
 *   "questionCount": number,        // total questions desired
 *   "settings": { duration, positiveMarks, negativeMarks },
 *   "ownerId": string               // student ID of the creator
 * }
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { title, chapterCodes, questionCount, settings, ownerId } = body;

        if (!title || !chapterCodes?.length || !questionCount || !settings || !ownerId) {
            return NextResponse.json(
                { error: 'Missing required fields: title, chapterCodes, questionCount, settings, ownerId' },
                { status: 400 }
            );
        }

        // Firestore 'in' queries support max 30 values
        if (chapterCodes.length > 30) {
            return NextResponse.json(
                { error: 'Too many chapters selected. Maximum is 30.' },
                { status: 400 }
            );
        }

        // Query approved questions matching the selected chapter codes
        const snapshot = await adminDb
            .collection('QuestionBank')
            .where('chapter_code', 'in', chapterCodes)
            .where('training_status', '==', 'approved')
            .get();

        if (snapshot.empty) {
            return NextResponse.json(
                { error: 'No approved questions found for the selected chapters. Make sure questions are ingested and approved first.' },
                { status: 404 }
            );
        }

        // Collect all questions
        const allQuestions = snapshot.docs.map(doc => ({
            ...doc.data(),
            _docId: doc.id,
        }));

        // Shuffle and pick the requested count
        const shuffled = allQuestions.sort(() => Math.random() - 0.5);
        const selected = shuffled.slice(0, Math.min(questionCount, shuffled.length));

        // Build the quiz structure: group by section -> chapter
        const sectionMap = new Map<string, {
            id: string;
            name: string;
            chapters: Map<string, {
                name: string;
                binaryCode: string;
                questions: any[];
            }>;
        }>();

        for (const q of selected) {
            const sectionId = (q as any).section_id || 'GEN';
            const sectionName = (q as any).section_name || 'General';
            const chapterBinary = (q as any).chapter_binary_code || '000000';
            const chapterName = (q as any).chapter_name || 'Unknown Chapter';

            if (!sectionMap.has(sectionId)) {
                // Try to get the canonical name from QUIZ_SUBJECTS
                const subjectData = QUIZ_SUBJECTS.find(s => s.id === sectionId);
                sectionMap.set(sectionId, {
                    id: sectionId,
                    name: subjectData?.name || sectionName,
                    chapters: new Map(),
                });
            }

            const section = sectionMap.get(sectionId)!;
            const chapterKey = `${sectionId}-${chapterBinary}`;

            if (!section.chapters.has(chapterKey)) {
                // Try to get the canonical chapter name
                const subjectData = QUIZ_SUBJECTS.find(s => s.id === sectionId);
                const chapterData = subjectData?.chapters.find(c => c.binaryCode === chapterBinary);
                section.chapters.set(chapterKey, {
                    name: chapterData?.name || chapterName,
                    binaryCode: chapterBinary,
                    questions: [],
                });
            }

            const chapter = section.chapters.get(chapterKey)!;
            const optimized = (q as any).optimized_json;
            if (optimized) {
                chapter.questions.push({
                    questionNumber: optimized.questionNumber,
                    text: optimized.text,
                    options: optimized.options,
                    correctOptionId: optimized.correctOptionId,
                    explanation: optimized.explanation || undefined,
                    imageUrl: optimized.imageUrl || undefined,
                });
            }
        }

        // Convert maps to the QuizStructure array format
        const structure = Array.from(sectionMap.values()).map(section => ({
            id: section.id,
            name: section.name,
            chapters: Array.from(section.chapters.values()).map(chapter => ({
                name: chapter.name,
                binaryCode: chapter.binaryCode,
                questions: chapter.questions.sort((a, b) => a.questionNumber - b.questionNumber),
            })),
        }));

        // Renumber questions sequentially (1, 2, 3, ...)
        let globalNum = 1;
        for (const section of structure) {
            for (const chapter of section.chapters) {
                for (const q of chapter.questions) {
                    q.questionNumber = globalNum++;
                }
            }
        }

        // Save the quiz to Firestore
        const quizPayload = {
            title,
            settings: {
                duration: settings.duration || 60,
                positiveMarks: settings.positiveMarks || 4,
                negativeMarks: settings.negativeMarks || -1,
            },
            structure,
            isPublished: false,
            createdAt: new Date(),
            ownerId,
            source: 'custom_quiz_builder',
            chapterCodes, // Track which chapters were used
        };

        const docRef = await adminDb.collection('quizzes').add(quizPayload);
        // Also store the ID inside the doc for easy access
        await docRef.update({ id: docRef.id });

        const totalQuestions = structure.reduce(
            (sum, s) => sum + s.chapters.reduce((cs, c) => cs + c.questions.length, 0),
            0
        );

        return NextResponse.json({
            quizId: docRef.id,
            totalQuestions,
            chaptersUsed: chapterCodes.length,
            message: `Custom quiz created with ${totalQuestions} questions from ${chapterCodes.length} chapters.`,
        });

    } catch (error: any) {
        console.error('[custom-quiz/generate] Error:', error);
        return NextResponse.json(
            { error: error.message || 'Internal server error' },
            { status: 500 }
        );
    }
}
