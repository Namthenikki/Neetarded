'use server';
/**
 * @fileOverview Provides AI-powered analysis of quiz performance and personalized suggestions for improvement.
 *
 * - quizPerformanceAnalysis - A function that handles the quiz performance analysis process.
 * - QuizPerformanceAnalysisInput - The input type for the quizPerformanceAnalysis function.
 * - QuizPerformanceAnalysisOutput - The return type for the quizPerformanceAnalysis function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const QuizPerformanceAnalysisInputSchema = z.object({
  quizAttemptId: z.string().describe('A unique identifier for the quiz attempt.'),
  userName: z.string().describe('The name of the user taking the quiz.'),
  examName: z.string().describe('The name of the competitive exam (e.g., NEET, JEE Mains).'),
  totalQuestions: z.number().describe('The total number of questions in the quiz.'),
  correctAnswers: z.number().describe('The number of questions answered correctly.'),
  incorrectAnswers: z.number().describe('The number of questions answered incorrectly.'),
  unattemptedQuestions: z.number().describe('The number of questions not attempted.'),
  scorePercentage: z.number().describe('The overall score percentage for the quiz.'),
  timeTakenMinutes: z.number().describe('The total time taken to complete the quiz in minutes.'),
  questionDetails: z.array(
    z.object({
      questionNumber: z.number().describe('The sequential number of the question.'),
      topic: z.string().describe('The topic or subject area of the question (e.g., Physics: Mechanics, Biology: Genetics).'),
      isCorrect: z.boolean().describe('Whether the user answered the question correctly.'),
      timeSpentSeconds: z.number().describe('The time spent by the user on this specific question in seconds.'),
      difficulty: z.enum(['Easy', 'Medium', 'Hard']).describe('The difficulty level of the question.'),
    })
  ).describe('Detailed information about each question in the quiz and the user\'s interaction.'),
});
export type QuizPerformanceAnalysisInput = z.infer<typeof QuizPerformanceAnalysisInputSchema>;

const QuizPerformanceAnalysisOutputSchema = z.object({
  summary: z.string().describe('An overall summary of the user\'s quiz performance.'),
  strongAreas: z.array(z.string()).describe('A list of topics or areas where the user performed well.'),
  weakAreas: z.array(z.string()).describe('A list of topics or areas where the user needs to improve.'),
  timeManagementAnalysis: z.string().describe('Feedback and analysis on the user\'s time management during the quiz.'),
  difficultyAnalysis: z.string().describe('Analysis of the user\'s performance across different difficulty levels.'),
  personalizedRecommendations: z.array(z.string()).describe('Specific, actionable advice and study strategy recommendations.'),
});
export type QuizPerformanceAnalysisOutput = z.infer<typeof QuizPerformanceAnalysisOutputSchema>;

export async function quizPerformanceAnalysis(input: QuizPerformanceAnalysisInput): Promise<QuizPerformanceAnalysisOutput> {
  return quizPerformanceAnalysisFlow(input);
}

const quizPerformanceAnalysisPrompt = ai.definePrompt({
  name: 'quizPerformanceAnalysisPrompt',
  input: { schema: QuizPerformanceAnalysisInputSchema },
  output: { schema: QuizPerformanceAnalysisOutputSchema },
  prompt: `You are an expert AI-powered study advisor for competitive exam aspirants. Your goal is to analyze the user's quiz performance and provide insightful, personalized suggestions to help them identify weak areas and optimize their study strategy.

Analyze the following quiz performance data for {{{userName}}} for the {{{examName}}} exam (Quiz ID: {{{quizAttemptId}}}):

Overall Performance:
- Total Questions: {{{totalQuestions}}}
- Correct Answers: {{{correctAnswers}}}
- Incorrect Answers: {{{incorrectAnswers}}}
- Unattempted Questions: {{{unattemptedQuestions}}}
- Score Percentage: {{{scorePercentage}}}%
- Total Time Taken: {{{timeTakenMinutes}}} minutes

Question-wise Details:
{{#each questionDetails}}
  - Question {{questionNumber}}: Topic '{{topic}}', Difficulty '{{difficulty}}', Correct: {{isCorrect}}, Time Spent: {{timeSpentSeconds}} seconds
{{/each}}

Based on this data, provide a comprehensive analysis focusing on the following aspects:
1.  **Summary**: A concise overall summary of the user's performance.
2.  **Strong Areas**: Identify specific topics or areas where the user demonstrated good understanding and performance.
3.  **Weak Areas**: Pinpoint specific topics or areas that require significant improvement. Be as granular as possible.
4.  **Time Management Analysis**: Comment on how well the user managed their time, highlighting instances of spending too much or too little time on questions, and suggest improvements.
5.  **Difficulty Analysis**: Analyze performance across 'Easy', 'Medium', and 'Hard' questions. Did they struggle disproportionately with a certain difficulty?
6.  **Personalized Recommendations**: Offer concrete, actionable advice for study strategy, resource utilization, and practice methods to address weak areas and improve overall performance.

Ensure your response is structured exactly as per the specified JSON schema.`,
});

const quizPerformanceAnalysisFlow = ai.defineFlow(
  {
    name: 'quizPerformanceAnalysisFlow',
    inputSchema: QuizPerformanceAnalysisInputSchema,
    outputSchema: QuizPerformanceAnalysisOutputSchema,
  },
  async (input) => {
    const { output } = await quizPerformanceAnalysisPrompt(input);
    return output!;
  }
);
