
"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { db } from "@/lib/firebase/config";
import { collection, query, where, getDocs } from "firebase/firestore";
import Link from "next/link";
import { type Quiz } from "@/types/quiz";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Clock, PlusCircle, Loader2 } from "lucide-react";
import { format } from "date-fns";

export default function QuizzesPage() {
  const { user } = useAuth();
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchQuizzes() {
      if (!user) return;
      try {
        const q = query(collection(db, "quizzes"), where("ownerId", "==", user.uid));
        const querySnapshot = await getDocs(q);
        const userQuizzes = querySnapshot.docs.map((doc) => {
            const data = doc.data();
            return {
                ...data,
                // Firestore Timestamps need to be converted to JS Dates
                createdAt: data.createdAt.toDate(),
            } as Quiz;
        });
        setQuizzes(userQuizzes.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
      } catch (error) {
        console.error("Error fetching quizzes:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchQuizzes();
  }, [user]);
  
  if (loading) {
    return (
        <div className="flex items-center justify-center h-full p-8">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
        </div>
    )
  }

  return (
    <div className="p-4 md:p-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">My Quizzes</h1>
          <p className="text-muted-foreground">
            All quizzes you have created are listed here.
          </p>
        </div>
        <Button asChild>
            <Link href="/dashboard/create">
                <PlusCircle className="mr-2 h-4 w-4" />
                Create New
            </Link>
        </Button>
      </header>

      {quizzes.length > 0 ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {quizzes.map((quiz) => (
            <Card key={quiz.id} className="flex flex-col">
              <CardHeader>
                <CardTitle className="line-clamp-2">{quiz.title}</CardTitle>
                <CardDescription>
                  Created on {format(quiz.createdAt, "PPP")}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-grow">
                 <div className="space-y-2 text-sm text-muted-foreground">
                    <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4" />
                        <span>{quiz.structure.reduce((acc, s) => acc + s.chapters.reduce((cAcc, c) => cAcc + (c.questions?.length || 0), 0), 0)} questions</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4" />
                        <span>{quiz.settings.duration} minutes</span>
                    </div>
                 </div>
              </CardContent>
              <div className="p-6 pt-0">
                <Button asChild className="w-full">
                  <Link href={`/quiz/${quiz.id}`}>
                    Start Quiz
                  </Link>
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="text-center py-16 border-2 border-dashed rounded-lg">
            <h2 className="text-xl font-semibold">No Quizzes Found</h2>
            <p className="text-muted-foreground mt-2">You haven't created any quizzes yet.</p>
            <Button asChild className="mt-4">
                <Link href="/dashboard/create">Create your first quiz</Link>
            </Button>
        </div>
      )}
    </div>
  );
}
