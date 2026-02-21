
"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { db } from "@/lib/firebase/config";
import { doc, getDoc, addDoc, collection, serverTimestamp, query, where, getDocs, writeBatch, setDoc, deleteDoc } from "firebase/firestore";
import { type Quiz, type Question, type Chapter } from "@/types/quiz";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { Timer, ArrowLeft, ArrowRight, CheckCircle, ShieldAlert, Loader2, Star, Flag, Grid3x3 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from "@/components/ui/sheet";

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
  const { toast } = useToast();

  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [status, setStatus] = useState<QuizStatus>('loading');
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [timeLeft, setTimeLeft] = useState(0);

  const [starredQuestions, setStarredQuestions] = useState<Set<number>>(new Set());
  const [flaggedQuestions, setFlaggedQuestions] = useState<Set<number>>(new Set());
  const [isSyncing, setIsSyncing] = useState(false);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [visited, setVisited] = useState<Set<number>>(new Set());


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

  const questionNumberToIndexMap = useMemo(() => 
    new Map(flatQuestions.map((q, index) => [q.questionNumber, index]))
  , [flatQuestions]);
  
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

    async function fetchQuizAndRestore() {
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

          const storageKey = `quiz_progress_${user.studentId}_${quizId}`;
          const savedProgressJSON = localStorage.getItem(storageKey);

          if (savedProgressJSON) {
              try {
                  const savedProgress = JSON.parse(savedProgressJSON);
                  console.log("Restoring quiz progress from localStorage...");
                  setAnswers(savedProgress.answers || {});
                  setTimeLeft(savedProgress.timeLeft > 0 ? savedProgress.timeLeft : quizData.settings.duration * 60);
                  setCurrentQuestionIndex(savedProgress.currentQuestionIndex || 0);
                  setVisited(new Set(savedProgress.visited || []));
                  setStarredQuestions(new Set(savedProgress.starred || []));
                  setFlaggedQuestions(new Set(savedProgress.flagged || []));
              } catch (e) {
                  console.error("Failed to parse saved progress, starting fresh.", e);
                  localStorage.removeItem(storageKey);
                  setTimeLeft(quizData.settings.duration * 60);
              }
          } else {
              console.log("No saved progress found. Starting fresh and fetching from DB.");
              setTimeLeft(quizData.settings.duration * 60);
              
              const fetchStatus = async (collectionName: string, setter: React.Dispatch<React.SetStateAction<Set<number>>>) => {
                  const q = query(
                      collection(db, collectionName),
                      where("studentId", "==", user.studentId),
                      where("quizId", "==", quizId)
                  );
                  const snapshot = await getDocs(q);
                  const questionNumbers = new Set(snapshot.docs.map(d => d.data().questionNumber));
                  setter(questionNumbers);
              };

              await Promise.all([
                fetchStatus('starred_questions', setStarredQuestions),
                fetchStatus('flagged_questions', setFlaggedQuestions)
              ]);
          }
          
          setStatus('active');
        } else {
          setStatus('not_found');
        }
      } catch (error) {
        console.error("Error fetching quiz:", error);
        setStatus('not_found');
      }
    }
    fetchQuizAndRestore();
  }, [quizId, user, authLoading, router]);

  // Save progress to localStorage
  useEffect(() => {
    if (status !== 'active' || !user || !quizId || !quiz) return;

    const progress = {
      answers,
      timeLeft,
      currentQuestionIndex,
      visited: Array.from(visited),
      starred: Array.from(starredQuestions),
      flagged: Array.from(flaggedQuestions),
    };
    
    localStorage.setItem(`quiz_progress_${user.studentId}_${quizId}`, JSON.stringify(progress));
    
  }, [answers, timeLeft, currentQuestionIndex, visited, starredQuestions, flaggedQuestions, user, quizId, status, quiz]);

  // Track visited questions
  useEffect(() => {
    if (status === 'active' && flatQuestions.length > 0) {
        const currentQNumber = flatQuestions[currentQuestionIndex].questionNumber;
        setVisited(prevVisited => {
            if (prevVisited.has(currentQNumber)) {
                return prevVisited;
            }
            const newVisited = new Set(prevVisited);
            newVisited.add(currentQNumber);
            return newVisited;
        });
    }
  }, [currentQuestionIndex, flatQuestions, status]);


  const handleSubmit = useCallback(async () => {
    if (status !== 'active' || !quiz || !user) return;
    setStatus('submitting');
    console.log("Saving attempt for Student ID:", user.studentId);
    
    const totalAttempted = Object.keys(answers).length;
    const correctAnswers = flatQuestions.filter(q => answers[q.questionNumber] === q.correctOptionId).length;
    const incorrectAnswers = flatQuestions.filter(q => answers[q.questionNumber] && answers[q.questionNumber] !== q.correctOptionId).length;
    const score = (correctAnswers * quiz.settings.positiveMarks) + (incorrectAnswers * quiz.settings.negativeMarks);
    const timeTaken = (quiz.settings.duration * 60) - timeLeft;

    const deepAnalysis: any = {
      subjects: {},
      chapters: {}
    };

    flatQuestions.forEach(q => {
      const sectionId = q.sectionId;
      const sectionName = q.sectionName;
      const chapterCode = q.chapterBinaryCode;
      const chapterName = q.chapterName;

      if (!deepAnalysis.subjects[sectionId]) {
        deepAnalysis.subjects[sectionId] = { name: sectionName, score: 0, correct: 0, incorrect: 0, skipped: 0 };
      }
      if (!deepAnalysis.chapters[chapterCode]) {
        deepAnalysis.chapters[chapterCode] = { subject: sectionName, name: chapterName, correct: 0, incorrect: 0, skipped: 0 };
      }

      const userAnswerId = answers[q.questionNumber];

      if (!userAnswerId) {
        deepAnalysis.subjects[sectionId].skipped++;
        deepAnalysis.chapters[chapterCode].skipped++;
      } else if (userAnswerId === q.correctOptionId) {
        deepAnalysis.subjects[sectionId].correct++;
        deepAnalysis.subjects[sectionId].score += quiz.settings.positiveMarks;
        deepAnalysis.chapters[chapterCode].correct++;
      } else {
        deepAnalysis.subjects[sectionId].incorrect++;
        deepAnalysis.subjects[sectionId].score += quiz.settings.negativeMarks;
        deepAnalysis.chapters[chapterCode].incorrect++;
      }
    });

    const attemptData = {
        quizId: quiz.id,
        quizTitle: quiz.title,
        userId: user.studentId,
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
            const attemptedInThisSection = sectionCorrect + sectionIncorrect;
            const totalInThisSection = sectionQuestions.length;
            
            const baseAccuracy = attemptedInThisSection > 0 ? (sectionCorrect / attemptedInThisSection) * 100 : 0;
            const confidenceFactor = totalInThisSection > 0 ? attemptedInThisSection / totalInThisSection : 0;
            const finalAccuracy = baseAccuracy * confidenceFactor;

            return {
                sectionId: section.id, 
                sectionName: section.name, 
                totalQuestions: totalInThisSection,
                correct: sectionCorrect, 
                incorrect: sectionIncorrect,
                accuracy: finalAccuracy
            }
        }),
        deepAnalysis: deepAnalysis,
    };

    try {
        const batch = writeBatch(db);
        const attemptRef = doc(collection(db, "attempts"));
        batch.set(attemptRef, attemptData);

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
        }
        
        await batch.commit();

        localStorage.removeItem(`quiz_progress_${user.studentId}_${quizId}`);

        setStatus('completed');
        router.push(`/quiz/${quiz.id}/result?attemptId=${attemptRef.id}`);

    } catch(error) {
        console.error("Error submitting attempt:", error);
        alert("Failed to submit your attempt. Please try again.");
        setStatus('active');
    }
  }, [status, quiz, user, answers, flatQuestions, router, timeLeft, quizId]);

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

  const handlePaletteSelect = (questionNumber: number) => {
    const index = questionNumberToIndexMap.get(questionNumber);
    if (index !== undefined) {
        setCurrentQuestionIndex(index);
    }
    setIsPaletteOpen(false);
  };

  const handleToggleFeature = async (
    question: FlatQuestion,
    collectionName: 'starred_questions' | 'flagged_questions',
    stateSet: Set<number>,
    setter: React.Dispatch<React.SetStateAction<Set<number>>>,
    chapter: Chapter
  ) => {
      if (!user || isSyncing || !quiz) return;
      setIsSyncing(true);

      const questionNumber = question.questionNumber;
      const docId = `${user.studentId}_${quizId}_${questionNumber}`;
      const docRef = doc(db, collectionName, docId);
      
      const newSet = new Set(stateSet);
      let action: 'add' | 'remove' = 'add';

      try {
          if (newSet.has(questionNumber)) {
              action = 'remove';
              await deleteDoc(docRef);
              newSet.delete(questionNumber);
          } else {
              action = 'add';
              const payload = {
                  studentId: user.studentId,
                  quizId,
                  quizTitle: quiz.title,
                  questionNumber: question.questionNumber,
                  sectionId: question.sectionId,
                  sectionName: question.sectionName,
                  chapterBinaryCode: question.chapterBinaryCode,
                  chapterName: chapter.name,
                  questionData: {
                      text: question.text,
                      options: question.options,
                      correctOptionId: question.correctOptionId,
                      explanation: question.explanation || '',
                      questionNumber: question.questionNumber,
                  },
                  addedAt: serverTimestamp(),
              };
              await setDoc(docRef, payload);
              newSet.add(questionNumber);
          }
          setter(newSet);
          toast({
            title: `Question ${action === 'add' ? 'Added to' : 'Removed from'} ${collectionName === 'starred_questions' ? 'Starred' : 'Flagged'}`,
          });
      } catch (error) {
          console.error(`Failed to toggle ${collectionName}:`, error);
          toast({ variant: 'destructive', title: `Operation failed.` });
      } finally {
          setIsSyncing(false);
      }
  };

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
                 <div className={cn("flex items-center gap-4 font-semibold text-lg shrink-0")}>
                    <Sheet open={isPaletteOpen} onOpenChange={setIsPaletteOpen}>
                        <SheetTrigger asChild>
                            <Button variant="outline" size="sm" className="rounded-lg">
                                <Grid3x3 className="mr-2 h-4 w-4"/>
                                Palette
                            </Button>
                        </SheetTrigger>
                        <SheetContent side="left" className="w-full sm:w-[350px] sm:max-w-full p-0">
                            <SheetHeader className="p-4 border-b">
                                <SheetTitle>Question Palette</SheetTitle>
                                <SheetDescription>
                                    Answered: {Object.keys(answers).length} &bull; Unanswered: {flatQuestions.length - Object.keys(answers).length}
                                </SheetDescription>
                            </SheetHeader>
                            <div className="py-4 px-4 space-y-6 overflow-y-auto h-[calc(100vh-8rem)]">
                                {quiz.structure.map(section => (
                                    <div key={section.id}>
                                        <h4 className="font-semibold mb-3 text-base">{section.name}</h4>
                                        <div className="grid grid-cols-5 gap-2">
                                            {flatQuestions
                                                .filter(q => q.sectionId === section.id)
                                                .map(q => {
                                                    const isAnswered = answers.hasOwnProperty(q.questionNumber);
                                                    const isCurrent = q.questionNumber === currentQuestion.questionNumber;
                                                    const isVisited = visited.has(q.questionNumber);
                                                    const isSkipped = isVisited && !isAnswered;

                                                    return (
                                                        <Button
                                                            key={q.questionNumber}
                                                            onClick={() => handlePaletteSelect(q.questionNumber)}
                                                            variant="outline"
                                                            size="sm"
                                                            className={cn("h-9 w-9 p-0 font-bold text-xs", {
                                                                "bg-green-500/20 border-green-500/50 text-green-800 hover:bg-green-500/30": isAnswered,
                                                                "bg-red-500/20 border-red-500/50 text-red-800 hover:bg-red-500/30": isSkipped && !isCurrent,
                                                                "ring-2 ring-primary ring-offset-2": isCurrent
                                                            })}
                                                        >
                                                            {q.questionNumber}
                                                        </Button>
                                                    )
                                                })}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </SheetContent>
                    </Sheet>
                    <div className={cn("flex items-center gap-2", timeIsLow ? "text-destructive" : "text-primary")}>
                        <Timer className="h-6 w-6"/>
                        <span>
                            {Math.floor(timeLeft / 60).toString().padStart(2, '0')}:{(timeLeft % 60).toString().padStart(2, '0')}
                        </span>
                    </div>
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
                    <div className="flex justify-between items-start mb-2">
                        <div>
                            <p className="text-sm font-semibold text-primary"> Question {currentQuestion.questionNumber} of {flatQuestions.length} </p>
                            <p className="text-sm text-muted-foreground">{currentQuestion.chapterName}</p>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button variant="ghost" size="icon" onClick={() => handleToggleFeature(currentQuestion, 'flagged_questions', flaggedQuestions, setFlaggedQuestions, quiz.structure.flatMap(s => s.chapters).find(c => c.binaryCode === currentQuestion.chapterBinaryCode)!)} disabled={isSyncing}>
                                <Flag className={cn("h-5 w-5", flaggedQuestions.has(currentQuestion.questionNumber) && "fill-orange-500 text-orange-500")}/>
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => handleToggleFeature(currentQuestion, 'starred_questions', starredQuestions, setStarredQuestions, quiz.structure.flatMap(s => s.chapters).find(c => c.binaryCode === currentQuestion.chapterBinaryCode)!)} disabled={isSyncing}>
                                <Star className={cn("h-5 w-5", starredQuestions.has(currentQuestion.questionNumber) && "fill-yellow-400 text-yellow-400")}/>
                            </Button>
                        </div>
                    </div>
                    <p className="font-serif text-xl md:text-2xl font-bold leading-relaxed whitespace-pre-wrap">{currentQuestion.text}</p>
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
