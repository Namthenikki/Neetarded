export interface QuizSettings {
  duration: number; // in minutes
  positiveMarks: number;
  negativeMarks: number;
}

export interface Quiz {
  id: string;
  title: string;
  settings: QuizSettings;
  structure: QuizStructure;
  isPublished: boolean;
  createdAt: Date;
  ownerId: string;
}

export type QuizStructure = Section[];

export interface Section {
  id: string; // e.g., "PHY", "CHE", "BIO"
  name: string;
  chapters: Chapter[];
}

export interface Chapter {
  name: string;
  binaryCode: string; // 6-digit binary code
}

export interface Question {
  id: string;
  text: string;
  options: string[];
  correctAnswer: string;
  sectionId: string;
  chapterBinaryCode: string;
}
