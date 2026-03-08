"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { QUIZ_SUBJECTS } from "@/lib/quiz-data";
import { Loader2, Flame, Shield, ShieldAlert, ArrowRight, Zap, Play, X, BookOpen, Clock, Target, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { type SubjectData } from "@/lib/quiz-data";

interface UserStats {
    currentStreak: number;
    longestStreak: number;
    lastActivityDate: string;
    dailyDots: Record<string, number>;
    streakFreezeAvailable: boolean;
    streakFreezeUsedThisWeek: boolean;
}

/**
 * Returns the calendar intensity tier (0-4) based on total questions attempted that day.
 * 0 = no activity
 * 1 = 1-9 questions (started but below daily goal)
 * 2 = 10-19 questions (daily goal met)
 * 3 = 20-29 questions (strong effort)
 * 4 = 30+ questions (beast mode / glowing green)
 */
function getCalendarTier(count: number): number {
    if (count <= 0) return 0;
    if (count < 10) return 1;
    if (count < 20) return 2;
    if (count < 30) return 3;
    return 4;
}

export default function AuraFarmPage() {
    const { user, loading } = useAuth();
    const router = useRouter();
    const { toast } = useToast();

    const [stats, setStats] = useState<UserStats | null>(null);
    const [statsLoading, setStatsLoading] = useState(true);

    const [selectedSubject, setSelectedSubject] = useState<string>("");
    const [selectedChapter, setSelectedChapter] = useState<string>("");

    const [availableSubjects, setAvailableSubjects] = useState<SubjectData[]>([]);
    const [subjectsLoading, setSubjectsLoading] = useState(true);

    const [showFreezePrompt, setShowFreezePrompt] = useState(false);
    const [applyingFreeze, setApplyingFreeze] = useState(false);

    // Day detail popup state
    const [selectedDay, setSelectedDay] = useState<string | null>(null);
    const [dayStats, setDayStats] = useState<any>(null);
    const [dayStatsLoading, setDayStatsLoading] = useState(false);

    // Fetch dynamic chapters that actually have questions
    useEffect(() => {
        async function fetchAvailableChapters() {
            setSubjectsLoading(true);
            try {
                const res = await fetch('/api/aura-farm/available-chapters');
                if (res.ok) {
                    const data = await res.json();
                    setAvailableSubjects(data.subjects || []);
                }
            } catch (err) {
                console.error("Failed to load available chapters", err);
            } finally {
                setSubjectsLoading(false);
            }
        }
        fetchAvailableChapters();
    }, []);

    useEffect(() => {
        if (!user || loading) return;

        async function fetchStats() {
            setStatsLoading(true);
            try {
                const docRef = doc(db, "aura_farm_user_stats", user!.studentId);
                const docSnap = await getDoc(docRef);

                if (docSnap.exists()) {
                    const rawData = docSnap.data();
                    // Backward compat: convert old boolean dailyDots to numbers
                    const dots = rawData.dailyDots || {};
                    for (const key of Object.keys(dots)) {
                        if (dots[key] === true) {
                            dots[key] = 10;
                        }
                    }
                    const data = { ...rawData, dailyDots: dots } as UserStats;

                    const now = new Date();
                    const nowIstDate = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));

                    let needsUpdate = false;
                    let { streakFreezeAvailable, streakFreezeUsedThisWeek, lastActivityDate, currentStreak } = data;

                    if (data.lastActivityDate && currentStreak > 0) {
                        const lastDate = new Date(data.lastActivityDate);
                        const diffTime = Math.abs(nowIstDate.getTime() - lastDate.getTime());
                        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

                        if (diffDays === 2 && data.streakFreezeAvailable) {
                            setShowFreezePrompt(true);
                        } else if (diffDays > 1) {
                            currentStreak = 0;
                            needsUpdate = true;
                        }
                    }

                    const newStats = { ...data, currentStreak };
                    setStats(newStats);

                    if (needsUpdate) {
                        await setDoc(docRef, { currentStreak: 0 }, { merge: true });
                    }

                } else {
                    const initial: UserStats = {
                        currentStreak: 0,
                        longestStreak: 0,
                        lastActivityDate: "",
                        dailyDots: {},
                        streakFreezeAvailable: true,
                        streakFreezeUsedThisWeek: false
                    };
                    setStats(initial);
                    await setDoc(docRef, initial);
                }
            } catch (error) {
                console.error("Error fetching Aura Farm stats", error);
                toast({ variant: "destructive", title: "Failed to load stats" });
            } finally {
                setStatsLoading(false);
            }
        }

        fetchStats();
    }, [user, loading, toast]);

    const handleApplyFreeze = async () => {
        if (!user || !stats) return;
        setApplyingFreeze(true);
        try {
            const docRef = doc(db, "aura_farm_user_stats", user.studentId);

            const now = new Date();
            const nowIstDate = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
            nowIstDate.setDate(nowIstDate.getDate() - 1);
            const yesterdayStr = `${nowIstDate.getFullYear()}-${String(nowIstDate.getMonth() + 1).padStart(2, '0')}-${String(nowIstDate.getDate()).padStart(2, '0')}`;

            const newDots = { ...stats.dailyDots, [yesterdayStr]: (stats.dailyDots[yesterdayStr] || 10) };

            await setDoc(docRef, {
                lastActivityDate: yesterdayStr,
                streakFreezeAvailable: false,
                streakFreezeUsedThisWeek: true,
                dailyDots: newDots
            }, { merge: true });

            setStats({
                ...stats,
                lastActivityDate: yesterdayStr,
                streakFreezeAvailable: false,
                streakFreezeUsedThisWeek: true,
                dailyDots: newDots
            });
            setShowFreezePrompt(false);
            toast({ title: "Streak Saved!", description: "Your weekly freeze has been applied." });
        } catch (e: any) {
            toast({ variant: "destructive", title: "Failed to apply freeze" });
        } finally {
            setApplyingFreeze(false);
        }
    };

    const handleDeclineFreeze = async () => {
        if (!user || !stats) return;
        setApplyingFreeze(true);
        try {
            const docRef = doc(db, "aura_farm_user_stats", user.studentId);
            await setDoc(docRef, { currentStreak: 0 }, { merge: true });

            setStats({ ...stats, currentStreak: 0 });
            setShowFreezePrompt(false);
            toast({ title: "Streak Reset", description: "You chose not to use your freeze. Your streak has been reset to 0." });
        } catch (e: any) {
            toast({ variant: "destructive", title: "Error" });
        } finally {
            setApplyingFreeze(false);
        }
    };

    const handleStartSession = () => {
        if (!selectedSubject || !selectedChapter) {
            toast({ variant: "destructive", title: "Please select a subject and chapter" });
            return;
        }
        router.push(`/dashboard/aura-farm/session?subjectId=${selectedSubject}&chapterId=${selectedChapter}`);
    };

    // Day detail popup handler
    const handleDayClick = useCallback(async (dayStr: string) => {
        if (!user?.studentId) return;
        setSelectedDay(dayStr);
        setDayStatsLoading(true);
        setDayStats(null);
        try {
            const res = await fetch(`/api/aura-farm/day-stats?studentId=${user.studentId}&date=${dayStr}`);
            if (res.ok) {
                const data = await res.json();
                setDayStats(data.summary);
            }
        } catch (err) {
            console.error('Failed to fetch day stats:', err);
        } finally {
            setDayStatsLoading(false);
        }
    }, [user?.studentId]);

    // GitHub-style calendar setup
    const now = new Date();
    const nowIst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));

    // Generate dates for 3 months (current month + next 2) for an expansive grid
    const calendarData = useMemo(() => {
        const year = nowIst.getFullYear();
        const startMonth = nowIst.getMonth();

        const days: (string | null)[] = [];

        // Pad front for the very first month
        const firstDayOfStartMonth = new Date(year, startMonth, 1).getDay(); // 0 (Sun) - 6 (Sat)
        for (let i = 0; i < firstDayOfStartMonth; i++) {
            days.push(null);
        }

        // Add days for all 3 months
        for (let m = 0; m < 3; m++) {
            const currentMonth = startMonth + m;
            const dateYear = year + Math.floor(currentMonth / 12);
            const dateMonth = currentMonth % 12;
            const daysInMonth = new Date(dateYear, dateMonth + 1, 0).getDate();

            for (let d = 1; d <= daysInMonth; d++) {
                days.push(`${dateYear}-${String(dateMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
            }
        }

        // Pad end to make multiple of 7
        while (days.length % 7 !== 0) {
            days.push(null);
        }

        return days;
    }, [nowIst]);

    const todayStr = `${nowIst.getFullYear()}-${String(nowIst.getMonth() + 1).padStart(2, '0')}-${String(nowIst.getDate()).padStart(2, '0')}`;
    const todayDate = new Date(`${todayStr}T00:00:00`);

    // Get dynamic 3-month header
    const endMonthDate = new Date(nowIst.getFullYear(), nowIst.getMonth() + 2, 1);
    const startStr = nowIst.toLocaleString('en-US', { month: 'short', timeZone: 'Asia/Kolkata' }).toUpperCase();
    const endStr = endMonthDate.toLocaleString('en-US', { month: 'short', timeZone: 'Asia/Kolkata' }).toUpperCase();
    const monthName = `${startStr} - ${endStr}`;

    const subjectData = availableSubjects.find(s => s.id === selectedSubject);

    if (loading || statsLoading || subjectsLoading) {
        return (
            <div className="flex h-64 items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#0a0f0d] text-slate-100 pb-24">
            <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">

                {/* Header */}
                <header className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-emerald-900/60 border border-emerald-700/50 flex items-center justify-center">
                            <Flame className="h-5 w-5 text-emerald-400" />
                        </div>
                        <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-100">Aura Farm</h1>
                    </div>
                    <p className="text-sm text-emerald-400/70 hidden md:block max-w-xs text-right">
                        Practice unlimited questions · 10+ daily for streak
                    </p>
                </header>

                {/* Freeze Prompt */}
                {showFreezePrompt && (
                    <div className="rounded-2xl border border-amber-500/30 bg-amber-950/30 p-5">
                        <div className="flex items-center gap-2 mb-2">
                            <ShieldAlert className="h-5 w-5 text-amber-400" />
                            <h3 className="font-bold text-amber-300">Protect Your Streak!</h3>
                        </div>
                        <p className="text-sm text-amber-200/70 mb-4">
                            You missed a day, but your streak of <strong className="text-amber-300">{stats?.currentStreak}</strong> doesn&apos;t have to end.
                            You have 1 Weekly Streak Freeze available.
                        </p>
                        <div className="flex gap-3">
                            <Button onClick={handleApplyFreeze} disabled={applyingFreeze} className="bg-amber-600 hover:bg-amber-700 text-white border-0 rounded-xl">
                                {applyingFreeze ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Shield className="w-4 h-4 mr-2" />}
                                Use Freeze
                            </Button>
                            <Button variant="outline" onClick={handleDeclineFreeze} disabled={applyingFreeze}
                                className="border-amber-700/50 text-amber-300 hover:bg-amber-900/30 rounded-xl bg-transparent">
                                Let it Break
                            </Button>
                        </div>
                    </div>
                )}

                {/* Aura Calendar — GitHub Style (Dark Glassmorphism) */}
                <div className="rounded-2xl border border-emerald-500/10 bg-[#020504] backdrop-blur-xl p-5 md:p-6 shadow-[0_8px_32px_rgba(0,0,0,0.5),inset_0_0_60px_rgba(16,185,129,0.02),inset_0_1px_0_rgba(16,185,129,0.06)]">
                    <div className="flex items-center justify-between mb-5">
                        <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-white">
                            {monthName} AURA
                        </h2>
                        <div className={`flex items-center gap-1.5 text-xs font-medium ${(stats?.currentStreak || 0) > 0 ? "text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.5)]" : "text-white/60"}`}>
                            <span>Streak: {stats?.currentStreak || 0} Days</span>
                            <Zap className={`h-3.5 w-3.5 ${(stats?.currentStreak || 0) > 0 ? "fill-emerald-400 text-emerald-400" : "fill-white/70 text-white/70"}`} />
                        </div>
                    </div>

                    {/* GitHub-style contribution grid */}
                    <div className="flex flex-col gap-1 w-full items-center justify-center pt-2 pb-4">
                        <div className="grid grid-flow-col grid-rows-7 gap-1 md:gap-1.5 overflow-x-auto scrollbar-hide">
                            {calendarData.map((dayStr, idx) => {
                                if (!dayStr) {
                                    return <div key={`empty-${idx}`} className="w-3.5 h-3.5 md:w-[15px] md:h-[15px] rounded-[3px] bg-transparent" />;
                                }

                                const dayCount = stats?.dailyDots?.[dayStr] || 0;
                                const tier = getCalendarTier(dayCount);
                                const isToday = dayStr === todayStr;
                                const d = new Date(`${dayStr}T00:00:00`);
                                const isFuture = d > todayDate;

                                // 5-tier green intensity matching the legend
                                const tierStyles: Record<number, string> = {
                                    0: isFuture ? 'bg-white/[0.03] border border-white/[0.04]' : 'bg-white/[0.02]',
                                    1: 'bg-emerald-900/25 border border-emerald-800/30',
                                    2: 'bg-emerald-800/40',
                                    3: 'bg-emerald-600/60',
                                    4: 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.5),0_0_3px_rgba(52,211,153,0.3)] border border-emerald-400/30',
                                };

                                let bgClass = tierStyles[tier] || tierStyles[0];
                                if (isToday) {
                                    // Today ring always shows, but the fill color reflects the tier
                                    const todayFill = tier >= 4 ? 'bg-emerald-400' : tier >= 3 ? 'bg-emerald-600/60' : tier >= 2 ? 'bg-emerald-800/40' : tier >= 1 ? 'bg-emerald-900/25' : 'bg-emerald-950/40';
                                    bgClass = `ring-[2px] ring-emerald-400 ring-offset-2 ring-offset-transparent ${todayFill} shadow-[0_0_12px_rgba(52,211,153,0.7),0_0_4px_rgba(52,211,153,0.4)] z-10`;
                                }

                                const titleText = dayCount > 0 ? `${dayStr} — ${dayCount} Qs ✓` : dayStr;

                                return (
                                    <div
                                        key={dayStr}
                                        title={titleText}
                                        onClick={() => dayCount > 0 ? handleDayClick(dayStr) : null}
                                        className={`w-3.5 h-3.5 md:w-[15px] md:h-[15px] rounded-[3px] transition-all duration-200 ${bgClass} ${dayCount > 0 ? 'cursor-pointer hover:scale-150 hover:shadow-[0_0_12px_rgba(16,185,129,0.6)]' : ''}`}
                                    />
                                );
                            })}
                        </div>
                    </div>

                    {/* Legend */}
                    <div className="flex items-center justify-between mt-5 text-xs font-semibold uppercase tracking-wider text-white/50">
                        <span>Less</span>
                        <div className="flex items-center gap-1.5">
                            <div className="w-3.5 h-3.5 rounded-[3px] bg-emerald-900/25 border border-emerald-800/30" />
                            <div className="w-3.5 h-3.5 rounded-[3px] bg-emerald-800/40" />
                            <div className="w-3.5 h-3.5 rounded-[3px] bg-emerald-600/60" />
                            <div className="w-3.5 h-3.5 rounded-[3px] bg-emerald-500" />
                            <div className="w-3.5 h-3.5 rounded-[3px] bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
                        </div>
                        <span>More</span>
                    </div>

                    {/* Stats row */}
                    <div className="flex items-center gap-6 mt-4 pt-4 border-t border-emerald-900/30">
                        <div>
                            <p className="text-xs text-white/50 uppercase tracking-wider font-semibold">Longest</p>
                            <p className="text-lg font-bold text-white">{stats?.longestStreak || 0} days</p>
                        </div>
                        <div className="w-px h-8 bg-emerald-900/40" />
                        <div>
                            <p className="text-xs text-white/50 uppercase tracking-wider font-semibold">Freeze</p>
                            <p className="text-sm font-semibold text-white">
                                {stats?.streakFreezeAvailable
                                    ? <span className="flex items-center gap-1"><Shield className="w-3.5 h-3.5" /> 1 Available</span>
                                    : <span className="text-red-400/80">Used</span>
                                }
                            </p>
                        </div>
                    </div>
                </div>

                {/* Start Practice Section */}
                <div>
                    <h2 className="text-lg font-bold text-slate-200 mb-4">Start Grinding</h2>
                    <div className="rounded-2xl border border-emerald-800/30 bg-[#0e1a14] p-5">
                        <p className="text-sm text-emerald-500/70 mb-4">Select a chapter. Practice unlimited questions — 10+ daily keeps your streak alive.</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                            <div className="space-y-2">
                                <label className="text-xs font-semibold uppercase tracking-wider text-emerald-500">Subject</label>
                                <Select value={selectedSubject} onValueChange={(val) => { setSelectedSubject(val); setSelectedChapter(""); }}>
                                    <SelectTrigger className="bg-[#0a1410] border-emerald-800/40 text-slate-200 focus:ring-emerald-500/30 rounded-xl h-11">
                                        <SelectValue placeholder="Select Subject" />
                                    </SelectTrigger>
                                    <SelectContent className="bg-[#0e1a14] border-emerald-800/40 text-slate-200">
                                        {availableSubjects.map(s => (
                                            <SelectItem key={s.id} value={s.id} className="focus:bg-emerald-900/30 focus:text-emerald-300">{s.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-semibold uppercase tracking-wider text-emerald-500">Chapter</label>
                                <Select value={selectedChapter} onValueChange={setSelectedChapter} disabled={!selectedSubject}>
                                    <SelectTrigger className="bg-[#0a1410] border-emerald-800/40 text-slate-200 focus:ring-emerald-500/30 rounded-xl h-11">
                                        <SelectValue placeholder="Select Chapter" />
                                    </SelectTrigger>
                                    <SelectContent className="bg-[#0e1a14] border-emerald-800/40 text-slate-200 max-h-64">
                                        {subjectData?.chapters.map((c: any) => (
                                            <SelectItem key={c.binaryCode} value={c.binaryCode} className="focus:bg-emerald-900/30 focus:text-emerald-300">
                                                {c.name} ({c.questionCount || '?'} Qs)
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <Button
                            onClick={handleStartSession}
                            disabled={!selectedSubject || !selectedChapter}
                            className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-500 text-white border-0 rounded-xl h-11 px-6 font-semibold shadow-[0_0_20px_rgba(16,185,129,0.2)] hover:shadow-[0_0_30px_rgba(16,185,129,0.35)] transition-all disabled:opacity-30 disabled:shadow-none"
                        >
                            Start Grinding <ArrowRight className="ml-2 w-4 h-4" />
                        </Button>
                    </div>
                </div>

                {/* Available Chapters Quick Access */}
                {selectedSubject && subjectData && (
                    <div>
                        <h2 className="text-lg font-bold text-slate-200 mb-4">
                            {subjectData.name} Chapters
                        </h2>
                        <div className="space-y-3">
                            {subjectData.chapters.map((c: any) => (
                                <button
                                    key={c.binaryCode}
                                    onClick={() => {
                                        setSelectedChapter(c.binaryCode);
                                        handleStartSession();
                                    }}
                                    className="w-full rounded-2xl border border-emerald-800/30 bg-[#0e1a14] hover:bg-emerald-950/60 p-4 flex items-center gap-4 transition-all group text-left"
                                >
                                    <div className="w-10 h-10 rounded-xl bg-emerald-900/40 border border-emerald-700/30 flex items-center justify-center shrink-0 group-hover:bg-emerald-800/40 transition-colors">
                                        <Flame className="w-5 h-5 text-emerald-400" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-semibold text-slate-200 truncate">{c.name}</p>
                                        <p className="text-sm text-emerald-600">{c.questionCount || '?'} Questions</p>
                                    </div>
                                    <div className="w-10 h-10 rounded-full bg-emerald-600 flex items-center justify-center shrink-0 group-hover:bg-emerald-500 group-hover:shadow-[0_0_15px_rgba(16,185,129,0.4)] transition-all">
                                        <Play className="w-4 h-4 text-white fill-white ml-0.5" />
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

            </div>

            {/* Day Detail Popup Overlay */}
            {selectedDay && (
                <div
                    className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
                    onClick={() => setSelectedDay(null)}
                >
                    <div
                        className="w-full max-w-md mx-auto rounded-t-2xl md:rounded-2xl border border-emerald-800/50 bg-[#0e1a14] p-6 shadow-2xl shadow-black/40 animate-in slide-in-from-bottom duration-300"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Popup Header */}
                        <div className="flex items-center justify-between mb-5">
                            <div>
                                <p className="text-xs text-emerald-500 uppercase tracking-widest font-bold">Activity</p>
                                <p className="text-lg font-bold text-slate-100">
                                    {new Date(`${selectedDay}T00:00:00`).toLocaleDateString('en-US', {
                                        weekday: 'long',
                                        month: 'short',
                                        day: 'numeric',
                                    })}
                                </p>
                            </div>
                            <button
                                onClick={() => setSelectedDay(null)}
                                className="w-8 h-8 rounded-full bg-emerald-900/40 flex items-center justify-center hover:bg-emerald-800/50 transition-colors"
                            >
                                <X className="w-4 h-4 text-emerald-400" />
                            </button>
                        </div>

                        {dayStatsLoading ? (
                            <div className="flex items-center justify-center py-10">
                                <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
                            </div>
                        ) : dayStats ? (
                            <div className="space-y-4">
                                {/* Summary Stats Row */}
                                <div className="grid grid-cols-3 gap-3">
                                    <div className="rounded-xl bg-emerald-950/40 border border-emerald-900/30 p-3 text-center">
                                        <Target className="w-4 h-4 text-emerald-400 mx-auto mb-1" />
                                        <p className="text-xl font-bold text-emerald-300">{dayStats.accuracy}%</p>
                                        <p className="text-[10px] text-slate-500 uppercase tracking-wider">Accuracy</p>
                                    </div>
                                    <div className="rounded-xl bg-emerald-950/40 border border-emerald-900/30 p-3 text-center">
                                        <BookOpen className="w-4 h-4 text-emerald-400 mx-auto mb-1" />
                                        <p className="text-xl font-bold text-emerald-300">{dayStats.totalQuestions}</p>
                                        <p className="text-[10px] text-slate-500 uppercase tracking-wider">Questions</p>
                                    </div>
                                    <div className="rounded-xl bg-emerald-950/40 border border-emerald-900/30 p-3 text-center">
                                        <Clock className="w-4 h-4 text-emerald-400 mx-auto mb-1" />
                                        <p className="text-xl font-bold text-emerald-300">{Math.round(dayStats.totalTimeSpent / 60)}m</p>
                                        <p className="text-[10px] text-slate-500 uppercase tracking-wider">Time</p>
                                    </div>
                                </div>

                                {/* Chapter Breakdown */}
                                {dayStats.chapters && dayStats.chapters.length > 0 && (
                                    <div>
                                        <p className="text-xs text-emerald-600 uppercase tracking-wider font-semibold mb-2">Chapters Practiced</p>
                                        <div className="space-y-2">
                                            {dayStats.chapters.map((ch: any, i: number) => {
                                                const chAcc = ch.questionsAttempted > 0 ? Math.round((ch.correct / ch.questionsAttempted) * 100) : 0;
                                                return (
                                                    <div
                                                        key={i}
                                                        className="flex items-center justify-between rounded-lg bg-emerald-950/30 border border-emerald-900/20 px-3 py-2.5"
                                                        style={{ animationDelay: `${i * 80}ms` }}
                                                    >
                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-sm font-medium text-slate-200 truncate">{ch.chapterName}</p>
                                                            <p className="text-[10px] text-emerald-600">{ch.subjectName} · {ch.questionsAttempted} Qs</p>
                                                        </div>
                                                        <div className="flex items-center gap-2 ml-3">
                                                            <div className="w-16 h-1.5 rounded-full bg-emerald-950/60 overflow-hidden">
                                                                <div
                                                                    className="h-full rounded-full bg-emerald-500 transition-all duration-700"
                                                                    style={{ width: `${chAcc}%` }}
                                                                />
                                                            </div>
                                                            <span className="text-xs font-bold text-emerald-400 w-9 text-right">{chAcc}%</span>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <p className="text-sm text-slate-500 text-center py-8">No session data found for this day.</p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

function getMostRecentMonday(date: Date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
