"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { Loader2, Rocket, CheckCircle, Send, Layers, Upload, FileText, XCircle, ChevronRight, Hash, Percent, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { QUIZ_SUBJECTS } from "@/lib/quiz-data";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useRouter } from "next/navigation";
import { doc, collection, writeBatch, serverTimestamp, query, where, getDocs, addDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface SelectedChapter {
    sectionId: string;
    sectionName: string;
    binaryCode: string;
    chapterName: string;
    chapterCode: string; // e.g. "#2P0-010110"
}

export default function CustomQuizPage() {
    const { user } = useAuth();
    const router = useRouter();
    const { toast } = useToast();

    // Quiz settings
    const [title, setTitle] = useState("");
    const [questionCount, setQuestionCount] = useState(20);
    const [duration, setDuration] = useState(60);
    const [positiveMarks, setPositiveMarks] = useState(4);
    const [negativeMarks, setNegativeMarks] = useState(1);

    // Chapter selection
    const [selectedChapters, setSelectedChapters] = useState<SelectedChapter[]>([]);

    // Source filtering
    const [availableSources, setAvailableSources] = useState<string[]>([]);
    const [selectedSources, setSelectedSources] = useState<string[]>([]);
    const [loadingSources, setLoadingSources] = useState(true);

    // Per-source distribution
    const [distributionMode, setDistributionMode] = useState<'count' | 'percentage'>('count');
    const [sourceAllocations, setSourceAllocations] = useState<Record<string, number>>({});

    // Per-source available question counts
    const [sourceQuestionCounts, setSourceQuestionCounts] = useState<Record<string, number>>({});
    const [loadingCounts, setLoadingCounts] = useState(false);

    // Per-chapter distribution inside source
    const [sourceChapterAllocations, setSourceChapterAllocations] = useState<Record<string, Record<string, number>>>({});
    const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());
    const [sourceChapterCounts, setSourceChapterCounts] = useState<Record<string, Record<string, { name: string, count: number, code: string }>>>({});

    useEffect(() => {
        if (!user || selectedSources.length === 0) {
            setSourceQuestionCounts({});
            return;
        }
        let cancelled = false;
        async function fetchCounts() {
            setLoadingCounts(true);
            try {
                const qRef = collection(db, "QuestionBank");
                const chapterCodes = selectedChapters.map(c => c.chapterCode);

                let snap;
                if (chapterCodes.length > 0 && chapterCodes.length <= 30) {
                    snap = await getDocs(query(qRef, where("chapter_code", "in", chapterCodes), where("training_status", "==", "approved")));
                } else {
                    snap = await getDocs(query(qRef, where("training_status", "==", "approved")));
                }

                if (cancelled) return;
                const counts: Record<string, number> = {};
                const chapterCounts: Record<string, Record<string, { name: string, count: number, code: string }>> = {};
                for (const src of selectedSources) {
                    counts[src] = 0;
                    chapterCounts[src] = {};
                }
                snap.docs.forEach(d => {
                    const src = d.data().source_paper;
                    const cCode = d.data().chapter_code;
                    const cName = d.data().chapter_name || 'Unknown Chapter';
                    if (src && selectedSources.includes(src)) {
                        counts[src] = (counts[src] || 0) + 1;
                        if (cCode) {
                            if (!chapterCounts[src][cCode]) {
                                chapterCounts[src][cCode] = { name: cName, count: 0, code: cCode };
                            }
                            chapterCounts[src][cCode].count += 1;
                        }
                    }
                });
                setSourceQuestionCounts(counts);
                setSourceChapterCounts(chapterCounts);
            } catch (e) {
                console.error("Failed to fetch source counts", e);
            } finally {
                if (!cancelled) setLoadingCounts(false);
            }
        }
        fetchCounts();
        return () => { cancelled = true; };
    }, [user, selectedSources, selectedChapters]);

    useEffect(() => {
        if (!user) return;
        async function fetchSources() {
            setLoadingSources(true);
            try {
                const snap = await getDocs(query(collection(db, "QuestionBank"), where("training_status", "==", "approved")));
                const sources = new Set<string>();
                snap.docs.forEach(d => {
                    const src = d.data().source_paper;
                    if (src) sources.add(src);
                });
                setAvailableSources(Array.from(sources).sort());
            } catch (e) {
                console.error("Failed to fetch sources", e);
            } finally {
                setLoadingSources(false);
            }
        }
        fetchSources();
    }, [user]);

    const toggleSource = (source: string) => {
        setSelectedSources(prev => {
            if (prev.includes(source)) {
                const next = prev.filter(s => s !== source);
                setSourceAllocations(a => {
                    const copy = { ...a };
                    delete copy[source];
                    return copy;
                });
                setSourceChapterAllocations(a => {
                    const copy = { ...a };
                    delete copy[source];
                    return copy;
                });
                return next;
            }
            return [...prev, source];
        });
    };

    const updateAllocation = (source: string, value: number) => {
        setSourceAllocations(prev => ({ ...prev, [source]: value }));
    };

    const updateChapterAllocation = (source: string, chapterCode: string, value: number) => {
        setSourceChapterAllocations(prev => {
            const currentSourceAlloc = prev[source] || {};
            return {
                ...prev,
                [source]: { ...currentSourceAlloc, [chapterCode]: value }
            };
        });
    };

    const toggleExpandedSource = (source: string) => {
        setExpandedSources(prev => {
            const next = new Set(prev);
            if (next.has(source)) next.delete(source);
            else next.add(source);
            return next;
        });
    };

    const allocationTotal = useMemo(() => {
        return selectedSources.reduce((sum, s) => sum + (sourceAllocations[s] || 0), 0);
    }, [selectedSources, sourceAllocations]);

    const expectedTotal = distributionMode === 'percentage' ? 100 : questionCount;
    const allocationValid = selectedSources.length === 0 || allocationTotal === expectedTotal;

    const distributeEvenly = useCallback(() => {
        if (selectedSources.length === 0) return;
        if (distributionMode === 'percentage') {
            const each = Math.floor(100 / selectedSources.length);
            const remainder = 100 - each * selectedSources.length;
            const alloc: Record<string, number> = {};
            selectedSources.forEach((s, i) => { alloc[s] = each + (i === 0 ? remainder : 0); });
            setSourceAllocations(alloc);
        } else {
            const each = Math.floor(questionCount / selectedSources.length);
            const remainder = questionCount - each * selectedSources.length;
            const alloc: Record<string, number> = {};
            selectedSources.forEach((s, i) => { alloc[s] = each + (i === 0 ? remainder : 0); });
            setSourceAllocations(alloc);
        }
    }, [selectedSources, distributionMode, questionCount]);

    // UI state
    const [isGenerating, setIsGenerating] = useState(false);
    const [quizId, setQuizId] = useState<string | null>(null);
    const [generatedCount, setGeneratedCount] = useState(0);
    const [showSuccessModal, setShowSuccessModal] = useState(false);
    const [showDeployModal, setShowDeployModal] = useState(false);
    const [deployStudentIds, setDeployStudentIds] = useState("");
    const [isDeploying, setIsDeploying] = useState(false);

    // Expand/collapse subjects
    const [expandedSubjects, setExpandedSubjects] = useState<Set<string>>(new Set());

    // PDF Upload inline
    const [showUpload, setShowUpload] = useState(false);
    const [uploadFile, setUploadFile] = useState<File | null>(null);
    const [uploadSource, setUploadSource] = useState("");
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState({ percent: 0, text: "" });
    const [uploadResult, setUploadResult] = useState<{ success: boolean; count: number } | null>(null);
    const uploadRef = useRef<HTMLInputElement>(null);

    const toggleSubject = (subjectId: string) => {
        setExpandedSubjects(prev => {
            const next = new Set(prev);
            if (next.has(subjectId)) next.delete(subjectId);
            else next.add(subjectId);
            return next;
        });
    };

    const isChapterSelected = (sectionId: string, binaryCode: string) => {
        return selectedChapters.some(
            c => c.sectionId === sectionId && c.binaryCode === binaryCode
        );
    };

    const toggleChapter = (
        sectionId: string,
        sectionName: string,
        binaryCode: string,
        chapterName: string
    ) => {
        setSelectedChapters(prev => {
            const exists = prev.find(
                c => c.sectionId === sectionId && c.binaryCode === binaryCode
            );
            if (exists) {
                return prev.filter(
                    c => !(c.sectionId === sectionId && c.binaryCode === binaryCode)
                );
            }
            return [
                ...prev,
                {
                    sectionId,
                    sectionName,
                    binaryCode,
                    chapterName,
                    chapterCode: `#${sectionId}-${binaryCode}`,
                },
            ];
        });
    };

    const selectAllChapters = (subjectId: string) => {
        const subject = QUIZ_SUBJECTS.find(s => s.id === subjectId);
        if (!subject) return;

        const allSelected = subject.chapters.every(c =>
            isChapterSelected(subjectId, c.binaryCode)
        );

        if (allSelected) {
            // Deselect all chapters of this subject
            setSelectedChapters(prev =>
                prev.filter(c => c.sectionId !== subjectId)
            );
        } else {
            // Select all chapters of this subject
            const newChapters = subject.chapters
                .filter(c => !isChapterSelected(subjectId, c.binaryCode))
                .map(c => ({
                    sectionId: subjectId,
                    sectionName: subject.name,
                    binaryCode: c.binaryCode,
                    chapterName: c.name,
                    chapterCode: `#${subjectId}-${c.binaryCode}`,
                }));
            setSelectedChapters(prev => [...prev, ...newChapters]);
        }
    };

    // Group selected chapters by subject for display
    const selectedBySubject = useMemo(() => {
        const grouped: Record<string, SelectedChapter[]> = {};
        for (const ch of selectedChapters) {
            if (!grouped[ch.sectionName]) grouped[ch.sectionName] = [];
            grouped[ch.sectionName].push(ch);
        }
        return grouped;
    }, [selectedChapters]);

    const handleGenerate = async () => {
        if (!title.trim()) {
            toast({ variant: "destructive", title: "Missing Title", description: "Please give your quiz a title." });
            return;
        }
        if (selectedChapters.length === 0) {
            toast({ variant: "destructive", title: "No Chapters Selected", description: "Select at least one chapter." });
            return;
        }
        if (!user) {
            toast({ variant: "destructive", title: "Not Logged In", description: "Please log in to create a quiz." });
            return;
        }

        setIsGenerating(true);
        try {
            const chapterCodes = selectedChapters.map(c => c.chapterCode);

            // Query approved questions matching selected chapter codes
            // Firestore 'in' supports max 30 values
            const qRef = collection(db, "QuestionBank");
            const snapshot = await getDocs(
                query(qRef, where("chapter_code", "in", chapterCodes), where("training_status", "==", "approved"))
            );

            let allQuestions = snapshot.docs.map(d => ({ ...d.data(), _docId: d.id }));

            if (selectedSources.length > 0) {
                allQuestions = allQuestions.filter(q => selectedSources.includes((q as any).source_paper));
            }

            // If no approved questions with chapter_code, try all approved questions
            if (allQuestions.length === 0) {
                const fallbackSnap = await getDocs(
                    query(qRef, where("training_status", "==", "approved"))
                );
                allQuestions = fallbackSnap.docs.map(d => ({ ...d.data(), _docId: d.id }));

                if (selectedSources.length > 0) {
                    allQuestions = allQuestions.filter(q => selectedSources.includes((q as any).source_paper));
                }

                if (allQuestions.length === 0) {
                    // Last resort: get ALL questions regardless of status
                    const allSnap = await getDocs(qRef);
                    allQuestions = allSnap.docs.map(d => ({ ...d.data(), _docId: d.id }));

                    if (selectedSources.length > 0) {
                        allQuestions = allQuestions.filter(q => selectedSources.includes((q as any).source_paper));
                    }
                }
            }

            if (allQuestions.length === 0) {
                throw new Error("No questions found in the QuestionBank. Upload and parse a PDF first.");
            }

            // Shuffle and pick — with per-source distribution if configured
            let selected: any[];

            const hasDistribution = selectedSources.length > 0 && Object.keys(sourceAllocations).length > 0 && allocationTotal > 0;

            if (hasDistribution) {
                // Group questions by source
                const bySource: Record<string, any[]> = {};
                for (const q of allQuestions) {
                    const src = (q as any).source_paper || '__unknown__';
                    if (!bySource[src]) bySource[src] = [];
                    bySource[src].push(q);
                }

                // Shuffle each source pool independently
                for (const src of Object.keys(bySource)) {
                    bySource[src].sort(() => Math.random() - 0.5);
                }

                // Compute target count per source
                const targets: { source: string; target: number }[] = [];
                for (const src of selectedSources) {
                    const val = sourceAllocations[src] || 0;
                    const target = distributionMode === 'percentage'
                        ? Math.round(questionCount * val / 100)
                        : val;
                    targets.push({ source: src, target });
                }

                // Pick from each source, track deficit
                selected = [];
                let deficit = 0;
                const remainingPools: any[][] = [];

                for (const { source, target } of targets) {
                    const pool = bySource[source] || [];
                    const pickedForSource: any[] = [];

                    // First pick from specific chapter allocations for this source
                    const chAlloc = sourceChapterAllocations[source] || {};
                    const byChapter: Record<string, any[]> = {};
                    const unallocatedPool: any[] = [];

                    for (const q of pool) {
                        const code = (q as any).chapter_code || '__unknown__';
                        if (!byChapter[code]) byChapter[code] = [];
                        byChapter[code].push(q);
                    }

                    for (const chCode of Object.keys(byChapter)) {
                        const chPool = byChapter[chCode];
                        const count = chAlloc[chCode] || 0;
                        chPool.sort(() => Math.random() - 0.5);

                        if (count > 0) {
                            pickedForSource.push(...chPool.slice(0, count));
                            unallocatedPool.push(...chPool.slice(count));
                        } else {
                            unallocatedPool.push(...chPool);
                        }
                    }

                    // Then pick remaining target count from the rest of the pool
                    const remainingTarget = Math.max(0, target - pickedForSource.length);
                    unallocatedPool.sort(() => Math.random() - 0.5);
                    const remainingPicked = unallocatedPool.slice(0, remainingTarget);
                    pickedForSource.push(...remainingPicked);

                    selected.push(...pickedForSource);

                    if (pickedForSource.length < target) {
                        deficit += target - pickedForSource.length;
                    } else if (unallocatedPool.length > remainingTarget) {
                        remainingPools.push(unallocatedPool.slice(remainingTarget));
                    }
                }

                // Redistribute deficit from remaining pools
                if (deficit > 0) {
                    const extraPool = remainingPools.flat().sort(() => Math.random() - 0.5);
                    selected.push(...extraPool.slice(0, deficit));
                }

                // Final shuffle to mix sources together
                selected.sort(() => Math.random() - 0.5);
            } else {
                // Original behavior: global shuffle and pick
                const shuffled = allQuestions.sort(() => Math.random() - 0.5);
                selected = shuffled.slice(0, Math.min(questionCount, shuffled.length));
            }

            // Build quiz structure grouped by section -> chapter
            const sectionMap = new Map<string, { id: string; name: string; chapters: Map<string, { name: string; binaryCode: string; questions: any[] }> }>();

            for (const q of selected) {
                const sectionId = (q as any).section_id || 'GEN';
                const sectionName = (q as any).section_name || 'General';
                const chapterBinary = (q as any).chapter_binary_code || '000000';
                const chapterName = (q as any).chapter_name || 'Unknown Chapter';

                if (!sectionMap.has(sectionId)) {
                    const subjectData = QUIZ_SUBJECTS.find(s => s.id === sectionId);
                    sectionMap.set(sectionId, { id: sectionId, name: subjectData?.name || sectionName, chapters: new Map() });
                }

                const section = sectionMap.get(sectionId)!;
                const chapterKey = `${sectionId}-${chapterBinary}`;

                if (!section.chapters.has(chapterKey)) {
                    const subjectData = QUIZ_SUBJECTS.find(s => s.id === sectionId);
                    const chapterData = subjectData?.chapters.find(c => c.binaryCode === chapterBinary);
                    section.chapters.set(chapterKey, { name: chapterData?.name || chapterName, binaryCode: chapterBinary, questions: [] });
                }

                const chapter = section.chapters.get(chapterKey)!;
                const optimized = (q as any).optimized_json;
                if (optimized) {
                    const qData: any = {
                        questionNumber: optimized.questionNumber || 0,
                        text: optimized.text || '',
                        options: optimized.options || [],
                        correctOptionId: optimized.correctOptionId || 'A',
                    };
                    if (optimized.explanation) qData.explanation = optimized.explanation;
                    if (optimized.imageUrl) qData.imageUrl = optimized.imageUrl;
                    chapter.questions.push(qData);
                }
            }

            // Convert to quiz structure array
            const structure = Array.from(sectionMap.values()).map(section => ({
                id: section.id,
                name: section.name,
                chapters: Array.from(section.chapters.values()).map(ch => ({
                    name: ch.name,
                    binaryCode: ch.binaryCode,
                    questions: ch.questions.sort((a, b) => a.questionNumber - b.questionNumber),
                })),
            }));

            // Renumber questions sequentially
            let globalNum = 1;
            for (const section of structure) {
                for (const chapter of section.chapters) {
                    for (const q of chapter.questions) {
                        q.questionNumber = globalNum++;
                    }
                }
            }

            const totalQuestions = globalNum - 1;

            if (totalQuestions === 0) {
                throw new Error("No valid questions could be built from the selected chapters. Ensure questions have optimized_json data.");
            }

            // Save quiz to Firestore
            const quizPayload = {
                title,
                settings: {
                    duration: duration || 60,
                    positiveMarks: positiveMarks || 4,
                    negativeMarks: negativeMarks > 0 ? -negativeMarks : negativeMarks,
                },
                structure,
                isPublished: false,
                createdAt: serverTimestamp(),
                ownerId: user.studentId,
                source: 'custom_quiz_builder',
                chapterCodes,
            };

            const docRef = await addDoc(collection(db, "quizzes"), quizPayload);
            await updateDoc(docRef, { id: docRef.id });

            setQuizId(docRef.id);
            setGeneratedCount(totalQuestions);
            setShowSuccessModal(true);

            toast({
                title: "Quiz Generated!",
                description: `Created quiz with ${totalQuestions} questions from ${selectedChapters.length} chapters.`,
            });
        } catch (error: any) {
            console.error("Generation error:", error);
            toast({
                variant: "destructive",
                title: "Generation Failed",
                description: error.message,
            });
        } finally {
            setIsGenerating(false);
        }
    };

    const handleStartQuiz = () => {
        if (quizId) window.location.assign(`/quiz/${quizId}`);
    };

    const handleDeploy = async () => {
        if (!quizId || !user || !deployStudentIds.trim()) {
            toast({ variant: "destructive", title: "Missing Info", description: "Quiz ID or student IDs are missing." });
            return;
        }
        setIsDeploying(true);
        try {
            const studentIds = deployStudentIds.split(",").map(id => id.trim().toLowerCase()).filter(id => id);
            const batch = writeBatch(db);

            const quizRef = doc(db, "quizzes", quizId);
            batch.update(quizRef, { isPublished: true });

            for (const studentId of studentIds) {
                const assignmentRef = doc(collection(db, "assigned_quizzes"));
                batch.set(assignmentRef, {
                    quizId,
                    quizTitle: title,
                    studentId,
                    assignedAt: serverTimestamp(),
                    status: "pending",
                    creatorId: user.studentId,
                });
            }

            await batch.commit();

            // Fire-and-forget push notifications
            try {
                await fetch("/api/notifications/send", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        quizId,
                        quizTitle: title,
                        studentIds,
                        adminId: user.studentId,
                    }),
                });
            } catch { }

            toast({ title: "Deployed!", description: `${studentIds.length} students assigned.` });
            setShowDeployModal(false);
            setShowSuccessModal(false);
            router.push("/dashboard/admin");
        } catch (error: any) {
            toast({ variant: "destructive", title: "Deploy Failed", description: error.message });
        } finally {
            setIsDeploying(false);
        }
    };

    const handleUploadPdf = async () => {
        if (!uploadFile || !uploadSource.trim()) {
            toast({ variant: "destructive", title: "Select a PDF and enter a source name" });
            return;
        }
        setIsUploading(true);
        setUploadResult(null);
        setUploadProgress({ percent: 0, text: "Starting pipeline..." });

        try {
            const formData = new FormData();
            formData.append("pdf", uploadFile);
            formData.append("source", uploadSource.trim());
            formData.append("dryRun", "false");
            formData.append("noImages", "false");

            const res = await fetch("/api/ingest", { method: "POST", body: formData });
            if (!res.body) throw new Error("No response body");

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let isDone = false;
            let currentPercent = 0;

            while (!isDone) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split("\n\n");

                for (const line of lines) {
                    if (line.startsWith("data: ")) {
                        try {
                            const data = JSON.parse(line.slice(6));

                            if (data.type === "log" && data.text) {
                                const logText = data.text;
                                let newText = uploadProgress.text;

                                if (logText.includes("Extracting text from page")) {
                                    const match = logText.match(/page (\d+)\/(\d+)/);
                                    if (match) {
                                        currentPercent = (parseInt(match[1]) / parseInt(match[2])) * 20;
                                        newText = `Extracting Text: Page ${match[1]} of ${match[2]}`;
                                    }
                                } else if (logText.includes("[OCR] Extracting text from page")) {
                                    const match = logText.match(/page (\d+)\/(\d+)/);
                                    if (match) {
                                        currentPercent = (parseInt(match[1]) / parseInt(match[2])) * 20;
                                        newText = `OCR: Page ${match[1]} of ${match[2]}`;
                                    }
                                } else if (logText.includes("[AUTO-DETECT]") || logText.includes("[OCR] Initializing")) {
                                    currentPercent = 5;
                                    newText = "Scanned PDF detected...";
                                } else if (logText.includes("[VISION] Parsing page")) {
                                    const match = logText.match(/page (\d+)\/(\d+)/);
                                    if (match) {
                                        currentPercent = 20 + (parseInt(match[1]) / parseInt(match[2])) * 50;
                                        newText = `Vision: Page ${match[1]} of ${match[2]}`;
                                    }
                                } else if (logText.includes("[SCANNED PDF]")) {
                                    currentPercent = 8;
                                    newText = "Scanned PDF - Vision parsing...";
                                } else if (logText.includes("Sending batch")) {
                                    const match = logText.match(/batch (\d+)\/(\d+)/);
                                    if (match) {
                                        currentPercent = 20 + (parseInt(match[1]) / parseInt(match[2])) * 40;
                                        newText = `AI Parsing: Batch ${match[1]} of ${match[2]}`;
                                    }
                                } else if (logText.includes("Extracting images from page")) {
                                    const match = logText.match(/page (\d+)\/(\d+)/);
                                    if (match) {
                                        currentPercent = 60 + (parseInt(match[1]) / parseInt(match[2])) * 20;
                                        newText = `Extracting Images: Page ${match[1]} of ${match[2]}`;
                                    }
                                } else if (logText.includes("Classifying")) {
                                    currentPercent = 85;
                                    newText = "AI Chapter Classification...";
                                } else if (logText.includes("Pushed") || logText.includes("Pushing")) {
                                    currentPercent = 95;
                                    newText = "Saving to Database...";
                                }

                                setUploadProgress({ percent: currentPercent, text: newText });
                            } else if (data.type === "done") {
                                isDone = true;
                                setUploadProgress({ percent: 100, text: "Finished!" });

                                if (data.success) {
                                    setUploadResult({ success: true, count: data.metrics?.questionsParsed || 0 });
                                    toast({ title: `✅ Parsed ${data.metrics?.questionsParsed || 0} questions and pushed to QuestionBank!` });
                                } else {
                                    setUploadResult({ success: false, count: data.metrics?.questionsParsed || 0 });
                                    toast({ variant: "destructive", title: "Upload completed with issues", description: "Check logs in Upload PDF page" });
                                }
                            } else if (data.type === "error") {
                                throw new Error(data.message);
                            }
                        } catch (e) {
                            // Parse error on incomplete chunk, ignore
                        }
                    }
                }
            }
        } catch (err: any) {
            toast({ variant: "destructive", title: "Upload failed", description: err.message });
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <div className="p-4 md:p-8 relative min-h-screen">
            <header className="mb-8">
                <div className="flex items-center gap-3 mb-1">
                    <Layers className="h-7 w-7 text-primary" />
                    <h1 className="text-3xl font-bold tracking-tight">Custom Quiz Builder</h1>
                </div>
                <p className="text-muted-foreground">
                    Build a quiz from your QuestionBank by selecting specific chapters across any subject.
                </p>
            </header>

            <div className="space-y-8 max-w-5xl mx-auto pb-32">
                {/* Quick Upload Section */}
                {user?.role === 'admin' && (
                    <Card className="shadow-sm border-dashed border-2">
                        <CardHeader
                            className="cursor-pointer"
                            onClick={() => setShowUpload(!showUpload)}
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Upload className="h-5 w-5 text-primary" />
                                    <CardTitle className="text-base">Quick Upload PDF</CardTitle>
                                </div>
                                <span className="text-xs text-muted-foreground">
                                    {showUpload ? "▲ Hide" : "▼ Upload a new paper and parse questions directly"}
                                </span>
                            </div>
                        </CardHeader>
                        {showUpload && (
                            <CardContent className="space-y-3">
                                <div
                                    onClick={() => !isUploading && uploadRef.current?.click()}
                                    className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${uploadFile ? "border-emerald-300 bg-emerald-50/50" : "border-slate-300 hover:border-primary/50"
                                        } ${isUploading ? "pointer-events-none opacity-60" : ""}`}
                                >
                                    <input
                                        ref={uploadRef}
                                        type="file"
                                        accept=".pdf"
                                        className="hidden"
                                        onChange={(e) => {
                                            const f = e.target.files?.[0];
                                            if (f) {
                                                setUploadFile(f);
                                                if (!uploadSource) setUploadSource(f.name.replace(".pdf", ""));
                                            }
                                        }}
                                    />
                                    {uploadFile ? (
                                        <div className="flex items-center justify-center gap-3">
                                            <FileText className="h-6 w-6 text-emerald-600" />
                                            <div className="text-left">
                                                <p className="font-medium text-sm text-slate-800">{uploadFile.name}</p>
                                                <p className="text-xs text-slate-500">{(uploadFile.size / 1024 / 1024).toFixed(2)} MB</p>
                                            </div>
                                            {!isUploading && (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setUploadFile(null); setUploadSource(""); setUploadResult(null); }}
                                                    className="text-slate-400 hover:text-red-500"
                                                >
                                                    <XCircle className="h-5 w-5" />
                                                </button>
                                            )}
                                        </div>
                                    ) : (
                                        <>
                                            <Upload className="h-8 w-8 mx-auto text-slate-400 mb-2" />
                                            <p className="text-sm text-slate-500">Drop PDF here or click to browse</p>
                                        </>
                                    )}
                                </div>

                                {isUploading && (
                                    <div className="space-y-2 mt-4">
                                        <div className="flex justify-between text-xs text-slate-500 font-medium">
                                            <span className="flex items-center gap-1">
                                                <Loader2 className="h-3 w-3 animate-spin" />
                                                {uploadProgress.text}
                                            </span>
                                            <span>{Math.round(uploadProgress.percent)}%</span>
                                        </div>
                                        <Progress value={uploadProgress.percent} className="h-2" />
                                    </div>
                                )}

                                {uploadFile && !isUploading && (
                                    <div className="flex gap-3 items-end">
                                        <div className="flex-1">
                                            <Label className="text-xs">Source Name</Label>
                                            <Input
                                                value={uploadSource}
                                                onChange={(e) => setUploadSource(e.target.value)}
                                                placeholder="e.g. NEET 2024"
                                                disabled={isUploading}
                                                className="rounded-lg h-9"
                                            />
                                        </div>
                                        <Button
                                            onClick={handleUploadPdf}
                                            disabled={isUploading || !uploadSource.trim()}
                                            className="rounded-lg h-9"
                                        >
                                            {isUploading ? (
                                                <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Parsing...</>
                                            ) : (
                                                <><Upload className="h-4 w-4 mr-1" /> Upload & Parse</>
                                            )}
                                        </Button>
                                    </div>
                                )}

                                {uploadResult && (
                                    <div className={`rounded-lg p-3 text-sm flex items-center gap-2 ${uploadResult.success ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                                        }`}>
                                        <CheckCircle className="h-4 w-4 shrink-0" />
                                        <span>
                                            {uploadResult.success
                                                ? `${uploadResult.count} questions parsed and pushed to QuestionBank! You can now select chapters below.`
                                                : `${uploadResult.count} questions parsed with some issues. Check the Upload PDF page for details.`
                                            }
                                        </span>
                                    </div>
                                )}
                            </CardContent>
                        )}
                    </Card>
                )}

                {/* Step 1: Quiz Settings */}
                <Card className="shadow-sm">
                    <CardHeader>
                        <CardTitle>1. Quiz Settings</CardTitle>
                        <CardDescription>Configure the basic properties.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div>
                            <Label htmlFor="custom-title">Quiz Title</Label>
                            <Input
                                id="custom-title"
                                placeholder="e.g., Custom Practice — Alternating Current + Plant Growth"
                                value={title}
                                onChange={e => setTitle(e.target.value)}
                                className="text-lg"
                            />
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                            <div>
                                <Label htmlFor="q-count">Question Count</Label>
                                <Input
                                    id="q-count"
                                    type="number"
                                    min={1}
                                    max={200}
                                    value={questionCount}
                                    onChange={e => setQuestionCount(parseInt(e.target.value) || 20)}
                                />
                            </div>
                            <div>
                                <Label htmlFor="c-duration">Duration (mins)</Label>
                                <Input
                                    id="c-duration"
                                    type="number"
                                    value={duration}
                                    onChange={e => setDuration(parseInt(e.target.value) || 60)}
                                />
                            </div>
                            <div>
                                <Label htmlFor="c-pos">Positive Marks</Label>
                                <Input
                                    id="c-pos"
                                    type="number"
                                    value={positiveMarks}
                                    onChange={e => setPositiveMarks(parseInt(e.target.value) || 4)}
                                />
                            </div>
                            <div>
                                <Label htmlFor="c-neg">Negative Marks</Label>
                                <div className="relative flex items-center">
                                    <span className="absolute left-3 text-lg text-muted-foreground">-</span>
                                    <Input
                                        id="c-neg"
                                        type="number"
                                        min={0}
                                        value={negativeMarks}
                                        onChange={e => setNegativeMarks(parseInt(e.target.value) || 0)}
                                        className="pl-7"
                                    />
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Step 2: Source Selection */}
                <Card className="shadow-sm">
                    <CardHeader>
                        <CardTitle>2. Select Sources (Optional)</CardTitle>
                        <CardDescription>
                            Filter questions by specific sources (e.g. NEET 2024). Leave empty to use all sources.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {loadingSources ? (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" /> Fetching available sources...
                            </div>
                        ) : availableSources.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                                {availableSources.map(source => {
                                    const isSelected = selectedSources.includes(source);
                                    return (
                                        <button
                                            key={source}
                                            onClick={() => toggleSource(source)}
                                            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${isSelected
                                                ? "bg-primary border-primary text-primary-foreground shadow-sm"
                                                : "bg-background border-input hover:bg-muted text-foreground"
                                                }`}
                                        >
                                            {source}
                                            {isSelected && " ✓"}
                                        </button>
                                    );
                                })}
                            </div>
                        ) : (
                            <p className="text-sm text-muted-foreground">No approved sources found.</p>
                        )}

                        {/* Per-source distribution controls */}
                        {selectedSources.length > 0 && (
                            <div className="mt-4 p-4 rounded-xl bg-muted/30 border space-y-4">
                                <div className="flex items-center justify-between">
                                    <p className="text-sm font-semibold">Question Distribution</p>
                                    <div className="flex items-center gap-1 rounded-lg border p-0.5 bg-background">
                                        <button
                                            onClick={() => { setDistributionMode('count'); setSourceAllocations({}); }}
                                            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${distributionMode === 'count'
                                                ? 'bg-primary text-primary-foreground shadow-sm'
                                                : 'text-muted-foreground hover:text-foreground'
                                                }`}
                                        >
                                            <Hash className="h-3 w-3" /> Count
                                        </button>
                                        <button
                                            onClick={() => { setDistributionMode('percentage'); setSourceAllocations({}); }}
                                            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${distributionMode === 'percentage'
                                                ? 'bg-primary text-primary-foreground shadow-sm'
                                                : 'text-muted-foreground hover:text-foreground'
                                                }`}
                                        >
                                            <Percent className="h-3 w-3" /> Percentage
                                        </button>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    {selectedSources.map(source => {
                                        const isExpanded = expandedSources.has(source);
                                        const chapters = sourceChapterCounts[source] ? Object.values(sourceChapterCounts[source]) : [];
                                        return (
                                            <div key={source} className="border-b border-muted/50 pb-2 last:border-0 last:pb-0">
                                                <div className="flex items-center gap-3 py-1">
                                                    <button
                                                        onClick={() => toggleExpandedSource(source)}
                                                        className="text-muted-foreground hover:text-foreground transition-colors p-1"
                                                    >
                                                        <ChevronRight className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                                                    </button>
                                                    <span className="text-sm font-medium min-w-[120px] flex-1 truncate cursor-pointer" onClick={() => toggleExpandedSource(source)}>
                                                        {source}
                                                        {loadingCounts ? (
                                                            <span className="ml-2 text-xs text-muted-foreground"><Loader2 className="inline h-3 w-3 animate-spin" /></span>
                                                        ) : sourceQuestionCounts[source] !== undefined ? (
                                                            <span className={`ml-2 text-xs font-normal ${sourceQuestionCounts[source] === 0 ? 'text-red-500' : 'text-muted-foreground'}`}>
                                                                ({sourceQuestionCounts[source]} available)
                                                            </span>
                                                        ) : null}
                                                    </span>
                                                    <div className="relative flex items-center">
                                                        <Input
                                                            type="number"
                                                            min={0}
                                                            max={distributionMode === 'percentage' ? 100 : questionCount}
                                                            value={sourceAllocations[source] || ''}
                                                            onChange={e => updateAllocation(source, parseInt(e.target.value) || 0)}
                                                            placeholder="0"
                                                            className="w-24 h-8 text-sm pr-8"
                                                        />
                                                        <span className="absolute right-2.5 text-xs text-muted-foreground pointer-events-none">
                                                            {distributionMode === 'percentage' ? '%' : 'Q'}
                                                        </span>
                                                    </div>
                                                </div>

                                                {isExpanded && chapters.length > 0 && (
                                                    <div className="pl-10 pr-2 pb-2 pt-1 space-y-2">
                                                        {chapters.map(ch => (
                                                            <div key={ch.code} className="flex items-center gap-2 justify-between bg-background/50 p-2 rounded-lg border text-sm">
                                                                <div className="flex items-center gap-2 truncate flex-1">
                                                                    <span className="text-muted-foreground truncate">{ch.name}</span>
                                                                    <span className="text-xs text-muted-foreground/50 hidden sm:inline">({ch.count} avail)</span>
                                                                </div>
                                                                <div className="relative flex items-center shrink-0">
                                                                    <Input
                                                                        type="number"
                                                                        min={0}
                                                                        max={ch.count}
                                                                        value={sourceChapterAllocations[source]?.[ch.code] || ''}
                                                                        onChange={e => updateChapterAllocation(source, ch.code, parseInt(e.target.value) || 0)}
                                                                        placeholder="0"
                                                                        className="w-20 h-7 text-xs"
                                                                    />
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                                {isExpanded && chapters.length === 0 && !loadingCounts && (
                                                    <div className="pl-10 pb-2 text-xs text-muted-foreground">No chapters available based on current filters.</div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* Summary bar */}
                                <div className="flex items-center justify-between pt-2 border-t">
                                    <div className="flex items-center gap-2">
                                        {!allocationValid && (
                                            <AlertTriangle className="h-4 w-4 text-amber-500" />
                                        )}
                                        <span className={`text-sm font-medium ${allocationValid ? 'text-emerald-600' : 'text-amber-600'
                                            }`}>
                                            Total: {allocationTotal} / {expectedTotal}{distributionMode === 'percentage' ? '%' : ' questions'}
                                        </span>
                                        {!allocationValid && (
                                            <span className="text-xs text-muted-foreground">
                                                ({allocationTotal > expectedTotal ? 'exceeds' : 'under'} — will auto-adjust)
                                            </span>
                                        )}
                                    </div>
                                    <button
                                        onClick={distributeEvenly}
                                        className="text-xs text-primary hover:underline font-medium"
                                    >
                                        Distribute Evenly
                                    </button>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Step 3: Chapter Selection */}
                <Card className="shadow-sm">
                    <CardHeader>
                        <CardTitle>3. Select Chapters</CardTitle>
                        <CardDescription>
                            Pick the chapters you want questions from. Only approved questions in the QuestionBank will be used.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-3">
                            {QUIZ_SUBJECTS.map(subject => {
                                const isExpanded = expandedSubjects.has(subject.id);
                                const selectedCount = selectedChapters.filter(c => c.sectionId === subject.id).length;
                                const allSelected = subject.chapters.length > 0 && subject.chapters.every(c => isChapterSelected(subject.id, c.binaryCode));

                                return (
                                    <div key={subject.id} className="border rounded-xl overflow-hidden">
                                        {/* Subject header */}
                                        <button
                                            onClick={() => toggleSubject(subject.id)}
                                            className="w-full flex items-center justify-between p-4 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
                                        >
                                            <div className="flex items-center gap-3">
                                                <span className="font-semibold text-lg">{subject.name}</span>
                                                <code className="text-xs font-mono bg-muted px-2 py-0.5 rounded">{subject.id}</code>
                                                {selectedCount > 0 && (
                                                    <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                                                        {selectedCount} selected
                                                    </span>
                                                )}
                                            </div>
                                            <span className="text-muted-foreground text-sm">
                                                {isExpanded ? "▲" : "▼"} {subject.chapters.length} chapters
                                            </span>
                                        </button>

                                        {/* Chapter list */}
                                        {isExpanded && (
                                            <div className="p-3 space-y-1 border-t">
                                                {/* Select all */}
                                                <button
                                                    onClick={() => selectAllChapters(subject.id)}
                                                    className="w-full text-left px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/5 rounded-lg transition-colors"
                                                >
                                                    {allSelected ? "✓ Deselect All" : "☐ Select All"} ({subject.chapters.length} chapters)
                                                </button>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                                                    {subject.chapters.map(chapter => {
                                                        const selected = isChapterSelected(subject.id, chapter.binaryCode);
                                                        return (
                                                            <button
                                                                key={chapter.binaryCode}
                                                                onClick={() => toggleChapter(subject.id, subject.name, chapter.binaryCode, chapter.name)}
                                                                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-all ${selected
                                                                    ? "bg-primary/10 text-primary border border-primary/20 font-medium"
                                                                    : "hover:bg-muted/50 text-muted-foreground border border-transparent"
                                                                    }`}
                                                            >
                                                                <span className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center text-[10px] ${selected ? "bg-primary border-primary text-white" : "border-muted-foreground/30"
                                                                    }`}>
                                                                    {selected && "✓"}
                                                                </span>
                                                                <span className="truncate">{chapter.name}</span>
                                                                <code className="text-[10px] font-mono opacity-40 ml-auto flex-shrink-0">{chapter.binaryCode}</code>
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        {/* Selection summary */}
                        {selectedChapters.length > 0 && (
                            <div className="mt-6 p-4 rounded-xl bg-muted/30 border">
                                <p className="text-sm font-semibold mb-2">
                                    {selectedChapters.length} chapter{selectedChapters.length > 1 ? "s" : ""} selected:
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    {Object.entries(selectedBySubject).map(([subject, chapters]) => (
                                        <div key={subject} className="flex flex-wrap gap-1">
                                            {chapters.map(ch => (
                                                <span
                                                    key={ch.chapterCode}
                                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 text-primary text-xs"
                                                >
                                                    {ch.chapterName}
                                                    <button
                                                        onClick={() => toggleChapter(ch.sectionId, ch.sectionName, ch.binaryCode, ch.chapterName)}
                                                        className="ml-1 hover:text-destructive"
                                                    >
                                                        ×
                                                    </button>
                                                </span>
                                            ))}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Generate FAB */}
            <div className="fixed bottom-8 right-8 z-50">
                <Button
                    onClick={handleGenerate}
                    disabled={isGenerating || selectedChapters.length === 0}
                    size="lg"
                    className="rounded-full shadow-lg h-16 w-auto px-6"
                >
                    {isGenerating ? (
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    ) : (
                        <Rocket className="mr-2 h-5 w-5" />
                    )}
                    Generate Custom Quiz
                </Button>
            </div>

            {/* Success Modal */}
            <AlertDialog open={showSuccessModal} onOpenChange={setShowSuccessModal}>
                <AlertDialogContent className="max-w-lg">
                    <AlertDialogHeader className="items-center text-center">
                        <div className="p-3 bg-green-100 dark:bg-green-900 rounded-full w-fit">
                            <CheckCircle className="h-8 w-8 text-green-600 dark:text-green-400" />
                        </div>
                        <AlertDialogTitle>Custom Quiz Ready!</AlertDialogTitle>
                        <AlertDialogDescription>
                            Generated a quiz with <strong>{generatedCount}</strong> questions from{" "}
                            <strong>{selectedChapters.length}</strong> chapters.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="grid grid-cols-2 gap-4 py-4">
                        <Button onClick={handleStartQuiz} className="h-auto py-3">
                            <Rocket className="mr-2" />
                            Start Quiz
                        </Button>
                        <Button onClick={() => setShowDeployModal(true)} variant="secondary" className="h-auto py-3">
                            <Send className="mr-2" />
                            Deploy to Students
                        </Button>
                    </div>
                    <AlertDialogFooter>
                        <Button variant="outline" onClick={() => setShowSuccessModal(false)}>
                            Close
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Deploy Modal */}
            <AlertDialog open={showDeployModal} onOpenChange={setShowDeployModal}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Deploy Quiz</AlertDialogTitle>
                        <AlertDialogDescription>
                            Enter comma-separated student IDs to assign this quiz.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="space-y-4">
                        <Textarea
                            placeholder="e.g. sourav, rahul, priya"
                            value={deployStudentIds}
                            onChange={e => setDeployStudentIds(e.target.value)}
                        />
                    </div>
                    <AlertDialogFooter>
                        <Button variant="outline" onClick={() => setShowDeployModal(false)} disabled={isDeploying}>
                            Cancel
                        </Button>
                        <Button onClick={handleDeploy} disabled={isDeploying}>
                            {isDeploying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                            Deploy
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
