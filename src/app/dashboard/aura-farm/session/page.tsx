"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { Loader2, Timer, CheckCircle, Flame, ArrowRight, Grid3x3, PartyPopper, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { renderMathText } from "@/lib/render-math";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import { Dialog, DialogContent, DialogTrigger, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription } from "@/components/ui/alert-dialog";

interface SessionQuestion {
    id: string;
    questionNumber: number;
    text: string;
    options: { id: string; text: string; imageUrl?: string }[];
    correctOptionId: string;
    topicTag: string;
    difficulty: string;
    source?: string;
    imageUrl?: string;
}

export default function AuraFarmSessionPage() {
    const { user, loading } = useAuth();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { toast } = useToast();

    const subjectId = searchParams.get('subjectId');
    const chapterBinaryCode = searchParams.get('chapterId');

    const [questions, setQuestions] = useState<SessionQuestion[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [fetching, setFetching] = useState(true);

    const [selectedOption, setSelectedOption] = useState<string | null>(null);
    const [attempts, setAttempts] = useState<any[]>([]);

    // ===== CUMULATIVE TRACKING =====
    // This ref persists ALL attempts across every batch in the entire session.
    // It is NEVER reset (unlike `attempts` state which resets per batch).
    const cumulativeAttemptsRef = useRef<any[]>([]);

    // Running total of questions attempted across all batches in this session
    const [totalAttemptedOverall, setTotalAttemptedOverall] = useState(0);

    // Timer State
    const [timerDisplay, setTimerDisplay] = useState(0);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Exhaustion / Congrats state
    const [showCongrats, setShowCongrats] = useState(false);
    const [isReshuffling, setIsReshuffling] = useState(false);

    // Loading next batch state
    const [isLoadingNextBatch, setIsLoadingNextBatch] = useState(false);

    // Exact time tracking
    const questionStartTimeRef = useRef<number>(0);
    const intervalRef = useRef<NodeJS.Timeout | null>(null);

    const fetchSession = useCallback(async (forceReshuffle = false) => {
        setFetching(true);
        try {
            const reshuffleParam = forceReshuffle ? '&forceReshuffle=true' : '';
            const res = await fetch(`/api/aura-farm/session?studentId=${user?.studentId}&subjectId=${subjectId}&chapterBinaryCode=${chapterBinaryCode}${reshuffleParam}`);
            if (!res.ok) throw new Error("Failed to fetch session questions");
            const data = await res.json();

            if (data.exhausted) {
                setShowCongrats(true);
                setFetching(false);
                return;
            }

            if (data.questions.length === 0) {
                toast({ title: "No questions found", description: "This chapter has no questions available." });
                router.push('/dashboard/aura-farm');
                return;
            }
            setQuestions(data.questions);
            setCurrentIndex(0);
            setAttempts([]);
            setSelectedOption(null);
            startTimer();
        } catch (error: any) {
            toast({ variant: "destructive", title: "Error", description: error.message });
        } finally {
            setFetching(false);
        }
    }, [user?.studentId, subjectId, chapterBinaryCode, router, toast]);

    useEffect(() => {
        if (!user || loading) return;
        if (!subjectId || !chapterBinaryCode) {
            router.push('/dashboard/aura-farm');
            return;
        }
        fetchSession();
    }, [user, loading, subjectId, chapterBinaryCode, router, toast, fetchSession]);

    const handleContinueAfterCongrats = async () => {
        setIsReshuffling(true);
        setShowCongrats(false);
        // NOTE: We do NOT reset cumulativeAttemptsRef here — that's the whole fix.
        await fetchSession(true);
        setIsReshuffling(false);
    };

    const startTimer = () => {
        setTimerDisplay(0);
        questionStartTimeRef.current = Date.now();

        if (intervalRef.current) clearInterval(intervalRef.current);

        intervalRef.current = setInterval(() => {
            const now = Date.now();
            const elapsed = Math.floor((now - questionStartTimeRef.current) / 1000);
            setTimerDisplay(elapsed);
        }, 1000);
    };

    const stopTimer = () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
        const now = Date.now();
        const absoluteSeconds = (now - questionStartTimeRef.current) / 1000;
        return parseFloat(absoluteSeconds.toFixed(3));
    };

    const handleNext = async () => {
        const timeSpentSeconds = stopTimer();
        const currentQ = questions[currentIndex];

        const isCorrect = selectedOption ? selectedOption === currentQ.correctOptionId : false;
        const isAttempted = selectedOption !== null;

        const attemptData = {
            questionId: currentQ.id,
            questionText: currentQ.text,
            selectedOptionId: selectedOption || null,
            correctOptionId: currentQ.correctOptionId,
            timeSpentSeconds,
            isCorrect,
            isAttempted,
            topicTag: currentQ.topicTag,
            difficulty: currentQ.difficulty,
            attemptTimestamp: Date.now()
        };

        const newAttempts = [...attempts, attemptData];
        setAttempts(newAttempts);
        setTotalAttemptedOverall(prev => prev + 1);

        // Always append to cumulative ref
        cumulativeAttemptsRef.current = [...cumulativeAttemptsRef.current, attemptData];

        if (currentIndex < questions.length - 1) {
            setCurrentIndex(currentIndex + 1);
            setSelectedOption(null);
            startTimer();
        } else {
            // End of current batch — auto-submit batch and load next
            await submitBatchAndContinue(newAttempts);
        }
    };

    const submitBatchAndContinue = async (finalAttempts: any[]) => {
        setIsLoadingNextBatch(true);
        try {
            // Submit current batch (isFinal=false — no session doc created)
            const res = await fetch('/api/aura-farm/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    studentId: user?.studentId,
                    subjectId,
                    chapterBinaryCode,
                    attempts: finalAttempts,
                    isFinal: false
                })
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || "Submission failed");
            }

            const data = await res.json();

            if (data.streakUpdated) {
                toast({ title: "Streak Updated! 🔥", description: "You've hit 10+ questions today — your streak is safe!" });
            }

            // Now fetch the next batch seamlessly
            const nextRes = await fetch(`/api/aura-farm/session?studentId=${user?.studentId}&subjectId=${subjectId}&chapterBinaryCode=${chapterBinaryCode}`);
            if (!nextRes.ok) throw new Error("Failed to fetch next batch");
            const nextData = await nextRes.json();

            if (nextData.exhausted) {
                setShowCongrats(true);
            } else if (nextData.questions.length === 0) {
                setShowCongrats(true);
            } else {
                setQuestions(nextData.questions);
                setCurrentIndex(0);
                setAttempts([]);
                setSelectedOption(null);
                startTimer();
            }
        } catch (error: any) {
            toast({ variant: "destructive", title: "Error", description: error.message });
        } finally {
            setIsLoadingNextBatch(false);
        }
    };

    const handleForceSubmit = async () => {
        // Include the current question if an option is selected
        let batchAttempts = [...attempts];
        if (selectedOption) {
            const timeSpentSeconds = stopTimer();
            const currentQ = questions[currentIndex];
            const attemptData = {
                questionId: currentQ.id,
                questionText: currentQ.text,
                selectedOptionId: selectedOption,
                correctOptionId: currentQ.correctOptionId,
                timeSpentSeconds,
                isCorrect: selectedOption === currentQ.correctOptionId,
                isAttempted: true,
                topicTag: currentQ.topicTag,
                difficulty: currentQ.difficulty,
                attemptTimestamp: Date.now()
            };
            batchAttempts.push(attemptData);
            // Also add to cumulative
            cumulativeAttemptsRef.current = [...cumulativeAttemptsRef.current, attemptData];
        }

        await submitSession(batchAttempts);
    };

    const submitSession = async (currentBatchAttempts: any[]) => {
        setIsSubmitting(true);
        setTimerDisplay(0);

        try {
            // Final submit: include ALL cumulative attempts for the session document
            const allAttempts = cumulativeAttemptsRef.current;

            const res = await fetch('/api/aura-farm/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    studentId: user?.studentId,
                    subjectId,
                    chapterBinaryCode,
                    attempts: currentBatchAttempts,
                    isFinal: true,
                    allAttempts: allAttempts
                })
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || "Submission failed");
            }

            const data = await res.json();

            if (data.streakUpdated) {
                toast({ title: "Aura Earned! 🔥", description: "You completed your daily goal and protected your streak." });
            }

            // Route to results
            router.push(`/dashboard/aura-farm/results?sessionId=${data.sessionId}`);

        } catch (error: any) {
            toast({ variant: "destructive", title: "Submission Error", description: error.message });
            setIsSubmitting(false);
        }
    };

    const formatSeconds = (ticks: number) => {
        const m = Math.floor(ticks / 60);
        const s = ticks % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    // Congrats screen when all questions are exhausted
    if (showCongrats || isReshuffling) {
        return (
            <div className="flex flex-col h-[80vh] items-center justify-center gap-6 p-6 text-center">
                {isReshuffling ? (
                    <>
                        <Loader2 className="h-12 w-12 animate-spin text-primary" />
                        <p className="text-muted-foreground font-medium">Reshuffling your questions...</p>
                    </>
                ) : (
                    <motion.div
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: "spring", stiffness: 200, damping: 15 }}
                        className="flex flex-col items-center gap-6 max-w-md"
                    >
                        <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center">
                            <PartyPopper className="w-10 h-10 text-emerald-600" />
                        </div>
                        <h1 className="text-3xl font-black text-slate-900 tracking-tight">
                            🎉 Congratulations!
                        </h1>
                        <p className="text-lg text-slate-600 leading-relaxed">
                            You&apos;ve completed <strong>all available questions</strong> in this chapter!
                            You answered <strong>{totalAttemptedOverall} questions</strong> this session.
                            The questions will now reshuffle and reappear until new questions are added to the question bank.
                        </p>
                        <div className="flex flex-col sm:flex-row gap-3 mt-4">
                            <Button
                                onClick={handleContinueAfterCongrats}
                                size="lg"
                                className="bg-emerald-600 hover:bg-emerald-700 rounded-xl px-8"
                            >
                                <RefreshCcw className="mr-2 w-5 h-5" /> Continue Practicing
                            </Button>
                            <Button
                                onClick={handleForceSubmit}
                                variant="outline"
                                size="lg"
                                className="rounded-xl px-8 border-emerald-600 text-emerald-700"
                            >
                                <CheckCircle className="mr-2 w-5 h-5" /> Complete & View Analysis
                            </Button>
                        </div>
                    </motion.div>
                )}
            </div>
        );
    }

    if (loading || fetching) {
        return <div className="flex flex-col h-[70vh] items-center justify-center gap-4">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p className="text-muted-foreground animate-pulse font-medium tracking-tight">Gathering your Aura questions...</p>
        </div>;
    }

    if (questions.length === 0) return null;

    const question = questions[currentIndex];
    const isDangerZone = timerDisplay > 90;

    return (
        <div className="flex flex-col h-screen overflow-hidden bg-slate-50">
            {(!isSubmitting && !isLoadingNextBatch) && question && (
                <>
                    <header className="sticky top-0 z-10 flex flex-col pt-2 bg-background/95 backdrop-blur-sm border-b border-slate-200">
                        <div className="flex items-center justify-between p-3 flex-wrap gap-y-2 max-w-4xl mx-auto w-full">
                            <div className="flex items-center gap-2 flex-wrap">
                                <div className="flex items-center gap-2 text-primary font-bold bg-primary/10 px-3 py-1.5 rounded-lg">
                                    <Flame className="w-5 h-5 text-orange-500" />
                                    Aura Farm
                                </div>
                            </div>
                            <div className={cn("flex items-center gap-4 font-semibold text-lg shrink-0")}>
                                <div className="text-sm font-medium text-muted-foreground mr-2">
                                    <span className="text-primary font-bold">
                                        {cumulativeAttemptsRef.current.filter(a => a.isAttempted).length + (selectedOption !== null ? 1 : 0)}
                                    </span> Questions Attempted
                                </div>
                                <div className={cn("flex items-center gap-2", isDangerZone ? "text-destructive" : "text-primary")}>
                                    <Timer className={cn("h-6 w-6", isDangerZone && "animate-pulse")} />
                                    <span className={cn(isDangerZone && "text-red-600 font-bold")}>
                                        {formatSeconds(timerDisplay)}
                                    </span>
                                </div>
                            </div>
                        </div>
                        <Progress value={((currentIndex) / questions.length) * 100} className="h-1 rounded-none" />
                    </header>

                    <main className="flex-1 overflow-y-auto p-4 md:p-6 bg-slate-50">
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={`${totalAttemptedOverall}-${currentIndex}`}
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
                                                <p className="text-sm font-semibold text-primary"> Question {totalAttemptedOverall + currentIndex + 1} </p>
                                                <p className="text-sm text-muted-foreground flex items-center gap-2 flex-wrap">
                                                    <span>{question.topicTag}</span>
                                                    <span className="text-muted-foreground/40">•</span>
                                                    <span className="text-xs bg-secondary px-1.5 py-0.5 rounded text-muted-foreground capitalize">{question.difficulty}</span>
                                                    {question.source && (
                                                        <>
                                                            <span className="text-muted-foreground/40">•</span>
                                                            <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-md font-semibold">{question.source}</span>
                                                        </>
                                                    )}
                                                </p>
                                            </div>
                                        </div>
                                        <p className="font-serif text-xl md:text-2xl font-bold leading-relaxed whitespace-pre-wrap">{renderMathText(question.text)}</p>
                                        {question.imageUrl && (
                                            <Dialog>
                                                <DialogTrigger asChild>
                                                    <div className="mt-4 rounded-lg overflow-hidden border p-2 bg-secondary cursor-zoom-in hover:opacity-90 transition-opacity">
                                                        <Image src={question.imageUrl} alt={`Figure for question`} width={800} height={400} priority className="min-h-[250px] min-w-full h-[250px] md:h-[300px] w-full object-contain mx-auto rounded-md bg-white p-2" />
                                                    </div>
                                                </DialogTrigger>
                                                <DialogContent className="max-w-3xl w-full p-2 bg-transparent border-none shadow-none flex justify-center items-center">
                                                    <DialogTitle className="sr-only">Image details</DialogTitle>
                                                    <div className="bg-background rounded-lg p-2 flex justify-center w-full">
                                                        <Image src={question.imageUrl} alt={`Figure for question`} width={1600} height={800} className="min-h-[500px] min-w-full h-[500px] md:h-[600px] w-full object-contain rounded-md mx-auto bg-white p-4" />
                                                    </div>
                                                </DialogContent>
                                            </Dialog>
                                        )}
                                    </CardContent>
                                </Card>

                                <div className="mt-8 space-y-3">
                                    {question.options.map(opt => (
                                        <motion.div key={opt.id} whileTap={{ scale: 0.98 }}>
                                            <Button
                                                variant="outline"
                                                className={cn("w-full h-auto min-h-[56px] justify-start text-left p-4 text-base md:text-lg whitespace-normal border-2 rounded-xl transition-all",
                                                    selectedOption === opt.id
                                                        ? "border-primary bg-primary/10 text-primary shadow-[0_0_15px_rgba(124,58,237,0.3)]"
                                                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                                                )}
                                                onClick={() => setSelectedOption(opt.id)}
                                            >
                                                <span className="mr-4 font-bold shrink-0 text-slate-500">{opt.id}.</span>
                                                {opt.imageUrl ? (
                                                    <div className="flex-1 flex justify-center">
                                                        <Image src={opt.imageUrl} alt={`Option ${opt.id}`} width={400} height={200} className="max-h-32 md:max-h-40 w-auto object-contain rounded bg-white p-1" />
                                                    </div>
                                                ) : (
                                                    <span className="flex-1">{renderMathText(opt.text)}</span>
                                                )}
                                            </Button>
                                        </motion.div>
                                    ))}
                                </div>
                            </motion.div>
                        </AnimatePresence>
                    </main>

                    <footer className="sticky bottom-0 flex items-center justify-between p-3 border-t bg-background/80 backdrop-blur-sm shadow-[0_-4px_20px_rgba(0,0,0,0.05)]">
                        <div className="max-w-4xl mx-auto flex justify-between w-full gap-4">
                            <Button
                                onClick={handleForceSubmit}
                                variant="outline"
                                size="lg"
                                className="rounded-xl px-4 md:px-6 font-semibold border-emerald-600 text-emerald-700 hover:bg-emerald-50 bg-white shadow-sm"
                            >
                                <CheckCircle className="mr-2 w-5 h-5 text-emerald-600" /> Complete Session
                            </Button>

                            <Button
                                onClick={handleNext}
                                size="lg"
                                className={cn("rounded-xl px-4 md:px-8 shadow-sm flex-1 max-w-[200px]", selectedOption ? "bg-primary" : "bg-slate-300 text-slate-700 hover:bg-slate-400")}
                            >
                                {selectedOption ? "Next Question" : "Skip Question"} <ArrowRight className="ml-2 w-5 h-5 flex-shrink-0" />
                            </Button>
                        </div>
                    </footer>
                </>
            )}

            {/* Loading next batch overlay */}
            {isLoadingNextBatch && (
                <div className="flex flex-col h-screen items-center justify-center gap-4 bg-slate-50">
                    <Loader2 className="h-10 w-10 animate-spin text-primary" />
                    <p className="text-muted-foreground font-medium">Loading next batch...</p>
                    <p className="text-sm text-muted-foreground/70">{totalAttemptedOverall} questions completed so far</p>
                </div>
            )}

            <AlertDialog open={isSubmitting}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-center text-primary flex justify-center items-center gap-2">
                            <Flame className="w-6 h-6 text-orange-500" /> Finalizing Session
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-center text-base">
                            Calculating your Aura and generating NEET Mentor logic...
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="flex justify-center py-6">
                        <Loader2 className="h-12 w-12 animate-spin text-primary" />
                    </div>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
