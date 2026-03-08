export interface AuraFarmUserStats {
    studentId: string;
    currentStreak: number;
    longestStreak: number;
    lastActivityDate: string; // YYYY-MM-DD IST
    dailyDots: Record<string, number>; // Track total questions attempted per day 'YYYY-MM-DD' -> count
    streakFreezeAvailable: boolean; // Resets true on Monday
    streakFreezeUsedThisWeek: boolean;
}

export interface AuraFarmChapterStats {
    id: string; // studentId_chapterBinaryCode
    studentId: string;
    chapterBinaryCode: string; // The 6-digit binary code
    subjectId: string; // e.g. '1B0', '2P0', '3C0'
    questionsSeen: string[]; // Array of question IDs
    mistakePool: Record<string, number>; // questionId -> consecutiveCorrectCount
}

export interface AuraFarmAttempt {
    questionId: string;
    timeSpentSeconds: number;
    isCorrect: boolean;
    isAttempted: boolean;
    topicTag: string;
    difficulty: string; // 'easy', 'medium', 'hard' mapped from QuestionBank
    attemptTimestamp: number;
}

export interface AuraFarmSession {
    id?: string;
    studentId: string;
    subjectId: string;
    chapterBinaryCode: string;
    attempts: AuraFarmAttempt[];
    completedAt: any; // Firestore Timestamp
    totalTimeSpent: number;
    score: number;
    totalQuestions: number;
}

export interface TopicAnalysisItem {
    topic: string;
    attempted: number;
    correct: number;
    incorrect: number;
    skipped: number;
    avgTime: number;
    status: 'strong' | 'weak' | 'needs_practice' | 'not_attempted';
}

export interface SessionSummary {
    totalQuestions: number;
    totalAttempted: number;
    totalCorrect: number;
    totalIncorrect: number;
    totalSkipped: number;
    accuracy: number; // percentage based on attempted
}

export interface AuraFarmAIAnalysis {
    sessionId: string;
    studentId: string;
    timePerformanceBreakdown: {
        averageTimePerQuestion: number;
        slowestQuestion: { topic: string; timeTaken: number; isCorrect: boolean };
        fastestQuestion: { topic: string; timeTaken: number; isCorrect: boolean };
        topicWiseAverageTime: Record<string, number>; // topic -> average time
    };
    sessionSummary: SessionSummary;
    topicAnalysis: TopicAnalysisItem[];
    redFlags: {
        type: 'danger_zone' | 'concept_gap' | 'careless_rushing' | 'slow_but_correct' | 'ideal_zone';
        topic: string;
        message: string;
    }[];
    practiceRecommendations: string[];
    mentorVerdict: string;
    createdAt: any; // Firestore timestamp
}
