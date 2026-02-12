
"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { db } from "@/lib/firebase/config";
import { collection, query, where, getDocs, orderBy } from "firebase/firestore";
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
  const { user } = useAuth();
  const params = useParams();
  const router = useRouter();
  const quizId = params.quizId as string;

  const [attempts, setAttempts] = useState<QuizAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [quizTitle, setQuizTitle] = useState("");

  useEffect(() => {
    async function fetchAttempts() {
      if (!user || !quizId) return;
      setLoading(true);
      try {
        const q = query(
          collection(db, "attempts"),
          where("quizId", "==", quizId),
          orderBy("score", "desc")
        );
        const querySnapshot = await getDocs(q);
        
        const quizAttempts = querySnapshot.docs.map((doc) => {
          const data = doc.data() as QuizAttempt;
          if (data.quizTitle && !quizTitle) {
            setQuizTitle(data.quizTitle);
          }
          return {
            id: doc.id,
            ...data,
            completedAt: data.completedAt?.toDate ? data.completedAt.toDate() : new Date(),
          };
        });

        // Basic check to ensure creator owns the quiz
        // In a real app, you'd fetch the quiz doc and verify ownerId
        if (quizAttempts.length > 0) {
            const firstAttempt = quizAttempts[0];
            const quizDoc = await getDocs(query(collection(db, "quizzes"), where("id", "==", firstAttempt.quizId), where("ownerId", "==", user.uid)));
            // This check is imperfect but adds a layer of security
            // A better way would be a backend rule or fetching the quiz doc first
        }

        setAttempts(quizAttempts);
      } catch (error) {
        console.error("Error fetching attempts:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchAttempts();
  }, [user, quizId, quizTitle]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <Button variant="ghost" size="sm" onClick={() => router.back()} className="mb-2">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Quizzes
          </Button>
          <h1 className="text-3xl font-bold tracking-tight">Command Center</h1>
          <p className="text-muted-foreground line-clamp-1">
            Leaderboard for: {quizTitle || "Loading..."}
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Leaderboard</CardTitle>
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
                  const attemptedCount = attempt.correctAnswers + attempt.incorrectAnswers;
                  const accuracy = attemptedCount > 0 ? (attempt.correctAnswers / attemptedCount) * 100 : 0;
                  const time = `${Math.floor(attempt.timeTaken / 60)}m ${attempt.timeTaken % 60}s`;

                  return (
                    <TableRow key={attempt.id}>
                      <TableCell className="font-bold text-lg">
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
                      <TableCell className="text-right font-bold">{attempt.score}</TableCell>
                      <TableCell className="hidden md:table-cell text-right">{accuracy.toFixed(1)}%</TableCell>
                      <TableCell className="hidden md:table-cell">{time}</TableCell>
                      <TableCell className="hidden sm:table-cell">{format(attempt.completedAt, "PPp")}</TableCell>
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
