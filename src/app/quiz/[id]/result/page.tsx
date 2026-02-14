
"use client";

import { useSearchParams, useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Award, Loader2, Check, X, ChevronsRight, AlertTriangle, BarChart, Clock, Target, Repeat, LayoutDashboard, BrainCircuit, Download, Dna, Star, Flag } from 'lucide-react';
import { useAuth, type AppUser } from '@/hooks/use-auth';
import { db } from '@/lib/firebase/config';
import { doc, getDoc, setDoc, deleteDoc, collection, query, where, getDocs, serverTimestamp } from 'firebase/firestore';
import { type QuizAttempt, type Quiz, type Question } from '@/types/quiz';
import { useState, useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { PieChart, Pie, Cell, ResponsiveContainer, Bar, BarChart as RechartsBarChart, XAxis, YAxis, Tooltip } from 'recharts';
import { cn } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import html2canvas from 'html2canvas';
import { useToast } from '@/hooks/use-toast';

interface FlatQuestion extends Question {
  sectionId: string;
  sectionName: string;
  chapterBinaryCode: string;
  chapterName: string;
}

const VitalSigns = ({ analysis, attempt }: { analysis: any, attempt: QuizAttempt }) => {
  if (!analysis) return null;
  const scorePercentage = (analysis.score / analysis.maxScore) * 100;
  const scoreColor = scorePercentage > 80 ? 'text-green-400' : scorePercentage > 50 ? 'text-yellow-400' : 'text-red-400';

  const gaugeData = [{ value: analysis.accuracy }, { value: 100 - analysis.accuracy }];
  const GAUGE_COLORS = ["hsl(var(--primary))", "hsl(var(--secondary))"];

  return (
    <Card className="shadow-lg bg-card/80 backdrop-blur-sm border-white/10">
      <CardHeader>
        <CardTitle className="text-2xl font-bold tracking-tight">Vital Signs</CardTitle>
        <CardDescription>Overall performance for {attempt.studentName}</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
        <div className="flex flex-col items-center justify-center">
          <div className="relative h-48 w-48">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={gaugeData} cx="50%" cy="50%" startAngle={180} endAngle={0} innerRadius={70} outerRadius={85} dataKey="value" stroke="none" cornerRadius={50}>
                  {gaugeData.map((entry, index) => (<Cell key={`cell-${index}`} fill={GAUGE_COLORS[index]} />))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-4xl font-bold text-primary">{analysis.accuracy.toFixed(1)}%</span>
              <span className="text-sm text-muted-foreground">Accuracy</span>
            </div>
          </div>
          <div className="text-center mt-4">
            <p className="text-sm text-muted-foreground">Total Score</p>
            <p className={`text-5xl font-bold ${scoreColor}`}>{analysis.score}<span className="text-2xl text-muted-foreground"> / {analysis.maxScore}</span></p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 text-center">
            <Card className="p-4 bg-secondary">
                <CardHeader className="p-0"><CardTitle className="text-sm font-medium">Correct</CardTitle></CardHeader>
                <p className="text-3xl font-bold mt-1 text-green-400">{analysis.stats.correct}</p>
            </Card>
            <Card className="p-4 bg-secondary">
                <CardHeader className="p-0"><CardTitle className="text-sm font-medium">Incorrect</CardTitle></CardHeader>
                <p className="text-3xl font-bold mt-1 text-red-400">{analysis.stats.incorrect}</p>
            </Card>
            <Card className="p-4 bg-secondary">
                <CardHeader className="p-0"><CardTitle className="text-sm font-medium">Skipped</CardTitle></CardHeader>
                <p className="text-3xl font-bold mt-1">{analysis.stats.skipped}</p>
            </Card>
            <Card className="p-4 bg-secondary">
                <CardHeader className="p-0"><CardTitle className="text-sm font-medium">Time</CardTitle></CardHeader>
                <p className="text-3xl font-bold mt-1">{analysis.timeTaken.minutes}<span className="text-lg">m</span> {analysis.timeTaken.seconds}<span className="text-lg">s</span></p>
            </Card>
        </div>
      </CardContent>
    </Card>
  );
}

const SubjectPerformanceChart = ({ data }: { data: any[] }) => {
    const chartColors = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))"];
    return (
    <Card className="shadow-lg bg-card/80 backdrop-blur-sm border-white/10">
      <CardHeader>
        <CardTitle className="text-2xl font-bold tracking-tight">Subject ECG</CardTitle>
        <CardDescription>Your accuracy breakdown by subject.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[300px] w-full">
             <ResponsiveContainer>
                <RechartsBarChart data={data} margin={{ top: 5, right: 0, left: -20, bottom: 5 }}>
                    <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}%`} domain={[0, 100]} />
                    <Tooltip cursor={{ fill: 'hsl(var(--secondary))' }} contentStyle={{ backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)' }} />
                    <Bar dataKey="accuracy" radius={[8, 8, 0, 0]}>
                        {data.map((entry, index) => (<Cell key={`cell-${index}`} fill={chartColors[index % chartColors.length]} />))}
                    </Bar>
                </RechartsBarChart>
            </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

const QuestionReview = ({ 
    flatQuestions, 
    attempt, 
    user,
    quizId,
    quizTitle,
    starredQuestions,
    setStarredQuestions,
    flaggedQuestions,
    setFlaggedQuestions,
}: { 
    flatQuestions: FlatQuestion[], 
    attempt: QuizAttempt,
    user: AppUser | null,
    quizId: string,
    quizTitle: string,
    starredQuestions: Set<number>,
    setStarredQuestions: React.Dispatch<React.SetStateAction<Set<number>>>,
    flaggedQuestions: Set<number>,
    setFlaggedQuestions: React.Dispatch<React.SetStateAction<Set<number>>>,
}) => {
    const [filter, setFilter] = useState('all');
    const [isSyncing, setIsSyncing] = useState<number | null>(null);
    const { toast } = useToast();

    const filteredQuestions = useMemo(() => {
        return filter === 'all' ? flatQuestions 
             : flatQuestions.filter(q => {
                const userAnswer = attempt.answers[q.questionNumber];
                if (filter === 'incorrect') return userAnswer && userAnswer !== q.correctOptionId;
                if (filter === 'skipped') return !userAnswer;
                return false;
            });
    }, [filter, flatQuestions, attempt.answers]);

    const handleToggleFeature = async (
        question: FlatQuestion,
        collectionName: 'starred_questions' | 'flagged_questions',
        stateSet: Set<number>,
        setter: React.Dispatch<React.SetStateAction<Set<number>>>
      ) => {
          if (!user || isSyncing === question.questionNumber) return;
          setIsSyncing(question.questionNumber);
    
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
                      quizTitle: quizTitle,
                      questionNumber: question.questionNumber,
                      sectionId: question.sectionId,
                      sectionName: question.sectionName,
                      chapterBinaryCode: question.chapterBinaryCode,
                      chapterName: question.chapterName,
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
              setIsSyncing(null);
          }
      };

    return (
        <Card className="shadow-lg bg-card/80 backdrop-blur-sm border-white/10">
             <CardHeader>
                <CardTitle className="text-2xl font-bold tracking-tight">Post-Mortem</CardTitle>
                <CardDescription>A detailed review of every question.</CardDescription>
            </CardHeader>
            <CardContent>
                <Tabs value={filter} onValueChange={setFilter} className="w-full">
                    <TabsList className="grid w-full grid-cols-3 sticky top-0 bg-secondary/95 backdrop-blur-sm z-10">
                        <TabsTrigger value="all">All</TabsTrigger>
                        <TabsTrigger value="incorrect">Mistakes</TabsTrigger>
                        <TabsTrigger value="skipped">Skipped</TabsTrigger>
                    </TabsList>
                </Tabs>
                <div className="mt-4 space-y-4 max-h-[60vh] overflow-y-auto p-1">
                    {filteredQuestions.map(q => {
                         const userAnswerId = attempt.answers[q.questionNumber];
                         const isCorrect = userAnswerId === q.correctOptionId;
                         const isSkipped = !userAnswerId;
                         const isWrong = !isSkipped && !isCorrect;

                        return (
                         <Card key={q.questionNumber} className="bg-secondary">
                            <CardHeader className="pb-3">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <Badge variant="outline">{q.sectionName}</Badge>
                                        <p className="mt-1 text-xs text-muted-foreground font-mono">{q.chapterName}</p>
                                    </div>
                                    <div className="flex items-center">
                                        <Button variant="ghost" size="icon" onClick={() => handleToggleFeature(q, 'flagged_questions', flaggedQuestions, setFlaggedQuestions)} disabled={isSyncing === q.questionNumber}>
                                            <Flag className={cn("h-5 w-5 text-muted-foreground", flaggedQuestions.has(q.questionNumber) && "fill-orange-500 text-orange-500")}/>
                                        </Button>
                                        <Button variant="ghost" size="icon" onClick={() => handleToggleFeature(q, 'starred_questions', starredQuestions, setStarredQuestions)} disabled={isSyncing === q.questionNumber}>
                                            <Star className={cn("h-5 w-5 text-muted-foreground", starredQuestions.has(q.questionNumber) && "fill-yellow-400 text-yellow-400")}/>
                                        </Button>
                                        <div className={cn("h-6 w-6 rounded-full flex items-center justify-center ml-2", isCorrect && "bg-green-500/20 text-green-400", isWrong && "bg-red-500/20 text-red-400", isSkipped && "bg-muted")}>
                                            {isCorrect && <Check size={16}/>}
                                            {isWrong && <X size={16}/>}
                                            {isSkipped && <ChevronsRight size={16}/>}
                                        </div>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <p className="mb-4 font-serif whitespace-pre-wrap">{q.text}</p>
                                <div className="space-y-2">
                                    {q.options.map(opt => {
                                        const isCorrectOption = opt.id === q.correctOptionId;
                                        const isSelected = opt.id === userAnswerId;
                                        return (
                                            <div key={opt.id}
                                                className={cn("w-full h-auto min-h-[44px] flex items-center justify-start text-left p-3 text-sm whitespace-normal rounded-md border-2", {
                                                    "border-green-500 bg-green-500/10 font-semibold": isCorrectOption,
                                                    "border-red-500 bg-red-500/10": isSelected && !isCorrectOption,
                                                    "border-transparent bg-background/50": !isSelected && !isCorrectOption,
                                                })}>
                                               <span className="font-semibold mr-2">{opt.id}.</span> {opt.text}
                                            </div>
                                        )
                                    })}
                                </div>
                                {q.explanation && (
                                  <div className="mt-4 p-3 bg-primary/10 rounded-lg">
                                      <p className="text-sm font-semibold text-primary flex items-center gap-2"><BrainCircuit size={16}/> Explanation</p>
                                      <p className="text-sm text-primary/80 mt-1"> {q.explanation} </p>
                                  </div>
                                )}
                            </CardContent>
                         </Card>
                    )})}
                </div>
            </CardContent>
        </Card>
    )
}

const ShareCard = ({ analysis, attempt, quiz, forwardedRef }: { analysis: any, attempt: any, quiz: any, forwardedRef: any }) => {
    if (!analysis) return null;
    return (
        <div ref={forwardedRef} className="w-[350px] h-[622px] bg-slate-900 text-white p-6 flex flex-col justify-between font-sans" style={{backgroundImage: 'linear-gradient(to bottom, hsl(var(--primary)), hsl(var(--background)))'}}>
            <div className="text-center">
                <p className="text-xl font-bold tracking-tight text-primary-foreground">Neetarded</p>
                <p className="text-xs text-primary-foreground/50">High-Performance Quiz Platform</p>
            </div>
            <div className="text-center">
                <p className="text-lg text-primary-foreground/80">I scored</p>
                <p className="text-7xl font-bold text-accent">{analysis.score}<span className="text-4xl text-primary-foreground/50"> / {analysis.maxScore}</span></p>
                <p className="text-lg mt-2 text-primary-foreground/80">on the <span className="font-bold text-white">{quiz.title}</span></p>
            </div>
            <div className="space-y-3">
                <div className="flex justify-between items-center bg-black/20 p-3 rounded-lg backdrop-blur-sm">
                    <p>Accuracy</p>
                    <p className="text-2xl font-bold">{analysis.accuracy.toFixed(1)}%</p>
                </div>
                <div className="flex justify-between items-center bg-black/20 p-3 rounded-lg backdrop-blur-sm">
                    <p>Mistakes</p>
                    <p className="text-2xl font-bold">{analysis.stats.incorrect}</p>
                </div>
            </div>
            <div className="text-center">
                <p className="text-accent font-semibold">Challenge me!</p>
            </div>
        </div>
    )
}


const DeepAnalysis = ({ attempt }: { attempt: QuizAttempt }) => {
    if (!attempt?.deepAnalysis) {
        return null;
    }

    const subjects = Object.values(attempt.deepAnalysis.subjects || {});
    const chapters = Object.entries(attempt.deepAnalysis.chapters || {}).map(([code, data]) => ({ code, ...(data as any) }));

    if (subjects.length === 0 && chapters.length === 0) {
        return null;
    }

    return (
        <Card className="shadow-lg bg-card/80 backdrop-blur-sm border-white/10">
            <CardHeader>
                <div className="flex items-center justify-between">
                    <CardTitle className="text-2xl font-bold tracking-tight flex items-center gap-2">
                        <Dna size={24} /> Deep Scope Analysis
                    </CardTitle>
                    <Badge variant="secondary" className="bg-primary/20 text-primary border-primary/30">Pro Insight</Badge>
                </div>
            </CardHeader>
            <CardContent className="grid md:grid-cols-2 gap-6">
                {/* Column A: Subject Performance */}
                <div className="space-y-4">
                    <h4 className="font-semibold text-lg">Subject Performance</h4>
                    {subjects.map((subject: any, index: number) => {
                        const total = subject.correct + subject.incorrect;
                        const correctPercentage = total > 0 ? (subject.correct / total) * 100 : 0;
                        const incorrectPercentage = total > 0 ? (subject.incorrect / total) * 100 : 0;
                        return (
                            <div key={index} className="p-4 rounded-lg bg-secondary">
                                <div className="flex justify-between items-center mb-2">
                                    <p className="font-bold text-base">{subject.name}</p>
                                    <p className={`font-bold text-lg ${subject.score >= 0 ? 'text-green-400' : 'text-red-400'}`}>{subject.score >= 0 ? '+' : ''}{subject.score} Marks</p>
                                </div>
                                <div className="w-full bg-muted rounded-full h-2 flex overflow-hidden">
                                    <div className="bg-green-500 h-2" style={{ width: `${correctPercentage}%` }}></div>
                                    <div className="bg-red-500 h-2" style={{ width: `${incorrectPercentage}%` }}></div>
                                </div>
                                <div className="flex items-center text-xs mt-2 text-muted-foreground gap-4">
                                    <span className='flex items-center gap-1'> <Check size={14} className="text-green-500" /> {subject.correct} Correct</span>
                                    <span className='flex items-center gap-1'> <X size={14} className="text-red-500" /> {subject.incorrect} Wrong</span>
                                </div>
                            </div>
                        )
                    })}
                </div>

                {/* Column B: Chapter Weakness Radar */}
                <div>
                     <h4 className="font-semibold text-lg mb-4">Chapter Weakness Radar</h4>
                    <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
                        {chapters.map((chapter: any, index: number) => {
                            const total = chapter.correct + chapter.incorrect;
                            const accuracy = total > 0 ? (chapter.correct / total) * 100 : 0;
                            
                            let badgeClass = "border-yellow-500/30 bg-yellow-500/20 text-yellow-500";
                            if (accuracy >= 75) badgeClass = "border-green-500/30 bg-green-500/20 text-green-500";
                            if (accuracy < 40) badgeClass = "border-red-500/30 bg-red-500/20 text-red-500";

                            return (
                                <div key={index} className="flex items-center justify-between p-3 rounded-lg bg-secondary">
                                    <div>
                                        <p className="font-semibold">{chapter.name}</p>
                                        <p className="text-xs text-muted-foreground">{chapter.subject}</p>
                                    </div>
                                    <Badge variant="outline" className={cn("font-bold", badgeClass)}>{accuracy.toFixed(0)}% Accuracy</Badge>
                                </div>
                            )
                        })}
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}


export default function ResultPage() {
    const router = useRouter();
    const params = useParams();
    const searchParams = useSearchParams();
    const { user } = useAuth();
    const attemptId = searchParams.get('attemptId');
    const quizId = params.id as string;

    const [attempt, setAttempt] = useState<QuizAttempt | null>(null);
    const [quiz, setQuiz] = useState<Quiz | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const shareCardRef = useRef(null);

    const [starredQuestions, setStarredQuestions] = useState<Set<number>>(new Set());
    const [flaggedQuestions, setFlaggedQuestions] = useState<Set<number>>(new Set());

    useEffect(() => {
        async function fetchResults() {
            if (!attemptId) { setError("Attempt ID not found."); setLoading(false); return; }
            try {
                setLoading(true);
                const attemptDoc = await getDoc(doc(db, "attempts", attemptId));
                if (!attemptDoc.exists()) { setError("Attempt not found."); setLoading(false); return; }
                const attemptData = attemptDoc.data() as QuizAttempt;

                const quizDoc = await getDoc(doc(db, "quizzes", attemptData.quizId));
                if (!quizDoc.exists()) { setError("Associated quiz not found."); setLoading(false); return; }

                setAttempt(attemptData);
                setQuiz(quizDoc.data() as Quiz);
                // No need to set loading false here, will be done after fetching star/flag status
            } catch (e: any) {
                setError(e.message || "An unknown error occurred.");
                setLoading(false);
            }
        }
        fetchResults();
    }, [attemptId]);

    useEffect(() => {
        if (!user || !quizId || !attempt) return;
    
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
        
        const fetchAllStatus = async () => {
            await Promise.all([
                fetchStatus('starred_questions', setStarredQuestions),
                fetchStatus('flagged_questions', setFlaggedQuestions)
            ]);
            setLoading(false); // Set loading to false after everything is fetched
        }
    
        fetchAllStatus();
    
      }, [user, quizId, attempt]);

    const flatQuestions: FlatQuestion[] = useMemo(() => {
        if (!quiz) return [];
        return quiz.structure.flatMap(section => 
            section.chapters.flatMap(chapter => 
                (chapter.questions || []).map(q => ({...q, sectionId: section.id, sectionName: section.name, chapterBinaryCode: chapter.binaryCode, chapterName: chapter.name}))
            )
        ).sort((a, b) => a.questionNumber - b.questionNumber);
    }, [quiz]);

    const analysis = useMemo(() => {
        if (!attempt || !quiz || flatQuestions.length === 0) return null;
        const maxScore = flatQuestions.length * quiz.settings.positiveMarks;
        const attemptedCount = attempt.correctAnswers + attempt.incorrectAnswers;
        return {
            score: attempt.score, maxScore,
            accuracy: attemptedCount > 0 ? (attempt.correctAnswers / attemptedCount) * 100 : 0,
            timeTaken: { minutes: Math.floor(attempt.timeTaken / 60), seconds: Math.floor(attempt.timeTaken % 60), },
            stats: { correct: attempt.correctAnswers, incorrect: attempt.incorrectAnswers, skipped: attempt.unattempted },
            subjectPerformance: attempt.sectionPerformance.map(p => ({name: p.sectionName, accuracy: p.accuracy, correct: p.correct, incorrect: p.incorrect}))
        };
    }, [attempt, quiz, flatQuestions]);
    
    const handleGenerateCard = async () => {
        if (!shareCardRef.current) return;
        try {
            const canvas = await html2canvas(shareCardRef.current, { backgroundColor: null });
            const image = canvas.toDataURL("image/png");
            const link = document.createElement('a');
            link.href = image;
            link.download = `neetarded-result-${attempt?.quizTitle.replace(/\s+/g, '-')}.png`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (error) {
            console.error("Failed to generate share card:", error);
            alert("Could not generate share card.");
        }
    };
    
    if (loading) {
        return ( <div className="flex h-screen w-full flex-col items-center justify-center bg-background text-center p-4"> <Loader2 className="h-12 w-12 text-primary animate-spin mb-4"/> <h1 className="text-2xl font-bold text-foreground">Analyzing Results...</h1> <p className="text-muted-foreground">Generating your performance report.</p> </div> );
    }
    
    if (error || !analysis || !attempt || !quiz) {
        return ( <div className="flex h-screen items-center justify-center text-center p-4"> <div> <AlertTriangle className="h-12 w-12 text-destructive mx-auto" /> <h1 className="mt-4 text-2xl font-bold">Could Not Load Results</h1> <p className="text-muted-foreground mt-2">{error || "The analysis could not be generated."}</p> <Button asChild className="mt-6"><Link href="/dashboard">Go to Dashboard</Link></Button> </div> </div> )
    }

    return (
        <motion.div 
            className="min-h-screen bg-background p-4 md:p-8 space-y-6"
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            
            <div className="fixed top-[-2000px] left-[-2000px]"><ShareCard analysis={analysis} attempt={attempt} quiz={quiz} forwardedRef={shareCardRef} /></div>
            
            <VitalSigns analysis={analysis} attempt={attempt} />
            <SubjectPerformanceChart data={analysis.subjectPerformance} />
            {attempt && <DeepAnalysis attempt={attempt} />}
            <QuestionReview 
                flatQuestions={flatQuestions} 
                attempt={attempt} 
                user={user}
                quizId={quiz.id}
                quizTitle={quiz.title}
                starredQuestions={starredQuestions}
                setStarredQuestions={setStarredQuestions}
                flaggedQuestions={flaggedQuestions}
                setFlaggedQuestions={setFlaggedQuestions}
            />

            <Card className="shadow-lg sticky bottom-4 z-20 bg-card/80 backdrop-blur-sm border-white/10">
                <CardContent className="p-2 grid grid-cols-2 md:grid-cols-4 gap-2">
                    <Button variant="outline" className="w-full" asChild><Link href={`/quiz/${quizId}`}> <Repeat/> Retake </Link></Button>
                    <Button className="w-full" asChild><Link href="/dashboard"> <LayoutDashboard/> Dashboard </Link></Button>
                    <Button variant="secondary" className="w-full" asChild><Link href={`/results/${attempt.studentId}`}> <BarChart/> My Profile </Link></Button>
                    <Button onClick={handleGenerateCard} variant="default" className="w-full bg-accent hover:bg-accent/90">
                        <Download/> Share Card
                    </Button>
                </CardContent>
            </Card>
        </motion.div>
    );
}
