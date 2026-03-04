"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
    Upload, FileText, Loader2, CheckCircle, XCircle,
    AlertTriangle, Image as ImageIcon, Brain, Database, Sparkles, ChevronDown
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type PipelineStage = "idle" | "uploading" | "extracting" | "parsing" | "images" | "classifying" | "pushing" | "done" | "error";

const STAGES: { key: PipelineStage; label: string; icon: any; }[] = [
    { key: "uploading", label: "Uploading PDF", icon: Upload },
    { key: "extracting", label: "Extracting Text", icon: FileText },
    { key: "parsing", label: "AI Parsing Questions", icon: Brain },
    { key: "images", label: "Extracting Images", icon: ImageIcon },
    { key: "classifying", label: "Chapter Classification", icon: Sparkles },
    { key: "pushing", label: "Saving to Database", icon: Database },
];

export default function UploadPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const { toast } = useToast();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [file, setFile] = useState<File | null>(null);
    const [source, setSource] = useState("");
    const [dryRun, setDryRun] = useState(true);
    const [noImages, setNoImages] = useState(false);
    const [stage, setStage] = useState<PipelineStage>("idle");
    const [uploadProgress, setUploadProgress] = useState({ percent: 0, text: "" });
    const [log, setLog] = useState("");
    const [metrics, setMetrics] = useState<any>(null);
    const [parsedQuestions, setParsedQuestions] = useState<any[]>([]);
    const [showLog, setShowLog] = useState(false);
    const [dragOver, setDragOver] = useState(false);

    if (authLoading) {
        return (
            <div className="flex h-full min-h-[calc(100vh-10rem)] items-center justify-center">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
            </div>
        );
    }

    if (!user || user.role !== "admin") {
        router.replace("/login");
        return null;
    }

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        const droppedFile = e.dataTransfer.files[0];
        if (droppedFile?.name.endsWith(".pdf")) {
            setFile(droppedFile);
            if (!source) setSource(droppedFile.name.replace(".pdf", ""));
        } else {
            toast({ variant: "destructive", title: "Only PDF files are accepted" });
        }
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selected = e.target.files?.[0];
        if (selected) {
            setFile(selected);
            if (!source) setSource(selected.name.replace(".pdf", ""));
        }
    };

    const handleSubmit = async () => {
        if (!file || !source.trim()) {
            toast({ variant: "destructive", title: "Please select a PDF and enter a source name" });
            return;
        }

        setStage("uploading");
        setLog("");
        setMetrics(null);
        setParsedQuestions([]);
        setUploadProgress({ percent: 5, text: "Starting pipeline..." });

        try {
            const formData = new FormData();
            formData.append("pdf", file);
            formData.append("source", source.trim());
            formData.append("dryRun", String(dryRun));
            formData.append("noImages", String(noImages));

            const response = await fetch("/api/ingest", { method: "POST", body: formData });
            if (!response.body) throw new Error("No response body");

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let isDone = false;
            let currentPercent = 5;

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
                                setLog(prev => prev + logText);
                                let newText = uploadProgress.text;

                                if (logText.includes("Extracting text from page")) {
                                    setStage("extracting");
                                    const match = logText.match(/page (\d+)\/(\d+)/);
                                    if (match) {
                                        currentPercent = (parseInt(match[1]) / parseInt(match[2])) * 20;
                                        newText = `Page ${match[1]} of ${match[2]}`;
                                    }
                                } else if (logText.includes("[OCR] Extracting text from page")) {
                                    setStage("extracting");
                                    const match = logText.match(/page (\d+)\/(\d+)/);
                                    if (match) {
                                        currentPercent = (parseInt(match[1]) / parseInt(match[2])) * 20;
                                        newText = `OCR: Page ${match[1]} of ${match[2]}`;
                                    }
                                } else if (logText.includes("[AUTO-DETECT]") || logText.includes("[OCR] Initializing")) {
                                    setStage("extracting");
                                    currentPercent = 5;
                                    newText = "Scanned PDF detected...";
                                } else if (logText.includes("[VISION] Parsing page")) {
                                    setStage("parsing");
                                    const match = logText.match(/page (\d+)\/(\d+)/);
                                    if (match) {
                                        currentPercent = 20 + (parseInt(match[1]) / parseInt(match[2])) * 50;
                                        newText = `Vision: Page ${match[1]} of ${match[2]}`;
                                    }
                                } else if (logText.includes("[SCANNED PDF]")) {
                                    setStage("extracting");
                                    currentPercent = 8;
                                    newText = "Scanned PDF - Vision parsing...";
                                } else if (logText.includes("Sending batch")) {
                                    setStage("parsing");
                                    const match = logText.match(/batch (\d+)\/(\d+)/);
                                    if (match) {
                                        currentPercent = 20 + (parseInt(match[1]) / parseInt(match[2])) * 40;
                                        newText = `Batch ${match[1]} of ${match[2]}`;
                                    }
                                } else if (logText.includes("Extracting images from page")) {
                                    setStage("images");
                                    const match = logText.match(/page (\d+)\/(\d+)/);
                                    if (match) {
                                        currentPercent = 60 + (parseInt(match[1]) / parseInt(match[2])) * 20;
                                        newText = `Page ${match[1]} of ${match[2]}`;
                                    }
                                } else if (logText.includes("Classifying")) {
                                    setStage("classifying");
                                    currentPercent = 85;
                                    newText = "Running classification...";
                                } else if (logText.includes("Pushed") || logText.includes("Pushing")) {
                                    setStage("pushing");
                                    currentPercent = 95;
                                    newText = "Saving to database...";
                                }

                                setUploadProgress({ percent: currentPercent, text: newText });
                            } else if (data.type === "done") {
                                isDone = true;
                                setUploadProgress({ percent: 100, text: "Finished!" });
                                setMetrics(data.metrics);
                                if (data.parsedQuestions) setParsedQuestions(data.parsedQuestions);

                                if (data.success) {
                                    setStage("done");
                                    toast({ title: "✅ Pipeline complete!" });
                                } else {
                                    setStage("error");
                                    toast({ variant: "destructive", title: "Pipeline finished with errors", description: "Check the log for details" });
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
        } catch (error: any) {
            setStage("error");
            toast({ variant: "destructive", title: "Pipeline failed", description: error.message });
        }
    };

    const reset = () => {
        setFile(null);
        setSource("");
        setStage("idle");
        setLog("");
        setMetrics(null);
        setParsedQuestions([]);
        setShowLog(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    const isRunning = !["idle", "done", "error"].includes(stage);
    const currentStageIndex = STAGES.findIndex((s) => s.key === stage);

    return (
        <div className="p-4 md:p-8 space-y-6 max-w-4xl mx-auto">
            {/* Header */}
            <header>
                <h1 className="text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-3">
                    <Upload className="h-8 w-8 text-primary" />
                    Upload NEET PDF
                </h1>
                <p className="text-slate-600 mt-1">
                    Upload a PDF and the pipeline will extract questions, images, classify chapters, and push to your Question Bank.
                </p>
            </header>

            {/* Upload Zone */}
            <Card className="rounded-2xl">
                <CardContent className="p-6">
                    <div
                        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={handleDrop}
                        onClick={() => !isRunning && fileInputRef.current?.click()}
                        className={cn(
                            "border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all duration-200",
                            dragOver
                                ? "border-primary bg-primary/5 scale-[1.01]"
                                : file
                                    ? "border-emerald-300 bg-emerald-50/50"
                                    : "border-slate-300 hover:border-primary/50 hover:bg-slate-50",
                            isRunning && "pointer-events-none opacity-60"
                        )}
                    >
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".pdf"
                            onChange={handleFileSelect}
                            className="hidden"
                        />
                        {file ? (
                            <div className="flex items-center justify-center gap-3">
                                <FileText className="h-8 w-8 text-emerald-600" />
                                <div className="text-left">
                                    <p className="font-semibold text-slate-800">{file.name}</p>
                                    <p className="text-xs text-slate-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                                </div>
                                {!isRunning && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="ml-4 text-slate-400 hover:text-red-500"
                                        onClick={(e) => { e.stopPropagation(); reset(); }}
                                    >
                                        <XCircle className="h-5 w-5" />
                                    </Button>
                                )}
                            </div>
                        ) : (
                            <>
                                <Upload className="h-12 w-12 mx-auto text-slate-400 mb-3" />
                                <p className="text-slate-600 font-medium">Drop your NEET PDF here</p>
                                <p className="text-xs text-slate-400 mt-1">or click to browse</p>
                            </>
                        )}
                    </div>

                    {/* Source Name & Options */}
                    {file && (
                        <div className="mt-4 space-y-4">
                            <div>
                                <Label className="text-sm font-medium text-slate-700">Source Name</Label>
                                <Input
                                    placeholder="e.g. NEET 2024 Paper 1"
                                    value={source}
                                    onChange={(e) => setSource(e.target.value)}
                                    disabled={isRunning}
                                    className="mt-1 rounded-xl"
                                />
                                <p className="text-xs text-slate-400 mt-1">This label identifies which paper the questions came from.</p>
                            </div>

                            <div className="flex flex-col sm:flex-row gap-4">
                                <div className="flex items-center gap-3 rounded-xl border p-3 flex-1">
                                    <Switch
                                        id="dry-run"
                                        checked={dryRun}
                                        onCheckedChange={setDryRun}
                                        disabled={isRunning}
                                    />
                                    <Label htmlFor="dry-run" className="cursor-pointer">
                                        <span className="text-sm font-medium text-slate-700">Dry Run</span>
                                        <p className="text-xs text-slate-400">Parse only, don't push to Firestore</p>
                                    </Label>
                                </div>
                                <div className="flex items-center gap-3 rounded-xl border p-3 flex-1">
                                    <Switch
                                        id="no-images"
                                        checked={noImages}
                                        onCheckedChange={setNoImages}
                                        disabled={isRunning}
                                    />
                                    <Label htmlFor="no-images" className="cursor-pointer">
                                        <span className="text-sm font-medium text-slate-700">Skip Images</span>
                                        <p className="text-xs text-slate-400">Faster, text-only extraction</p>
                                    </Label>
                                </div>
                            </div>

                            <Button
                                onClick={handleSubmit}
                                disabled={isRunning || !source.trim()}
                                className="w-full rounded-xl h-12 text-base"
                                size="lg"
                            >
                                {isRunning ? (
                                    <>
                                        <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                                        Processing...
                                    </>
                                ) : (
                                    <>
                                        <Sparkles className="h-5 w-5 mr-2" />
                                        {dryRun ? "Run Pipeline (Dry Run)" : "Run Pipeline & Push to Firestore"}
                                    </>
                                )}
                            </Button>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Pipeline Progress */}
            {stage !== "idle" && (
                <Card className="rounded-2xl">
                    <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-lg">Pipeline Progress</CardTitle>
                            {isRunning && (
                                <span className="text-sm font-medium text-primary">
                                    {Math.round(uploadProgress.percent)}%
                                </span>
                            )}
                        </div>
                        {isRunning && (
                            <Progress value={uploadProgress.percent} className="h-2 mt-2" />
                        )}
                    </CardHeader>
                    <CardContent className="p-6 pt-2">
                        <div className="space-y-3">
                            {STAGES.map((s, i) => {
                                const Icon = s.icon;
                                const isDone = stage === "done" || (currentStageIndex > i);
                                const isCurrent = s.key === stage || (stage === "done" && i === STAGES.length - 1);
                                const isError = stage === "error" && i === currentStageIndex;
                                const isPending = !isDone && !isCurrent && !isError;

                                // Skip pushing stage if dry run
                                if (s.key === "pushing" && dryRun) return null;

                                return (
                                    <div
                                        key={s.key}
                                        className={cn(
                                            "flex items-center gap-3 rounded-xl px-4 py-2.5 transition-all",
                                            isDone && "bg-emerald-50",
                                            isCurrent && !isError && "bg-primary/5 ring-1 ring-primary/20",
                                            isError && "bg-red-50 ring-1 ring-red-200",
                                            isPending && "opacity-40"
                                        )}
                                    >
                                        {isDone ? (
                                            <CheckCircle className="h-5 w-5 text-emerald-500 shrink-0" />
                                        ) : isCurrent && !isError ? (
                                            <Loader2 className="h-5 w-5 text-primary animate-spin shrink-0" />
                                        ) : isError ? (
                                            <XCircle className="h-5 w-5 text-red-500 shrink-0" />
                                        ) : (
                                            <Icon className="h-5 w-5 text-slate-400 shrink-0" />
                                        )}
                                        <span
                                            className={cn(
                                                "text-sm font-medium flex-1",
                                                isDone && "text-emerald-700",
                                                isCurrent && !isError && "text-primary",
                                                isError && "text-red-700",
                                                isPending && "text-slate-500"
                                            )}
                                        >
                                            {s.label}
                                        </span>
                                        {isCurrent && !isError && uploadProgress.text && (
                                            <span className="text-xs text-primary/70 font-medium">
                                                {uploadProgress.text}
                                            </span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Results */}
            {metrics && (
                <Card className="rounded-2xl">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            {stage === "done" ? (
                                <CheckCircle className="h-5 w-5 text-emerald-500" />
                            ) : (
                                <AlertTriangle className="h-5 w-5 text-amber-500" />
                            )}
                            Results
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-3 gap-4 mb-4">
                            <div className="text-center p-4 rounded-xl bg-slate-50">
                                <p className="text-2xl font-bold text-slate-800">{metrics.questionsParsed}</p>
                                <p className="text-xs text-slate-500">Questions Parsed</p>
                            </div>
                            <div className="text-center p-4 rounded-xl bg-violet-50">
                                <p className="text-2xl font-bold text-violet-700">{metrics.imagesAttached}</p>
                                <p className="text-xs text-violet-600">Images Attached</p>
                            </div>
                            <div className="text-center p-4 rounded-xl bg-emerald-50">
                                <p className="text-2xl font-bold text-emerald-700">
                                    {dryRun ? "Dry Run" : metrics.documentsPushed}
                                </p>
                                <p className="text-xs text-emerald-600">
                                    {dryRun ? "No push" : "Docs Pushed"}
                                </p>
                            </div>
                        </div>

                        <div className="flex gap-2">
                            {!dryRun && (
                                <Button
                                    variant="outline"
                                    className="rounded-xl flex-1"
                                    onClick={() => router.push("/dashboard/question-bank")}
                                >
                                    <Database className="h-4 w-4 mr-2" />
                                    View Question Bank
                                </Button>
                            )}
                            <Button variant="outline" className="rounded-xl flex-1" onClick={reset}>
                                Upload Another
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Parsed Questions Preview (Dry Run) */}
            {parsedQuestions.length > 0 && (
                <Card className="rounded-2xl">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-lg">
                            <CheckCircle className="h-5 w-5 text-emerald-500" />
                            Parsed Questions Preview ({parsedQuestions.length})
                        </CardTitle>
                        <CardDescription>Review the extracted questions below. If they look correct, re-run without Dry Run to push to Firestore.</CardDescription>
                    </CardHeader>
                    <CardContent className="max-h-[500px] overflow-y-auto space-y-3 pr-2">
                        {parsedQuestions.map((q: any, i: number) => (
                            <div key={i} className="rounded-xl border p-4 bg-slate-50 space-y-2">
                                <div className="flex items-start gap-2">
                                    <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-primary/10 text-primary font-bold text-xs shrink-0">
                                        {q.optimized_json?.questionNumber || q.questionNumber || i + 1}
                                    </span>
                                    <p className="text-sm text-slate-800 leading-relaxed flex-1">
                                        {q.optimized_json?.text || q.text || 'No text'}
                                    </p>
                                </div>
                                {(q.optimized_json?.options || q.options) && (
                                    <div className="grid grid-cols-2 gap-1 ml-9">
                                        {(q.optimized_json?.options || q.options).map((opt: any) => {
                                            const correctId = q.optimized_json?.correctOptionId || q.correctOptionId;
                                            return (
                                                <div
                                                    key={opt.id}
                                                    className={cn(
                                                        "rounded-lg px-2.5 py-1 text-xs border",
                                                        opt.id === correctId
                                                            ? "bg-emerald-50 border-emerald-300 text-emerald-800 font-medium"
                                                            : "bg-white border-slate-200 text-slate-600"
                                                    )}
                                                >
                                                    <span className="font-bold mr-1">{opt.id})</span>
                                                    {opt.text}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                                {(q.chapter_name || q.section_name) && (
                                    <div className="ml-9">
                                        <Badge variant="secondary" className="text-xs">
                                            {q.chapter_name || q.section_name}
                                        </Badge>
                                    </div>
                                )}
                            </div>
                        ))}
                    </CardContent>
                </Card>
            )}

            {/* Log output */}
            {log && (
                <Card className="rounded-2xl">
                    <CardHeader
                        className="cursor-pointer"
                        onClick={() => setShowLog(!showLog)}
                    >
                        <CardTitle className="flex items-center justify-between text-sm">
                            <span>Pipeline Log</span>
                            <ChevronDown
                                className={cn("h-4 w-4 transition-transform", showLog && "rotate-180")}
                            />
                        </CardTitle>
                    </CardHeader>
                    {showLog && (
                        <CardContent>
                            <pre className="text-xs text-slate-600 bg-slate-50 rounded-xl p-4 overflow-auto max-h-96 whitespace-pre-wrap font-mono">
                                {log}
                            </pre>
                        </CardContent>
                    )}
                </Card>
            )}
        </div>
    );
}
