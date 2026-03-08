import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase/config';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { QUIZ_SUBJECTS } from '@/lib/quiz-data';

/**
 * GET /api/aura-farm/day-stats?studentId=X&date=YYYY-MM-DD
 *
 * Returns all sessions for a student on a given date.
 * Used by the calendar popup to show day-specific performance.
 */
export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const studentId = searchParams.get('studentId');
        const dateStr = searchParams.get('date'); // YYYY-MM-DD

        if (!studentId || !dateStr) {
            return NextResponse.json(
                { error: 'Missing studentId or date' },
                { status: 400 }
            );
        }

        // Build timestamp range for the given date in IST (UTC+5:30)
        // dateStr is "YYYY-MM-DD" in IST
        const startOfDayIST = new Date(`${dateStr}T00:00:00+05:30`);
        const endOfDayIST = new Date(`${dateStr}T23:59:59.999+05:30`);

        const sessionsRef = collection(db, 'aura_farm_sessions');
        // Query only by studentId to avoid requiring a composite index,
        // then filter by date range in memory
        const q = query(
            sessionsRef,
            where('studentId', '==', studentId)
        );

        const allSnapshot = await getDocs(q);

        // Filter by date in memory
        const matchingDocs = allSnapshot.docs.filter(doc => {
            const data = doc.data();
            if (!data.completedAt) return false;
            const completedDate = data.completedAt.toDate();
            return completedDate >= startOfDayIST && completedDate <= endOfDayIST;
        });

        if (matchingDocs.length === 0) {
            return NextResponse.json({ sessions: [], summary: null });
        }

        // Build chapter name lookup
        const chapterNameMap: Record<string, string> = {};
        const subjectNameMap: Record<string, string> = {};
        for (const subject of QUIZ_SUBJECTS) {
            subjectNameMap[subject.id] = subject.name;
            for (const chapter of subject.chapters) {
                // Key by subjectId + binaryCode for uniqueness
                chapterNameMap[`${subject.id}_${chapter.binaryCode}`] = chapter.name;
            }
        }

        let totalQuestions = 0;
        let totalCorrect = 0;
        let totalTimeSpent = 0;
        const chapterBreakdown: Record<string, {
            chapterName: string;
            subjectName: string;
            questionsAttempted: number;
            correct: number;
            timeSpent: number;
        }> = {};

        const sessions = matchingDocs.map((docSnap) => {
            const data = docSnap.data();
            const key = `${data.subjectId}_${data.chapterBinaryCode}`;
            const chapterName = chapterNameMap[key] || data.chapterBinaryCode;
            const subjectName = subjectNameMap[data.subjectId] || data.subjectId;

            totalQuestions += data.totalQuestions || 0;
            totalCorrect += data.score || 0;
            totalTimeSpent += data.totalTimeSpent || 0;

            if (!chapterBreakdown[key]) {
                chapterBreakdown[key] = {
                    chapterName,
                    subjectName,
                    questionsAttempted: 0,
                    correct: 0,
                    timeSpent: 0,
                };
            }
            chapterBreakdown[key].questionsAttempted += data.totalQuestions || 0;
            chapterBreakdown[key].correct += data.score || 0;
            chapterBreakdown[key].timeSpent += data.totalTimeSpent || 0;

            return {
                sessionId: docSnap.id,
                subjectName,
                chapterName,
                score: data.score,
                totalQuestions: data.totalQuestions,
                totalTimeSpent: data.totalTimeSpent,
            };
        });

        const accuracy = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0;

        return NextResponse.json({
            sessions,
            summary: {
                totalSessions: sessions.length,
                totalQuestions,
                totalCorrect,
                accuracy,
                totalTimeSpent,
                chapters: Object.values(chapterBreakdown),
            },
        });

    } catch (error: any) {
        console.error('[aura-farm/day-stats] Error:', error);
        return NextResponse.json(
            { error: error.message || 'Internal server error' },
            { status: 500 }
        );
    }
}
