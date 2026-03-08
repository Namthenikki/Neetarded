"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { Loader2, ArrowLeft, Trophy, AlertTriangle, Lightbulb, Clock, CheckCircle2, ChevronRight, RefreshCcw, Target, BarChart3, BookOpen, XCircle, SkipForward, TrendingUp, Shield, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { AuraFarmAIAnalysis } from "@/types/aura";
import { renderMathText } from "@/lib/render-math";
import { cn } from "@/lib/utils";
import Image from "next/image";

type FilterTab = 'all' | 'correct' | 'incorrect' | 'skipped';

interface EnrichedAttempt {
    questionId: string;
    questionText?: string;
    options?: { id: string; text: string; imageUrl?: string }[];
    selectedOptionId?: string;
    correctOptionId?: string;
    explanation?: string;
    explanationImageUrl?: string;
    questionImageUrl?: string;
    topicTag: string;
    difficulty: string;
    timeSpentSeconds: number;
    isCorrect: boolean;
    isAttempted: boolean;
}

export default function AuraFarmResultsPage() {
    const { user, loading } = useAuth();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { toast } = useToast();

    const sessionId = searchParams.get('sessionId');

    const [analysis, setAnalysis] = useState<AuraFarmAIAnalysis | null>(null);
    const [sessionAttempts, setSessionAttempts] = useState<EnrichedAttempt[]>([]);
    const [analyzing, setAnalyzing] = useState(true);
    const [errorData, setErrorData] = useState<any>(null);
    const [activeTab, setActiveTab] = useState<FilterTab>('all');
    const [expandedQuestions, setExpandedQuestions] = useState<Set<number>>(new Set());

    useEffect(() => {
        if (!user || loading) return;
        if (!sessionId) {
            router.push('/dashboard/aura-farm');
            return;
        }

        fetchAnalysis();
    }, [user, loading, sessionId, router]);

    const fetchAnalysis = async () => {
        setAnalyzing(true);
        setErrorData(null);
        try {
            const res = await fetch('/api/aura-farm/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId })
            });

            const data = await res.json();

            if (!res.ok) {
                if (data.fallbackStats) {
                    setErrorData(data.fallbackStats);
                } else {
                    throw new Error(data.error || "Analysis failed");
                }
            } else {
                setAnalysis(data.analysis);
                setSessionAttempts(data.sessionAttempts || []);
            }
        } catch (err: any) {
            toast({ variant: "destructive", title: "Mentor Analysis Failed", description: err.message });
            setErrorData({ message: err.message });
        } finally {
            setAnalyzing(false);
        }
    };

    const toggleQuestion = (index: number) => {
        setExpandedQuestions(prev => {
            const next = new Set(prev);
            if (next.has(index)) next.delete(index);
            else next.add(index);
            return next;
        });
    };

    if (loading || (analyzing && !analysis && !errorData)) {
        return (
            <div className="flex flex-col h-[70vh] items-center justify-center gap-6">
                <div className="relative">
                    <div className="absolute inset-0 border-4 border-slate-200 rounded-full animate-ping opacity-20 w-16 h-16"></div>
                    <Loader2 className="w-16 h-16 text-primary animate-spin relative z-10" />
                </div>
                <div className="text-center space-y-2">
                    <h2 className="text-2xl font-bold text-slate-800">Your NEET Mentor is reviewing your session...</h2>
                    <p className="text-muted-foreground max-w-sm mx-auto">
                        Analyzing your 66-second benchmarks, checking for concept gaps, and building your personalized feedback.
                    </p>
                </div>
            </div>
        );
    }

    if (!analysis && errorData) {
        return (
            <div className="p-4 md:p-8 max-w-3xl mx-auto space-y-6 min-h-screen">
                <Button variant="ghost" onClick={() => router.push('/dashboard/aura-farm')} className="mb-4">
                    <ArrowLeft className="mr-2 w-4 h-4" /> Back to Aura Farm
                </Button>
                <Card className="border-red-200 bg-red-50/30">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-red-600">
                            <AlertTriangle className="w-5 h-5" /> AI Mentor Unavailable
                        </CardTitle>
                        <CardDescription>{errorData.message}</CardDescription>
                    </CardHeader>
                    <CardFooter>
                        <Button onClick={fetchAnalysis} disabled={analyzing} className="bg-red-600 hover:bg-red-700">
                            {analyzing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCcw className="w-4 h-4 mr-2" />}
                            Retry AI Analysis
                        </Button>
                    </CardFooter>
                </Card>
            </div>
        );
    }

    if (!analysis) return null;

    const { timePerformanceBreakdown: t, sessionSummary: s, topicAnalysis, redFlags, practiceRecommendations, mentorVerdict } = analysis;

    const getFlagIcon = (type: string) => {
        switch (type) {
            case 'danger_zone': return <AlertTriangle className="text-red-500 w-5 h-5" />;
            case 'concept_gap': return <BookOpenIcon className="text-orange-500 w-5 h-5" />;
            case 'careless_rushing': return <ZapIcon className="text-yellow-500 w-5 h-5" />;
            case 'slow_but_correct': return <Clock className="text-blue-500 w-5 h-5" />;
            case 'ideal_zone': return <Trophy className="text-emerald-500 w-5 h-5" />;
            default: return <Lightbulb className="text-primary w-5 h-5" />;
        }
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'strong':
                return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800"><Shield className="w-3 h-3" /> Strong</span>;
            case 'weak':
                return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-red-100 text-red-800"><AlertTriangle className="w-3 h-3" /> Weak</span>;
            case 'needs_practice':
                return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800"><TrendingUp className="w-3 h-3" /> Needs Practice</span>;
            case 'not_attempted':
                return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-600"><SkipForward className="w-3 h-3" /> Not Attempted</span>;
            default:
                return null;
        }
    };

    // Filter attempts based on active tab
    const filteredAttempts = sessionAttempts.map((att, idx) => ({ att, originalIndex: idx })).filter(({ att }) => {
        if (activeTab === 'all') return true;
        if (activeTab === 'correct') return att.isAttempted && att.isCorrect;
        if (activeTab === 'incorrect') return att.isAttempted && !att.isCorrect;
        if (activeTab === 'skipped') return !att.isAttempted;
        return true;
    });

    const tabCounts = {
        all: sessionAttempts.length,
        correct: sessionAttempts.filter(a => a.isAttempted && a.isCorrect).length,
        incorrect: sessionAttempts.filter(a => a.isAttempted && !a.isCorrect).length,
        skipped: sessionAttempts.filter(a => !a.isAttempted).length,
    };

    return (
        <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-8 bg-slate-50 min-h-screen">
            <header className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-black tracking-tight text-slate-900">NEET Mentor Analysis</h1>
                    <p className="text-slate-500 mt-1 font-medium">Session ID: {sessionId!.slice(0, 8)}</p>
                </div>
                <Button variant="outline" onClick={() => router.push('/dashboard/aura-farm')}>
                    Finish Review <ArrowLeft className="ml-2 w-4 h-4 rotate-180" />
                </Button>
            </header>

            {/* ===== SESSION SUMMARY CARDS ===== */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <Card className="shadow-sm border-0 bg-white">
                    <CardContent className="p-4 text-center">
                        <BookOpen className="w-5 h-5 text-slate-500 mx-auto mb-1.5" />
                        <p className="text-2xl font-black text-slate-800">{s?.totalQuestions || sessionAttempts.length}</p>
                        <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold mt-0.5">Total</p>
                    </CardContent>
                </Card>
                <Card className="shadow-sm border-0 bg-white">
                    <CardContent className="p-4 text-center">
                        <Target className="w-5 h-5 text-blue-500 mx-auto mb-1.5" />
                        <p className="text-2xl font-black text-blue-700">{s?.totalAttempted || 0}</p>
                        <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold mt-0.5">Attempted</p>
                    </CardContent>
                </Card>
                <Card className="shadow-sm border-0 bg-white">
                    <CardContent className="p-4 text-center">
                        <CheckCircle2 className="w-5 h-5 text-emerald-500 mx-auto mb-1.5" />
                        <p className="text-2xl font-black text-emerald-700">{s?.totalCorrect || 0}</p>
                        <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold mt-0.5">Correct</p>
                    </CardContent>
                </Card>
                <Card className="shadow-sm border-0 bg-white">
                    <CardContent className="p-4 text-center">
                        <XCircle className="w-5 h-5 text-red-500 mx-auto mb-1.5" />
                        <p className="text-2xl font-black text-red-700">{s?.totalIncorrect || 0}</p>
                        <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold mt-0.5">Incorrect</p>
                    </CardContent>
                </Card>
                <Card className="shadow-sm border-0 bg-white col-span-2 md:col-span-1">
                    <CardContent className="p-4 text-center">
                        <SkipForward className="w-5 h-5 text-slate-400 mx-auto mb-1.5" />
                        <p className="text-2xl font-black text-slate-600">{s?.totalSkipped || 0}</p>
                        <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold mt-0.5">Skipped</p>
                    </CardContent>
                </Card>
            </div>

            {/* Time Performance Map */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="shadow-sm border-0 border-l-4 border-l-primary">
                    <CardHeader className="pb-2">
                        <CardDescription className="uppercase tracking-wider font-bold text-xs">Avg. Time / Q</CardDescription>
                        <CardTitle className={`text-4xl font-black ${t.averageTimePerQuestion > 66 ? 'text-red-600' : 'text-emerald-600'}`}>
                            {t.averageTimePerQuestion}s
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="text-xs font-medium text-slate-500">
                        NEET Benchmark: 66s
                    </CardContent>
                </Card>

                <Card className="shadow-sm border-0 border-l-4 border-l-slate-800">
                    <CardHeader className="pb-2">
                        <CardDescription className="uppercase tracking-wider font-bold text-xs">Slowest Question</CardDescription>
                        <CardTitle className="text-3xl font-black text-slate-800">
                            {t.slowestQuestion.timeTaken}s
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="text-xs font-medium text-slate-500 truncate" title={t.slowestQuestion.topic}>
                        Topic: {t.slowestQuestion.topic} <br />
                        Result: {t.slowestQuestion.isCorrect ? <span className="text-emerald-600 font-bold">Correct</span> : <span className="text-red-500 font-bold">Incorrect</span>}
                    </CardContent>
                </Card>

                <Card className="shadow-sm border-0 border-l-4 border-l-emerald-500">
                    <CardHeader className="pb-2">
                        <CardDescription className="uppercase tracking-wider font-bold text-xs">Fastest Question</CardDescription>
                        <CardTitle className="text-3xl font-black text-slate-800">
                            {t.fastestQuestion.timeTaken}s
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="text-xs font-medium text-slate-500 truncate" title={t.fastestQuestion.topic}>
                        Topic: {t.fastestQuestion.topic} <br />
                        Result: {t.fastestQuestion.isCorrect ? <span className="text-emerald-600 font-bold">Correct</span> : <span className="text-red-500 font-bold">Incorrect</span>}
                    </CardContent>
                </Card>
            </div>

            {/* ===== TOPIC ANALYSIS ===== */}
            {topicAnalysis && topicAnalysis.length > 0 && (
                <Card className="shadow-sm border-slate-200">
                    <CardHeader className="bg-slate-100 rounded-t-xl border-b border-slate-200">
                        <CardTitle className="flex items-center gap-2">
                            <BarChart3 className="w-5 h-5 text-primary" />
                            Topic Strength & Weakness Analysis
                        </CardTitle>
                        <CardDescription>Per-topic performance breakdown with AI classification.</CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b">
                                    <tr>
                                        <th className="px-4 py-3 font-medium">Topic</th>
                                        <th className="px-4 py-3 font-medium text-center">Status</th>
                                        <th className="px-4 py-3 font-medium text-center">Attempted</th>
                                        <th className="px-4 py-3 font-medium text-center">✓</th>
                                        <th className="px-4 py-3 font-medium text-center">✗</th>
                                        <th className="px-4 py-3 font-medium text-center">Skipped</th>
                                        <th className="px-4 py-3 font-medium text-right">Avg Time</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {topicAnalysis.map((ta, idx) => (
                                        <tr key={idx} className="hover:bg-slate-50">
                                            <td className="px-4 py-3">
                                                <p className="font-medium text-slate-900">{ta.topic}</p>
                                            </td>
                                            <td className="px-4 py-3 text-center">{getStatusBadge(ta.status)}</td>
                                            <td className="px-4 py-3 text-center font-medium text-slate-700">{ta.attempted}</td>
                                            <td className="px-4 py-3 text-center font-bold text-emerald-600">{ta.correct}</td>
                                            <td className="px-4 py-3 text-center font-bold text-red-600">{ta.incorrect}</td>
                                            <td className="px-4 py-3 text-center font-medium text-slate-500">{ta.skipped}</td>
                                            <td className={`px-4 py-3 text-right font-mono ${ta.avgTime > 90 ? 'text-red-600 font-bold' : ta.avgTime > 66 ? 'text-amber-600 font-medium' : 'text-slate-600'}`}>
                                                {ta.avgTime}s
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* ===== RED FLAGS ===== */}
            <Card className="shadow-sm border-slate-200">
                <CardHeader className="bg-slate-100 rounded-t-xl border-b border-slate-200">
                    <CardTitle className="flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5 text-red-500" />
                        Mentor Observations & Red Flags
                    </CardTitle>
                    <CardDescription>Strict analysis of your speed vs accuracy.</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="divide-y divide-slate-100">
                        {redFlags.length === 0 ? (
                            <div className="p-6 text-center text-slate-500 font-medium">
                                No major red flags detected. You played perfectly inside the ideal NEET zone.
                            </div>
                        ) : (
                            redFlags.map((flag, idx) => (
                                <div key={idx} className="p-4 md:p-6 flex gap-4 hover:bg-slate-50 transition-colors">
                                    <div className="mt-1 flex-shrink-0">{getFlagIcon(flag.type)}</div>
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                            <span className="font-bold text-slate-800 capitalize">{flag.type.replace(/_/g, ' ')}</span>
                                            <span className="text-xs bg-slate-200 px-2 py-0.5 rounded font-medium text-slate-600">{flag.topic}</span>
                                        </div>
                                        <p className="text-slate-700 font-medium leading-relaxed">{flag.message}</p>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* ===== PRACTICE RECOMMENDATIONS ===== */}
            {practiceRecommendations && practiceRecommendations.length > 0 && (
                <Card className="shadow-sm border-emerald-200 bg-emerald-50/30">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-emerald-800">
                            <TrendingUp className="w-5 h-5" />
                            Practice Recommendations
                        </CardTitle>
                        <CardDescription>AI-generated action items for your next session.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <ul className="space-y-3">
                            {practiceRecommendations.map((rec, idx) => (
                                <li key={idx} className="flex items-start gap-3">
                                    <span className="w-6 h-6 rounded-full bg-emerald-200 text-emerald-800 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">{idx + 1}</span>
                                    <p className="text-slate-700 font-medium leading-relaxed">{rec}</p>
                                </li>
                            ))}
                        </ul>
                    </CardContent>
                </Card>
            )}

            {/* ===== MENTOR VERDICT ===== */}
            <Card className="shadow-lg border-2 border-primary/20 bg-primary/5">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-primary">
                        <CheckCircle2 className="w-6 h-6" /> Mentor Verdict
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-lg font-medium leading-relaxed text-slate-800">
                        {mentorVerdict}
                    </p>
                </CardContent>
            </Card>

            {/* ===== FULL QUESTION REVIEW SECTION ===== */}
            <Card className="shadow-sm border-slate-200">
                <CardHeader className="bg-slate-100 rounded-t-xl border-b border-slate-200">
                    <CardTitle className="text-lg">A detailed review of every question.</CardTitle>
                </CardHeader>

                {/* Filter Tabs */}
                <div className="flex border-b border-slate-200 bg-white px-2 md:px-4">
                    {([
                        { key: 'all', label: 'All', color: 'text-slate-700', activeBg: 'bg-slate-100' },
                        { key: 'correct', label: 'Correct', color: 'text-emerald-700', activeBg: 'bg-emerald-50' },
                        { key: 'incorrect', label: 'Mistakes', color: 'text-red-700', activeBg: 'bg-red-50' },
                        { key: 'skipped', label: 'Skipped', color: 'text-slate-500', activeBg: 'bg-slate-50' },
                    ] as { key: FilterTab; label: string; color: string; activeBg: string }[]).map(tab => (
                        <button
                            key={tab.key}
                            onClick={() => setActiveTab(tab.key)}
                            className={`px-3 md:px-4 py-3 text-sm font-semibold transition-all border-b-2 ${activeTab === tab.key
                                    ? `${tab.color} border-current ${tab.activeBg}`
                                    : 'text-slate-400 border-transparent hover:text-slate-600'
                                }`}
                        >
                            {tab.label} <span className="ml-1 text-xs opacity-70">({tabCounts[tab.key]})</span>
                        </button>
                    ))}
                </div>

                <CardContent className="p-0">
                    {filteredAttempts.length === 0 ? (
                        <div className="p-8 text-center text-slate-400 font-medium">
                            No questions in this category.
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-100">
                            {filteredAttempts.map(({ att, originalIndex }) => {
                                const isExpanded = expandedQuestions.has(originalIndex);
                                const showExplanation = !att.isAttempted || !att.isCorrect; // Show for wrong / skipped
                                const hasExplanation = att.explanation && att.explanation.trim().length > 0;

                                return (
                                    <div key={originalIndex} className="bg-white">
                                        {/* Question Header — always visible, clickable */}
                                        <button
                                            onClick={() => toggleQuestion(originalIndex)}
                                            className="w-full text-left p-4 md:p-5 flex items-start gap-3 hover:bg-slate-50 transition-colors"
                                        >
                                            <div className="flex-shrink-0 mt-0.5">
                                                <span className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center text-sm font-bold">
                                                    {originalIndex + 1}
                                                </span>
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-1 flex-wrap">
                                                    <span className="text-xs font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded">
                                                        {att.topicTag}
                                                    </span>
                                                    <span className="text-xs text-slate-400 capitalize">{att.difficulty}</span>
                                                    <span className={cn("text-xs font-mono",
                                                        att.timeSpentSeconds > 90 ? 'text-red-600 font-bold' : 'text-slate-500'
                                                    )}>
                                                        {att.timeSpentSeconds.toFixed(1)}s
                                                    </span>
                                                </div>
                                                <p className="text-sm font-medium text-slate-800 line-clamp-2 leading-relaxed">
                                                    {att.questionText ? renderMathText(att.questionText) : 'Question text not available'}
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                                {!att.isAttempted ? (
                                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-600">
                                                        <SkipForward className="w-3 h-3" /> Skipped
                                                    </span>
                                                ) : att.isCorrect ? (
                                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
                                                        <CheckCircle2 className="w-3 h-3" /> Correct
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-red-100 text-red-800">
                                                        <XCircle className="w-3 h-3" /> Wrong
                                                    </span>
                                                )}
                                                {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                                            </div>
                                        </button>

                                        {/* Expanded Content — Question, Options, Explanation */}
                                        {isExpanded && (
                                            <div className="px-4 md:px-5 pb-5 pt-0 border-t border-slate-100 bg-slate-50/50">
                                                {/* Full question text */}
                                                <div className="pt-4 pb-3">
                                                    <p className="text-base font-semibold text-slate-900 leading-relaxed whitespace-pre-wrap">
                                                        {att.questionText ? renderMathText(att.questionText) : 'Question text not available'}
                                                    </p>
                                                    {att.questionImageUrl && (
                                                        <div className="mt-3 rounded-lg overflow-hidden border p-2 bg-white">
                                                            <Image src={att.questionImageUrl} alt="Question figure" width={600} height={300} className="w-full h-auto max-h-[250px] object-contain rounded" />
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Options */}
                                                {att.options && att.options.length > 0 && (
                                                    <div className="space-y-2 mb-4">
                                                        {att.options.map((opt) => {
                                                            const isCorrectOption = opt.id === att.correctOptionId;
                                                            const isSelectedOption = opt.id === att.selectedOptionId;
                                                            const isWrongSelection = isSelectedOption && !isCorrectOption;

                                                            return (
                                                                <div
                                                                    key={opt.id}
                                                                    className={cn(
                                                                        "flex items-start gap-3 p-3 rounded-xl border-2 transition-all",
                                                                        isCorrectOption
                                                                            ? "border-emerald-400 bg-emerald-50"
                                                                            : isWrongSelection
                                                                                ? "border-red-400 bg-red-50"
                                                                                : "border-slate-200 bg-white"
                                                                    )}
                                                                >
                                                                    <span className={cn(
                                                                        "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5",
                                                                        isCorrectOption ? "bg-emerald-500 text-white" :
                                                                            isWrongSelection ? "bg-red-500 text-white" :
                                                                                "bg-slate-200 text-slate-600"
                                                                    )}>
                                                                        {isCorrectOption ? '✓' : isWrongSelection ? '✗' : opt.id}
                                                                    </span>
                                                                    <div className="flex-1">
                                                                        {opt.imageUrl ? (
                                                                            <Image src={opt.imageUrl} alt={`Option ${opt.id}`} width={400} height={200} className="max-h-28 w-auto object-contain rounded" />
                                                                        ) : (
                                                                            <span className={cn(
                                                                                "text-sm font-medium",
                                                                                isCorrectOption ? "text-emerald-900" :
                                                                                    isWrongSelection ? "text-red-900" :
                                                                                        "text-slate-700"
                                                                            )}>
                                                                                {renderMathText(opt.text)}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    {isCorrectOption && (
                                                                        <span className="text-xs font-bold text-emerald-700 shrink-0">Correct Answer</span>
                                                                    )}
                                                                    {isWrongSelection && (
                                                                        <span className="text-xs font-bold text-red-700 shrink-0">Your Answer</span>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}

                                                {/* Explanation — shown for wrong and skipped questions */}
                                                {showExplanation && hasExplanation && (
                                                    <div className="rounded-xl border-2 border-violet-200 bg-violet-50/50 p-4">
                                                        <div className="flex items-center gap-2 mb-2">
                                                            <Lightbulb className="w-4 h-4 text-violet-600" />
                                                            <span className="text-sm font-bold text-violet-800">Explanation</span>
                                                        </div>
                                                        <p className="text-sm text-violet-900 leading-relaxed whitespace-pre-wrap">
                                                            {renderMathText(att.explanation!)}
                                                        </p>
                                                        {att.explanationImageUrl && (
                                                            <div className="mt-3 rounded-lg overflow-hidden border border-violet-200 p-2 bg-white">
                                                                <Image src={att.explanationImageUrl} alt="Explanation figure" width={600} height={300} className="w-full h-auto max-h-[200px] object-contain rounded" />
                                                            </div>
                                                        )}
                                                    </div>
                                                )}

                                                {showExplanation && !hasExplanation && (
                                                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
                                                        <p className="text-xs text-slate-400 font-medium">No explanation available for this question.</p>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

// Inline SVG components
function BookOpenIcon(props: any) {
    return <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></svg>;
}

function ZapIcon(props: any) {
    return <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>;
}
