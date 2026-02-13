
"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { db } from "@/lib/firebase/config";
import { collection, query, where, getDocs, orderBy } from "firebase/firestore";
import { Loader2, Star, Flag } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { type LibraryQuestion } from "@/types/quiz";
import { Badge } from "@/components/ui/badge";

const LibraryList = ({ items }: { items: LibraryQuestion[] }) => {
    if (items.length === 0) {
        return <p className="text-muted-foreground text-center py-8">Nothing here yet. Start saving questions!</p>;
    }

    const groupedByQuiz = items.reduce((acc, item) => {
        (acc[item.quizTitle] = acc[item.quizTitle] || []).push(item);
        return acc;
    }, {} as { [quizTitle: string]: LibraryQuestion[] });


    return (
        <Accordion type="multiple" className="w-full space-y-2">
            {Object.entries(groupedByQuiz).map(([quizTitle, questions]) => (
                <AccordionItem key={quizTitle} value={quizTitle} className="bg-background rounded-xl border">
                    <AccordionTrigger className="p-4 text-lg font-semibold hover:no-underline">
                        <div className="flex items-center gap-2">
                           {quizTitle} <Badge variant="secondary" className="ml-2">{questions.length} Questions</Badge>
                        </div>
                    </AccordionTrigger>
                    <AccordionContent className="p-4 pt-0">
                        <div className="space-y-4">
                            {questions.sort((a,b) => a.questionData.questionNumber - b.questionData.questionNumber).map((item) => (
                                <Card key={item.id} className="bg-secondary/50">
                                    <CardHeader className="pb-3">
                                        <div className="flex justify-between">
                                            <Badge variant="outline">{item.sectionName} - {item.chapterName}</Badge>
                                            <p className="text-sm font-semibold">Q{item.questionData.questionNumber}</p>
                                        </div>
                                    </CardHeader>
                                    <CardContent>
                                        <p className="mb-4 font-serif">{item.questionData.text}</p>
                                        <div className="space-y-2">
                                            {item.questionData.options.map(opt => (
                                                <div key={opt.id} className={`w-full text-left p-2 text-sm rounded-md ${opt.id === item.questionData.correctOptionId ? 'bg-green-500/10 border-green-500 border-l-4' : 'bg-background'}`}>
                                                    <span className="font-semibold mr-2">{opt.id}.</span> {opt.text}
                                                </div>
                                            ))}
                                        </div>
                                        {item.questionData.explanation && (
                                            <p className="text-sm mt-3 p-2 bg-primary/10 rounded-md"><b>Explanation:</b> {item.questionData.explanation}</p>
                                        )}
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    </AccordionContent>
                </AccordionItem>
            ))}
        </Accordion>
    );
};


export default function MyLibraryPage() {
    const { user } = useAuth();
    const [starred, setStarred] = useState<LibraryQuestion[]>([]);
    const [flagged, setFlagged] = useState<LibraryQuestion[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user) return;

        const fetchData = async (collectionName: string, setter: React.Dispatch<React.SetStateAction<LibraryQuestion[]>>) => {
            try {
                const q = query(
                    collection(db, collectionName),
                    where("studentId", "==", user.studentId),
                    orderBy("addedAt", "desc")
                );
                const snapshot = await getDocs(q);
                const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as LibraryQuestion));
                setter(items);
            } catch (e) {
                console.warn(`Failed to fetch ${collectionName} with ordering. Retrying without.`, e);
                try {
                    const q = query(
                        collection(db, collectionName),
                        where("studentId", "==", user.studentId)
                    );
                    const snapshot = await getDocs(q);
                    const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as LibraryQuestion));
                    // Manual sort
                    setter(items.sort((a,b) => b.addedAt.toMillis() - a.addedAt.toMillis()));
                } catch (fallbackError) {
                    console.error(`Failed to fetch ${collectionName} on fallback.`, fallbackError);
                }
            }
        };

        const fetchAll = async () => {
            setLoading(true);
            await Promise.all([
                fetchData('starred_questions', setStarred),
                fetchData('flagged_questions', setFlagged)
            ]);
            setLoading(false);
        };
        
        fetchAll();
    }, [user]);

    return (
        <div className="p-4 md:p-8 space-y-8">
            <header>
                <h1 className="text-3xl font-bold tracking-tight text-slate-900">My Library</h1>
                <p className="text-slate-600">Your personal collection of important and bookmarked questions.</p>
            </header>

            {loading ? (
                <div className="flex items-center justify-center h-64">
                    <Loader2 className="h-12 w-12 animate-spin text-primary" />
                </div>
            ) : (
                <Tabs defaultValue="starred" className="w-full">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="starred"><Star className="mr-2"/> Starred Questions</TabsTrigger>
                        <TabsTrigger value="flagged"><Flag className="mr-2"/> Flagged for Review</TabsTrigger>
                    </TabsList>
                    <TabsContent value="starred" className="mt-4">
                        <Card>
                            <CardHeader>
                                <CardTitle>Starred Questions</CardTitle>
                                <CardDescription>Your hand-picked collection of important questions.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <LibraryList items={starred} />
                            </CardContent>
                        </Card>
                    </TabsContent>
                    <TabsContent value="flagged" className="mt-4">
                        <Card>
                            <CardHeader>
                                <CardTitle>Flagged for Review</CardTitle>
                                <CardDescription>Questions you marked because you have doubts.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <LibraryList items={flagged} />
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>
            )}
        </div>
    );
}
