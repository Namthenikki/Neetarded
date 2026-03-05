"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { db } from "@/lib/firebase/config";
import { collection, query, where, getDocs, updateDoc, doc } from "firebase/firestore";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle, CheckCircle, Edit3 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface QuestionOption {
    id: string;
    text: string;
    imageUrl?: string;
}

interface QuestionData {
    questionNumber: number;
    text: string;
    options: QuestionOption[];
    correctOptionId: string;
    explanation?: string;
    imageUrl?: string;
}

interface FlaggedQuestionDoc {
    id: string;
    source_paper: string;
    has_active_flag?: boolean;
    flag_reason?: string;
    flagged_by?: string;
    optimized_json: QuestionData;
}

export default function NotificationsPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const { toast } = useToast();

    const [questions, setQuestions] = useState<FlaggedQuestionDoc[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (authLoading) return;
        if (!user || user.role !== "admin") {
            router.replace("/login");
            return;
        }

        async function fetchFlagged() {
            setLoading(true);
            try {
                const q = query(
                    collection(db, "QuestionBank"),
                    where("has_active_flag", "==", true)
                );
                const snap = await getDocs(q);
                const docs = snap.docs.map((d) => ({
                    id: d.id,
                    ...d.data(),
                })) as FlaggedQuestionDoc[];
                setQuestions(docs);
            } catch (error) {
                console.error("Error fetching flagged questions:", error);
                toast({ variant: "destructive", title: "Failed to load notifications" });
            } finally {
                setLoading(false);
            }
        }

        fetchFlagged();
    }, [user, authLoading, router, toast]);

    const handleRejectFlag = async (docId: string) => {
        try {
            await updateDoc(doc(db, "QuestionBank", docId), {
                has_active_flag: false,
                flag_reason: null,
                flagged_by: null
            });
            setQuestions((prev) => prev.filter((q) => q.id !== docId));
            toast({ title: "✅ Flag rejected and cleared." });
        } catch (error) {
            toast({ variant: "destructive", title: "Failed to clear flag" });
        }
    };

    const handleEditQuestion = (docId: string) => {
        // Simple redirect to Review page for now, can be inline later if needed
        router.push(`/review`);
        toast({ title: "Redirected to complete review. Please search for the question there." });
    };

    if (authLoading || loading) {
        return (
            <div className="flex justify-center items-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="p-4 md:p-8 max-w-5xl mx-auto">
            <header className="mb-8">
                <div className="flex items-center gap-3 mb-1">
                    <AlertTriangle className="h-7 w-7 text-red-500" />
                    <h1 className="text-3xl font-bold tracking-tight">Student Issue Reports</h1>
                </div>
                <p className="text-muted-foreground">
                    Review questions that students have flagged for errors.
                </p>
            </header>

            {questions.length === 0 ? (
                <div className="text-center py-16 bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl">
                    <CheckCircle className="h-12 w-12 text-emerald-400 mx-auto mb-3" />
                    <h3 className="text-lg font-medium text-slate-900">All clear!</h3>
                    <p className="text-slate-500">No active flags from students.</p>
                </div>
            ) : (
                <div className="grid gap-6">
                    {questions.map((q) => (
                        <Card key={q.id} className="border-red-200 shadow-sm overflow-hidden">
                            <div className="bg-red-50 px-6 py-3 border-b border-red-100 flex items-start justify-between">
                                <div>
                                    <div className="flex items-center gap-2 text-red-800 font-semibold">
                                        <AlertTriangle className="h-4 w-4" />
                                        Flagged by: {q.flagged_by || "Student"}
                                    </div>
                                    <p className="text-sm text-red-700 mt-1">
                                        <span className="font-medium">Reason:</span> {q.flag_reason}
                                    </p>
                                </div>
                                <div className="text-xs text-slate-500 font-mono bg-white px-2 py-1 rounded inline-block">
                                    {q.source_paper} | Q{q.optimized_json.questionNumber}
                                </div>
                            </div>
                            <CardContent className="p-6">
                                <div className="mb-4">
                                    <h4 className="font-medium text-slate-900 mb-2 whitespace-pre-wrap">Q: {q.optimized_json.text}</h4>
                                    {q.optimized_json.imageUrl && (
                                        <img src={q.optimized_json.imageUrl} alt="Question" className="max-h-48 rounded my-2 border bg-slate-50 object-contain p-2" />
                                    )}
                                </div>

                                <div className="grid sm:grid-cols-2 gap-3 mb-6">
                                    {q.optimized_json.options.map((opt) => (
                                        <div
                                            key={opt.id}
                                            className={`flex gap-3 p-3 rounded-xl border items-center ${opt.id === q.optimized_json.correctOptionId
                                                    ? 'bg-emerald-50 border-emerald-200'
                                                    : 'bg-slate-50 border-slate-200'
                                                }`}
                                        >
                                            <div className={`w-6 h-6 shrink-0 flex items-center justify-center rounded-md text-xs font-bold ${opt.id === q.optimized_json.correctOptionId ? 'bg-emerald-200 text-emerald-800' : 'bg-slate-200 text-slate-700'
                                                }`}>
                                                {opt.id}
                                            </div>
                                            <div className="flex-1 min-w-0 break-words text-sm">
                                                {opt.imageUrl ? (
                                                    <img src={opt.imageUrl} alt={`Option ${opt.id}`} className="max-h-16 w-auto object-contain bg-white rounded border border-slate-100 p-1" />
                                                ) : (
                                                    <span>{opt.text}</span>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <div className="flex justify-end gap-3 pt-4 border-t">
                                    <Button variant="outline" onClick={() => handleRejectFlag(q.id)} className="text-slate-600">
                                        Reject Flag (Keep As Is)
                                    </Button>
                                    <Button onClick={() => handleEditQuestion(q.id)} className="bg-primary hover:bg-primary/90 text-white">
                                        <Edit3 className="mr-2 h-4 w-4" /> Edit & Fix in Review Page
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}
