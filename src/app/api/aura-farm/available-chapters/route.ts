import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase/config';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { QUIZ_SUBJECTS } from '@/lib/quiz-data';

export async function GET() {
    try {
        const qBankRef = collection(db, 'QuestionBank');
        // We only care about approved questions
        const qQuery = query(qBankRef, where('training_status', '==', 'approved'));
        const snapshot = await getDocs(qQuery);

        // Track available chapters and their question counts
        const chapterQuestionCounts = new Map<string, number>();

        snapshot.docs.forEach(doc => {
            const data = doc.data();
            if (data.chapter_code) {
                // chapter_code format is usually "#1B0-010010"
                const parts = data.chapter_code.split('-');
                if (parts.length === 2) {
                    const key = data.chapter_code; // full key including subject prefix
                    chapterQuestionCounts.set(key, (chapterQuestionCounts.get(key) || 0) + 1);
                }
            }
        });

        // Map back to our subjects structure, filtering out empty chapters
        const availableSubjects = QUIZ_SUBJECTS.map(subject => {
            const activeChapters = subject.chapters
                .map(chapter => {
                    const fullKey = `#${subject.id}-${chapter.binaryCode}`;
                    const count = chapterQuestionCounts.get(fullKey) || 0;
                    return {
                        ...chapter,
                        questionCount: count
                    };
                })
                .filter(chapter => chapter.questionCount > 0);
            return {
                ...subject,
                chapters: activeChapters
            };
        }).filter(subject => subject.chapters.length > 0);

        return NextResponse.json({ subjects: availableSubjects });
    } catch (error: any) {
        console.error('[aura-farm/available-chapters] Error:', error);
        return NextResponse.json({ error: 'Failed to fetch available chapters' }, { status: 500 });
    }
}

