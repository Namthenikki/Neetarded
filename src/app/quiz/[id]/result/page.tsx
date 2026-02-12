
"use client";

import { useSearchParams, useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Award, Loader2, Check, X, ChevronsRight, AlertTriangle, BarChart, Clock, Target, Repeat, LayoutDashboard, BrainCircuit } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { db } from '@/lib/firebase/config';
import { doc, getDoc } from 'firebase/firestore';
import { type QuizAttempt, type Quiz, type Question } from '@/types/quiz';
import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { PieChart, Pie, Cell, ResponsiveContainer, Bar, BarChart as RechartsBarChart, XAxis, YAxis, Tooltip } from 'recharts';
import { cn } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';


interface FlatQuestion extends Question {
  sectionId: string;
  sectionName: string;
  chapterBinaryCode: string;
  chapterName: string;
}

// --- Internal Components for UI Zones ---

const VitalSigns = ({ analysis }: { analysis: any }) => {
  if (!analysis) return null;
  const scorePercentage = (analysis.score / analysis.maxScore) * 100;
  const scoreColor = scorePercentage > 80 ? 'text-green-500' : scorePercentage > 50 ? 'text-yellow-500' : 'text-red-500';

  const gaugeData = [
    { name: 'Accuracy', value: analysis.accuracy },
    { name: 'Remaining', value: 100 - analysis.accuracy },
  ];
  const GAUGE_COLORS = ['hsl(var(--primary))', 'hsl(var(--muted))'];

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="text-2xl font-bold tracking-tight">Vital Signs</CardTitle>
        <CardDescription>Your overall performance at a glance.</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
        <div className="flex flex-col items-center justify-center">
          <div className="relative h-48 w-48">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={gaugeData}
                  cx="50%"
                  cy="50%"
                  startAngle={180}
                  endAngle={0}
                  innerRadius={60}
                  outerRadius={80}
                  dataKey="value"
                  stroke="none"
                  paddingAngle={2}
                >
                  {gaugeData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={GAUGE_COLORS[index % GAUGE_COLORS.length]} />
                  ))}
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
            <p className={`text-4xl font-bold ${scoreColor}`}>{analysis.score} / {analysis.maxScore}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
            <Card className="p-4 bg-background">
                <CardHeader className="p-0 flex-row items-center justify-between">
                    <CardTitle className="text-sm font-medium">Correct</CardTitle>
                    <Check className="h-4 w-4 text-green-500"/>
                </CardHeader>
                <p className="text-2xl font-bold mt-2">{analysis.stats.correct}</p>
            </Card>
            <Card className="p-4 bg-background">
                <CardHeader className="p-0 flex-row items-center justify-between">
                    <CardTitle className="text-sm font-medium">Incorrect</CardTitle>
                    <X className="h-4 w-4 text-red-500"/>
                </CardHeader>
                <p className="text-2xl font-bold mt-2">{analysis.stats.incorrect}</p>
            </Card>
            <Card className="p-4 bg-background">
                <CardHeader className="p-0 flex-row items-center justify-between">
                    <CardTitle className="text-sm font-medium">Skipped</CardTitle>
                    <ChevronsRight className="h-4 w-4 text-muted-foreground"/>
                </CardHeader>
                <p className="text-2xl font-bold mt-2">{analysis.stats.skipped}</p>
            </Card>
            <Card className="p-4 bg-background">
                <CardHeader className="p-0 flex-row items-center justify-between">
                    <CardTitle className="text-sm font-medium">Time Taken</CardTitle>
                    <Clock className="h-4 w-4 text-muted-foreground"/>
                </CardHeader>
                <p className="text-2xl font-bold mt-2">{analysis.timeTaken.minutes}m {analysis.timeTaken.seconds}s</p>
            </Card>
        </div>
      </CardContent>
    </Card>
  );
}

const SubjectPerformanceChart = ({ data }: { data: any[] }) => {
    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            return (
            <div className="p-2 bg-background border rounded-lg shadow-lg">
                <p className="font-bold">{label}</p>
                <p className="text-primary">{`Accuracy: ${payload[0].value.toFixed(1)}%`}</p>
                <p className="text-sm text-green-500">{`Correct: ${payload[0].payload.correct}`}</p>
                <p className="text-sm text-red-500">{`Incorrect: ${payload[0].payload.incorrect}`}</p>
            </div>
            );
        }
        return null;
    };

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="text-2xl font-bold tracking-tight">Subject ECG</CardTitle>
        <CardDescription>Your accuracy breakdown by subject.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[300px] w-full">
             <ResponsiveContainer>
                <RechartsBarChart data={data} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                    <XAxis dataKey="name" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}%`} domain={[0, 100]} />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(var(--muted))' }} />
                    <Bar dataKey="accuracy" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </RechartsBarChart>
            </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

const QuestionReview = ({ flatQuestions, attempt }: { flatQuestions: FlatQuestion[], attempt: QuizAttempt }) => {
    const [filter, setFilter] = useState('all');

    const filteredQuestions = useMemo(() => {
        switch (filter) {
            case 'incorrect':
                return flatQuestions.filter(q => {
                    const userAnswer = attempt.answers[q.questionNumber];
                    return userAnswer && userAnswer !== q.correctOptionId;
                });
            case 'skipped':
                return flatQuestions.filter(q => !attempt.answers[q.questionNumber]);
            case 'all':
            default:
                return flatQuestions;
        }
    }, [filter, flatQuestions, attempt.answers]);

    return (
        <Card className="shadow-lg">
             <CardHeader>
                <CardTitle className="text-2xl font-bold tracking-tight">Post-Mortem</CardTitle>
                <CardDescription>A detailed review of every question.</CardDescription>
            </CardHeader>
            <CardContent>
                <Tabs value={filter} onValueChange={setFilter} className="w-full">
                    <TabsList className="grid w-full grid-cols-3 sticky top-0 bg-background/95 backdrop-blur-sm z-10">
                        <TabsTrigger value="all">All</TabsTrigger>
                        <TabsTrigger value="incorrect">Mistakes</TabsTrigger>
                        <TabsTrigger value="skipped">Skipped</TabsTrigger>
                    </TabsList>
                </Tabs>
                <div className="mt-4 space-y-4 max-h-[60vh] overflow-y-auto pr-2">
                    {filteredQuestions.map(q => (
                         <Card key={q.questionNumber} className="bg-background/50">
                            <CardHeader className="flex-row justify-between items-start">
                                <div>
                                    <Badge variant="secondary">{q.sectionName}</Badge>
                                    <p className="mt-1 text-xs text-muted-foreground font-mono">Chapter: {q.chapterName} ({q.chapterBinaryCode})</p>
                                </div>
                                <p className="font-semibold text-sm">Q. {q.questionNumber}</p>
                            </CardHeader>
                            <CardContent>
                                <p className="mb-4">{q.text}</p>
                                <div className="space-y-2">
                                    {q.options.map(opt => {
                                        const userAnswerId = attempt.answers[q.questionNumber];
                                        const isCorrect = opt.id === q.correctOptionId;
                                        const isSelected = opt.id === userAnswerId;

                                        return (
                                            <Button
                                                key={opt.id}
                                                variant="outline"
                                                className={cn("w-full h-auto min-h-[44px] justify-between text-left p-3 text-sm whitespace-normal relative", {
                                                    "bg-green-600/20 border-green-600 text-green-900 dark:text-green-200 font-semibold": isCorrect,
                                                    "bg-red-500/20 border-red-500 text-red-900 dark:text-red-200": isSelected && !isCorrect,
                                                    "bg-muted/50": !isSelected && !isCorrect,
                                                })}
                                            >
                                               <div><span className="font-semibold mr-2">{opt.id}.</span> {opt.text}</div>
                                               {isSelected && !isCorrect && <X className="h-4 w-4 ml-2" />}
                                               {isCorrect && <Check className="h-4 w-4 ml-2" />}
                                            </Button>
                                        )
                                    })}
                                </div>
                                {(q.explanation) && (
                                  <div className="mt-4 p-3 bg-accent/30 rounded-lg">
                                      <p className="text-sm font-semibold text-accent-foreground flex items-center gap-2"><BrainCircuit className="h-4 w-4"/> AI Analysis</p>
                                      <p className="text-xs text-accent-foreground/80 mt-1">
                                          {q.explanation}
                                      </p>
                                  </div>
                                )}
                            </CardContent>
                         </Card>
                    ))}
                </div>
            </CardContent>
        </Card>
    )
}

// --- Main Page Component ---

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

    useEffect(() => {
        async function fetchResults() {
            if (!attemptId || !user) {
                setError("Attempt ID or user not found.");
                setLoading(false);
                return;
            }
            try {
                setLoading(true);
                const attemptDoc = await getDoc(doc(db, "attempts", attemptId));
                if (!attemptDoc.exists() || attemptDoc.data().userId !== user.uid) {
                    setError("Attempt not found or you do not have permission to view it.");
                    return;
                }
                const attemptData = attemptDoc.data() as QuizAttempt;

                const quizDoc = await getDoc(doc(db, "quizzes", attemptData.quizId));
                if (!quizDoc.exists()) {
                    setError("Associated quiz not found.");
                    return;
                }

                setAttempt(attemptData);
                setQuiz(quizDoc.data() as Quiz);

            } catch (e: any) {
                console.error("Error fetching results:", e);
                setError(e.message || "An unknown error occurred.");
            } finally {
                // Simulate analysis time
                setTimeout(() => {
                    setLoading(false);
                }, 1500);
            }
        }
        fetchResults();
    }, [attemptId, user]);

    const flatQuestions: FlatQuestion[] = useMemo(() => {
        if (!quiz) return [];
        return quiz.structure.flatMap(section => 
            section.chapters.flatMap(chapter => 
                (chapter.questions || []).map(q => ({
                    ...q,
                    sectionId: section.id,
                    sectionName: section.name,
                    chapterBinaryCode: chapter.binaryCode,
                    chapterName: chapter.name
                }))
            )
        );
    }, [quiz]);

    const analysis = useMemo(() => {
        if (!attempt || !quiz || flatQuestions.length === 0) return null;

        let correct = 0;
        let incorrect = 0;
        let attemptedCount = 0;
        const subjectStats: { [key: string]: { correct: number, incorrect: number, name: string } } = {};

        quiz.structure.forEach(s => {
            subjectStats[s.id] = { correct: 0, incorrect: 0, name: s.name };
        });

        flatQuestions.forEach(q => {
            const userAnswer = attempt.answers[q.questionNumber];
            if (userAnswer) {
                attemptedCount++;
                if (userAnswer === q.correctOptionId) {
                    correct++;
                    subjectStats[q.sectionId].correct++;
                } else {
                    incorrect++;
                    subjectStats[q.sectionId].incorrect++;
                }
            }
        });

        const score = (correct * quiz.settings.positiveMarks) + (incorrect * quiz.settings.negativeMarks);
        const maxScore = flatQuestions.length * quiz.settings.positiveMarks;
        const accuracy = attemptedCount > 0 ? (correct / attemptedCount) * 100 : 0;

        const subjectPerformance = Object.entries(subjectStats).map(([id, stats]) => {
            const total = stats.correct + stats.incorrect;
            return {
                id,
                name: stats.name,
                accuracy: total > 0 ? (stats.correct / total) * 100 : 0,
                correct: stats.correct,
                incorrect: stats.incorrect,
            };
        });

        return {
            score,
            maxScore,
            accuracy,
            timeTaken: {
                minutes: Math.floor(attempt.timeTaken / 60),
                seconds: Math.floor(attempt.timeTaken % 60),
            },
            stats: {
                correct,
                incorrect,
                skipped: flatQuestions.length - attemptedCount
            },
            subjectPerformance
        };
    }, [attempt, quiz, flatQuestions]);
    
    if (loading) {
        return (
            <div className="flex h-screen w-full flex-col items-center justify-center bg-background text-center p-4">
                <Loader2 className="h-12 w-12 text-primary animate-spin mb-4"/>
                <h1 className="text-2xl font-bold text-foreground">Analyzing Results...</h1>
                <p className="text-muted-foreground">Please wait while we generate your performance report.</p>
            </div>
        );
    }
    
    if (error || !analysis) {
        return (
             <div className="flex h-screen items-center justify-center text-center p-4">
                <div>
                    <AlertTriangle className="h-12 w-12 text-destructive mx-auto" />
                    <h1 className="mt-4 text-2xl font-bold">Could Not Load Results</h1>
                    <p className="text-muted-foreground mt-2">{error || "The analysis could not be generated."}</p>
                     <Button asChild className="mt-6">
                        <Link href="/dashboard">Go to Dashboard</Link>
                    </Button>
                </div>
            </div>
        )
    }

    return (
        <motion.div 
            className="min-h-screen bg-slate-50 dark:bg-background p-4 md:p-8 space-y-6"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
        >
            <VitalSigns analysis={analysis} />
            <SubjectPerformanceChart data={analysis.subjectPerformance} />
            {attempt && <QuestionReview flatQuestions={flatQuestions} attempt={attempt} />}

            <Card className="shadow-lg sticky bottom-4 z-20 bg-background/80 backdrop-blur-sm">
                <CardContent className="p-4 flex flex-col md:flex-row items-center justify-center gap-4">
                    <Button variant="outline" className="w-full md:w-auto" asChild>
                       <Link href={`/quiz/${quizId}`}>
                         <Repeat className="mr-2 h-4 w-4" /> Retake Exam
                       </Link>
                    </Button>
                     <Button className="w-full md:w-auto" asChild>
                       <Link href="/dashboard">
                        <LayoutDashboard className="mr-2 h-4 w-4" /> Back to Dashboard
                       </Link>
                    </Button>
                </CardContent>
            </Card>
        </motion.div>
    );
}
