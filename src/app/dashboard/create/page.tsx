
"use client";

import { useState, useMemo } from "react";
import { Plus, Save, Trash2, BookPlus, Loader2, BrainCircuit, Play, Globe, Clipboard } from "lucide-react";
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
import { generateBinaryCode } from "@/lib/binaryUtils";
import type { QuizStructure, Chapter, QuizSettings } from "@/types/quiz";
import { useToast } from "@/hooks/use-toast";
import { doc, setDoc, addDoc, collection } from "firebase/firestore";
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

  const [title, setTitle] = useState("");
  const [settings, setSettings] = useState<QuizSettings>({
    duration: 180,
    positiveMarks: 4,
    negativeMarks: -1,
  });
  const [structure, setStructure] = useState<QuizStructure>([]);
  const [questions, setQuestions] = useState("");
  const [answers, setAnswers] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [publishedQuizId, setPublishedQuizId] = useState("");

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
        toast({
          variant: "destructive",
          title: "Incomplete Section",
          description: `Please provide a name and ID for all sections.`,
        });
        return false;
      }
      if (section.id.length !== 3) {
        toast({
          variant: "destructive",
          title: "Invalid Section ID",
          description: `Section ID "${section.id}" must be 3 characters long.`,
        });
        return false;
      }
      if (sectionIds.has(section.id)) {
        toast({
          variant: "destructive",
          title: "Duplicate Section ID",
          description: `Section ID "${section.id}" must be unique.`,
        });
        return false;
      }
      if (section.chapters.some(ch => !ch.name.trim())) {
         toast({
          variant: "destructive",
          title: "Incomplete Chapter",
          description: `Please provide a name for all chapters in section "${section.name}".`,
        });
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
  
  const handleSave = async (action: "start" | "publish") => {
    console.log("Button Clicked:", action);
    if (!title || !hasQuestions) {
      toast({
        variant: "destructive",
        title: "Missing Information",
        description: "Please provide a Quiz Title and add questions before saving.",
      });
      return;
    }
    if (!validateStructure()) {
      return;
    }
    if (!user) {
      toast({
        variant: "destructive",
        title: "Authentication Error",
        description: "You must be logged in to save a quiz.",
      });
      return;
    }

    setIsSaving(true);
    try {
      const isPublished = action === 'publish';
      const quizPayload = {
        title,
        settings,
        structure,
        isPublished,
        createdAt: new Date(),
        ownerId: user.uid,
      };
      
      const docRef = await addDoc(collection(db, "quizzes"), quizPayload);
      // Now update the document with its own ID
      await setDoc(doc(db, "quizzes", docRef.id), { id: docRef.id }, { merge: true });

      if (action === 'start') {
        toast({
            title: "Draft Saved!",
            description: "Starting your quiz now...",
        });
        router.push(`/quiz/${docRef.id}`);
      } else { // publish
        setPublishedQuizId(docRef.id);
        setShowSuccessModal(true);
      }

    } catch (error) {
      console.error("Error saving quiz:", error);
      toast({
        variant: "destructive",
        title: "Uh oh! Something went wrong.",
        description: "Could not save the quiz.",
      });
    } finally {
      setIsSaving(false);
    }
  };
  
  const copyLinkToClipboard = () => {
    if(!publishedQuizId) return;
    const link = `${window.location.origin}/quiz/${publishedQuizId}`;
    navigator.clipboard.writeText(link);
    toast({
        title: "Link Copied!",
        description: "The shareable link has been copied to your clipboard.",
    });
  };

  const isActionDisabled = isSaving || isAnalyzing;

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
            <Button onClick={handleAiParse} disabled={isAnalyzing || isSaving} className="w-full">
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

        {/* Action Bar */}
        <div className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/90 p-4 backdrop-blur-sm md:left-64">
            <div className="mx-auto flex max-w-4xl items-center justify-end gap-4">
                <Button
                    variant="secondary"
                    onClick={() => handleSave('start')}
                    disabled={isActionDisabled}
                >
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                    Start Quiz Now
                </Button>
                <Button
                    onClick={() => handleSave('publish')}
                    disabled={isActionDisabled}
                >
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Globe className="mr-2 h-4 w-4" />}
                    Publish & Share
                </Button>
            </div>
        </div>

        {/* Success Modal */}
        <AlertDialog open={showSuccessModal} onOpenChange={setShowSuccessModal}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Quiz Published Successfully!</AlertDialogTitle>
                    <AlertDialogDescription>
                        Anyone with this link can now attempt your quiz.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="space-y-2 pt-2">
                  <Label htmlFor="share-link" className="text-sm font-medium">Shareable Link</Label>
                  <div className="flex gap-2">
                    <Input id="share-link" readOnly value={`${window.location.origin}/quiz/${publishedQuizId}`} />
                    <Button onClick={copyLinkToClipboard} variant="outline" size="icon">
                        <Clipboard className="h-4 w-4" />
                        <span className="sr-only">Copy Link</span>
                    </Button>
                  </div>
                </div>
                <AlertDialogFooter className="mt-4">
                    <Button variant="outline" onClick={() => router.push('/dashboard')}>
                        Go to Dashboard
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>

    </div>
  );

    