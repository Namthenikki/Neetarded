
"use client";

import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Award, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { db } from '@/lib/firebase/config';
import { doc, getDoc } from 'firebase/firestore';
import { type QuizAttempt } from '@/types/quiz';
import { useState, useEffect } from 'react';

export default function ResultPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { user } = useAuth();
    const attemptId = searchParams.get('attemptId');

    const [attempt, setAttempt] = useState<QuizAttempt | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchAttempt() {
            if (!attemptId || !user) return;
            try {
                const attemptDoc = await getDoc(doc(db, "attempts", attemptId));
                if (attemptDoc.exists()) {
                    const data = attemptDoc.data() as QuizAttempt;
                    if (data.userId === user.uid) {
                        setAttempt(data);
                    } else {
                        // unauthorized access
                       router.push('/dashboard');
                    }
                } else {
                    // not found
                    router.push('/dashboard');
                }
            } catch(e) {
                console.error("Error fetching attempt:", e);
            } finally {
                setLoading(false);
            }
        }
        fetchAttempt();
    }, [attemptId, user, router]);
    
    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
            </div>
        );
    }
    
    if (!attempt) {
        return (
             <div className="flex h-screen items-center justify-center text-center">
                <div>
                    <h1 className="text-2xl font-bold">Could not load results.</h1>
                    <p className="text-muted-foreground">The attempt was not found or you do not have permission to view it.</p>
                     <Button asChild className="mt-4">
                        <Link href="/dashboard">Go to Dashboard</Link>
                    </Button>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-background">
            <Card className="w-full max-w-2xl text-center shadow-lg">
                <CardHeader>
                    <div className="mx-auto bg-green-100 rounded-full p-4 w-fit">
                        <Award className="h-12 w-12 text-green-600" />
                    </div>
                    <CardTitle className="mt-4 text-3xl font-bold">Quiz Completed!</CardTitle>
                    <CardDescription className="text-lg">
                        You have successfully submitted your attempt for <span className="font-semibold">{attempt.quizTitle}</span>.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 gap-4 my-6 text-left">
                        <div className="rounded-lg border p-4">
                            <p className="text-sm text-muted-foreground">Your Score</p>
                            <p className="text-2xl font-bold">{attempt.score}</p>
                        </div>
                        <div className="rounded-lg border p-4">
                            <p className="text-sm text-muted-foreground">Accuracy</p>
                            <p className="text-2xl font-bold">{((attempt.correctAnswers / attempt.totalQuestions) * 100).toFixed(2)}%</p>
                        </div>
                        <div className="rounded-lg border p-4">
                            <p className="text-sm text-muted-foreground">Correct</p>
                            <p className="text-2xl font-bold text-green-600">{attempt.correctAnswers}</p>
                        </div>
                        <div className="rounded-lg border p-4">
                            <p className="text-sm text-muted-foreground">Incorrect</p>
                            <p className="text-2xl font-bold text-destructive">{attempt.incorrectAnswers}</p>
                        </div>
                    </div>
                    
                    <p className="mb-6 text-muted-foreground">A detailed performance analysis will be available soon.</p>
                    
                    <div className="flex justify-center gap-4">
                        <Button asChild>
                            <Link href="/dashboard/quizzes">Back to Quizzes</Link>
                        </Button>
                        <Button variant="outline" asChild>
                            <Link href="/dashboard">Go to Dashboard</Link>
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
