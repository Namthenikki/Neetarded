"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { db } from "@/lib/firebase/config";
import { collection, query, where, getDocs, deleteDoc, doc, orderBy } from "firebase/firestore";
import Link from "next/link";
import { type Quiz, type QuizAttempt } from "@/types/quiz";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Trash2, Search, BarChart, BookOpen, User } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";

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

    if (chartData.length === 0) return <p className="text-muted-foreground text-center py-8">No attempt data to show.</p>;

    return (
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
    );
}


export default function AdminPage() {
  const { user, loading: authLoading, logout } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [loadingQuizzes, setLoadingQuizzes] = useState(true);
  const [deletingQuizId, setDeletingQuizId] = useState<string | null>(null);

  const [searchId, setSearchId] = useState("");
  const [searchedStudent, setSearchedStudent] = useState<{name: string, attempts: QuizAttempt[]} | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user || user.role !== 'admin') {
      logout();
      return;
    }

    async function fetchQuizzes() {
      setLoadingQuizzes(true);
      try {
        const querySnapshot = await getDocs(collection(db, "quizzes"));
        const allQuizzes = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Quiz));
        setQuizzes(allQuizzes);
      } catch (error) {
        console.error("Error fetching quizzes:", error);
        toast({ variant: 'destructive', title: 'Failed to load quizzes.' });
      } finally {
        setLoadingQuizzes(false);
      }
    }
    fetchQuizzes();
  }, [user, authLoading, logout, toast]);
  
  const handleDeleteQuiz = async (quizId: string) => {
    if (!window.confirm("Are you absolutely sure? This will permanently delete this quiz and its data.")) {
        return;
    }

    setDeletingQuizId(quizId);
    try {
      await deleteDoc(doc(db, "quizzes", quizId));
      setQuizzes(prevQuizzes => prevQuizzes.filter(q => q.id !== quizId));
      toast({ title: 'Quiz Deleted' });
    } catch (error: any) {
      console.error("Failed to delete quiz:", error);
      alert("Failed to delete quiz: " + error.message);
    } finally {
      setDeletingQuizId(null);
    }
  }

  const handleStudentSearch = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!searchId) return;
      setSearching(true);
      setSearchedStudent(null);
      try {
          const userQuery = query(collection(db, "users"), where("studentId", "==", searchId));
          const userSnapshot = await getDocs(userQuery);

          if (userSnapshot.empty) {
              toast({ variant: 'destructive', title: 'Student not found.' });
              setSearching(false);
              return;
          }
          const studentName = userSnapshot.docs[0].data().name;

          const attemptsQuery = query(collection(db, "attempts"), where("studentId", "==", searchId), orderBy("completedAt", "asc"));
          const attemptsSnapshot = await getDocs(attemptsQuery);
          const studentAttempts = attemptsSnapshot.docs.map(d => ({...d.data(), completedAt: d.data().completedAt.toDate()}) as QuizAttempt);

          setSearchedStudent({ name: studentName, attempts: studentAttempts });
      } catch (error) {
        console.error("Error searching student:", error);
        toast({ variant: 'destructive', title: 'Failed to search student.' });
      } finally {
        setSearching(false);
      }
  }


  if (authLoading) {
    return <div className="flex h-screen items-center justify-center"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>;
  }

  return (
    <div className="p-4 md:p-8 space-y-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Admin Command Center</h1>
        <p className="text-slate-600">Manage quizzes and view student analytics.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-slate-900"><User /> Student Lookup</CardTitle>
            <CardDescription>Enter a student ID to analyze their performance.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleStudentSearch} className="flex gap-2">
              <Input 
                placeholder="e.g. sourav" 
                value={searchId}
                onChange={(e) => setSearchId(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))}
                className="rounded-xl bg-white"
              />
              <Button type="submit" disabled={searching} className="rounded-xl">
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search />}
              </Button>
            </form>
            {searchedStudent && (
              <div className="mt-6">
                <h3 className="font-bold text-lg text-slate-800">{searchedStudent.name}'s Growth Chart</h3>
                <ScoreHistoryChart data={searchedStudent.attempts} />
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-slate-900"><BookOpen /> Manage Quizzes</CardTitle>
            <CardDescription>View, analyze, or delete existing quizzes.</CardDescription>
          </CardHeader>
          <CardContent className="max-h-[400px] overflow-y-auto">
            {loadingQuizzes ? <Loader2 className="mx-auto my-8 h-8 w-8 animate-spin text-primary" /> :
              <div className="space-y-3">
                <AnimatePresence>
                  {quizzes.map(quiz => (
                    <motion.div 
                        key={quiz.id} 
                        layout
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, x: -50, transition: { duration: 0.3 } }}
                        className="flex items-center justify-between rounded-xl border p-3 bg-slate-50"
                    >
                      <div className="flex-1 overflow-hidden pr-2">
                        <p className="font-semibold line-clamp-1 text-slate-800">{quiz.title}</p>
                        <p className="text-xs text-slate-500 font-mono">{quiz.id}</p>
                      </div>
                      <div className="flex gap-2">
                          <Button asChild variant="outline" size="sm" className="rounded-lg">
                              <Link href={`/dashboard/stats/${quiz.id}`}><BarChart className="h-4 w-4" /></Link>
                          </Button>
                          <Button 
                              variant="destructive" 
                              size="sm" 
                              onClick={() => handleDeleteQuiz(quiz.id)} 
                              disabled={deletingQuizId === quiz.id}
                              className="rounded-lg"
                          >
                              {deletingQuizId === quiz.id ? <Loader2 className="h-4 w-4 animate-spin"/> : <Trash2 className="h-4 w-4"/>}
                          </Button>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            }
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
