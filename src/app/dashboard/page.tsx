
"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { db } from "@/lib/firebase/config";
import { collection, query, where, getDocs, orderBy, getDoc, doc, onSnapshot } from "firebase/firestore";
import { type QuizAttempt, type AssignedQuiz, type Quiz } from "@/types/quiz";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, PlusCircle, BarChart, FileText, Target, Rocket } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function DashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [attempts, setAttempts] = useState<QuizAttempt[]>([]);
  const [assignments, setAssignments] = useState<(AssignedQuiz & { quiz: Quiz })[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user || user.role !== 'student') {
      router.replace('/login');
      return;
    }

    let isMounted = true;
    let unsubscribeAssignments: () => void = () => {};

    async function fetchInitialData() {
      if (!user || !isMounted) return;
      setLoading(true);
      try {
        // Fetch past attempts (one-time fetch)
        const attemptsQuery = query(
          collection(db, "attempts"),
          where("studentId", "==", user.studentId),
          orderBy("completedAt", "desc")
        );
        const attemptsSnapshot = await getDocs(attemptsQuery);
        if (isMounted) {
          const studentAttempts = attemptsSnapshot.docs.map((doc) => {
            const data = doc.data();
            return {
              id: doc.id,
              ...data,
              completedAt: data.completedAt?.toDate ? data.completedAt.toDate() : new Date(),
            } as QuizAttempt;
          });
          setAttempts(studentAttempts);
        }

        // Set up real-time listener for new assignments
        const assignmentsQuery = query(
          collection(db, "assigned_quizzes"),
          where("studentId", "==", user.studentId),
          where("status", "==", "pending")
        );
        
        unsubscribeAssignments = onSnapshot(assignmentsQuery, async (snapshot) => {
          console.log("Current Student ID:", user.studentId);
          console.log("Assigned Quizzes Found:", snapshot.docs.length);
          
          const promises = snapshot.docs.map(async (assignmentDoc) => {
            const assignmentData = { id: assignmentDoc.id, ...assignmentDoc.data() } as AssignedQuiz;
            const quizDoc = await getDoc(doc(db, "quizzes", assignmentData.quizId));
            if (quizDoc.exists()) {
              return { ...assignmentData, quiz: quizDoc.data() as Quiz };
            }
            return null;
          });

          const results = await Promise.all(promises);
          if (isMounted) {
            const validAssignments = results
              .filter((a): a is AssignedQuiz & { quiz: Quiz } => a !== null)
              .sort((a, b) => b.assignedAt.toDate().getTime() - a.assignedAt.toDate().getTime());
            setAssignments(validAssignments);
          }
        });

      } catch (error) {
        console.error("Error fetching dashboard data:", error);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    fetchInitialData();

    return () => {
      isMounted = false;
      unsubscribeAssignments();
    };
  }, [user, authLoading, router]);

  if (loading || authLoading) {
    return (
      <div className="flex h-full min-h-[calc(100vh-10rem)] items-center justify-center p-8">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 space-y-8">
      <header className="mb-4">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Welcome back, {user?.name}!</h1>
        <p className="text-slate-600">This is your performance ledger.</p>
      </header>

      {assignments.length > 0 && (
        <Card className="rounded-2xl">
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><Target className="text-primary"/> Assigned Tasks</CardTitle>
                <CardDescription>Your instructor has assigned these quizzes to you. They require your immediate attention.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                {assignments.map(assignment => (
                  <div key={assignment.id} className="flex items-center justify-between rounded-xl border-l-4 border-primary bg-slate-50 p-4 shadow-sm">
                     <div className="flex-1">
                        <div className="flex items-center gap-3">
                            <p className="font-semibold text-slate-800">{assignment.quizTitle}</p>
                            <Badge variant="secondary">Admin Assigned</Badge>
                        </div>
                        <p className="text-xs text-slate-500 mt-1">Assigned on {format(assignment.assignedAt.toDate(), "PP")}</p>
                      </div>
                      <Button asChild>
                          <Link href={`/quiz/${assignment.quizId}`}><Rocket className="mr-2"/> Start Now</Link>
                      </Button>
                  </div>
                ))}
            </CardContent>
        </Card>
      )}

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

       <Card className="rounded-2xl border-dashed">
            <CardHeader>
                <CardTitle>Looking for a new Challenge?</CardTitle>
                <CardDescription>Browse all public quizzes and test your knowledge.</CardDescription>
            </CardHeader>
            <CardContent>
                <Button asChild>
                    <Link href="/dashboard/quizzes">
                        <PlusCircle className="mr-2 h-5 w-5" />
                        Browse All Quizzes
                    </Link>
                </Button>
            </CardContent>
        </Card>
    </div>
  );
}
