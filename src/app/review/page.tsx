"use client";

import { useState, useEffect, useMemo } from "react";
import { db } from "@/lib/firebase/config";
import {
    collection,
    getDocs,
    query,
    where,
    doc,
    updateDoc,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { storage } from "@/lib/firebase/config";
import { cn } from "@/lib/utils";
import { QUIZ_SUBJECTS } from "@/lib/quiz-data";
import FigureCropEditor from "@/components/figure-crop-editor";
import { MathText } from "@/components/MathText";

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
    explanationImageUrl?: string;
    imageUrl?: string;
}

interface FigureTraining {
    source_page_url?: string | null;
    source_page_number?: number | null;
    ai_crop_bbox?: { left: number; top: number; right: number; bottom: number } | null;
    page_width?: number;
    page_height?: number;
    ai_figure_url?: string | null;
    human_crop_bbox?: { left: number; top: number; right: number; bottom: number } | null;
    human_figure_url?: string | null;
    correction_type?: string;
}

interface QuestionBankDoc {
    id: string;
    source_paper: string;
    section_id: string | null;
    section_name: string | null;
    chapter_code: string | null;
    chapter_binary_code: string | null;
    chapter_name: string | null;
    training_status: string;
    optimized_json: QuestionData;
    figure_training?: FigureTraining;
}

export default function ReviewPage() {
    const [questions, setQuestions] = useState<QuestionBankDoc[]>([]);
    const [loading, setLoading] = useState(true);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [showAnswer, setShowAnswer] = useState(false);
    const [selectedOption, setSelectedOption] = useState<string | null>(null);
    const [filter, setFilter] = useState<"all" | "pending_review" | "approved" | "flagged">("all");
    const [sourceFilter, setSourceFilter] = useState<string>("all");
    const [uniqueSources, setUniqueSources] = useState<string[]>([]);
    const [stats, setStats] = useState({ total: 0, approved: 0, flagged: 0, pending: 0 });

    // Chapter editing state
    const [editingChapter, setEditingChapter] = useState(false);
    const [selectedSubject, setSelectedSubject] = useState<string>("");
    const [selectedChapterCode, setSelectedChapterCode] = useState<string>("");
    const [savingChapter, setSavingChapter] = useState(false);

    // Question editing state
    const [editingQuestion, setEditingQuestion] = useState(false);
    const [editText, setEditText] = useState("");
    const [editOptions, setEditOptions] = useState<QuestionOption[]>([]);
    const [editCorrectId, setEditCorrectId] = useState("");
    const [editExplanation, setEditExplanation] = useState("");
    const [editExplanationImageUrl, setEditExplanationImageUrl] = useState("");
    const [editImageUrl, setEditImageUrl] = useState("");
    const [savingQuestion, setSavingQuestion] = useState(false);
    const [uploadingImage, setUploadingImage] = useState(false);
    const [uploadingExplanationImage, setUploadingExplanationImage] = useState(false);
    const [showCropEditor, setShowCropEditor] = useState(false);
    const [editCorrectionType, setEditCorrectionType] = useState<string>("none");
    const [uploadingOptionId, setUploadingOptionId] = useState<string | null>(null);

    useEffect(() => {
        loadQuestions();
    }, [filter, sourceFilter]);

    // Reset editing state when navigating
    useEffect(() => {
        setEditingChapter(false);
        setSelectedSubject("");
        setSelectedChapterCode("");
        setEditingQuestion(false);
    }, [currentIndex]);

    // Populate edit fields when entering edit mode
    function startEditingQuestion() {
        const qData = questions[currentIndex]?.optimized_json;
        if (!qData) return;
        setEditText(qData.text);
        setEditOptions(qData.options.map(o => ({ ...o })));
        setEditCorrectId(qData.correctOptionId);
        setEditExplanation(qData.explanation || "");
        setEditExplanationImageUrl(qData.explanationImageUrl || "");
        setEditImageUrl(qData.imageUrl || "");
        setEditingQuestion(true);
    }

    async function loadQuestions() {
        setLoading(true);
        try {
            const ref = collection(db, "QuestionBank");

            // Build query based on filters
            const conditions = [];
            if (filter !== "all") {
                conditions.push(where("training_status", "==", filter));
            }
            if (sourceFilter !== "all") {
                conditions.push(where("source_paper", "==", sourceFilter));
            }

            const q = conditions.length > 0 ? query(ref, ...conditions) : query(ref);

            const snapshot = await getDocs(q);
            const docs: QuestionBankDoc[] = snapshot.docs.map((d) => ({
                id: d.id,
                ...d.data(),
            })) as QuestionBankDoc[];

            // Sort by question number
            docs.sort(
                (a, b) =>
                    (a.optimized_json?.questionNumber || 0) -
                    (b.optimized_json?.questionNumber || 0)
            );

            setQuestions(docs);
            setCurrentIndex(0);
            setShowAnswer(false);
            setSelectedOption(null);

            // Stats
            const allRef = collection(db, "QuestionBank");
            const allSnap = await getDocs(allRef);
            let approved = 0,
                flagged = 0,
                pending = 0;
            const sources = new Set<string>();
            allSnap.docs.forEach((d) => {
                const data = d.data();
                const status = data.training_status;
                if (data.source_paper) sources.add(data.source_paper);
                if (status === "approved") approved++;
                else if (status === "flagged") flagged++;
                else pending++;
            });
            setUniqueSources(Array.from(sources).sort());
            setStats({ total: allSnap.size, approved, flagged, pending });
        } catch (err) {
            console.error("Error loading questions:", err);
        } finally {
            setLoading(false);
        }
    }

    async function updateStatus(docId: string, status: "approved" | "flagged") {
        try {
            await updateDoc(doc(db, "QuestionBank", docId), {
                training_status: status,
            });
            setQuestions((prev) =>
                prev.map((q) =>
                    q.id === docId ? { ...q, training_status: status } : q
                )
            );
            // Update stats
            setStats((prev) => {
                const oldQ = questions.find((q) => q.id === docId);
                const oldStatus = oldQ?.training_status || "pending_review";
                const newStats = { ...prev };
                if (oldStatus === "approved") newStats.approved--;
                else if (oldStatus === "flagged") newStats.flagged--;
                else newStats.pending--;
                if (status === "approved") newStats.approved++;
                else newStats.flagged++;
                return newStats;
            });
        } catch (err) {
            console.error("Error updating status:", err);
        }
    }

    async function updateChapter(docId: string, sectionId: string, binaryCode: string) {
        setSavingChapter(true);
        try {
            const subject = QUIZ_SUBJECTS.find(s => s.id === sectionId);
            const chapter = subject?.chapters.find(c => c.binaryCode === binaryCode);
            const chapterCode = `#${sectionId}-${binaryCode}`;
            const sectionName = subject?.name || null;
            const chapterName = chapter?.name || null;

            await updateDoc(doc(db, "QuestionBank", docId), {
                section_id: sectionId,
                section_name: sectionName,
                chapter_binary_code: binaryCode,
                chapter_code: chapterCode,
                chapter_name: chapterName,
            });

            setQuestions((prev) =>
                prev.map((q) =>
                    q.id === docId
                        ? {
                            ...q,
                            section_id: sectionId,
                            section_name: sectionName,
                            chapter_binary_code: binaryCode,
                            chapter_code: chapterCode,
                            chapter_name: chapterName,
                        }
                        : q
                )
            );

            setEditingChapter(false);
        } catch (err) {
            console.error("Error updating chapter:", err);
        } finally {
            setSavingChapter(false);
        }
    }

    async function saveQuestionEdits(docId: string) {
        setSavingQuestion(true);
        try {
            const current = questions.find(q => q.id === docId);
            if (!current) return;

            const updatedJson: QuestionData = {
                ...current.optimized_json,
                text: editText.trim(),
                options: editOptions.map(o => {
                    const mapped: any = { id: o.id, text: o.text.trim() };
                    if ((o as any).imageUrl) mapped.imageUrl = (o as any).imageUrl;
                    return mapped;
                }),
                correctOptionId: editCorrectId,
            };

            if (editExplanation.trim()) {
                updatedJson.explanation = editExplanation.trim();
            } else {
                delete (updatedJson as any).explanation;
            }

            if (editExplanationImageUrl) {
                updatedJson.explanationImageUrl = editExplanationImageUrl;
            } else {
                delete (updatedJson as any).explanationImageUrl;
            }

            if (editImageUrl) {
                updatedJson.imageUrl = editImageUrl;
                (updatedJson as any).hasImage = true;
            } else {
                delete (updatedJson as any).imageUrl;
                (updatedJson as any).hasImage = false;
            }

            const updateData: any = {
                optimized_json: updatedJson,
            };

            if (editImageUrl) {
                updateData.image_url = editImageUrl;
            } else {
                // If it's cleared, we also want to remove it from the root document
                updateData.image_url = null;
            }

            // Update figure_training with correction_type
            if (editCorrectionType !== "none" && current.figure_training) {
                const updatedFt: FigureTraining = {
                    ...current.figure_training,
                    correction_type: editCorrectionType,
                };
                if (editCorrectionType === "replaced" && editImageUrl) {
                    updatedFt.human_figure_url = editImageUrl;
                }
                if (editCorrectionType === "removed") {
                    updatedFt.human_figure_url = null;
                    updatedFt.human_crop_bbox = null;
                }
                updateData.figure_training = updatedFt;
            }

            await updateDoc(doc(db, "QuestionBank", docId), updateData);

            setQuestions((prev) =>
                prev.map((q) =>
                    q.id === docId
                        ? { ...q, optimized_json: updatedJson, image_url: editImageUrl || undefined }
                        : q
                )
            );

            setEditingQuestion(false);
        } catch (err) {
            console.error("Error saving question edits:", err);
            alert("Failed to save changes. Please try again.");
        } finally {
            setSavingQuestion(false);
        }
    }

    async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;

        setUploadingImage(true);
        try {
            const current = questions[currentIndex];
            if (!current) return;
            const safeSource = current.source_paper.replace(/[^\w-]/g, "_");
            const qNum = current.optimized_json.questionNumber;
            const ext = file.name.split('.').pop() || 'png';

            const storageRef = ref(storage, `question-images/${safeSource}/q${qNum}_fig_manual_${Date.now()}.${ext}`);
            await uploadBytes(storageRef, file);
            const url = await getDownloadURL(storageRef);
            setEditImageUrl(url);
            setEditCorrectionType("replaced");
        } catch (err) {
            console.error("Error uploading image:", err);
            alert("Failed to upload image. Make sure you have the correct permissions.");
        } finally {
            setUploadingImage(false);
            if (e.target) e.target.value = "";
        }
    }

    async function handleExplanationImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;

        setUploadingExplanationImage(true);
        try {
            const current = questions[currentIndex];
            if (!current) return;
            const safeSource = current.source_paper.replace(/[^\w-]/g, "_");
            const qNum = current.optimized_json.questionNumber;
            const ext = file.name.split('.').pop() || 'png';

            const storageRef = ref(storage, `question-images/${safeSource}/q${qNum}_expl_manual_${Date.now()}.${ext}`);
            await uploadBytes(storageRef, file);
            const url = await getDownloadURL(storageRef);
            setEditExplanationImageUrl(url);
        } catch (err) {
            console.error("Error uploading explanation image:", err);
            alert("Failed to upload explanation image. Make sure you have the correct permissions.");
        } finally {
            setUploadingExplanationImage(false);
            if (e.target) e.target.value = "";
        }
    }

    async function handleExplanationImageDelete() {
        if (!confirm("Are you sure you want to remove this explanation image? You will need to click 'Save Changes' below to apply this permanently.")) return;
        setEditExplanationImageUrl("");
    }

    async function handleOptionImageUpload(e: React.ChangeEvent<HTMLInputElement>, optionIndex: number) {
        const file = e.target.files?.[0];
        if (!file) return;

        const option = editOptions[optionIndex];
        const uploadKey = option.id;
        setUploadingOptionId(uploadKey);

        try {
            const current = questions[currentIndex];
            if (!current) return;

            const safeSource = current.source_paper.replace(/[^\w-]/g, "_");
            const qNum = current.optimized_json.questionNumber;
            const ext = file.name.split('.').pop() || 'png';

            const storageRef = ref(storage, `question-images/${safeSource}/q${qNum}_opt${option.id}_manual_${Date.now()}.${ext}`);
            await uploadBytes(storageRef, file);
            const url = await getDownloadURL(storageRef);

            const updated = [...editOptions];
            updated[optionIndex] = { ...updated[optionIndex], imageUrl: url };
            setEditOptions(updated);
        } catch (err) {
            console.error("Error uploading option image:", err);
            alert("Failed to upload option image.");
        } finally {
            setUploadingOptionId(null);
            if (e.target) e.target.value = "";
        }
    }

    async function handleImageDelete() {
        if (!confirm("Are you sure you want to remove this figure? You will need to click 'Save Changes' below to apply this permanently to the question.")) return;
        setEditImageUrl("");
        setEditCorrectionType("removed");
    }

    async function handleCropApply(result: {
        croppedBlob: Blob;
        bbox: { left: number; top: number; right: number; bottom: number };
    }) {
        setUploadingImage(true);
        try {
            const current = questions[currentIndex];
            if (!current) return;
            const safeSource = current.source_paper.replace(/[^\w-]/g, "_");
            const qNum = current.optimized_json.questionNumber;

            const storageRef = ref(storage, `question-images/${safeSource}/q${qNum}_fig_corrected_${Date.now()}.png`);
            await uploadBytes(storageRef, result.croppedBlob);
            const url = await getDownloadURL(storageRef);
            setEditImageUrl(url);
            setEditCorrectionType("bbox_adjusted");

            // Update figure_training with human correction
            const ft = current.figure_training || {};
            const updatedFt: FigureTraining = {
                ...ft,
                human_crop_bbox: result.bbox,
                human_figure_url: url,
                correction_type: "bbox_adjusted",
            };

            // Save directly to Firestore so we don't lose it
            await updateDoc(doc(db, "QuestionBank", current.id), {
                figure_training: updatedFt,
            });

            setQuestions((prev) =>
                prev.map((q) =>
                    q.id === current.id
                        ? { ...q, figure_training: updatedFt }
                        : q
                )
            );

            setShowCropEditor(false);
        } catch (err) {
            console.error("Error applying crop:", err);
            alert("Failed to apply crop. Please try again.");
        } finally {
            setUploadingImage(false);
        }
    }

    function handleApproveAndNext(docId: string) {
        updateStatus(docId, "approved");
        goNext();
    }

    function handleFlagAndNext(docId: string) {
        updateStatus(docId, "flagged");
        goNext();
    }

    function goNext() {
        setShowAnswer(false);
        setSelectedOption(null);
        setCurrentIndex((i) => Math.min(i + 1, questions.length - 1));
    }

    function goPrev() {
        setShowAnswer(false);
        setSelectedOption(null);
        setCurrentIndex((i) => Math.max(i - 1, 0));
    }

    // Available chapters for the selected subject
    const availableChapters = useMemo(() => {
        if (!selectedSubject) return [];
        const subject = QUIZ_SUBJECTS.find(s => s.id === selectedSubject);
        return subject?.chapters || [];
    }, [selectedSubject]);

    if (loading) {
        return (
            <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-gray-400 text-lg">Loading QuestionBank...</p>
                </div>
            </div>
        );
    }

    if (questions.length === 0) {
        return (
            <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
                <div className="text-center">
                    <p className="text-gray-400 text-xl mb-2">No questions found</p>
                    <p className="text-gray-600">
                        {filter !== "all" ? `No "${filter}" questions. Try "All".` : "Run the ingest pipeline first."}
                    </p>
                </div>
            </div>
        );
    }

    const current = questions[currentIndex];
    const qData = current.optimized_json;

    return (
        <div className="min-h-screen bg-[#0a0a0f] text-white">
            {/* Header */}
            <div className="sticky top-0 z-50 bg-[#0a0a0f]/95 backdrop-blur-xl border-b border-white/5">
                <div className="max-w-4xl mx-auto px-4 py-3">
                    <div className="flex items-center justify-between mb-3">
                        <h1 className="text-lg font-bold bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
                            QuestionBank Review
                        </h1>
                        <div className="flex items-center gap-2 text-xs">
                            <span className="px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                {stats.approved} approved
                            </span>
                            <span className="px-2 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                {stats.flagged} flagged
                            </span>
                            <span className="px-2 py-1 rounded-full bg-gray-500/10 text-gray-400 border border-gray-500/20">
                                {stats.pending} pending
                            </span>
                        </div>
                    </div>

                    {/* Filter tabs */}
                    <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                        <div className="flex gap-1">
                            {(["all", "pending_review", "approved", "flagged"] as const).map(
                                (f) => (
                                    <button
                                        key={f}
                                        onClick={() => setFilter(f)}
                                        className={cn(
                                            "px-3 py-1.5 text-xs rounded-lg transition-all",
                                            filter === f
                                                ? "bg-violet-500/20 text-violet-300 border border-violet-500/30"
                                                : "text-gray-500 hover:text-gray-300 hover:bg-white/5"
                                        )}
                                    >
                                        {f === "pending_review" ? "Pending" : f.charAt(0).toUpperCase() + f.slice(1)}
                                    </button>
                                )
                            )}
                        </div>
                        <div className="hidden sm:block w-px h-6 bg-white/10" />
                        <select
                            value={sourceFilter || ""}
                            onChange={(e) => setSourceFilter(e.target.value)}
                            className="bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-gray-300 focus:border-violet-500/50 focus:outline-none w-full sm:w-auto"
                        >
                            <option value="">All Sources</option>
                            {uniqueSources.map(src => (
                                <option key={src} value={src}>{src}</option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* Progress bar */}
                <div className="h-0.5 bg-white/5">
                    <div
                        className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all duration-300"
                        style={{ width: `${((currentIndex + 1) / questions.length) * 100}%` }}
                    />
                </div>
            </div>

            {/* Main content */}
            <div className="max-w-4xl mx-auto px-4 py-6">
                {/* Question counter + source */}
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <span className="text-sm text-gray-500">
                            {currentIndex + 1} / {questions.length}
                        </span>
                        <span
                            className={cn(
                                "text-xs px-2 py-0.5 rounded-full",
                                current.training_status === "approved"
                                    ? "bg-emerald-500/10 text-emerald-400"
                                    : current.training_status === "flagged"
                                        ? "bg-red-500/10 text-red-400"
                                        : "bg-gray-500/10 text-gray-400"
                            )}
                        >
                            {current.training_status}
                        </span>
                    </div>
                    <span className="text-xs text-gray-600">
                        {current.source_paper} | {current.section_name || "Unknown"}
                    </span>
                </div>

                {/* Chapter badge + Edit buttons */}
                <div className="flex items-center gap-2 mb-4 flex-wrap">
                    {current.chapter_name ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-xs">
                            <span className="font-mono text-[10px] opacity-60">{current.chapter_code}</span>
                            <span className="w-px h-3 bg-cyan-500/20" />
                            {current.chapter_name}
                        </span>
                    ) : (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs">
                            ⚠ No chapter assigned
                        </span>
                    )}
                    <button
                        onClick={() => {
                            setEditingChapter(!editingChapter);
                            if (editingChapter) return;
                            if (current.section_id) setSelectedSubject(current.section_id);
                            if (current.chapter_binary_code) setSelectedChapterCode(current.chapter_binary_code);
                        }}
                        className="px-2 py-1 text-[10px] rounded-md bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 transition-all"
                    >
                        {editingChapter ? "Cancel" : "Edit Chapter"}
                    </button>
                    <button
                        onClick={() => {
                            if (editingQuestion) {
                                setEditingQuestion(false);
                            } else {
                                startEditingQuestion();
                            }
                        }}
                        className="px-2 py-1 text-[10px] rounded-md bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 transition-all"
                    >
                        {editingQuestion ? "Cancel Edit" : "✏️ Edit Question"}
                    </button>
                </div>

                {/* Chapter editor */}
                {editingChapter && (
                    <div className="mb-6 p-4 rounded-xl bg-[#12121a] border border-white/10">
                        <p className="text-xs text-gray-400 mb-3 font-semibold">Assign Chapter</p>
                        <div className="flex flex-col sm:flex-row gap-3">
                            <select
                                value={selectedSubject}
                                onChange={(e) => {
                                    setSelectedSubject(e.target.value);
                                    setSelectedChapterCode("");
                                }}
                                className="flex-1 bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-200 focus:border-violet-500/50 focus:outline-none"
                            >
                                <option value="">Select Subject...</option>
                                {QUIZ_SUBJECTS.map(s => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                            </select>
                            <select
                                value={selectedChapterCode}
                                onChange={(e) => setSelectedChapterCode(e.target.value)}
                                disabled={!selectedSubject}
                                className="flex-[2] bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-200 focus:border-violet-500/50 focus:outline-none disabled:opacity-40"
                            >
                                <option value="">Select Chapter...</option>
                                {availableChapters.map(c => (
                                    <option key={c.binaryCode} value={c.binaryCode}>
                                        {c.name} ({c.binaryCode})
                                    </option>
                                ))}
                            </select>
                            <button
                                onClick={() => updateChapter(current.id, selectedSubject, selectedChapterCode)}
                                disabled={!selectedSubject || !selectedChapterCode || savingChapter}
                                className="px-4 py-2 rounded-lg text-sm font-semibold bg-violet-500/20 text-violet-300 border border-violet-500/30 hover:bg-violet-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition-all whitespace-nowrap"
                            >
                                {savingChapter ? "Saving..." : "Save Chapter"}
                            </button>
                        </div>
                    </div>
                )}

                {/* Question card — EDIT MODE */}
                {editingQuestion ? (
                    <div className="bg-[#12121a] rounded-2xl border border-violet-500/20 p-6 mb-6">
                        <div className="flex items-center gap-2 mb-4">
                            <span className="text-xs font-semibold text-violet-400 bg-violet-500/10 px-2 py-1 rounded-md">EDITING</span>
                            <span className="text-xs text-gray-500">Changes will be saved to Firestore</span>
                        </div>

                        {/* Question text */}
                        <div className="mb-5">
                            <label className="text-xs text-gray-400 font-semibold mb-1.5 block">Question Text</label>
                            <textarea
                                value={editText}
                                onChange={(e) => setEditText(e.target.value)}
                                rows={4}
                                className="w-full bg-[#0a0a0f] border border-white/10 rounded-xl px-4 py-3 text-sm text-gray-200 focus:border-violet-500/50 focus:outline-none resize-y leading-relaxed"
                            />
                        </div>

                        {/* Options */}
                        <div className="space-y-3 mb-5">
                            <label className="text-xs text-gray-400 font-semibold block">Options</label>
                            {editOptions.map((opt, idx) => (
                                <div key={opt.id} className="flex flex-col gap-2 p-3 bg-white/[0.02] border border-white/5 rounded-xl">
                                    <div className="flex items-center gap-3">
                                        <button
                                            onClick={() => setEditCorrectId(opt.id)}
                                            className={cn(
                                                "flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold border transition-all",
                                                editCorrectId === opt.id
                                                    ? "bg-emerald-500/20 border-emerald-500/30 text-emerald-300"
                                                    : "bg-white/5 border-white/10 text-gray-500 hover:border-emerald-500/30 hover:text-emerald-400"
                                            )}
                                            title={editCorrectId === opt.id ? "This is the correct answer" : "Click to set as correct answer"}
                                        >
                                            {opt.id}
                                        </button>
                                        <input
                                            type="text"
                                            value={opt.text}
                                            onChange={(e) => {
                                                const updated = [...editOptions];
                                                updated[idx] = { ...updated[idx], text: e.target.value };
                                                setEditOptions(updated);
                                            }}
                                            placeholder="Option text..."
                                            className="flex-1 bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-200 focus:border-violet-500/50 focus:outline-none"
                                        />
                                        {editCorrectId === opt.id && (
                                            <span className="text-[10px] text-emerald-400 font-semibold">✓ Correct</span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-3 pl-11">
                                        {opt.imageUrl ? (
                                            <div className="flex items-center gap-3 bg-[#0a0a0f] border border-white/10 p-2 rounded-lg flex-1">
                                                <img src={opt.imageUrl} alt={`Option ${opt.id}`} className="max-h-12 object-contain rounded" />
                                                <button
                                                    onClick={() => {
                                                        const updated = [...editOptions];
                                                        delete updated[idx].imageUrl;
                                                        setEditOptions(updated);
                                                    }}
                                                    className="text-[10px] px-2 py-1 bg-red-500/10 text-red-400 rounded hover:bg-red-500/20 ml-auto"
                                                >
                                                    Remove Image
                                                </button>
                                            </div>
                                        ) : (
                                            <label className="inline-flex cursor-pointer px-3 py-1.5 text-[10px] bg-white/5 text-gray-400 rounded hover:bg-white/10 hover:text-gray-200 transition-colors">
                                                {uploadingOptionId === opt.id ? "Uploading..." : "📤 Add Option Image"}
                                                <input
                                                    type="file"
                                                    accept="image/*"
                                                    className="hidden"
                                                    onChange={(e) => handleOptionImageUpload(e, idx)}
                                                    disabled={uploadingOptionId !== null}
                                                />
                                            </label>
                                        )}
                                    </div>
                                </div>
                            ))}
                            <p className="text-[10px] text-gray-600">Click the letter button to set the correct answer.</p>
                        </div>

                        {/* Image Edit */}
                        <div className="mb-5">
                            <label className="text-xs text-gray-400 font-semibold mb-2 block">Question Figure / Image</label>

                            {editImageUrl ? (
                                <div className="p-3 border border-white/10 rounded-xl bg-[#0a0a0f]">
                                    <div className="flex items-start justify-between mb-3">
                                        <div className="flex items-center gap-2">
                                            <div className="text-xs text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded">Image Present</div>
                                            {editCorrectionType !== "none" && (
                                                <div className="text-xs text-amber-400 bg-amber-500/10 px-2 py-1 rounded">
                                                    {editCorrectionType === "bbox_adjusted" ? "✂️ Crop Adjusted" : editCorrectionType === "replaced" ? "🔄 Replaced" : ""}
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {current.figure_training?.source_page_url && (
                                                <button
                                                    onClick={() => setShowCropEditor(true)}
                                                    className="text-xs px-2 py-1 bg-violet-500/10 text-violet-400 rounded hover:bg-violet-500/20 transition-colors"
                                                >
                                                    ✂️ Adjust Crop
                                                </button>
                                            )}
                                            <button
                                                onClick={handleImageDelete}
                                                className="text-xs px-2 py-1 bg-red-500/10 text-red-400 rounded hover:bg-red-500/20 transition-colors"
                                            >
                                                🗑 Remove
                                            </button>
                                        </div>
                                    </div>
                                    <img src={editImageUrl} alt="Question figure edit" className="max-h-48 rounded border border-white/5 object-contain bg-white/5" />
                                </div>
                            ) : (
                                <div className="p-4 border border-dashed border-white/20 rounded-xl bg-[#0a0a0f] text-center">
                                    <div className="mb-2 text-sm text-gray-400">No image attached.</div>
                                    <div className="flex items-center justify-center gap-2">
                                        <label className="inline-block cursor-pointer px-3 py-1.5 text-xs bg-violet-500/20 text-violet-300 rounded hover:bg-violet-500/30 transition-colors">
                                            {uploadingImage ? "Uploading..." : "📁 Upload Figure"}
                                            <input
                                                type="file"
                                                accept="image/*"
                                                className="hidden"
                                                onChange={handleImageUpload}
                                                disabled={uploadingImage}
                                            />
                                        </label>
                                        {current.figure_training?.source_page_url && (
                                            <button
                                                onClick={() => setShowCropEditor(true)}
                                                className="px-3 py-1.5 text-xs bg-cyan-500/20 text-cyan-300 rounded hover:bg-cyan-500/30 transition-colors"
                                            >
                                                ✂️ Crop from Page
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Explanation */}
                        <div className="mb-5">
                            <label className="text-xs text-gray-400 font-semibold mb-1.5 block">Explanation (optional)</label>
                            <textarea
                                value={editExplanation}
                                onChange={(e) => setEditExplanation(e.target.value)}
                                rows={3}
                                placeholder="Add or edit the explanation text..."
                                className="w-full bg-[#0a0a0f] border border-white/10 rounded-xl px-4 py-3 text-sm text-gray-200 focus:border-violet-500/50 focus:outline-none resize-y leading-relaxed placeholder:text-gray-700 mb-3"
                            />

                            <label className="text-xs text-gray-400 font-semibold mb-2 block">Explanation Image</label>
                            {editExplanationImageUrl ? (
                                <div className="p-3 border border-white/10 rounded-xl bg-[#0a0a0f]">
                                    <div className="flex items-start justify-between mb-3">
                                        <div className="text-xs text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded">Image Present</div>
                                        <button
                                            onClick={handleExplanationImageDelete}
                                            className="text-xs px-2 py-1 bg-red-500/10 text-red-400 rounded hover:bg-red-500/20 transition-colors"
                                        >
                                            🗑 Remove
                                        </button>
                                    </div>
                                    <img src={editExplanationImageUrl} alt="Explanation figure edit" className="max-h-48 rounded border border-white/5 object-contain bg-white/5" />
                                </div>
                            ) : (
                                <div className="p-4 border border-dashed border-white/20 rounded-xl bg-[#0a0a0f] text-center">
                                    <div className="mb-2 text-sm text-gray-400">No image attached.</div>
                                    <div className="flex items-center justify-center gap-2">
                                        <label className="inline-block cursor-pointer px-3 py-1.5 text-xs bg-violet-500/20 text-violet-300 rounded hover:bg-violet-500/30 transition-colors">
                                            {uploadingExplanationImage ? "Uploading..." : "📁 Upload Explanation Image"}
                                            <input
                                                type="file"
                                                accept="image/*"
                                                className="hidden"
                                                onChange={handleExplanationImageUpload}
                                                disabled={uploadingExplanationImage}
                                            />
                                        </label>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Save / Cancel */}
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => setEditingQuestion(false)}
                                className="px-4 py-2 rounded-lg text-sm bg-white/5 text-gray-400 hover:bg-white/10 transition-all"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => saveQuestionEdits(current.id)}
                                disabled={savingQuestion || !editText.trim()}
                                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold bg-violet-500/20 text-violet-300 border border-violet-500/30 hover:bg-violet-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                            >
                                {savingQuestion ? "Saving..." : "💾 Save Changes"}
                            </button>
                        </div>
                    </div>
                ) : (
                    /* Question card — VIEW MODE */
                    <div className="bg-[#12121a] rounded-2xl border border-white/5 p-6 mb-6">
                        <div className="flex items-start gap-3 mb-5">
                            <span className="flex-shrink-0 w-8 h-8 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-sm font-bold text-violet-400">
                                {qData.questionNumber}
                            </span>
                            <div className="text-gray-200 text-base leading-relaxed pt-1 w-full overflow-hidden">
                                <MathText content={qData.text} />
                            </div>
                        </div>

                        {qData.imageUrl && (
                            <div className="mb-5 rounded-xl overflow-hidden border border-white/5">
                                <img src={qData.imageUrl} alt="Question" className="w-full" />
                            </div>
                        )}

                        {/* Options */}
                        <div className="space-y-3">
                            {qData.options.map((opt) => {
                                const isCorrect = opt.id === qData.correctOptionId;
                                const isSelected = selectedOption === opt.id;
                                const reveal = showAnswer;

                                return (
                                    <button
                                        key={opt.id}
                                        onClick={() => {
                                            setSelectedOption(opt.id);
                                            setShowAnswer(true);
                                        }}
                                        className={cn(
                                            "w-full flex items-center gap-3 p-4 rounded-xl border transition-all text-left",
                                            reveal && isCorrect
                                                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                                                : reveal && isSelected && !isCorrect
                                                    ? "bg-red-500/10 border-red-500/30 text-red-300"
                                                    : isSelected
                                                        ? "bg-violet-500/10 border-violet-500/30 text-violet-300"
                                                        : "bg-white/[0.02] border-white/5 text-gray-400 hover:border-white/10 hover:bg-white/[0.04]"
                                        )}
                                    >
                                        <span
                                            className={cn(
                                                "flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold",
                                                reveal && isCorrect
                                                    ? "bg-emerald-500/20 text-emerald-300"
                                                    : reveal && isSelected && !isCorrect
                                                        ? "bg-red-500/20 text-red-300"
                                                        : "bg-white/5 text-gray-500"
                                            )}
                                        >
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
                                    </button>
                                );
                            })}
                        </div>

                        {/* Explanation */}
                        {showAnswer && (qData.explanation || qData.explanationImageUrl) && (
                            <div className="mt-5 p-4 rounded-xl bg-blue-500/5 border border-blue-500/10">
                                <p className="text-xs text-blue-400 font-semibold mb-2">Explanation</p>
                                {qData.explanation && (
                                    <div className="text-sm text-gray-400 leading-relaxed overflow-hidden">
                                        <MathText content={qData.explanation} />
                                    </div>
                                )}
                                {qData.explanationImageUrl && (
                                    <div className="mt-3">
                                        <img src={qData.explanationImageUrl} alt="Explanation Visual" className="max-h-48 rounded border border-white/5 object-contain bg-[#0a0a0f]" />
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Correct answer badge */}
                        {showAnswer && (
                            <div className="mt-4 flex items-center gap-2">
                                <span className="text-xs text-gray-500">Correct Answer:</span>
                                <span className="text-sm font-bold text-emerald-400">
                                    {qData.correctOptionId}
                                </span>
                            </div>
                        )}
                    </div>
                )}

                {/* Action buttons */}
                <div className="flex items-center gap-3">
                    <button
                        onClick={goPrev}
                        disabled={currentIndex === 0}
                        className="px-4 py-2.5 rounded-xl text-sm bg-white/5 text-gray-400 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                    >
                        Prev
                    </button>

                    <button
                        onClick={() => handleApproveAndNext(current.id)}
                        className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all"
                    >
                        Approve + Next
                    </button>

                    <button
                        onClick={() => handleFlagAndNext(current.id)}
                        className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-all"
                    >
                        Flag + Next
                    </button>

                    <button
                        onClick={goNext}
                        disabled={currentIndex === questions.length - 1}
                        className="px-4 py-2.5 rounded-xl text-sm bg-white/5 text-gray-400 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                    >
                        Next
                    </button>
                </div>

                {/* Hint */}
                <p className="text-center text-xs text-gray-600 mt-4">
                    Click any option to reveal the answer. Use &quot;✏️ Edit Question&quot; to fix errors in text, options, or correct answer.
                </p>
            </div>

            {/* Crop Editor Modal */}
            {showCropEditor && current?.figure_training?.source_page_url && (
                <FigureCropEditor
                    sourcePageUrl={current.figure_training.source_page_url}
                    currentBbox={current.figure_training.human_crop_bbox || current.figure_training.ai_crop_bbox}
                    pageWidth={current.figure_training.page_width}
                    pageHeight={current.figure_training.page_height}
                    onApply={handleCropApply}
                    onCancel={() => setShowCropEditor(false)}
                />
            )}
        </div>
    );
}
