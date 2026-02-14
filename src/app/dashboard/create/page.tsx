
"use client";

import { useState, useMemo } from "react";
import { Plus, Trash2, BookPlus, Loader2, BrainCircuit, Rocket, CheckCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { Progress } from "@/components/ui/progress";
import { QUIZ_SUBJECTS, getSubjectById, type ChapterData } from "@/lib/quiz-data";
import type { QuizStructure, Chapter, QuizSettings } from "@/types/quiz";
import { useToast } from "@/hooks/use-toast";
import { doc, setDoc, addDoc, collection, serverTimestamp, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { useAuth } from "@/hooks/use-auth";
import { useRouter } from "next/navigation";
import { generateQuizAction } from "@/app/actions/quiz";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";


// A small sub-component to manage adding chapters to a section
const ChapterManager = ({ section, sectionIndex, onChapterUpdate }: { section: any, sectionIndex: number, onChapterUpdate: (sectionIndex: number, newChapters: Chapter[]) => void }) => {
    const [selectedChapterCode, setSelectedChapterCode] = useState<string>('');
    const subjectData = getSubjectById(section.id);
    
    const availableChapters = useMemo(() => {
        if (!subjectData) return [];
        const existingChapterCodes = new Set(section.chapters.map((c: Chapter) => c.binaryCode));
        return subjectData.chapters.filter(c => !existingChapterCodes.has(c.binaryCode));
    }, [subjectData, section.chapters]);

    const handleAddChapter = () => {
        if (!selectedChapterCode) return;
        const chapterToAdd = subjectData?.chapters.find(c => c.binaryCode === selectedChapterCode);
        if (chapterToAdd) {
            const newChapter: Chapter = {
                name: chapterToAdd.name,
                binaryCode: chapterToAdd.binaryCode,
                questions: [],
            }
            onChapterUpdate(sectionIndex, [...section.chapters, newChapter]);
        }
        setSelectedChapterCode(''); // Reset dropdown
    }

    const handleRemoveChapter = (chapterIndex: number) => {
        const newChapters = section.chapters.filter((_: any, cIndex: number) => cIndex !== chapterIndex);
        onChapterUpdate(sectionIndex, newChapters);
    }
    
    return (
        <CardContent className="p-4">
            {section.chapters.length > 0 ? (
                <div className="space-y-3">
                <Label className="text-xs text-muted-foreground">Chapters</Label>
                {section.chapters.map((chapter: Chapter, chapterIndex: number) => (
                    <div key={chapter.binaryCode} className="flex items-center gap-2 p-2 rounded-lg bg-background">
                        <div className="flex-grow">
                            <p className="font-medium">{chapter.name}</p>
                            <code className="text-sm text-muted-foreground">{section.id}-{chapter.binaryCode}</code>
                        </div>
                        <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveChapter(chapterIndex)}
                        >
                        <Trash2 className="h-4 w-4 text-destructive/70" />
                        </Button>
                    </div>
                ))}
                </div>
            ) : (
                <p className="py-4 text-center text-sm text-muted-foreground">No chapters yet. Add one below.</p>
            )}

            {availableChapters.length > 0 && (
                <div className="flex items-center gap-2 mt-4 pt-4 border-t">
                    <Select value={selectedChapterCode} onValueChange={setSelectedChapterCode}>
                        <SelectTrigger>
                            <SelectValue placeholder="Select a chapter..." />
                        </SelectTrigger>
                        <SelectContent>
                            {availableChapters.map(chapter => (
                                <SelectItem key={chapter.binaryCode} value={chapter.binaryCode}>{chapter.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleAddChapter}
                        disabled={!selectedChapterCode}
                    >
                        <Plus className="mr-2 h-4 w-4" /> Add
                    </Button>
                </div>
            )}
        </CardContent>
    )
}


export default function CreateQuizPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  // Core quiz data
  const [title, setTitle] = useState("");
  const [settings, setSettings] = useState<QuizSettings>({
    duration: 180,
    positiveMarks: 4,
    negativeMarks: -1,
  });
  const [structure, setStructure] = useState<QuizStructure>([]);
  const [questions, setQuestions] = useState("");
  const [answers, setAnswers] = useState("");
  
  // State for UI/flow
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isPorting, setIsPorting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [quizId, setQuizId] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [showDeployModal, setShowDeployModal] = useState(false);
  const [deployStudentIds, setDeployStudentIds] = useState("");
  const [isDeploying, setIsDeploying] = useState(false);
  const [subjectToAdd, setSubjectToAdd] = useState<string>('');


  const hasQuestions = useMemo(() => {
    return structure.some(section => 
      section.chapters.some(chapter => chapter.questions && chapter.questions.length > 0)
    );
  }, [structure]);

  const availableSubjects = useMemo(() => {
      const existingSubjectIds = new Set(structure.map(s => s.id));
      return QUIZ_SUBJECTS.filter(s => !existingSubjectIds.has(s.id));
  }, [structure]);

  const handleAddSection = () => {
    if (!subjectToAdd) return;
    const subjectData = QUIZ_SUBJECTS.find(s => s.id === subjectToAdd);
    if (!subjectData) return;

    const newSection = {
        id: subjectData.id,
        name: subjectData.name,
        chapters: []
    };
    setStructure([...structure, newSection]);
    setSubjectToAdd(''); // Reset dropdown
  };

  const handleRemoveSection = (index: number) => {
    setStructure(structure.filter((_, i) => i !== index));
  };

  const handleChapterUpdate = (sectionIndex: number, newChapters: Chapter[]) => {
      const newStructure = [...structure];
      newStructure[sectionIndex].chapters = newChapters;
      setStructure(newStructure);
  }

  const validateStructure = () => {
    if (!title.trim()) {
        toast({ variant: "destructive", title: `Missing Title`, description: "Please provide a title for your quiz."});
        return false;
    }
     if (structure.length === 0) {
      toast({
        variant: "destructive",
        title: "Structure Not Defined",
        description: "Please add at least one section.",
      });
      return false;
    }
    return true;
  };

  const handleAiParse = async () => {
    if (!questions || !answers) {
      toast({
        variant: "destructive",
        title: "Missing Content",
        description: "Please paste both questions and the answer key.",
      });
      return;
    }
    if (structure.length === 0 || structure.every(s => s.chapters.length === 0)) {
      toast({
        variant: "destructive",
        title: "Structure Not Defined",
        description: "Please add at least one section and chapter before parsing.",
      });
      return;
    }

    setIsAnalyzing(true);
    try {
      const structureForAi = structure.map(section => ({
        id: section.id,
        name: section.name,
        chapters: section.chapters.map(chapter => ({
          name: chapter.name,
          binaryCode: chapter.binaryCode,
        })),
      }));

      const result = await generateQuizAction({
        rawQuestions: questions,
        rawAnswers: answers,
        structure: structureForAi,
      });

      setStructure(result.parsedStructure);

      toast({
        title: "AI Analysis Complete",
        description: "Questions have been parsed and added to the structure.",
      });
    } catch (error) {
      console.error("AI parsing error:", error);
      toast({
        variant: "destructive",
        title: "AI Parsing Failed",
        description: error instanceof Error ? error.message : "An unknown error occurred.",
      });
    } finally {
      setIsAnalyzing(false);
    }
  };
  
  const handleFinalize = async () => {
    if (!validateStructure()) return;
    if (!hasQuestions) {
        toast({ variant: 'destructive', title: "No Questions", description: "The quiz must have at least one question parsed by the AI." });
        return;
    }
    if (!user) {
      toast({ variant: 'destructive', title: "Authentication Error", description: "You must be logged in to save a quiz." });
      return;
    }

    setIsPorting(true);
    setUploadProgress(0);

    try {
      await new Promise(res => setTimeout(res, 200));
      setUploadProgress(20);

      const quizPayload = {
        title,
        settings,
        structure,
        isPublished: false,
        createdAt: serverTimestamp(),
        ownerId: user.studentId,
      };
      
      console.log("Attempting to save to 'quizzes' collection...", quizPayload);

      await new Promise(res => setTimeout(res, 500));
      setUploadProgress(50);
      
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Database Connection Timeout. Check your internet or Firebase Rules.")), 5000)
      );

      const docRef = await Promise.race([
        addDoc(collection(db, "quizzes"), quizPayload),
        timeoutPromise
      ]) as any; 

      setDoc(doc(db, "quizzes", docRef.id), { id: docRef.id }, { merge: true });

      await new Promise(res => setTimeout(res, 300));
      setUploadProgress(100);

      await new Promise(res => setTimeout(res, 500));
      setQuizId(docRef.id);
      setIsReady(true);
      setIsPorting(false);

    } catch (error: any) {
      console.error("SAVE FAILED:", error);
      toast({ variant: 'destructive', title: "Save Failed", description: error.message });
      setIsPorting(false);
      setUploadProgress(0);
    }
  };

  const handleStartProtocol = () => {
    if (!quizId) return;
    window.location.assign(`/quiz/${quizId}`);
  };

  const handleDeploy = async () => {
    if (!quizId || !user || !deployStudentIds.trim()) {
        toast({ variant: 'destructive', title: 'Missing Info', description: 'Quiz ID or student IDs are missing.' });
        return;
    }
    setIsDeploying(true);
    try {
        const studentIds = deployStudentIds.split(',').map(id => id.trim().toLowerCase()).filter(id => id);
        const batch = writeBatch(db);

        const quizRef = doc(db, "quizzes", quizId);
        batch.update(quizRef, { isPublished: true });

        for (const studentId of studentIds) {
            const assignmentRef = doc(collection(db, "assigned_quizzes"));
            batch.set(assignmentRef, {
                quizId: quizId,
                quizTitle: title,
                studentId: studentId,
                assignedAt: serverTimestamp(),
                status: 'pending',
                creatorId: user.studentId
            });
        }

        await batch.commit();
        toast({ title: 'Deployment Successful', description: `${studentIds.length} students have been assigned this quiz.` });
        setShowDeployModal(false);
        setIsReady(false);
        router.push('/dashboard/admin');

    } catch (error: any) {
        console.error("Deploy error:", error);
        toast({ variant: 'destructive', title: 'Deployment Failed', description: error.message });
    } finally {
        setIsDeploying(false);
    }
  };


  const isActionDisabled = isAnalyzing || isPorting;

  return (
    <div className="p-4 md:p-8 relative min-h-screen">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Create a New Quiz</h1>
        <p className="text-muted-foreground">
          Follow the steps below to build your quiz.
        </p>
      </header>

      <div className="space-y-8 max-w-4xl mx-auto pb-32">
        {/* Phase A: Quiz Settings */}
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>1. Quiz Details</CardTitle>
            <CardDescription>
              Set the basic properties for your quiz.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="quiz-title">Quiz Title</Label>
              <Input
                id="quiz-title"
                placeholder="e.g., NEET Mock Test 1"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="text-lg"
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label htmlFor="duration">Duration (mins)</Label>
                <Input
                  id="duration"
                  type="number"
                  value={settings.duration}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      duration: parseInt(e.target.value) || 0,
                    })
                  }
                  className="text-lg"
                />
              </div>
              <div>
                <Label htmlFor="positive-marks">Positive Marks</Label>
                <Input
                  id="positive-marks"
                  type="number"
                  value={settings.positiveMarks}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      positiveMarks: parseInt(e.target.value) || 0,
                    })
                  }
                  className="text-lg"
                />
              </div>
              <div>
                <Label htmlFor="negative-marks">Negative Marks</Label>
                 <div className="relative flex items-center">
                  <span className="absolute left-3 text-lg text-muted-foreground">-</span>
                  <Input
                    id="negative-marks"
                    type="number"
                    min="0"
                    value={Math.abs(settings.negativeMarks)}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 0;
                      setSettings({
                        ...settings,
                        negativeMarks: val > 0 ? -val : 0,
                      });
                    }}
                    className="pl-7 text-lg"
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Phase B: Structure Builder */}
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>2. Quiz Structure</CardTitle>
            <CardDescription>
              Add sections and chapters from the predefined list.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {structure.map((section, sectionIndex) => (
                <Card key={section.id} className="overflow-hidden bg-background">
                  <CardHeader className="flex flex-row items-center justify-between bg-muted/30 p-3">
                    <div className="flex flex-1 items-center gap-4">
                      <h3 className="text-lg font-semibold">{section.name}</h3>
                      <code className="text-lg font-mono tracking-widest bg-muted px-2 py-1 rounded">{section.id}</code>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveSection(sectionIndex)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </CardHeader>
                  <ChapterManager section={section} sectionIndex={sectionIndex} onChapterUpdate={handleChapterUpdate} />
                </Card>
              ))}
            </div>
            {availableSubjects.length > 0 && (
                <div className="flex items-center gap-2 mt-4 p-4 border-t">
                    <Select value={subjectToAdd} onValueChange={setSubjectToAdd}>
                        <SelectTrigger>
                            <SelectValue placeholder="Select a subject to add..." />
                        </SelectTrigger>
                        <SelectContent>
                            {availableSubjects.map(subject => (
                                <SelectItem key={subject.id} value={subject.id}>{subject.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button
                        variant="outline"
                        onClick={handleAddSection}
                        disabled={!subjectToAdd}
                    >
                        <BookPlus className="mr-2 h-4 w-4" /> Add Section
                    </Button>
                </div>
            )}
          </CardContent>
        </Card>

        {/* Phase C: The "Gibberish" Portal */}
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>3. Add Questions</CardTitle>
            <CardDescription>
              Paste your raw question text and the answer key below. Then click the AI button.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="questions-paste">Paste Questions</Label>
              <Textarea
                id="questions-paste"
                placeholder="Paste the entire block of questions here..."
                rows={15}
                value={questions}
                onChange={(e) => setQuestions(e.target.value)}
                className="text-base font-mono"
              />
            </div>
            <div>
              <Label htmlFor="answers-paste">Paste Answer Key</Label>
              <Textarea
                id="answers-paste"
                placeholder="Paste the answer key here..."
                rows={5}
                value={answers}
                onChange={(e) => setAnswers(e.target.value)}
                className="text-base font-mono"
              />
            </div>
            <Button onClick={handleAiParse} disabled={isAnalyzing || isPorting} className="w-full">
              {isAnalyzing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <BrainCircuit className="mr-2 h-4 w-4" />
                  Generate with AI
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* "Finalize" Floating Action Button */}
      <div className="fixed bottom-8 right-8 z-50">
        <Button
          onClick={handleFinalize}
          disabled={isActionDisabled}
          size="lg"
          className="rounded-full shadow-lg h-16 w-auto px-6"
        >
          {isPorting ? (
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          ) : (
            <Rocket className="mr-2 h-5 w-5" />
          )}
          Finalize & Port to Engine
        </Button>
      </div>

      {/* "Porting" Overlay */}
      <AlertDialog open={isPorting}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-center">Porting Quiz to Engine...</AlertDialogTitle>
            <AlertDialogDescription className="text-center">
              Please wait while we finalize your quiz configuration.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <Progress value={uploadProgress} className="w-full" />
            <p className="text-center text-sm text-muted-foreground mt-2">{uploadProgress}%</p>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      {/* "Mission Control" Success Modal */}
      <AlertDialog open={isReady} onOpenChange={setIsReady}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader className="items-center text-center">
            <div className="p-3 bg-green-100 dark:bg-green-900 rounded-full w-fit">
                <CheckCircle className="h-8 w-8 text-green-600 dark:text-green-400" />
            </div>
            <AlertDialogTitle>Quiz Engine Ready</AlertDialogTitle>
            <AlertDialogDescription>
              Your quiz has been successfully ported. What's next?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid grid-cols-2 gap-4 py-4">
            <Button onClick={handleStartProtocol} className="h-auto py-3">
              <Rocket className="mr-2"/>
              Start Protocol
            </Button>
            <Button onClick={() => setShowDeployModal(true)} variant="secondary" className="h-auto py-3">
              <Send className="mr-2"/>
              Deploy to Students
            </Button>
          </div>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setIsReady(false)}>
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
              Enter comma-separated student IDs to assign this quiz. This will also publish the quiz.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-4">
            <Textarea 
              placeholder="e.g. sourav, rahul, priya"
              value={deployStudentIds}
              onChange={(e) => setDeployStudentIds(e.target.value)}
            />
          </div>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setShowDeployModal(false)} disabled={isDeploying}>Cancel</Button>
            <Button onClick={handleDeploy} disabled={isDeploying}>
              {isDeploying ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Send />}
              Deploy
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}
    