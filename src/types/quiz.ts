export interface QuizSettings {
  duration: number; // in minutes
  positiveMarks: number;
  negativeMarks: number;
}

export interface Question {
  questionNumber: number;
  text: string;
  options: { id: string; text: string }[];
  correctOptionId: string;
  explanation?: string;
}

export interface Chapter {
  name: string;
  binaryCode: string; // 6-digit binary code
  questions?: Question[];
}

export interface Section {
  id: string; // e.g., "PHY", "CHE", "BIO"
  name: string;
  chapters: Chapter[];
}

export type QuizStructure = Section[];

export interface Quiz {
  id: string;
  title: string;
  settings: QuizSettings;
  structure: QuizStructure;
  isPublished: boolean;
  createdAt: Date;
  ownerId: string;
}
