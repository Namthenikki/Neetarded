
"use client";

import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import { db } from "@/lib/firebase/config";
import { collection, query, where, getDocs } from "firebase/firestore";
import { type QuizAttempt } from "@/types/quiz";
import { QUIZ_SUBJECTS } from "@/lib/quiz-data";
import { Loader2, Sparkles, TrendingUp, BookOpen, Target, AlertTriangle, TrendingDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Helper to create a lookup map for subject IDs
const subjectNameMap = new Map(QUIZ_SUBJECTS.map(s => [s.name, s.id]));

interface AggregatedChapter {
    name: string;
    attemptQuizIds: Set<string>;
    totalAttemptedQuestions: number;
    totalCorrectQuestions: number;
    strength: number;
    lastAttemptedAt: Date;
    sectionName: string; // for flattened list
    code: string; // for flattened list
}

interface AggregatedSection {
    name: string;
    chapters: {
        [chapterCode: string]: AggregatedChapter;
    };
}

type AuraData = {
    [sectionId: string]: AggregatedSection;
};

const AuraChapterCard = ({ chapter, code }: { chapter: AggregatedChapter, code: string }) => {
    const strength = chapter.strength;
    const strengthColor = strength > 75 ? "bg-green-500" : strength > 40 ? "bg-yellow-500" : "bg-red-500";
    const strengthTextColor = strength > 75 ? "text-green-500" : strength > 40 ? "text-yellow-600" : "text-red-500";

    return (
        <Card className="bg-background">
            <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">{chapter.name}</CardTitle>
                <CardDescription className="font-mono text-xs">{code}</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="space-y-3">
                    <div className="flex justify-between items-center text-sm">
                        <span className="text-muted-foreground flex items-center gap-1.5"><BookOpen size={14}/> Total Questions Solved</span>
                        <span className="font-bold">{chapter.totalAttemptedQuestions}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                        <span className="text-muted-foreground flex items-center gap-1.5"><Target size={14}/> Times Attempted</span>
                        <span className="font-bold">{chapter.attemptQuizIds.size}</span>
                    </div>
                    <div>
                         <div className="flex justify-between items-center mb-1">
                            <span className="text-sm text-muted-foreground flex items-center gap-1.5"><TrendingUp size={14}/> Chapter Strength</span>
                            <span className={cn("text-sm font-bold", strengthTextColor)}>{strength.toFixed(1)}%</span>
                        </div>
                        <Progress value={strength} className="h-2" indicatorClassName={strengthColor}/>
                    </div>
                </div>
            </CardContent>
        </Card>
    )
};

const AuraWarningList = ({ title, description, chapters, icon, cardClassName, badgeClassName }: { title: string, description: string, chapters: AggregatedChapter[], icon: React.ReactNode, cardClassName: string, badgeClassName: string }) => {
    if (chapters.length === 0) return null;

    return (
        <Card className={cn("shadow-lg", cardClassName)}>
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl font-bold">{icon} {title}</CardTitle>
                <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
                {chapters.map(chapter => (
                    <div key={chapter.code} className="flex justify-between items-center p-3 rounded-lg bg-background/50 shadow-sm">
                        <div>
                            <p className="font-semibold">{chapter.name}</p>
                            <p className="text-sm text-muted-foreground">{chapter.sectionName}</p>
                        </div>
                        <Badge variant="outline" className={cn("text-base font-bold", badgeClassName)}>{chapter.strength.toFixed(0)}%</Badge>
                    </div>
                ))}
            </CardContent>
        </Card>
    );
};


export default function AuraPage() {
    const { user, loading: authLoading } = useAuth();
    const [auraData, setAuraData] = useState<AuraData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user) return;

        const processAttempts = (attempts: QuizAttempt[]): AuraData => {
            const aggregation: AuraData = {};

            for (const attempt of attempts) {
                if (!attempt.deepAnalysis?.chapters) continue;

                for (const [chapterCode, chapterData] of Object.entries(attempt.deepAnalysis.chapters as any)) {
                    
                    const sectionName = chapterData.subject;
                    const sectionId = subjectNameMap.get(sectionName) as keyof AuraData;
                    if (!sectionId) continue;

                    // Initialize section if not present
                    if (!aggregation[sectionId]) {
                        aggregation[sectionId] = { name: sectionName, chapters: {} };
                    }

                    // Initialize chapter if not present
                    if (!aggregation[sectionId].chapters[chapterCode]) {
                        aggregation[sectionId].chapters[chapterCode] = {
                            name: chapterData.name,
                            attemptQuizIds: new Set<string>(),
                            totalAttemptedQuestions: 0,
                            totalCorrectQuestions: 0,
                            lastAttemptedAt: new Date(0),
                            strength: 0,
                        } as AggregatedChapter;
                    }

                    const chapterAgg = aggregation[sectionId].chapters[chapterCode];
                    chapterAgg.attemptQuizIds.add(attempt.quizId);
                    const attemptedInThisQuiz = chapterData.correct + chapterData.incorrect;
                    chapterAgg.totalAttemptedQuestions += attemptedInThisQuiz;
                    chapterAgg.totalCorrectQuestions += chapterData.correct;
                    
                    if (attempt.completedAt > chapterAgg.lastAttemptedAt) {
                        chapterAgg.lastAttemptedAt = attempt.completedAt;
                    }
                }
            }

            // Final calculation of strength with time decay
            const currentDate = new Date();
            for (const section of Object.values(aggregation)) {
                for (const chapter of Object.values(section.chapters)) {
                    const baseStrength = chapter.totalAttemptedQuestions > 0
                        ? (chapter.totalCorrectQuestions / chapter.totalAttemptedQuestions) * 100
                        : 0;

                    const daysSinceLastAttempt = (currentDate.getTime() - chapter.lastAttemptedAt.getTime()) / (1000 * 3600 * 24);

                    // Apply decay only after a 7-day grace period
                    if (daysSinceLastAttempt > 7) {
                        const decayableDays = daysSinceLastAttempt - 7;
                        // Strength has a half-life of 60 days after the grace period
                        const halfLife = 60; 
                        const decayFactor = Math.pow(0.5, decayableDays / halfLife);
                        chapter.strength = baseStrength * decayFactor;
                    } else {
                        chapter.strength = baseStrength;
                    }
                }
            }

            return aggregation;
        };

        const fetchAuraData = async () => {
            setLoading(true);
            try {
                const q = query(collection(db, "attempts"), where("studentId", "==", user.studentId));
                const querySnapshot = await getDocs(q);
                const attempts = querySnapshot.docs.map(doc => {
                    const data = doc.data();
                    return {
                        ...data,
                        completedAt: data.completedAt?.toDate ? data.completedAt.toDate() : new Date(),
                    } as QuizAttempt
                });
                
                const processedData = processAttempts(attempts);
                setAuraData(processedData);

            } catch (error) {
                console.error("Failed to fetch Aura data:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchAuraData();
    }, [user]);

    const { sortedAuraData, auraDebtChapters, auraNegativeChapters } = useMemo(() => {
        if (!auraData) return { sortedAuraData: [], auraDebtChapters: [], auraNegativeChapters: [] };

        const allChapters: AggregatedChapter[] = Object.entries(auraData).flatMap(([sectionId, sectionData]) =>
            Object.entries(sectionData.chapters).map(([chapterCode, chapterData]) => ({
                ...(chapterData as AggregatedChapter),
                sectionName: sectionData.name,
                code: chapterCode,
            }))
        );

        const debt = allChapters.filter(c => c.strength < 30).sort((a, b) => a.strength - b.strength);
        const negative = allChapters.filter(c => c.strength >= 30 && c.strength < 60).sort((a, b) => a.strength - b.strength);
        
        const dataWithSubjectStrength = Object.entries(auraData).map(([sectionId, sectionData]) => {
            const chapters = Object.values(sectionData.chapters);
            const totalStrength = chapters.reduce((sum, chapter) => sum + (chapter as AggregatedChapter).strength, 0);
            const subjectStrength = chapters.length > 0 ? totalStrength / chapters.length : 0;
            return {
                id: sectionId,
                ...sectionData,
                subjectStrength
            };
        }).sort((a, b) => a.id.localeCompare(b.id));


        return { sortedAuraData: dataWithSubjectStrength, auraDebtChapters: debt, auraNegativeChapters: negative };

    }, [auraData]);


    if (loading || authLoading) {
        return (
             <div className="flex h-full min-h-[calc(100vh-10rem)] items-center justify-center p-8">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
            </div>
        );
    }
    
    if (!auraData || Object.keys(auraData).length === 0) {
        return (
            <div className="p-4 md:p-8 text-center">
                 <header className="mb-8">
                    <h1 className="text-3xl font-bold tracking-tight text-slate-900 flex items-center justify-center gap-2"><Sparkles/>Aura</h1>
                    <p className="text-slate-600">Your dynamic learning DNA.</p>
                </header>
                <p className="text-muted-foreground mt-16">No attempt data found. Take a quiz to build your Aura!</p>
            </div>
        )
    }

    return (
        <div className="p-4 md:p-8 space-y-8">
            <header>
                <h1 className="text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-2"><Sparkles/>Aura</h1>
                <p className="text-slate-600">Your dynamic learning DNA, showing strengths and weaknesses across all attempts.</p>
            </header>

            <div className="grid md:grid-cols-2 gap-8">
                <AuraWarningList
                    title="Aura Debt"
                    description="Chapters with strength below 30%. Focus here first."
                    chapters={auraDebtChapters}
                    icon={<AlertTriangle className="text-red-500" />}
                    cardClassName="border-red-500/50 bg-red-500/5"
                    badgeClassName="border-red-500/30 bg-red-500/20 text-red-500"
                />
                <AuraWarningList
                    title="Aura Negative"
                    description="Chapters with strength between 30% and 60%. These need practice."
                    chapters={auraNegativeChapters}
                    icon={<TrendingDown className="text-yellow-500" />}
                    cardClassName="border-yellow-500/50 bg-yellow-500/5"
                    badgeClassName="border-yellow-500/30 bg-yellow-500/20 text-yellow-600"
                />
            </div>


             <Accordion type="multiple" className="w-full space-y-4">
                {sortedAuraData.map((sectionData) => {
                    const subjectStrength = sectionData.subjectStrength;
                    const strengthColor = subjectStrength > 75 ? "bg-green-500" : subjectStrength > 40 ? "bg-yellow-500" : "bg-red-500";
                    const strengthTextColor = subjectStrength > 75 ? "text-green-500" : subjectStrength > 40 ? "text-yellow-600" : "text-red-500";

                    return (
                    <AccordionItem key={sectionData.id} value={sectionData.id} className="bg-card rounded-xl border">
                        <AccordionTrigger className="p-4 text-xl font-bold hover:no-underline text-slate-800 w-full">
                           <div className="flex items-center justify-between w-full">
                                <div className="flex items-center gap-3">
                                    {sectionData.name} 
                                    <Badge variant="secondary">{Object.keys(sectionData.chapters).length} Chapters</Badge>
                                </div>
                                <div className="flex items-center gap-3 text-sm mr-4">
                                    <span className="font-medium text-muted-foreground flex items-center gap-1.5"><TrendingUp size={16}/> Subject Strength</span>
                                    <Progress value={subjectStrength} className="w-32 h-2" indicatorClassName={strengthColor} />
                                    <span className={cn("font-bold text-base", strengthTextColor)}>{subjectStrength.toFixed(0)}%</span>
                                </div>
                           </div>
                        </AccordionTrigger>
                        <AccordionContent className="p-4 pt-0">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {Object.entries(sectionData.chapters)
                                    .sort(([, chapA], [, chapB]) => (chapA as AggregatedChapter).name.localeCompare((chapB as AggregatedChapter).name))
                                    .map(([chapterCode, chapter]) => (
                                    <AuraChapterCard key={chapterCode} chapter={chapter as AggregatedChapter} code={`${sectionData.id}-${chapterCode}`} />
                                ))}
                            </div>
                        </AccordionContent>
                    </AccordionItem>
                )})}
            </Accordion>
        </div>
    )
}

    