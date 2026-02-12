
"use client";

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Check, X, Circle, Award } from 'lucide-react';

export default function ResultPage() {
    const searchParams = useSearchParams();
    const attemptId = searchParams.get('attemptId');
    // In a real app, you would fetch the attempt details using this ID
    // For now, we'll just show a success message.

    return (
        <div className="min-h-screen flex items-center justify-center p-4">
            <Card className="w-full max-w-2xl text-center shadow-lg">
                <CardHeader>
                    <div className="mx-auto bg-green-100 rounded-full p-4 w-fit">
                        <Award className="h-12 w-12 text-green-600" />
                    </div>
                    <CardTitle className="mt-4 text-3xl font-bold">Quiz Completed!</CardTitle>
                    <CardDescription className="text-lg">
                        You have successfully submitted your attempt.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-muted-foreground mb-6">
                        Your attempt ID is: <code className="bg-muted px-2 py-1 rounded-md text-sm">{attemptId}</code>
                    </p>
                    <p className="mb-4">
                        In a real application, a detailed performance analysis would be displayed here.
                    </p>
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
