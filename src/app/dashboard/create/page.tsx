"use client";

import { useState } from "react";
import { Plus, Save, Trash2, BookPlus, Loader2 } from "lucide-react";
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
import type { QuizStructure, Section, Chapter, QuizSettings } from "@/types/quiz";
import { useToast } from "@/hooks/use-toast";
import { doc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { useAuth } from "@/hooks/use-auth";
import { useRouter } from "next/navigation";

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
  const [structure, setStructure] = useState<Section[]>([]);
  const [questions, setQuestions] = useState("");
  const [answers, setAnswers] = useState("");
  const [isSaving, setIsSaving] = useState(false);

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
    const name = prompt("Enter chapter name:");
    if (name) {
      const newStructure = [...structure];
      const section = newStructure[sectionIndex];
      const existingCodes = getAllBinaryCodes();
      const newChapter: Chapter = {
        name,
        binaryCode: generateBinaryCode(existingCodes),
      };
      section.chapters.push(newChapter);
      setStructure(newStructure);
    }
  };

  const handleRemoveChapter = (
    sectionId: string,
    chapterBinaryCode: string
  ) => {
    const newStructure = structure.map((section) => {
      if (section.id === sectionId) {
        return {
          ...section,
          chapters: section.chapters.filter(
            (c) => c.binaryCode !== chapterBinaryCode
          ),
        };
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
      sectionIds.add(section.id);
    }
    return true;
  };

  const handleSaveDraft = async () => {
    if (!title) {
      toast({ variant: "destructive", title: "Title is required." });
      return;
    }
    if (!validateStructure()) {
      return;
    }
    if (!user) {
      toast({
        variant: "destructive",
        title: "You must be logged in to save a quiz.",
      });
      return;
    }
    setIsSaving(true);
    try {
      const quizId = `${title.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`;

      const finalStructure: QuizStructure = structure.map(s => ({
        id: s.id,
        name: s.name,
        chapters: s.chapters,
      }));

      await setDoc(doc(db, "quizzes", quizId), {
        id: quizId,
        title,
        settings,
        structure: finalStructure,
        isPublished: false,
        createdAt: new Date(),
        ownerId: user.uid,
      });

      toast({
        title: "Draft Saved!",
        description: `Quiz "${title}" has been saved successfully.`,
      });

      router.push("/dashboard/quizzes");
    } catch (error) {
      console.error("Error saving draft:", error);
      toast({
        variant: "destructive",
        title: "Uh oh! Something went wrong.",
        description: "Could not save quiz draft.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="p-4 md:p-8 relative min-h-screen">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Create a New Quiz</h1>
        <p className="text-muted-foreground">
          Follow the steps below to build your quiz.
        </p>
      </header>

      <div className="space-y-8 max-w-4xl mx-auto pb-24">
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
              Define the sections and chapters for your quiz.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {structure.map((section, index) => (
                <Card key={index} className="overflow-hidden bg-background">
                  <CardHeader className="flex flex-row items-center justify-between bg-muted/30 p-3">
                    <div className="flex flex-1 items-center gap-4">
                      <Input
                        placeholder="Section Name (e.g., Physics)"
                        value={section.name}
                        onChange={(e) =>
                          handleUpdateSection(index, "name", e.target.value)
                        }
                        className="text-lg font-semibold border-0 focus-visible:ring-1"
                      />
                      <Input
                        placeholder="ID"
                        value={section.id}
                        onChange={(e) =>
                          handleUpdateSection(index, "id", e.target.value)
                        }
                        className="w-24 text-lg font-mono tracking-widest border-0 focus-visible:ring-1"
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveSection(index)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </CardHeader>
                  <CardContent className="p-4">
                    <ul className="space-y-2">
                      {section.chapters.map((chapter) => (
                        <li
                          key={chapter.binaryCode}
                          className="flex items-center justify-between"
                        >
                          <span>{chapter.name}</span>
                          <div className="flex items-center gap-2">
                            <code className="text-sm bg-muted px-2 py-1 rounded">
                              {chapter.binaryCode}
                            </code>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() =>
                                handleRemoveChapter(
                                  section.id,
                                  chapter.binaryCode
                                )
                              }
                            >
                              <Trash2 className="h-4 w-4 text-destructive/70" />
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-4"
                      onClick={() => handleAddChapter(index)}
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
              Paste your raw question text and the answer key below.
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
            <Button disabled className="w-full">
              Generate with AI (Coming Soon)
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Phase D: Save Draft */}
      <Button
        className="fixed bottom-6 right-6 h-16 w-16 rounded-full shadow-lg z-50 md:bottom-8 md:right-8"
        onClick={handleSaveDraft}
        disabled={isSaving}
      >
        {isSaving ? (
          <Loader2 className="h-7 w-7 animate-spin" />
        ) : (
          <Save className="h-7 w-7" />
        )}
        <span className="sr-only">Save Draft</span>
      </Button>
    </div>
  );
}

    