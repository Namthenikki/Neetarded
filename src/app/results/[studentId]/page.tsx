
"use client";

import { useState, useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { db } from "@/lib/firebase/config";
import { collection, query, where, getDocs, orderBy } from "firebase/firestore";
import Link from "next/link";
import { type QuizAttempt, SectionPerformance } from "@/types/quiz";
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
import { Loader2, ArrowLeft, TrendingUp, Target, BarChart, FileText, Check, X, Share2, User } from "lucide-react";
import { format } from "date-fns";
import { LineChart, Line, Bar, BarChart as RechartsBarChart, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { useToast } from "@/hooks/use-toast";


const ScoreHistoryChart = ({ data }: { data: QuizAttempt[] }) => {
    const chartData = useMemo(() => {
        return data
            .sort((a,b) => a.completedAt.getTime() - b.completedAt.getTime())
            .map(attempt => ({
                date: format(attempt.completedAt, "MMM d"),
                score: attempt.score,
                quiz: attempt.quizTitle
            }));
    }, [data]);

    return (
        <Card>
            <CardHeader>
                <CardTitle>Score History</CardTitle>
                <CardDescription>Your performance over time.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="h-[250px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chartData}>
                            <XAxis dataKey="date" stroke="#888" fontSize={12} />
                            <YAxis stroke="#888" fontSize={12} />
                            <Tooltip content={({ active, payload, label }) => {
                                if (active && payload?.length) {
                                    return <div className="p-2 bg-background border rounded-lg shadow-lg">
                                        <p className="font-bold">{label}</p>
                                        <p className="text-primary">Score: {payload[0].value}</p>
                                        <p className="text-xs text-muted-foreground">{payload[0].payload.quiz}</p>
                                    </div>
                                }
                                return null;
                            }} />
                            <Line type="monotone" dataKey="score" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 8 }}/>
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            </CardContent>
        </Card>
    )
}

const AggregateSectionChart = ({ data }: { data: QuizAttempt[] }) => {
    const chartData = useMemo(() => {
        const sections: { [key: string]: { name: string, correct: number, incorrect: number, totalQuestions: number } } = {};
        data.forEach(attempt => {
            attempt.sectionPerformance.forEach(sec => {
                if (!sections[sec.sectionId]) {
                    sections[sec.sectionId] = { name: sec.sectionName, correct: 0, incorrect: 0, totalQuestions: 0 };
                }
                sections[sec.sectionId].correct += sec.correct;
                sections[sec.sectionId].incorrect += sec.incorrect;
                sections[sec.sectionId].totalQuestions += sec.totalQuestions;
            });
        });
        return Object.values(sections).map(s => {
            return {
                name: s.name,
                accuracy: s.totalQuestions > 0 ? (s.correct / s.totalQuestions) * 100 : 0,
                correct: s.correct,
                incorrect: s.incorrect
            }
        });
    }, [data]);

     return (
        <Card>
            <CardHeader>
                <CardTitle>Overall Strengths</CardTitle>
                <CardDescription>Aggregate accuracy per subject.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="h-[250px]">
                   <ResponsiveContainer width="100%" height="100%">
                        <RechartsBarChart data={chartData}>
                            <XAxis dataKey="name" stroke="#888" fontSize={12} />
                            <YAxis stroke="#888" fontSize={12} tickFormatter={v => `${v}%`} domain={[0, 100]} />
                            <Tooltip cursor={{fill: 'hsl(var(--muted))'}} content={({ active, payload, label }) => {
                                 if (active && payload?.length) {
                                    return <div className="p-2 bg-background border rounded-lg shadow-lg">
                                        <p className="font-bold">{label}</p>
                                        <p className="text-primary">Accuracy: {payload[0].value?.toFixed(1)}%</p>
                                        <p className="text-sm text-green-500">Correct: {payload[0].payload.correct}</p>
                                        <p className="text-sm text-red-500">Incorrect: {payload[0].payload.incorrect}</p>
                                    </div>
                                }
                                return null;
                            }} />
                            <Bar dataKey="accuracy" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                        </RechartsBarChart>
                    </ResponsiveContainer>
                </div>
            </CardContent>
        </Card>
    )
}


export default function StudentResultsPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const studentId = params.studentId as string;

  const [attempts, setAttempts] = useState<QuizAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [studentName, setStudentName] = useState("");

  useEffect(() => {
    async function fetchAttempts() {
      if (!studentId) return;
      setLoading(true);
      try {
        const q = query(
          collection(db, "attempts"),
          where("studentId", "==", studentId),
          orderBy("completedAt", "desc")
        );
        const querySnapshot = await getDocs(q);
        
        const studentAttempts = querySnapshot.docs.map((doc) => {
          const data = doc.data() as QuizAttempt;
          if (data.studentName && !studentName) {
            setStudentName(data.studentName);
          }
          return {
            id: doc.id,
            ...data,
            completedAt: data.completedAt?.toDate ? data.completedAt.toDate() : new Date(),
          };
        });

        setAttempts(studentAttempts);
      } catch (error) {
        console.error("Error fetching attempts:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchAttempts();
  }, [studentId, studentName]);

  const handleShare = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url);
    toast({ title: "Profile Link Copied!", description: "Share your performance with others."});
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center p-8">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }
  
  if (attempts.length === 0) {
      return (
          <div className="flex h-screen items-center justify-center text-center p-4">
              <div>
                  <User className="h-12 w-12 text-muted-foreground mx-auto" />
                  <h1 className="mt-4 text-2xl font-bold">Student Record Not Found</h1>
                  <p className="text-muted-foreground mt-2">No attempts found for ID: {studentId}</p>
                   <Button asChild className="mt-6">
                      <Link href="/dashboard">Go to Dashboard</Link>
                  </Button>
              </div>
          </div>
      )
  }

  return (
    <div className="p-4 md:p-8 space-y-6">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Student Record</h1>
          <p className="text-muted-foreground line-clamp-1">
            Performance profile for: {studentName} ({studentId})
          </p>
        </div>
        <Button onClick={handleShare} variant="outline"><Share2 className="mr-2"/> Share Profile</Button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ScoreHistoryChart data={attempts} />
        <AggregateSectionChart data={attempts} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Attempt History</CardTitle>
          <CardDescription>
            A complete log of all quizzes taken.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quiz Title</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead className="text-right">Accuracy</TableHead>
                <TableHead className="hidden sm:table-cell">Date</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {attempts.map((attempt) => {
                  const accuracy = attempt.totalQuestions > 0 ? (attempt.correctAnswers / attempt.totalQuestions) * 100 : 0;
                  return (
                    <TableRow key={attempt.id}>
                      <TableCell className="font-medium">{attempt.quizTitle}</TableCell>
                      <TableCell className="text-right font-bold">{attempt.score}</TableCell>
                      <TableCell className="text-right">{accuracy.toFixed(1)}%</TableCell>
                      <TableCell className="hidden sm:table-cell">{format(attempt.completedAt, "PPP")}</TableCell>
                      <TableCell className="text-right">
                          <Button asChild variant="secondary" size="sm">
                            <Link href={`/quiz/${attempt.quizId}/result?attemptId=${attempt.id}`}>Review</Link>
                          </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
