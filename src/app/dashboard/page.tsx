"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { db } from "@/lib/firebase/config";
import { collection, query, where, getDocs, orderBy } from "firebase/firestore";
import { type QuizAttempt } from "@/types/quiz";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, PlusCircle, BarChart, FileText } from "lucide-react";

export default function DashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [attempts, setAttempts] = useState<QuizAttempt[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user || user.role !== 'student') {
      router.replace('/login');
      return;
    }

    async function fetchAttempts() {
      setLoading(true);
      try {
        const q = query(
          collection(db, "attempts"),
          where("studentId", "==", user.studentId),
          orderBy("completedAt", "desc")
        );
        const querySnapshot = await getDocs(q);
        
        const studentAttempts = querySnapshot.docs.map((doc) => {
          const data = doc.data();
          return {
            id: doc.id,
            ...data,
            completedAt: data.completedAt?.toDate ? data.completedAt.toDate() : new Date(),
          } as QuizAttempt;
        });
        setAttempts(studentAttempts);
      } catch (error) {
        console.error("Error fetching attempts:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchAttempts();
  }, [user, authLoading, router]);

  if (loading || authLoading) {
    return (
      <div className="flex h-full min-h-[calc(100vh-10rem)] items-center justify-center p-8">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Welcome back, {user?.name}!</h1>
        <p className="text-slate-600">This is your performance ledger.</p>
      </header>

      <div className="mb-8">
        <Card className="rounded-2xl border-primary/20 bg-card/80 backdrop-blur-sm">
            <CardHeader>
                <CardTitle>Ready for a new Challenge?</CardTitle>
                <CardDescription>Browse available quizzes and test your knowledge.</CardDescription>
            </CardHeader>
            <CardContent>
                <Button asChild size="lg" className="rounded-xl">
                    <Link href="/dashboard/quizzes">
                        <PlusCircle className="mr-2 h-5 w-5" />
                        Browse Quizzes
                    </Link>
                </Button>
            </CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-slate-900"><FileText /> Attempt History</CardTitle>
          <CardDescription>A complete log of all quizzes you've taken.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quiz Title</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead className="hidden sm:table-cell text-right">Accuracy</TableHead>
                <TableHead className="hidden md:table-cell">Date</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {attempts.length > 0 ? (
                attempts.map((attempt) => {
                  const attemptedCount = attempt.correctAnswers + attempt.incorrectAnswers;
                  const accuracy = attemptedCount > 0 ? (attempt.correctAnswers / attemptedCount) * 100 : 0;
                  return (
                    <TableRow key={attempt.id} className="cursor-pointer hover:bg-slate-50" onClick={() => router.push(`/quiz/${attempt.quizId}/result?attemptId=${attempt.id}`)}>
                      <TableCell className="font-medium text-slate-800">{attempt.quizTitle}</TableCell>
                      <TableCell className="text-right font-bold text-slate-800">{attempt.score}</TableCell>
                      <TableCell className="hidden sm:table-cell text-right text-slate-600">{accuracy.toFixed(1)}%</TableCell>
                      <TableCell className="hidden md:table-cell text-slate-600">{format(attempt.completedAt, "PP")}</TableCell>
                      <TableCell className="text-right">
                          <Button asChild variant="ghost" size="sm" className="rounded-lg">
                            <Link href={`/quiz/${attempt.quizId}/result?attemptId=${attempt.id}`} onClick={(e) => e.stopPropagation()}>
                              <BarChart className="h-4 w-4" />
                            </Link>
                          </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                 <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-slate-500">
                    You haven't attempted any quizzes yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
