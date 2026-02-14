"use client";

import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import { db } from "@/lib/firebase/config";
import { collection, query, where, getDocs } from "firebase/firestore";
import { type QuizAttempt } from "@/types/quiz";
import { QUIZ_SUBJECTS } from "@/lib/quiz-data";
import { Loader2, Sparkles, TrendingUp, BookOpen, Target } from "lucide-react";
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
    const strengthColor = chapter.strength > 75 ? "bg-green-500" : chapter.strength > 40 ? "bg-yellow-500" : "bg-red-500";

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
                            <span className="text-sm font-bold text-primary">{chapter.strength.toFixed(1)}%</span>
                        </div>
                        <Progress value={chapter.strength} className="h-2" indicatorClassName={strengthColor}/>
                    </div>
                </div>
            </CardContent>
        </Card>
    )
};


export default function AuraPage() {
    const { user, loading: authLoading } = useAuth();
    const [auraData, setAuraData] = useState<AuraData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user) return;

        const processAttempts = (attempts: QuizAttempt[]): AuraData => {
            const aggregation: { [sectionId: string]: { name: string; chapters: { [chapterCode: string]: any } } } = {};

            for (const attempt of attempts) {
                if (!attempt.deepAnalysis?.chapters) continue;

                for (const [chapterCode, chapterData] of Object.entries(attempt.deepAnalysis.chapters as any)) {
                    
                    const sectionName = chapterData.subject;
                    const sectionId = subjectNameMap.get(sectionName);
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
                        };
                    }

                    const chapterAgg = aggregation[sectionId].chapters[chapterCode];
                    chapterAgg.attemptQuizIds.add(attempt.quizId);
                    const attemptedInThisQuiz = chapterData.correct + chapterData.incorrect;
                    chapterAgg.totalAttemptedQuestions += attemptedInThisQuiz;
                    chapterAgg.totalCorrectQuestions += chapterData.correct;
                }
            }

            // Final calculation of strength
            for (const section of Object.values(aggregation)) {
                for (const chapter of Object.values(section.chapters)) {
                    chapter.strength = chapter.totalAttemptedQuestions > 0
                        ? (chapter.totalCorrectQuestions / chapter.totalAttemptedQuestions) * 100
                        : 0;
                }
            }

            return aggregation;
        };

        const fetchAuraData = async () => {
            setLoading(true);
            try {
                const q = query(collection(db, "attempts"), where("studentId", "==", user.studentId));
                const querySnapshot = await getDocs(q);
                const attempts = querySnapshot.docs.map(doc => doc.data() as QuizAttempt);
                
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

    const sortedAuraData = useMemo(() => {
        if (!auraData) return [];
        return Object.entries(auraData).sort(([idA], [idB]) => idA.localeCompare(idB));
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

             <Accordion type="multiple" className="w-full space-y-4" defaultValue={sortedAuraData.map(([id]) => id)}>
                {sortedAuraData.map(([sectionId, sectionData]) => (
                    <AccordionItem key={sectionId} value={sectionId} className="bg-card rounded-xl border">
                        <AccordionTrigger className="p-4 text-xl font-bold hover:no-underline text-slate-800">
                           <div className="flex items-center gap-3">
                                {sectionData.name} 
                                <Badge variant="secondary">{Object.keys(sectionData.chapters).length} Chapters</Badge>
                           </div>
                        </AccordionTrigger>
                        <AccordionContent className="p-4 pt-0">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {Object.entries(sectionData.chapters)
                                    .sort(([, chapA], [, chapB]) => chapA.name.localeCompare(chapB.name))
                                    .map(([chapterCode, chapter]) => (
                                    <AuraChapterCard key={chapterCode} chapter={chapter} code={`${sectionId}-${chapterCode}`} />
                                ))}
                            </div>
                        </AccordionContent>
                    </AccordionItem>
                ))}
            </Accordion>
        </div>
    )
}
