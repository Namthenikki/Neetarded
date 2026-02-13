
"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { db } from "@/lib/firebase/config";
import { doc, getDoc, addDoc, collection, serverTimestamp, query, where, getDocs, writeBatch } from "firebase/firestore";
import { type Quiz, type Question } from "@/types/quiz";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { Timer, ArrowLeft, ArrowRight, CheckCircle, ShieldAlert, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription } from "@/components/ui/alert-dialog";

type QuizStatus = 'loading' | 'active' | 'submitting' | 'completed' | 'not_found' | 'private' | 'auth_required';
type AnswerMap = { [questionNumber: number]: string };

interface FlatQuestion extends Question {
  sectionId: string;
  sectionName: string;
  chapterBinaryCode: string;
  chapterName: string;
}

export default function QuizPage() {
  const router = useRouter();
  const params = useParams();
  const { user, loading: authLoading } = useAuth();
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
          sectionId: section.id,
          sectionName: section.name,
          chapterBinaryCode: chapter.binaryCode,
          chapterName: chapter.name,
        }))
      )
    ).sort((a, b) => a.questionNumber - b.questionNumber);
  }, [quiz]);
  
  useEffect(() => {
      if (authLoading) {
          setStatus('loading');
          return;
      }
      if (!user) {
          setStatus('auth_required');
          router.replace('/login');
          return;
      }

      async function fetchQuiz() {
        setStatus('loading');
        try {
          const quizDoc = await getDoc(doc(db, "quizzes", quizId));
          if (quizDoc.exists()) {
            const quizData = quizDoc.data() as Quiz;
            if (!quizData.isPublished && user.role !== 'admin' && user.studentId !== quizData.ownerId) {
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
  }, [quizId, user, authLoading, router]);

  const handleSubmit = useCallback(async () => {
    if (status !== 'active' || !quiz || !user) return;
    setStatus('submitting');
    console.log("Saving attempt for Student ID:", user.studentId);
    
    const score = flatQuestions.reduce((acc, q) => {
        const userAnswerId = answers[q.questionNumber];
        if (userAnswerId) {
            if (userAnswerId === q.correctOptionId) return acc + quiz.settings.positiveMarks;
            else return acc + quiz.settings.negativeMarks;
        }
        return acc;
    }, 0);

    const correctAnswers = flatQuestions.filter(q => answers[q.questionNumber] === q.correctOptionId).length;
    const incorrectAnswers = flatQuestions.filter(q => answers[q.questionNumber] && answers[q.questionNumber] !== q.correctOptionId).length;
    const timeTaken = (quiz.settings.duration * 60) - timeLeft;

    // Deep Analysis Calculation
    const deepAnalysis: any = {
      subjects: {},
      chapters: {}
    };

    flatQuestions.forEach(q => {
      const sectionId = q.sectionId;
      const sectionName = q.sectionName;
      const chapterCode = q.chapterBinaryCode;
      const chapterName = q.chapterName;

      // Initialize subject if not present
      if (!deepAnalysis.subjects[sectionId]) {
        deepAnalysis.subjects[sectionId] = { name: sectionName, score: 0, correct: 0, incorrect: 0, skipped: 0 };
      }
      // Initialize chapter if not present
      if (!deepAnalysis.chapters[chapterCode]) {
        deepAnalysis.chapters[chapterCode] = { subject: sectionName, name: chapterName, correct: 0, incorrect: 0, skipped: 0 };
      }

      const userAnswerId = answers[q.questionNumber];

      if (!userAnswerId) {
        // Skipped
        deepAnalysis.subjects[sectionId].skipped++;
        deepAnalysis.chapters[chapterCode].skipped++;
      } else if (userAnswerId === q.correctOptionId) {
        // Correct
        deepAnalysis.subjects[sectionId].correct++;
        deepAnalysis.subjects[sectionId].score += quiz.settings.positiveMarks;
        deepAnalysis.chapters[chapterCode].correct++;
      } else {
        // Incorrect
        deepAnalysis.subjects[sectionId].incorrect++;
        deepAnalysis.subjects[sectionId].score += quiz.settings.negativeMarks;
        deepAnalysis.chapters[chapterCode].incorrect++;
      }
    });

    const attemptData = {
        quizId: quiz.id,
        quizTitle: quiz.title,
        userId: user.studentId, // Legacy
        studentId: user.studentId, 
        studentName: user.name, 
        isGuest: false,
        answers, score, correctAnswers, incorrectAnswers,
        unattempted: flatQuestions.length - (correctAnswers + incorrectAnswers),
        totalQuestions: flatQuestions.length, timeTaken,
        completedAt: serverTimestamp(),
        sectionPerformance: quiz.structure.map(section => {
            const sectionQuestions = flatQuestions.filter(q => q.sectionId === section.id);
            const sectionCorrect = sectionQuestions.filter(q => answers[q.questionNumber] === q.correctOptionId).length;
            const sectionIncorrect = sectionQuestions.filter(q => answers[q.questionNumber] && answers[q.questionNumber] !== q.correctOptionId).length;
            const attempted = sectionCorrect + sectionIncorrect;
            return {
                sectionId: section.id, sectionName: section.name, totalQuestions: sectionQuestions.length,
                correct: sectionCorrect, incorrect: sectionIncorrect,
                accuracy: attempted > 0 ? (sectionCorrect / attempted) * 100 : 0
            }
        }),
        deepAnalysis: deepAnalysis,
    };

    try {
        const batch = writeBatch(db);

        // 1. Save the new attempt
        const attemptRef = doc(collection(db, "attempts"));
        console.log("Attempt Document ID:", attemptRef.id);
        batch.set(attemptRef, attemptData);

        // 2. Check for and update any pending assignment
        const assignmentQuery = query(
            collection(db, "assigned_quizzes"),
            where("quizId", "==", quiz.id),
            where("studentId", "==", user.studentId),
            where("status", "==", "pending")
        );
        const assignmentSnapshot = await getDocs(assignmentQuery);
        if (!assignmentSnapshot.empty) {
            const assignmentDocRef = assignmentSnapshot.docs[0].ref;
            batch.update(assignmentDocRef, { status: 'completed' });
            console.log("Marked assignment as completed:", assignmentDocRef.id);
        }
        
        await batch.commit();

        setStatus('completed');
        router.push(`/quiz/${quiz.id}/result?attemptId=${attemptRef.id}`);

    } catch(error) {
        console.error("Error submitting attempt:", error);
        alert("Failed to submit your attempt. Please try again.");
        setStatus('active');
    }
  }, [status, quiz, user, answers, flatQuestions, router, timeLeft]);

  useEffect(() => {
    if (status !== 'active') return;
    if (timeLeft <= 0) {
      handleSubmit();
      return;
    }
    const timer = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
    return () => clearTimeout(timer);
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
  
  const handleSectionSelect = useCallback((sectionId: string) => {
    const firstQuestionIndex = flatQuestions.findIndex(q => q.sectionId === sectionId);
    if (firstQuestionIndex !== -1) {
      setCurrentQuestionIndex(firstQuestionIndex);
    }
  }, [flatQuestions]);

  const progress = useMemo(() => {
    if (flatQuestions.length === 0) return 0;
    return ((currentQuestionIndex + 1) / flatQuestions.length) * 100;
  }, [currentQuestionIndex, flatQuestions.length]);

  if (status === 'loading' || status === 'auth_required') {
    return ( <div className="flex items-center justify-center min-h-screen"> <div className="p-4 md:p-8 space-y-6 w-full max-w-4xl"> <div className="flex justify-between items-center"> <Skeleton className="h-8 w-1/4" /> <Skeleton className="h-8 w-24" /> </div> <Card className="rounded-2xl"> <CardContent className="p-6"> <Skeleton className="h-6 w-1/4 mb-4" /> <Skeleton className="h-8 w-full mb-6" /> <div className="space-y-4"> <Skeleton className="h-12 w-full rounded-xl" /> <Skeleton className="h-12 w-full rounded-xl" /> <Skeleton className="h-12 w-full rounded-xl" /> <Skeleton className="h-12 w-full rounded-xl" /> </div> </CardContent> </Card> <div className="flex justify-between items-center"> <Skeleton className="h-10 w-24" /> <Skeleton className="h-10 w-24" /> </div> </div> </div> );
  }
  
  if (status === 'not_found' || status === 'private') {
    return ( <div className="flex flex-col items-center justify-center min-h-screen text-center p-4"> <ShieldAlert className="h-16 w-16 text-destructive mb-4" /> <h1 className="text-3xl font-bold"> {status === 'not_found' ? 'Quiz Not Found' : 'Access Denied'} </h1> <p className="text-muted-foreground mt-2"> {status === 'not_found' ? 'The quiz you are looking for does not exist.' : 'This quiz is private and cannot be attempted.'} </p> <Button onClick={() => router.push('/dashboard')} className="mt-6">Go to Dashboard</Button> </div> );
  }

  const currentQuestion = flatQuestions[currentQuestionIndex];
  const timeIsLow = timeLeft <= 5 * 60;
  
  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {(status === 'active' || status === 'submitting') && quiz && currentQuestion && (
        <>
          <header className="sticky top-0 z-10 flex flex-col pt-2 bg-background/95 backdrop-blur-sm">
            <div className="flex items-center justify-between p-3 flex-wrap gap-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                    {quiz.structure.map((section) => {
                        const isCurrentSection = section.id === currentQuestion.sectionId;
                        return (
                            <Button
                                key={section.id}
                                variant={isCurrentSection ? 'default' : 'secondary'}
                                size="sm"
                                onClick={() => handleSectionSelect(section.id)}
                                className="rounded-lg transition-all shadow-sm"
                                disabled={status === 'submitting'}
                            >
                                {section.name}
                            </Button>
                        );
                    })}
                </div>
                <div className={cn("flex items-center gap-2 font-semibold text-lg shrink-0", timeIsLow ? "text-destructive" : "text-primary")}>
                    <Timer className="h-6 w-6"/>
                    <span>
                        {Math.floor(timeLeft / 60).toString().padStart(2, '0')}:{(timeLeft % 60).toString().padStart(2, '0')}
                    </span>
                </div>
            </div>
            <Progress value={progress} className="h-1" />
          </header>

          <main className="flex-1 overflow-y-auto p-4 md:p-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentQuestionIndex}
                initial={{ x: 300, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: -300, opacity: 0 }}
                transition={{ type: "spring", stiffness: 200, damping: 25 }}
                className="max-w-4xl mx-auto"
              >
                <Card className="bg-transparent border-0 shadow-none rounded-2xl">
                  <CardContent className="p-0">
                    <p className="text-sm font-semibold text-primary mb-4"> Question {currentQuestionIndex + 1} of {flatQuestions.length} </p>
                    <p className="font-serif text-xl md:text-2xl font-bold leading-relaxed">{currentQuestion.text}</p>
                  </CardContent>
                </Card>
                <div className="mt-8 space-y-3">
                  {currentQuestion.options.map(option => (
                    <motion.div key={option.id} whileTap={{ scale: 0.98 }}>
                      <Button
                        variant="outline"
                        className={cn("w-full h-auto min-h-[56px] justify-start text-left p-4 text-base md:text-lg whitespace-normal border-2 rounded-xl",
                          answers[currentQuestion.questionNumber] === option.id 
                          ? "border-primary bg-primary/10 shadow-[0_0_15px_rgba(124,58,237,0.3)]"
                          : "border-input"
                        )}
                        onClick={() => handleSelectOption(currentQuestion.questionNumber, option.id)}
                        disabled={status === 'submitting'}
                      >
                        <span className="mr-4 font-bold">{option.id}.</span>
                        {option.text}
                      </Button>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            </AnimatePresence>
          </main>

          <footer className="sticky bottom-0 flex items-center justify-between p-3 border-t bg-background/80 backdrop-blur-sm">
            <div className="max-w-4xl mx-auto flex justify-between w-full">
              <Button variant="outline" onClick={handlePrev} disabled={currentQuestionIndex === 0 || status === 'submitting'} className="rounded-xl">
                <ArrowLeft/> Prev
              </Button>
              {currentQuestionIndex === flatQuestions.length - 1 ? (
                <Button onClick={handleSubmit} disabled={status === 'submitting'} className="bg-green-600 hover:bg-green-700 rounded-xl">
                  <CheckCircle/> Submit Quiz
                </Button>
              ) : (
                <Button onClick={handleNext} disabled={status === 'submitting'} className="rounded-xl">
                  Next <ArrowRight/>
                </Button>
              )}
            </div>
          </footer>
        </>
      )}
       <AlertDialog open={status === 'submitting'}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-center">Submitting Your Answers...</AlertDialogTitle>
            <AlertDialogDescription className="text-center">
              Please wait while we calculate your score. Do not close this page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex justify-center py-4">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
