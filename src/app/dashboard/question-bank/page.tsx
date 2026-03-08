"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { db } from "@/lib/firebase/config";
import { collection, getDocs, query, where, doc, updateDoc, deleteDoc, writeBatch } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "@/lib/firebase/config";
import { QUIZ_SUBJECTS } from "@/lib/quiz-data";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    Loader2, Search, Database, CheckCircle, AlertTriangle, Clock,
    Image as ImageIcon, ChevronLeft, ChevronRight, ExternalLink, Trash2, Upload
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";

interface QuestionDoc {
    id: string;
    source_paper: string;
    section_id: string | null;
    chapter_name: string | null;
    chapter_code: string | null;
    training_status: string;
    image_url?: string;
    optimized_json: {
        questionNumber: number;
        text: string;
        options: { id: string; text: string; imageUrl?: string }[];
        correctOptionId: string;
        explanation?: string;
        explanationImageUrl?: string;
        imageUrl?: string;
    };
    has_active_flag?: boolean;
    flag_reason?: string;
    flagged_by?: string;
}

const SUBJECTS = [
    { id: "all", name: "All Subjects" },
    { id: "1B0", name: "Biology" },
    { id: "2P0", name: "Physics" },
    { id: "3C0", name: "Chemistry" },
];

const STATUSES = [
    { id: "all", name: "All Status" },
    { id: "pending_review", name: "⏳ Pending" },
    { id: "approved", name: "✅ Approved" },
    { id: "flagged", name: "🚩 Flagged" },
];

const PAGE_SIZE = 20;

export default function QuestionBankPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const { toast } = useToast();

    const [questions, setQuestions] = useState<QuestionDoc[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [subjectFilter, setSubjectFilter] = useState("all");
    const [statusFilter, setStatusFilter] = useState("all");
    const [sourceFilter, setSourceFilter] = useState("all");
    const [page, setPage] = useState(0);

    // Deletion states
    const [singleDeleteId, setSingleDeleteId] = useState<string | null>(null);
    const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false);
    const [bulkDeleteSource, setBulkDeleteSource] = useState("all");
    const [uploadingOptionId, setUploadingOptionId] = useState<string | null>(null);

    // Upload Answers states
    const [isUploadAnswersOpen, setIsUploadAnswersOpen] = useState(false);
    const [answersFile, setAnswersFile] = useState<File | null>(null);
    const [answersSource, setAnswersSource] = useState("");
    const [answersDryRun, setAnswersDryRun] = useState(false);
    const [uploadAnswersStatus, setUploadAnswersStatus] = useState<"idle" | "uploading" | "processing" | "done" | "error">("idle");
    const [uploadAnswersLogs, setUploadAnswersLogs] = useState<any[]>([]);

    // Student flag states
    const [studentFlagId, setStudentFlagId] = useState<string | null>(null);
    const [studentFlagReason, setStudentFlagReason] = useState("");

    const handleUploadAnswers = async () => {
        if (!answersFile || !answersSource) {
            toast({ variant: "destructive", title: "Select a PDF and Source" });
            return;
        }

        setUploadAnswersStatus("uploading");
        setUploadAnswersLogs([]);

        const formData = new FormData();
        formData.append("pdf", answersFile);
        formData.append("source", answersSource);
        formData.append("dryRun", String(answersDryRun));

        try {
            const res = await fetch("/api/ingest-answers", {
                method: "POST",
                body: formData,
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || "Upload failed");
            }

            setUploadAnswersStatus("processing");

            if (res.body) {
                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let buffer = "";

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || "";

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            try {
                                const data = JSON.parse(line.slice(6));
                                if (data.type === "log" || data.type === "error") {
                                    setUploadAnswersLogs(prev => [...prev, data]);
                                } else if (data.type === "done") {
                                    setUploadAnswersStatus(data.success ? "done" : "error");
                                    if (data.success && !answersDryRun) {
                                        toast({ title: "✅ Answers Uploaded Successfully" });
                                        // Small delay before reload
                                        setTimeout(() => window.location.reload(), 2000);
                                    }
                                }
                            } catch (e) { }
                        }
                    }
                }
            }
        } catch (e: any) {
            console.error("Upload answers failed:", e);
            setUploadAnswersStatus("error");
            toast({ variant: "destructive", title: "Failed to upload", description: e.message });
        }
    };

    const handleOptionImageUpload = async (questionDoc: QuestionDoc, optionId: string, file: File) => {
        const uploadKey = `${questionDoc.id}_${optionId}`;
        setUploadingOptionId(uploadKey);
        try {
            const safeName = questionDoc.source_paper.replace(/[^\w\-]/g, '_');
            const qNum = questionDoc.optimized_json.questionNumber;
            const storageRef = ref(storage, `question-images/${safeName}/q${qNum}_opt${optionId}.png`);
            await uploadBytes(storageRef, file);
            const downloadUrl = await getDownloadURL(storageRef);

            // Update Firestore document
            const updatedOptions = questionDoc.optimized_json.options.map(opt =>
                opt.id === optionId ? { ...opt, imageUrl: downloadUrl } : opt
            );
            await updateDoc(doc(db, "QuestionBank", questionDoc.id), {
                "optimized_json.options": updatedOptions,
            });

            // Update local state
            setQuestions(prev => prev.map(q => {
                if (q.id !== questionDoc.id) return q;
                return {
                    ...q,
                    optimized_json: {
                        ...q.optimized_json,
                        options: updatedOptions,
                    },
                };
            }));
            toast({ title: `✅ Option ${optionId} image uploaded` });
        } catch (e) {
            console.error("Option image upload failed:", e);
            toast({ variant: "destructive", title: "Failed to upload option image" });
        } finally {
            setUploadingOptionId(null);
        }
    };

    useEffect(() => {
        if (authLoading) return;
        if (!user) {
            router.replace("/login");
            return;
        }

        async function fetchAll() {
            setLoading(true);
            try {
                let snap;
                if (user?.role === "admin") {
                    snap = await getDocs(collection(db, "QuestionBank"));
                } else {
                    snap = await getDocs(query(collection(db, "QuestionBank"), where("training_status", "==", "approved")));
                }

                const docs = snap.docs.map((d) => ({
                    id: d.id,
                    ...d.data(),
                })) as QuestionDoc[];
                setQuestions(docs);
            } catch (e) {
                console.error("Error fetching QuestionBank:", e);
                toast({ variant: "destructive", title: "Failed to load questions" });
            } finally {
                setLoading(false);
            }
        }

        fetchAll();
    }, [user, authLoading, router, toast]);

    // Stats
    const stats = useMemo(() => {
        const total = questions.length;
        const approved = questions.filter((q) => q.training_status === "approved").length;
        const flagged = questions.filter((q) => q.has_active_flag).length;
        const pending = questions.filter((q) => q.training_status === "pending_review").length;
        const withImages = questions.filter(
            (q) => q.image_url || q.optimized_json?.imageUrl
        ).length;
        return { total, approved, flagged, pending, withImages };
    }, [questions]);

    // Filtered list
    const filtered = useMemo(() => {
        let result = questions;

        if (subjectFilter !== "all") {
            result = result.filter((q) => q.section_id === subjectFilter);
        }

        if (statusFilter !== "all") {
            result = result.filter((q) => q.training_status === statusFilter);
        }

        if (sourceFilter !== "all") {
            result = result.filter((q) => q.source_paper === sourceFilter);
        }

        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            result = result.filter(
                (q) =>
                    q.optimized_json?.text?.toLowerCase().includes(query) ||
                    q.chapter_name?.toLowerCase().includes(query) ||
                    String(q.optimized_json?.questionNumber).includes(query)
            );
        }

        // Sort by question number
        result.sort((a, b) => (a.optimized_json?.questionNumber || 0) - (b.optimized_json?.questionNumber || 0));

        return result;
    }, [questions, subjectFilter, statusFilter, sourceFilter, searchQuery]);

    const uniqueSources = useMemo(() => {
        const sources = new Set(questions.map((q) => q.source_paper).filter(Boolean));
        return Array.from(sources);
    }, [questions]);

    const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
    const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

    // Reset page when filters change
    useEffect(() => {
        setPage(0);
    }, [subjectFilter, statusFilter, sourceFilter, searchQuery]);

    const handleQuickApprove = async (docId: string) => {
        try {
            await updateDoc(doc(db, "QuestionBank", docId), { training_status: "approved" });
            setQuestions((prev) =>
                prev.map((q) => (q.id === docId ? { ...q, training_status: "approved" } : q))
            );
            toast({ title: "✅ Approved" });
        } catch {
            toast({ variant: "destructive", title: "Failed to approve" });
        }
    };

    const handleQuickFlag = async (docId: string) => {
        try {
            await updateDoc(doc(db, "QuestionBank", docId), { training_status: "flagged" });
            setQuestions((prev) =>
                prev.map((q) => (q.id === docId ? { ...q, training_status: "flagged" } : q))
            );
            toast({ title: "🚩 Flagged" });
        } catch {
            toast({ variant: "destructive", title: "Failed to flag" });
        }
    };

    const handleStudentFlag = async () => {
        if (!studentFlagId || !studentFlagReason.trim() || !user) return;
        try {
            await updateDoc(doc(db, "QuestionBank", studentFlagId), {
                has_active_flag: true,
                flag_reason: studentFlagReason.trim(),
                flagged_by: user.studentId
            });
            // Keep question in view, just update its local state
            setQuestions((prev) =>
                prev.map((q) =>
                    q.id === studentFlagId
                        ? { ...q, has_active_flag: true, flag_reason: studentFlagReason.trim(), flagged_by: user.studentId }
                        : q
                )
            );
            toast({ title: "🚩 Flag reported successfully" });
        } catch {
            toast({ variant: "destructive", title: "Failed to submit flag" });
        } finally {
            setStudentFlagId(null);
            setStudentFlagReason("");
        }
    };

    const handleSingleDelete = async () => {
        if (!singleDeleteId) return;
        try {
            await deleteDoc(doc(db, "QuestionBank", singleDeleteId));
            setQuestions((prev) => prev.filter((q) => q.id !== singleDeleteId));
            toast({ title: "🗑️ Question deleted" });
        } catch {
            toast({ variant: "destructive", title: "Failed to delete question" });
        } finally {
            setSingleDeleteId(null);
        }
    };

    const handleBulkDelete = async () => {
        if (!bulkDeleteSource || bulkDeleteSource === "all") return;

        const toDelete = questions.filter((q) => q.source_paper === bulkDeleteSource);
        if (toDelete.length === 0) return;

        try {
            // Firestore transactions/batches can handle maximum 500 operations at once
            // In a real app we might need to chunk this, but for < 500 questions this is fine
            const chunks = [];
            for (let i = 0; i < toDelete.length; i += 500) {
                chunks.push(toDelete.slice(i, i + 500));
            }

            for (const chunk of chunks) {
                const batch = writeBatch(db);
                chunk.forEach((q) => {
                    batch.delete(doc(db, "QuestionBank", q.id));
                });
                await batch.commit();
            }

            setQuestions((prev) => prev.filter((q) => q.source_paper !== bulkDeleteSource));
            setBulkDeleteSource("all");
            toast({ title: `🗑️ Deleted ${toDelete.length} questions` });
        } catch (e) {
            console.error("Bulk delete failed", e);
            toast({ variant: "destructive", title: "Failed to bulk delete questions" });
        } finally {
            setIsBulkDeleteDialogOpen(false);
        }
    };

    const getSubjectName = (sectionId: string | null) => {
        if (!sectionId) return "Unknown";
        return { "1B0": "Biology", "2P0": "Physics", "3C0": "Chemistry" }[sectionId] || "Unknown";
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case "approved":
                return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100">✅ Approved</Badge>;
            case "flagged":
                return <Badge className="bg-red-100 text-red-700 border-red-200 hover:bg-red-100">🚩 Flagged</Badge>;
            default:
                return <Badge className="bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100">⏳ Pending</Badge>;
        }
    };

    if (authLoading || loading) {
        return (
            <div className="flex h-full min-h-[calc(100vh-10rem)] items-center justify-center">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="p-4 md:p-8 space-y-6">
            {/* Header */}
            <header>
                <h1 className="text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-3">
                    <Database className="h-8 w-8 text-primary" />
                    Question Bank
                </h1>
                <p className="text-slate-600 mt-1">Browse, filter, and manage all parsed questions from your NEET PDFs.</p>
            </header>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <Card className="rounded-2xl">
                    <CardContent className="p-4 text-center">
                        <p className="text-2xl font-bold text-slate-800">{stats.total}</p>
                        <p className="text-xs text-slate-500 mt-1">Total Questions</p>
                    </CardContent>
                </Card>
                <Card className="rounded-2xl border-emerald-200 bg-emerald-50/50">
                    <CardContent className="p-4 text-center">
                        <p className="text-2xl font-bold text-emerald-700">{stats.approved}</p>
                        <p className="text-xs text-emerald-600 mt-1">Approved</p>
                    </CardContent>
                </Card>
                <Card className="rounded-2xl border-amber-200 bg-amber-50/50">
                    <CardContent className="p-4 text-center">
                        <p className="text-2xl font-bold text-amber-700">{stats.pending}</p>
                        <p className="text-xs text-amber-600 mt-1">Pending Review</p>
                    </CardContent>
                </Card>
                <Card className="rounded-2xl border-red-200 bg-red-50/50">
                    <CardContent className="p-4 text-center">
                        <p className="text-2xl font-bold text-red-700">{stats.flagged}</p>
                        <p className="text-xs text-red-600 mt-1">Flagged</p>
                    </CardContent>
                </Card>
                <Card className="rounded-2xl border-violet-200 bg-violet-50/50">
                    <CardContent className="p-4 text-center">
                        <p className="text-2xl font-bold text-violet-700">{stats.withImages}</p>
                        <p className="text-xs text-violet-600 mt-1">With Images</p>
                    </CardContent>
                </Card>
            </div>

            {/* Filters */}
            <Card className="rounded-2xl">
                <CardContent className="p-4">
                    <div className="flex flex-col md:flex-row gap-3">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                            <Input
                                placeholder="Search by question text, chapter, or number..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-9 rounded-xl bg-white"
                            />
                        </div>
                        <Select value={sourceFilter} onValueChange={setSourceFilter}>
                            <SelectTrigger className="w-full md:w-[180px] rounded-xl">
                                <SelectValue placeholder="All Sources" />
                            </SelectTrigger>
                            <SelectContent className="rounded-xl">
                                <SelectItem value="all">All Sources</SelectItem>
                                {uniqueSources.map((source) => (
                                    <SelectItem key={source} value={source}>
                                        {source}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Select value={subjectFilter} onValueChange={setSubjectFilter}>
                            <SelectTrigger className="w-full md:w-[180px] rounded-xl">
                                <SelectValue placeholder="Subject" />
                            </SelectTrigger>
                            <SelectContent className="rounded-xl">
                                {SUBJECTS.map((s) => (
                                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {user?.role === 'admin' && (
                            <Select value={statusFilter} onValueChange={setStatusFilter}>
                                <SelectTrigger className="w-full md:w-[180px] rounded-xl">
                                    <SelectValue placeholder="Status" />
                                </SelectTrigger>
                                <SelectContent className="rounded-xl">
                                    {STATUSES.map((s) => (
                                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    </div>

                    {/* Bulk Actions (Admin only) */}
                    <div className="mt-4 pt-4 border-t flex flex-wrap gap-3 items-center justify-between">
                        {user?.role === 'admin' ? (
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 text-xs rounded-lg bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100"
                                    onClick={() => {
                                        setAnswersFile(null);
                                        setAnswersSource("");
                                        setUploadAnswersLogs([]);
                                        setUploadAnswersStatus("idle");
                                        setIsUploadAnswersOpen(true);
                                    }}
                                >
                                    <Upload className="h-3 w-3 mr-1" /> Answer Keys
                                </Button>
                                <Select value={bulkDeleteSource} onValueChange={setBulkDeleteSource}>
                                    <SelectTrigger className="w-[200px] h-8 rounded-lg text-xs">
                                        <SelectValue placeholder="Select PDF to delete" />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-xl">
                                        <SelectItem value="all">Do not delete</SelectItem>
                                        {uniqueSources.map((source) => (
                                            <SelectItem key={source} value={source}>
                                                Delete "{source}"
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Button
                                    variant="destructive"
                                    size="sm"
                                    className="h-8 text-xs rounded-lg"
                                    disabled={bulkDeleteSource === "all"}
                                    onClick={() => setIsBulkDeleteDialogOpen(true)}
                                >
                                    <Trash2 className="h-3 w-3 mr-1" /> Delete By Source
                                </Button>
                            </div>
                        ) : (
                            <div></div>
                        )}
                        <p className="text-xs text-slate-500">
                            Showing {filtered.length} of {user?.role === 'admin' ? stats.total : stats.approved} questions
                        </p>
                    </div>
                </CardContent>
            </Card>

            {/* Question Cards */}
            <div className="space-y-3">
                {paged.length === 0 ? (
                    <Card className="rounded-2xl">
                        <CardContent className="p-12 text-center">
                            <Database className="h-12 w-12 mx-auto text-slate-300 mb-4" />
                            <p className="text-slate-500 text-lg">No questions found</p>
                            <p className="text-slate-400 text-sm mt-1">Try adjusting your filters or upload a PDF first.</p>
                        </CardContent>
                    </Card>
                ) : (
                    paged.map((q) => {
                        const opt = q.optimized_json;
                        const imgUrl = q.image_url || opt?.imageUrl;

                        return (
                            <Card key={q.id} className={cn("rounded-2xl hover:shadow-md transition-shadow", q.has_active_flag ? "border-red-200" : "")}>
                                <CardContent className="p-5">
                                    <div className="flex gap-4">
                                        {/* Question content */}
                                        <div className="flex-1 min-w-0">
                                            {/* Header row */}
                                            <div className="flex items-start justify-between gap-2 mb-2">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 text-primary font-bold text-sm shrink-0">
                                                        {opt?.questionNumber || "?"}
                                                    </span>
                                                    <Badge variant="outline" className="text-xs">
                                                        {getSubjectName(q.section_id)}
                                                    </Badge>
                                                    {q.chapter_name && (
                                                        <Badge variant="secondary" className="text-xs">
                                                            {q.chapter_name}
                                                        </Badge>
                                                    )}
                                                    {getStatusBadge(q.training_status)}
                                                    {imgUrl && (
                                                        <Badge className="bg-violet-100 text-violet-700 border-violet-200 hover:bg-violet-100 text-xs">
                                                            <ImageIcon className="h-3 w-3 mr-1" /> Has Image
                                                        </Badge>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Question text */}
                                            <p className="text-slate-800 text-sm leading-relaxed mb-3">
                                                {opt?.text || "No text available"}
                                            </p>

                                            {/* Options grid */}
                                            {opt?.options && (
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mb-3">
                                                    {opt.options.map((option) => (
                                                        <div
                                                            key={option.id}
                                                            className={cn(
                                                                "rounded-lg px-3 py-1.5 text-xs border",
                                                                option.id === opt.correctOptionId
                                                                    ? "bg-emerald-50 border-emerald-300 text-emerald-800 font-medium"
                                                                    : "bg-slate-50 border-slate-200 text-slate-600"
                                                            )}
                                                        >
                                                            <div className="flex items-center gap-2">
                                                                <span className="font-bold shrink-0">{option.id})</span>
                                                                {option.imageUrl ? (
                                                                    <img
                                                                        src={option.imageUrl}
                                                                        alt={`Option ${option.id}`}
                                                                        className="max-h-16 w-auto object-contain rounded bg-white"
                                                                    />
                                                                ) : (
                                                                    <span className="flex-1">{option.text}</span>
                                                                )}
                                                                {user?.role === 'admin' && (
                                                                    <label className="shrink-0 cursor-pointer">
                                                                        <input
                                                                            type="file"
                                                                            accept="image/*"
                                                                            className="hidden"
                                                                            onChange={(e) => {
                                                                                const file = e.target.files?.[0];
                                                                                if (file) handleOptionImageUpload(q, option.id, file);
                                                                                e.target.value = "";
                                                                            }}
                                                                            disabled={uploadingOptionId === `${q.id}_${option.id}`}
                                                                        />
                                                                        {uploadingOptionId === `${q.id}_${option.id}` ? (
                                                                            <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
                                                                        ) : (
                                                                            <Upload className="h-3.5 w-3.5 text-slate-400 hover:text-primary transition-colors" />
                                                                        )}
                                                                    </label>
                                                                )}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            {/* Explanation block */}
                                            {opt?.explanation && (
                                                <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                                                    <div className="flex items-center gap-2 mb-2">
                                                        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Explanation for Answer</span>
                                                    </div>
                                                    <p className="text-slate-700 text-sm whitespace-pre-wrap">{opt.explanation}</p>
                                                    {(opt.explanationImageUrl || (q as any).optimized_json?.explanationImageUrl) && (
                                                        <img
                                                            src={opt.explanationImageUrl || (q as any).optimized_json?.explanationImageUrl}
                                                            alt="Explanation Diagram"
                                                            className="mt-3 max-h-48 w-auto rounded-md border bg-white"
                                                        />
                                                    )}
                                                </div>
                                            )}

                                            {/* Source & actions */}
                                            <div className="flex items-center gap-2 flex-wrap mt-2">
                                                <span className="text-xs text-slate-400">
                                                    Source: {q.source_paper}
                                                </span>
                                                <div className="flex-1" />

                                                {user?.role === 'admin' ? (
                                                    <>
                                                        {q.training_status === "pending_review" && (
                                                            <>
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    className="rounded-lg text-xs h-7"
                                                                    onClick={() => handleQuickApprove(q.id)}
                                                                >
                                                                    <CheckCircle className="h-3 w-3 mr-1" /> Approve
                                                                </Button>
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    className="rounded-lg text-xs h-7 text-red-600 hover:text-red-700"
                                                                    onClick={() => handleQuickFlag(q.id)}
                                                                >
                                                                    <AlertTriangle className="h-3 w-3 mr-1" /> Flag
                                                                </Button>
                                                            </>
                                                        )}
                                                        <Button
                                                            size="icon"
                                                            variant="ghost"
                                                            className="rounded-lg h-7 w-7 text-slate-400 hover:text-red-600 hover:bg-slate-100"
                                                            onClick={() => setSingleDeleteId(q.id)}
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    </>
                                                ) : (
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="rounded-lg text-xs h-7 text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                                                        onClick={() => setStudentFlagId(q.id)}
                                                    >
                                                        <AlertTriangle className="h-3 w-3 mr-1" /> Flag Issue
                                                    </Button>
                                                )}
                                            </div>

                                            {/* Flag Reason Display (Admin Only) */}
                                            {user?.role === 'admin' && q.has_active_flag && q.flag_reason && (
                                                <div className="mt-3 p-3 bg-red-50 border border-red-100 rounded-lg">
                                                    <div className="flex items-center gap-1.5 text-red-800 font-medium text-xs mb-1">
                                                        <AlertTriangle className="h-3.5 w-3.5" />
                                                        Active Flag reported by {q.flagged_by || 'Student'}
                                                    </div>
                                                    <p className="text-sm text-red-700">{q.flag_reason}</p>
                                                    <span className="text-[10px] text-red-500 font-semibold mt-2 inline-block uppercase tracking-wider">Review in Notifications Page</span>
                                                </div>
                                            )}
                                        </div>

                                        {/* Image thumbnail */}
                                        {imgUrl && (
                                            <div className="shrink-0 w-32 h-32 rounded-xl border bg-slate-50 overflow-hidden flex items-center justify-center">
                                                <img
                                                    src={imgUrl}
                                                    alt={`Q${opt?.questionNumber} diagram`}
                                                    className="max-w-full max-h-full object-contain"
                                                />
                                            </div>
                                        )}
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })
                )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-4 py-4">
                    <Button
                        variant="outline"
                        size="sm"
                        className="rounded-xl"
                        disabled={page === 0}
                        onClick={() => setPage((p) => p - 1)}
                    >
                        <ChevronLeft className="h-4 w-4 mr-1" /> Previous
                    </Button>
                    <span className="text-sm text-slate-600">
                        Page {page + 1} of {totalPages}
                    </span>
                    <Button
                        variant="outline"
                        size="sm"
                        className="rounded-xl"
                        disabled={page >= totalPages - 1}
                        onClick={() => setPage((p) => p + 1)}
                    >
                        Next <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                </div>
            )}

            {/* Delete Confirmation Dialogs */}
            <AlertDialog open={!!singleDeleteId} onOpenChange={(open) => !open && setSingleDeleteId(null)}>
                <AlertDialogContent className="rounded-2xl">
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Question?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will permanently remove the question from the database. This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleSingleDelete} className="bg-red-600 hover:bg-red-700 rounded-xl">
                            <Trash2 className="h-4 w-4 mr-2" /> Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={isBulkDeleteDialogOpen} onOpenChange={setIsBulkDeleteDialogOpen}>
                <AlertDialogContent className="rounded-2xl border-red-200">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-red-700 flex items-center gap-2">
                            <AlertTriangle className="h-5 w-5" /> Bulk Delete Questions
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            You are about to permanently delete all questions parsed from the source{" "}
                            <span className="font-semibold text-slate-900">"{bulkDeleteSource}"</span>.
                            <br /><br />
                            This will delete{" "}
                            <span className="font-semibold px-2 py-0.5 rounded bg-red-100 text-red-700">
                                {questions.filter((q) => q.source_paper === bulkDeleteSource).length}
                            </span>{" "}
                            questions from the Question Bank. This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleBulkDelete} className="bg-red-600 hover:bg-red-700 rounded-xl">
                            <Trash2 className="h-4 w-4 mr-2" /> Delete All
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={!!studentFlagId} onOpenChange={(open) => !open && setStudentFlagId(null)}>
                <AlertDialogContent className="rounded-2xl">
                    <AlertDialogHeader>
                        <AlertDialogTitle>Report an Issue</AlertDialogTitle>
                        <AlertDialogDescription>
                            Please describe what is wrong with this question (e.g. incorrect answer, typo, unclear image). Admins will review it.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="my-2">
                        <textarea
                            className="w-full min-h-[100px] p-3 text-sm rounded-xl border border-slate-200 outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all resize-y"
                            placeholder="Reason for flagging..."
                            value={studentFlagReason}
                            onChange={(e) => setStudentFlagReason(e.target.value)}
                        />
                    </div>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
                        <Button
                            onClick={handleStudentFlag}
                            disabled={!studentFlagReason.trim()}
                            className="rounded-xl"
                        >
                            Submit Report
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Upload Answer Keys Dialog */}
            <Dialog open={isUploadAnswersOpen} onOpenChange={(open) => {
                if (!open && uploadAnswersStatus === "processing") {
                    toast({ title: "Upload in progress", description: "Please wait for it to finish." });
                    return;
                }
                setIsUploadAnswersOpen(open);
            }}>
                <DialogContent className="sm:max-w-md rounded-2xl">
                    <DialogHeader>
                        <DialogTitle>Upload Answer Keys & Explanations</DialogTitle>
                        <DialogDescription>
                            Upload a PDF containing Hints & Solutions. The AI will extract and merge them with existing questions for the selected source paper.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-slate-700">Target Source Paper</label>
                            <Select value={answersSource} onValueChange={setAnswersSource}>
                                <SelectTrigger className="w-full rounded-xl">
                                    <SelectValue placeholder="Select Source Paper" />
                                </SelectTrigger>
                                <SelectContent className="rounded-xl">
                                    {uniqueSources.map((source) => (
                                        <SelectItem key={source} value={source}>
                                            {source}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-slate-700">Solutions PDF</label>
                            <div className="flex items-center justify-center w-full">
                                <label className={cn(
                                    "flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-xl cursor-pointer transition-colors",
                                    answersFile ? "border-emerald-300 bg-emerald-50/50" : "border-slate-300 bg-slate-50 hover:bg-slate-100"
                                )}>
                                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                                        <Upload className={cn("w-6 h-6 mb-2", answersFile ? "text-emerald-500" : "text-slate-400")} />
                                        <p className="mb-1 text-sm text-slate-500 font-medium">
                                            {answersFile ? answersFile.name : "Click to upload Answers PDF"}
                                        </p>
                                        <p className="text-xs text-slate-400">PDFs only</p>
                                    </div>
                                    <input
                                        type="file"
                                        className="hidden"
                                        accept=".pdf"
                                        onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (file) setAnswersFile(file);
                                        }}
                                    />
                                </label>
                            </div>
                        </div>

                        <div className="flex items-center space-x-2 bg-amber-50 p-3 rounded-lg border border-amber-200">
                            <Checkbox
                                id="dry-run"
                                checked={answersDryRun}
                                onCheckedChange={(checked) => setAnswersDryRun(checked as boolean)}
                            />
                            <label htmlFor="dry-run" className="text-sm font-medium leading-none text-amber-800 peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer">
                                Dry Run 🧪
                            </label>
                            <p className="text-xs text-amber-700/80 ml-auto">Do not push to DB</p>
                        </div>

                        {uploadAnswersStatus !== "idle" && (
                            <div className="mt-4 p-3 bg-slate-900 rounded-xl" style={{ maxHeight: '160px', overflowY: 'auto' }}>
                                {uploadAnswersLogs.map((log, i) => (
                                    <div key={i} className={cn("text-xs font-mono", log.isError ? "text-red-400" : "text-emerald-400")}>
                                        {log.text.trim()}
                                    </div>
                                ))}
                                {uploadAnswersStatus === "processing" && (
                                    <div className="flex items-center gap-2 text-indigo-400 text-xs font-mono mt-2 animate-pulse">
                                        <Loader2 className="h-3 w-3 animate-spin" /> Processing AI outputs...
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button
                            variant="outline"
                            className="rounded-xl"
                            disabled={uploadAnswersStatus === "uploading" || uploadAnswersStatus === "processing"}
                            onClick={() => setIsUploadAnswersOpen(false)}
                        >
                            Close
                        </Button>
                        <Button
                            className="rounded-xl"
                            disabled={!answersFile || !answersSource || uploadAnswersStatus === "uploading" || uploadAnswersStatus === "processing"}
                            onClick={handleUploadAnswers}
                        >
                            {uploadAnswersStatus === "uploading" || uploadAnswersStatus === "processing" ? (
                                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Processing...</>
                            ) : (
                                "Start Extraction"
                            )}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
