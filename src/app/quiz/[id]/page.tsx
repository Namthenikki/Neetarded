
"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { db } from "@/lib/firebase/config";
import { doc, getDoc, setDoc, collection, addDoc, serverTimestamp } from "firebase/firestore";
import { type Quiz, type Question } from "@/types/quiz";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { Timer, AlertCircle, ArrowLeft, ArrowRight, CheckCircle, ShieldAlert } from "lucide-react";

type QuizStatus = 'loading' | 'active' | 'submitting' | 'completed' | 'not_found' | 'private';

type AnswerMap = { [questionNumber: number]: string };

interface FlatQuestion extends Question {
  sectionName: string;
  chapterName: string;
}

export default function QuizPage() {
  const router = useRouter();
  const params = useParams();
  const { user } = useAuth();
  const quizId = params.id as string;

  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [status, setStatus] = useState<QuizStatus>('loading');
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [timeLeft, setTimeLeft] = useState(0);

  const flatQuestions: FlatQuestion[] = useMemo(() => {
    if (!quiz) return [];
    return quiz.structure.flatMap((section) =>
      section.chapters.flatMap((chapter) =>
        (chapter.questions || []).map((q) => ({
          ...q,
          sectionName: section.name,
          chapterName: chapter.name,
        }))
      )
    ).sort((a,b) => a.questionNumber - b.questionNumber);
  }, [quiz]);
  
  useEffect(() => {
    async function fetchQuiz() {
      if (!quizId || !user) return;
      try {
        const quizDoc = await getDoc(doc(db, "quizzes", quizId));
        if (quizDoc.exists()) {
          const quizData = quizDoc.data() as Quiz;
          if (!quizData.isPublished && quizData.ownerId !== user.uid) {
              setStatus('private');
              return;
          }
          setQuiz(quizData);
          setTimeLeft(quizData.settings.duration * 60);
          setStatus('active');
        } else {
          setStatus('not_found');
        }
      } catch (error) {
        console.error("Error fetching quiz:", error);
        setStatus('not_found');
      }
    }
    fetchQuiz();
  }, [quizId, user]);

  const handleSubmit = useCallback(async () => {
    if (status === 'submitting' || status === 'completed' || !quiz || !user) return;
    setStatus('submitting');
    
    let correctAnswers = 0;
    let incorrectAnswers = 0;
    flatQuestions.forEach(q => {
        const userAnswerId = answers[q.questionNumber];
        if (userAnswerId) {
            if (userAnswerId === q.correctOptionId) {
                correctAnswers++;
            } else {
                incorrectAnswers++;
            }
        }
    });
    const score = (correctAnswers * quiz.settings.positiveMarks) + (incorrectAnswers * quiz.settings.negativeMarks);
    const timeTaken = (quiz.settings.duration * 60) - timeLeft;

    const attemptData = {
        quizId: quiz.id,
        quizTitle: quiz.title,
        userId: user.uid,
        userName: user.name,
        answers,
        score,
        correctAnswers,
        incorrectAnswers,
        unattempted: flatQuestions.length - (correctAnswers + incorrectAnswers),
        totalQuestions: flatQuestions.length,
        timeTaken,
        completedAt: serverTimestamp(),
    };

    try {
        const attemptRef = await addDoc(collection(db, "attempts"), attemptData);
        setStatus('completed');
        router.push(`/quiz/${quiz.id}/result?attemptId=${attemptRef.id}`);
    } catch(error) {
        console.error("Error saving attempt:", error);
        alert("Failed to submit your attempt. Please try again.");
        setStatus('active'); // Re-enable quiz if submission fails
    }
  }, [status, quiz, user, answers, flatQuestions, router, timeLeft]);

  useEffect(() => {
    if (status !== 'active') return;
    
    if (timeLeft > 0) {
      const timer = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
      return () => clearTimeout(timer);
    } else {
      handleSubmit();
    }
  }, [timeLeft, status, handleSubmit]);


  const handleSelectOption = (questionNumber: number, optionId: string) => {
    setAnswers({ ...answers, [questionNumber]: optionId });
  };

  const handleNext = () => {
    if (currentQuestionIndex < flatQuestions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
    }
  };

  const handlePrev = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(currentQuestionIndex - 1);
    }
  };

  if (status === 'loading' || !quiz) {
    return (
      <div className="flex items-center justify-center min-h-screen">
          <div className="p-4 md:p-8 space-y-6 w-full max-w-4xl">
            <div className="flex justify-between items-center">
                <Skeleton className="h-8 w-1/4" />
                <Skeleton className="h-8 w-24" />
            </div>
            <Card>
                <CardContent className="p-6">
                <Skeleton className="h-6 w-1/4 mb-4" />
                <Skeleton className="h-8 w-full mb-6" />
                <div className="space-y-4">
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                </div>
                </CardContent>
            </Card>
            <div className="flex justify-between items-center">
                <Skeleton className="h-10 w-24" />
                <Skeleton className="h-10 w-24" />
            </div>
        </div>
      </div>
    );
  }
  
  if (status === 'not_found' || status === 'private') {
    return (
        <div className="flex flex-col items-center justify-center min-h-screen text-center p-4">
            <ShieldAlert className="h-16 w-16 text-destructive mb-4" />
            <h1 className="text-3xl font-bold">
                {status === 'not_found' ? 'Quiz Not Found' : 'Access Denied'}
            </h1>
            <p className="text-muted-foreground mt-2">
                {status === 'not_found' ? 'The quiz you are looking for does not exist.' : 'This quiz is private and cannot be attempted.'}
            </p>
            <Button onClick={() => router.push('/dashboard')} className="mt-6">Go to Dashboard</Button>
        </div>
    );
  }

  const currentQuestion = flatQuestions[currentQuestionIndex];
  const timeIsLow = timeLeft <= 5 * 60;
  
  return (
    <div className="flex flex-col h-screen">
      <header className="sticky top-0 z-10 flex items-center justify-between p-3 border-b bg-card shadow-sm">
        <Badge variant="outline" className="text-sm font-semibold">
            {currentQuestion.sectionName}
        </Badge>
        <div className={cn("flex items-center gap-2 font-semibold text-lg", timeIsLow ? "text-destructive animate-pulse" : "text-primary")}>
            <Timer className="h-6 w-6"/>
            <span>
                {Math.floor(timeLeft / 60).toString().padStart(2, '0')}:
                {(timeLeft % 60).toString().padStart(2, '0')}
            </span>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 md:p-8">
       <div className="max-w-4xl mx-auto">
        <Card>
            <CardContent className="p-6">
                <p className="text-sm font-semibold text-primary mb-2">
                    Question {currentQuestionIndex + 1} of {flatQuestions.length}
                </p>
                <p className="text-lg md:text-xl font-medium leading-relaxed">
                    {currentQuestion.text}
                </p>
            </CardContent>
        </Card>

        <div className="mt-6 space-y-3">
            {currentQuestion.options.map(option => (
                <Button
                    key={option.id}
                    variant={answers[currentQuestion.questionNumber] === option.id ? "default" : "outline"}
                    className="w-full h-auto min-h-[48px] justify-start text-left p-4 text-base md:text-lg whitespace-normal"
                    onClick={() => handleSelectOption(currentQuestion.questionNumber, option.id)}
                    disabled={status === 'submitting'}
                >
                    <span className="mr-4 font-bold">{option.id}.</span>
                    {option.text}
                </Button>
            ))}
        </div>
        
        {status === 'submitting' && (
            <Alert className="mt-8">
                <AlertCircle className="h-4 w-4 animate-spin" />
                <AlertTitle>Submitting...</AlertTitle>
                <AlertDescription>
                    Please wait while we calculate your results.
                </AlertDescription>
            </Alert>
        )}
        </div>
      </main>

      <footer className="sticky bottom-0 flex items-center justify-between p-3 border-t bg-card/90 backdrop-blur-sm">
       <div className="max-w-4xl mx-auto flex justify-between w-full">
         <Button variant="outline" onClick={handlePrev} disabled={currentQuestionIndex === 0 || status === 'submitting'}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Prev
        </Button>
        
        {currentQuestionIndex === flatQuestions.length - 1 ? (
             <Button onClick={handleSubmit} disabled={status === 'submitting'} className="bg-green-600 hover:bg-green-700">
                <CheckCircle className="mr-2 h-4 w-4" />
                Submit Quiz
            </Button>
        ) : (
            <Button onClick={handleNext} disabled={status === 'submitting'}>
                Next
                <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
        )}
       </div>
      </footer>
    </div>
  );
}
