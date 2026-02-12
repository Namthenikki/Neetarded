
"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { db } from "@/lib/firebase/config";
import { doc, getDoc, addDoc, collection, serverTimestamp } from "firebase/firestore";
import { type Quiz, type Question } from "@/types/quiz";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { Timer, ArrowLeft, ArrowRight, CheckCircle, ShieldAlert, X } from "lucide-react";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription } from "@/components/ui/alert-dialog";
import { motion, AnimatePresence } from "framer-motion";

type QuizStatus = 'loading' | 'needs_identity' | 'active' | 'submitting' | 'completed' | 'not_found' | 'private';
type AnswerMap = { [questionNumber: number]: string };

interface FlatQuestion extends Question {
  sectionId: string;
  sectionName: string;
  chapterName: string;
}

export default function QuizPage() {
  const router = useRouter();
  const params = useParams();
  const { user } = useAuth(); // Logged-in creator
  const quizId = params.id as string;

  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [status, setStatus] = useState<QuizStatus>('loading');
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [timeLeft, setTimeLeft] = useState(0);

  // Student Identity State
  const [studentId, setStudentId] = useState<string | null>(null);
  const [studentName, setStudentName] = useState<string | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [identityInput, setIdentityInput] = useState('');

  const flatQuestions: FlatQuestion[] = useMemo(() => {
    if (!quiz) return [];
    return quiz.structure.flatMap((section) =>
      section.chapters.flatMap((chapter) =>
        (chapter.questions || []).map((q) => ({
          ...q,
          sectionId: section.id,
          sectionName: section.name,
          chapterName: chapter.name,
        }))
      )
    ).sort((a, b) => a.questionNumber - b.questionNumber);
  }, [quiz]);

  const progress = useMemo(() => {
    if (flatQuestions.length === 0) return 0;
    return ((currentQuestionIndex + 1) / flatQuestions.length) * 100;
  }, [currentQuestionIndex, flatQuestions.length]);

  const processIdentityName = (name: string) => {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
  };

  useEffect(() => {
    const storedStudentId = localStorage.getItem('neetarded_student_id');

    if (user) {
      setStudentId(user.uid);
      setStudentName(user.name);
      setIsGuest(false);
    } else if (storedStudentId) {
      setStudentId(storedStudentId);
      setStudentName(storedStudentId); // For guests, ID and name are the same
      setIsGuest(true);
    } else {
      setIsGuest(true);
      setStatus('needs_identity');
      return;
    }
  }, [user]);

  useEffect(() => {
    async function fetchQuiz() {
      if (status === 'needs_identity' || !studentId) return;
      
      setLoading(true);
      try {
        const quizDoc = await getDoc(doc(db, "quizzes", quizId));
        if (quizDoc.exists()) {
          const quizData = quizDoc.data() as Quiz;
          if (!quizData.isPublished && quizData.ownerId !== user?.uid) {
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
      } finally {
        setLoading(false);
      }
    }
    fetchQuiz();
  }, [quizId, user, status, studentId]);

  const handleBeginExam = () => {
    const processedId = processIdentityName(identityInput);
    if (!processedId) {
      alert("Please enter a valid name.");
      return;
    }
    setStudentId(processedId);
    setStudentName(processedId);
    localStorage.setItem('neetarded_student_id', processedId);
    setStatus('loading'); // Triggers fetchQuiz useEffect
  }
  
  const handleIdentityInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setIdentityInput(processIdentityName(e.target.value));
  };


  const handleSubmit = useCallback(async () => {
    if (status !== 'active' || !quiz || !studentId || !studentName) return;
    setStatus('submitting');
    
    let correctAnswers = 0;
    let incorrectAnswers = 0;
    flatQuestions.forEach(q => {
        const userAnswerId = answers[q.questionNumber];
        if (userAnswerId) {
            if (userAnswerId === q.correctOptionId) correctAnswers++;
            else incorrectAnswers++;
        }
    });
    
    const score = (correctAnswers * quiz.settings.positiveMarks) + (incorrectAnswers * quiz.settings.negativeMarks);
    const timeTaken = (quiz.settings.duration * 60) - timeLeft;

    const attemptData = {
        quizId: quiz.id,
        quizTitle: quiz.title,
        userId: user?.uid || 'guest',
        studentId, studentName, isGuest,
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
    };

    try {
        const attemptRef = await addDoc(collection(db, "attempts"), attemptData);
        setStatus('completed');
        router.push(`/quiz/${quiz.id}/result?attemptId=${attemptRef.id}`);
    } catch(error) {
        console.error("Error saving attempt:", error);
        alert("Failed to submit your attempt. Please try again.");
        setStatus('active');
    }
  }, [status, quiz, studentId, studentName, isGuest, answers, flatQuestions, router, timeLeft, user]);

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

  if (status === 'loading') {
    return ( <div className="flex items-center justify-center min-h-screen"> <div className="p-4 md:p-8 space-y-6 w-full max-w-4xl"> <div className="flex justify-between items-center"> <Skeleton className="h-8 w-1/4" /> <Skeleton className="h-8 w-24" /> </div> <Card> <CardContent className="p-6"> <Skeleton className="h-6 w-1/4 mb-4" /> <Skeleton className="h-8 w-full mb-6" /> <div className="space-y-4"> <Skeleton className="h-12 w-full" /> <Skeleton className="h-12 w-full" /> <Skeleton className="h-12 w-full" /> <Skeleton className="h-12 w-full" /> </div> </CardContent> </Card> <div className="flex justify-between items-center"> <Skeleton className="h-10 w-24" /> <Skeleton className="h-10 w-24" /> </div> </div> </div> );
  }
  
  if (status === 'not_found' || status === 'private') {
    return ( <div className="flex flex-col items-center justify-center min-h-screen text-center p-4"> <ShieldAlert className="h-16 w-16 text-destructive mb-4" /> <h1 className="text-3xl font-bold"> {status === 'not_found' ? 'Quiz Not Found' : 'Access Denied'} </h1> <p className="text-muted-foreground mt-2"> {status === 'not_found' ? 'The quiz you are looking for does not exist.' : 'This quiz is private and cannot be attempted.'} </p> <Button onClick={() => router.push('/dashboard')} className="mt-6">Go to Dashboard</Button> </div> );
  }

  const currentQuestion = flatQuestions[currentQuestionIndex];
  const timeIsLow = timeLeft <= 5 * 60;
  
  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <AnimatePresence>
        {status === 'needs_identity' && (
          <AlertDialog open={true}>
            <AlertDialogContent asChild className="bg-background/80 backdrop-blur-sm border-white/10">
              <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}>
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-center text-2xl font-bold">Student Identity Required</AlertDialogTitle>
                  <AlertDialogDescription className="text-center">Enter your name to begin. This will be your permanent ID.</AlertDialogDescription>
                </AlertDialogHeader>
                <div className="py-4 space-y-4">
                  <Input 
                    placeholder="e.g. sourav" 
                    value={identityInput} 
                    onChange={handleIdentityInputChange} 
                    className="text-center text-lg h-12" 
                    autoFocus 
                  />
                  <Button onClick={handleBeginExam} className="w-full h-12 text-lg">
                    Begin Exam
                  </Button>
                </div>
              </motion.div>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </AnimatePresence>

      {(status === 'active' && quiz) && (
        <>
          <header className="sticky top-0 z-10 flex flex-col pt-2">
            <div className="flex items-center justify-between p-3">
              <Badge variant="outline" className="text-sm font-semibold">{currentQuestion.sectionName}</Badge>
              <div className={cn("flex items-center gap-2 font-semibold text-lg", timeIsLow ? "text-destructive" : "text-primary")}>
                <Timer className="h-6 w-6"/>
                <span> {Math.floor(timeLeft / 60).toString().padStart(2, '0')}:{(timeLeft % 60).toString().padStart(2, '0')} </span>
              </div>
            </div>
            <Progress value={progress} className="h-1 bg-accent/20 [&>div]:bg-accent" />
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
                <Card className="bg-transparent border-0 shadow-none">
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
                        className={cn("w-full h-auto min-h-[56px] justify-start text-left p-4 text-base md:text-lg whitespace-normal border-2",
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
              <Button variant="outline" onClick={handlePrev} disabled={currentQuestionIndex === 0 || status === 'submitting'}>
                <ArrowLeft/> Prev
              </Button>
              {currentQuestionIndex === flatQuestions.length - 1 ? (
                <Button onClick={handleSubmit} disabled={status === 'submitting'} className="bg-green-600 hover:bg-green-700">
                  <CheckCircle/> Submit Quiz
                </Button>
              ) : (
                <Button onClick={handleNext} disabled={status === 'submitting'}>
                  Next <ArrowRight/>
                </Button>
              )}
            </div>
          </footer>
        </>
      )}
    </div>
  );
}

    