
"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { db } from "@/lib/firebase/config";
import { collection, query, where, getDocs, orderBy, getDoc, doc } from "firebase/firestore";
import Link from "next/link";
import { type QuizAttempt } from "@/types/quiz";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft, Trophy, User } from "lucide-react";
import { format } from "date-fns";

export default function QuizStatsPage() {
  const { user, loading: authLoading, logout } = useAuth();
  const params = useParams();
  const router = useRouter();
  const quizId = params.quizId as string;

  const [attempts, setAttempts] = useState<QuizAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [quizTitle, setQuizTitle] = useState("");

  useEffect(() => {
    if (authLoading || !user) return;

    async function fetchStats() {
      if (user.role !== 'admin') {
          logout();
          router.replace('/login');
          return;
      }
      setLoading(true);

      try {
        const quizDoc = await getDoc(doc(db, "quizzes", quizId));
        if (quizDoc.exists()) {
            setQuizTitle(quizDoc.data().title);
        } else {
            router.replace('/dashboard/admin');
            return;
        }

        // Primary query with ordering
        const primaryQuery = query(
          collection(db, "attempts"),
          where("quizId", "==", quizId),
          orderBy("score", "desc")
        );
        const querySnapshot = await getDocs(primaryQuery);
        
        const quizAttempts = querySnapshot.docs.map((doc) => {
          const data = doc.data() as QuizAttempt;
          return {
            id: doc.id,
            ...data,
            completedAt: data.completedAt?.toDate ? data.completedAt.toDate() : new Date(),
          };
        });

        setAttempts(quizAttempts);
        console.log("Fetched attempts with ordering:", quizAttempts.length);

      } catch (error) {
        console.warn("Primary query failed (likely missing index). Retrying without ordering. Error:", error);
        // Fallback query without ordering
        try {
            const fallbackQuery = query(
              collection(db, "attempts"),
              where("quizId", "==", quizId)
            );
            const fallbackSnapshot = await getDocs(fallbackQuery);
            const quizAttempts = fallbackSnapshot.docs.map((doc) => {
              const data = doc.data() as QuizAttempt;
              return {
                id: doc.id,
                ...data,
                completedAt: data.completedAt?.toDate ? data.completedAt.toDate() : new Date(),
              };
            }).sort((a, b) => b.score - a.score); // Manual sorting

            setAttempts(quizAttempts);
            console.log("Fetched attempts with fallback and manual sort:", quizAttempts.length);

        } catch (fallbackError) {
            console.error("Error fetching attempts with fallback:", fallbackError);
        }

      } finally {
        setLoading(false);
      }
    }

    fetchStats();
  }, [user, authLoading, quizId, router, logout]);

  if (loading || authLoading) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8">
      <header className="mb-8">
        <Button variant="ghost" size="sm" onClick={() => router.back()} className="mb-2 rounded-2xl">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Admin
        </Button>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Command Center</h1>
        <p className="text-slate-600 line-clamp-1">
          Leaderboard for: {quizTitle || "Loading..."}
        </p>
      </header>

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="text-slate-900">Leaderboard</CardTitle>
          <CardDescription>
            See how students performed on your quiz.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]">Rank</TableHead>
                <TableHead>Student</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead className="hidden md:table-cell text-right">Accuracy</TableHead>
                <TableHead className="hidden md:table-cell">Time Taken</TableHead>
                <TableHead className="hidden sm:table-cell">Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {attempts.length > 0 ? (
                attempts.map((attempt, index) => {
                  const accuracy = attempt.totalQuestions > 0 ? (attempt.correctAnswers / attempt.totalQuestions) * 100 : 0;
                  const time = `${Math.floor(attempt.timeTaken / 60)}m ${attempt.timeTaken % 60}s`;

                  return (
                    <TableRow key={attempt.id}>
                      <TableCell className="font-bold text-lg text-slate-700">
                        {index === 0 && <Trophy className="h-5 w-5 text-yellow-500 inline-block" />}
                        {index === 1 && <Trophy className="h-5 w-5 text-slate-400 inline-block" />}
                        {index === 2 && <Trophy className="h-5 w-5 text-amber-700 inline-block" />}
                        {index > 2 && index + 1}
                      </TableCell>
                      <TableCell>
                        <Link href={`/results/${attempt.studentId}`} className="font-medium text-primary hover:underline flex items-center gap-2">
                          <User className="h-4 w-4" /> {attempt.studentName}
                        </Link>
                        <div className="text-xs text-muted-foreground font-mono">{attempt.studentId}</div>
                      </TableCell>
                      <TableCell className="text-right font-bold text-slate-800">{attempt.score}</TableCell>
                      <TableCell className="hidden md:table-cell text-right text-slate-600">{accuracy.toFixed(1)}%</TableCell>
                      <TableCell className="hidden md:table-cell text-slate-600">{time}</TableCell>
                      <TableCell className="hidden sm:table-cell text-slate-600">{format(attempt.completedAt, "PPp")}</TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center">
                    No one has attempted this quiz yet.
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
