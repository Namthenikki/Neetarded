"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, doc, setDoc, deleteDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { MathText } from "@/components/MathText";

interface RecycleBinQuestion {
    id: string; // The ID in the recycle bin
    original_doc_id?: string; // The ID in QuestionBank this belongs to
    deleted_at?: { seconds: number; nanoseconds: number };
    expires_at?: { seconds: number; nanoseconds: number };
    source_paper: string;
    chapter_code: string;
    training_status: string;
    optimized_json: {
        questionNumber: number;
        text: string;
        options: { id: string; text: string; imageUrl?: string }[];
        correctOptionId: string;
        explanation?: string;
        imageUrl?: string;
    };
    image_url?: string;
    [key: string]: any; // other fields
}

export default function RecycleBinPage() {
    const [questions, setQuestions] = useState<RecycleBinQuestion[]>([]);
    const [loading, setLoading] = useState(true);
    const [restoringId, setRestoringId] = useState<string | null>(null);

    useEffect(() => {
        loadRecycleBin();
    }, []);

    async function loadRecycleBin() {
        setLoading(true);
        try {
            const ref = collection(db, "QuestionBankRecycleBin");
            const snap = await getDocs(ref);
            const data: RecycleBinQuestion[] = [];

            snap.docs.forEach(d => {
                data.push({ id: d.id, ...d.data() } as RecycleBinQuestion);
            });

            // Sort by deletion date (newest first)
            data.sort((a, b) => (b.deleted_at?.seconds || 0) - (a.deleted_at?.seconds || 0));
            setQuestions(data);
        } catch (err) {
            console.error("Error loading recycle bin:", err);
        } finally {
            setLoading(false);
        }
    }

    async function handleRestore(q: RecycleBinQuestion) {
        if (!q.original_doc_id) {
            alert("Cannot restore: original document ID is missing.");
            return;
        }

        if (!confirm("Are you sure you want to restore this question? It will overwrite the current version in the Question Bank.")) return;

        setRestoringId(q.id);
        try {
            // 1. Prepare data for QuestionBank
            const restoreData = { ...q } as Partial<RecycleBinQuestion>;
            delete restoreData.id;
            delete restoreData.original_doc_id;
            delete restoreData.deleted_at;
            delete restoreData.expires_at;

            // 2. Overwrite in QuestionBank using original ID
            await setDoc(doc(db, "QuestionBank", q.original_doc_id), restoreData);

            // 3. Delete from Recycle Bin
            await deleteDoc(doc(db, "QuestionBankRecycleBin", q.id));

            // 4. Update UI
            setQuestions(prev => prev.filter(item => item.id !== q.id));
            alert("Question restored successfully!");
        } catch (err) {
            console.error("Error restoring question:", err);
            alert("Failed to restore question. Check console for details.");
        } finally {
            setRestoringId(null);
        }
    }

    if (loading) {
        return <div className="min-h-screen pt-24 px-6 md:px-12 flex justify-center items-center text-gray-400">Loading Recycle Bin...</div>;
    }

    return (
        <div className="min-h-screen pt-24 pb-24 px-6 md:px-12 max-w-7xl mx-auto">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-white mb-2">Recycle Bin</h1>
                    <p className="text-gray-400">
                        View and restore questions replaced during re-ingestion. Questions are permanently deleted after 7 days.
                    </p>
                </div>
            </div>

            {questions.length === 0 ? (
                <div className="mt-12 p-12 rounded-2xl border border-white/10 bg-white/5 flex flex-col items-center justify-center text-center">
                    <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
                        <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                    </div>
                    <h3 className="text-xl font-semibold text-white mb-2">Recycle Bin is Empty</h3>
                    <p className="text-gray-400 max-w-md">No questions have been replaced recently.</p>
                </div>
            ) : (
                <div className="space-y-6">
                    {questions.map((q) => {
                        const deletedDate = new Date((q.deleted_at?.seconds || 0) * 1000);
                        const daysAgo = Math.floor((Date.now() - deletedDate.getTime()) / (1000 * 60 * 60 * 24));

                        return (
                            <div key={q.id} className="p-6 rounded-2xl border border-red-500/20 bg-[#140D1C]">
                                <div className="flex justify-between items-start mb-4">
                                    <div>
                                        <div className="flex gap-2 mb-2">
                                            <span className="px-2 py-1 rounded text-xs font-semibold bg-red-500/10 text-red-400 border border-red-500/20">
                                                Deleted {daysAgo === 0 ? "Today" : `${daysAgo} days ago`}
                                            </span>
                                            <span className="px-2 py-1 rounded text-xs font-medium bg-white/5 text-gray-300 border border-white/10">
                                                {q.source_paper}
                                            </span>
                                            <span className="px-2 py-1 rounded text-xs font-medium bg-white/5 text-gray-300 border border-white/10">
                                                {q.chapter_code}
                                            </span>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => handleRestore(q)}
                                        disabled={restoringId === q.id}
                                        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50"
                                    >
                                        {restoringId === q.id ? "Restoring..." : "Restore Question"}
                                    </button>
                                </div>

                                <div className="flex gap-4">
                                    <span className="flex-shrink-0 w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center text-sm font-bold text-red-400">
                                        {q.optimized_json.questionNumber}
                                    </span>
                                    <div className="text-gray-200 text-base leading-relaxed pt-1 w-full overflow-hidden">
                                        <MathText content={q.optimized_json.text} />
                                    </div>
                                </div>

                                {/* Options */}
                                <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-3 pl-12 pr-4">
                                    {q.optimized_json.options.map((opt) => {
                                        const isCorrect = opt.id === q.optimized_json.correctOptionId;
                                        return (
                                            <div
                                                key={opt.id}
                                                className={`p-3 rounded-xl border flex items-start gap-3 transition-colors ${isCorrect
                                                    ? "bg-emerald-500/10 border-emerald-500/30 ring-1 ring-emerald-500/20"
                                                    : "bg-white/5 border-white/10"
                                                    }`}
                                            >
                                                <span className={`flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-md text-xs font-bold ${isCorrect ? "bg-emerald-500 text-white" : "bg-white/10 text-gray-400"
                                                    }`}>
                                                    {opt.id}
                                                </span>
                                                <div className="flex flex-col gap-2 w-full text-left">
                                                    <div className="text-sm">
                                                        <MathText content={opt.text || "(empty)"} />
                                                    </div>
                                                    {opt.imageUrl && (
                                                        <div className="mt-1">
                                                            <img src={opt.imageUrl} alt={`Option ${opt.id}`} className="max-h-24 object-contain rounded border border-white/5 bg-white/5" />
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
