
"use client";

import { useState, useMemo } from "react";
import { Plus, Trash2, BookPlus, Loader2, BrainCircuit, Rocket, CheckCircle, Share2, Send } from "lucide-react";
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
import { generateBinaryCode } from "@/lib/binaryUtils";
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


  const hasQuestions = useMemo(() => {
    return structure.some(section => 
      section.chapters.some(chapter => chapter.questions && chapter.questions.length > 0)
    );
  }, [structure]);

  const getAllBinaryCodes = () => {
    return structure.flatMap((section) =>
      section.chapters.map((chapter) => chapter.binaryCode)
    );
  };

  const handleAddSection = () => {
    setStructure([...structure, { id: "", name: "", chapters: [] }]);
  };

  const handleUpdateSection = (
    index: number,
    field: "name" | "id",
    value: string
  ) => {
    const newStructure = [...structure];
    let processedValue = value;
    if (field === "id") {
      processedValue = value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3);
    }
    newStructure[index] = { ...newStructure[index], [field]: processedValue };
    setStructure(newStructure);
  };

  const handleRemoveSection = (index: number) => {
    setStructure(structure.filter((_, i) => i !== index));
  };

  const handleAddChapter = (sectionIndex: number) => {
    const newStructure = structure.map((section, index) => {
      if (index === sectionIndex) {
        const existingCodes = getAllBinaryCodes();
        const newChapter: Chapter = {
          name: "", // Start with an empty name
          binaryCode: generateBinaryCode(existingCodes),
          questions: [],
        };
        return {
          ...section,
          chapters: [...section.chapters, newChapter],
        };
      }
      return section;
    });
    setStructure(newStructure);
  };

  const handleUpdateChapter = (sectionIndex: number, chapterIndex: number, name: string) => {
    const newStructure = structure.map((section, sIndex) => {
      if (sIndex === sectionIndex) {
        const newChapters = section.chapters.map((chapter, cIndex) => {
          if (cIndex === chapterIndex) {
            return { ...chapter, name: name };
          }
          return chapter;
        });
        return { ...section, chapters: newChapters };
      }
      return section;
    });
    setStructure(newStructure);
  };

  const handleRemoveChapter = (sectionIndex: number, chapterIndex: number) => {
    const newStructure = structure.map((section, sIndex) => {
      if (sIndex === sectionIndex) {
        const newChapters = section.chapters.filter((_, cIndex) => cIndex !== chapterIndex);
        return { ...section, chapters: newChapters };
      }
      return section;
    });
    setStructure(newStructure);
  };


  const validateStructure = () => {
    const sectionIds = new Set<string>();
    for (const section of structure) {
      if (!section.name.trim() || !section.id.trim()) {
        toast({ variant: "destructive", title: `Incomplete Section`, description: "Please provide a name and ID for all sections."});
        return false;
      }
      if (section.id.length !== 3) {
        toast({ variant: "destructive", title: `Invalid Section ID`, description: `Section ID "${section.id}" must be 3 characters long.`});
        return false;
      }
      if (sectionIds.has(section.id)) {
        toast({ variant: "destructive", title: `Duplicate Section ID`, description: `Section ID "${section.id}" must be unique.`});
        return false;
      }
      if (section.chapters.some(ch => !ch.name.trim())) {
         toast({ variant: "destructive", title: `Incomplete Chapter`, description: `Please provide a name for all chapters in section "${section.name}".`});
        return false;
      }
      sectionIds.add(section.id);
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
    if (structure.length === 0) {
      toast({
        variant: "destructive",
        title: "Structure Not Defined",
        description: "Please define at least one section and chapter before parsing.",
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
    if (!title.trim() || !hasQuestions) {
      alert("Please add a Title and at least one Question first!");
      return;
    }
    if (!validateStructure()) return;
    if (!user) {
      alert("You must be logged in to save a quiz.");
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
        isPublished: false, // Deployed quizzes are published implicitly
        createdAt: serverTimestamp(),
        ownerId: user.studentId, // Using studentId for ownership
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
      alert("SAVE FAILED: " + error.message);
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

        // 1. Set the quiz to published
        const quizRef = doc(db, "quizzes", quizId);
        batch.update(quizRef, { isPublished: true });

        // 2. Create assignments for each student
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
              Define sections and chapters. Use the AI parser to fill them with questions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {structure.map((section, sectionIndex) => (
                <Card key={sectionIndex} className="overflow-hidden bg-background">
                  <CardHeader className="flex flex-row items-center justify-between bg-muted/30 p-3">
                    <div className="flex flex-1 items-center gap-4">
                      <Input
                        placeholder="Section Name (e.g., Physics)"
                        value={section.name}
                        onChange={(e) =>
                          handleUpdateSection(sectionIndex, "name", e.target.value)
                        }
                        className="text-lg font-semibold border-0 focus-visible:ring-1"
                      />
                      <Input
                        placeholder="ID"
                        value={section.id}
                        onChange={(e) =>
                          handleUpdateSection(sectionIndex, "id", e.target.value)
                        }
                        maxLength={3}
                        className="w-24 text-lg font-mono tracking-widest border-0 focus-visible:ring-1 uppercase"
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveSection(sectionIndex)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </CardHeader>
                  <CardContent className="p-4">
                     {section.chapters.length > 0 ? (
                       <div className="space-y-3">
                         <Label className="text-xs text-muted-foreground">Chapters</Label>
                        {section.chapters.map((chapter, chapterIndex) => (
                          <div key={chapter.binaryCode} className="flex items-center gap-2">
                             <Input
                                placeholder="Chapter name"
                                value={chapter.name}
                                onChange={(e) => handleUpdateChapter(sectionIndex, chapterIndex, e.target.value)}
                              />
                              <code className="text-sm bg-muted px-2 py-1 rounded">
                                {chapter.binaryCode}
                              </code>
                               <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleRemoveChapter(sectionIndex, chapterIndex)}
                              >
                                <Trash2 className="h-4 w-4 text-destructive/70" />
                              </Button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="py-4 text-center text-sm text-muted-foreground">No chapters yet. Click 'Add Chapter' to start.</p>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-4"
                      onClick={() => handleAddChapter(sectionIndex)}
                      disabled={!section.id}
                    >
                      <Plus className="mr-2 h-4 w-4" /> Add Chapter
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
            <Button
              className="mt-4 w-full"
              variant="outline"
              onClick={handleAddSection}
            >
              <BookPlus className="mr-2 h-4 w-4" /> Add Section
            </Button>
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
