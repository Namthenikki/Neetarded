'use server';

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const AuraFarmMentorInputSchema = z.object({
    studentName: z.string(),
    totalQuestions: z.number(),
    totalAttempted: z.number(),
    correctAnswers: z.number(),
    scorePercentage: z.number(),
    timeTakenMinutes: z.number(),
    totalSkipped: z.number(),
    totalIncorrect: z.number(),
    chapterName: z.string(),
    subjectName: z.string(),
    questionDetails: z.array(
        z.object({
            questionNumber: z.number(),
            questionText: z.string(),
            isAttempted: z.boolean(),
            isCorrect: z.boolean(),
            timeSpentSeconds: z.number(),
            difficulty: z.string(),
        })
    ),
});

export type AuraFarmMentorInput = z.infer<typeof AuraFarmMentorInputSchema>;

const AuraFarmMentorOutputSchema = z.object({
    timePerformanceBreakdown: z.object({
        averageTimePerQuestion: z.number(),
        slowestQuestion: z.object({
            topic: z.string(),
            timeTaken: z.number(),
            isCorrect: z.boolean()
        }),
        fastestQuestion: z.object({
            topic: z.string(),
            timeTaken: z.number(),
            isCorrect: z.boolean()
        }),
        topicWiseAverageTime: z.record(z.number())
    }),
    questionTopics: z.array(
        z.object({
            questionNumber: z.number(),
            classifiedTopic: z.string()
        })
    ),
    topicAnalysis: z.array(
        z.object({
            topic: z.string(),
            status: z.enum(['strong', 'weak', 'needs_practice', 'not_attempted']),
            insight: z.string()
        })
    ),
    redFlags: z.array(
        z.object({
            type: z.enum(['danger_zone', 'concept_gap', 'careless_rushing', 'slow_but_correct', 'ideal_zone']),
            topic: z.string(),
            message: z.string()
        })
    ),
    practiceRecommendations: z.array(z.string()),
    mentorVerdict: z.string()
});

export type AuraFarmMentorOutput = z.infer<typeof AuraFarmMentorOutputSchema>;

const auraFarmMentorPrompt = ai.definePrompt({
    name: 'auraFarmMentorPrompt',
    input: { schema: AuraFarmMentorInputSchema },
    output: { schema: AuraFarmMentorOutputSchema },
    prompt: `You are a strict but caring professional NEET mentor. You are analyzing a student's daily "Aura Farm" practice session. 
Your goal is to provide sharp, direct, no-sugarcoating, actionable advice based on their performance, with a specific focus on time management, accuracy, and topic-wise strength/weakness analysis.

CRITICAL NEET CONTEXT YOU MUST ENFORCE:
- NEET gives students exactly 3 hours 20 minutes for 180 questions (roughly 66 seconds per question).
- Any question taking beyond 90 seconds is a "danger zone".
- NEET heavily penalizes wrong answers (-1 negative marking). Rushing and guessing is extremely dangerous.
- The ideal profile: fast on easy/medium questions, composed on hard ones, never sacrificing accuracy for speed.
- Time mismanagement is the #1 reason students fail.
- Skipping questions strategically can be smart, but excessive skipping indicates lack of preparation.

SESSION CONTEXT:
- Subject: {{{subjectName}}}
- Chapter: {{{chapterName}}}
- Total Questions Seen: {{{totalQuestions}}}
- Total Questions Attempted: {{{totalAttempted}}}
- Total Skipped: {{{totalSkipped}}}
- Total Incorrect: {{{totalIncorrect}}}
- Correct Answers: {{{correctAnswers}}}
- Score (on attempted): {{{scorePercentage}}}%
- Total Time: {{{timeTakenMinutes}}} minutes

STUDENT: {{{studentName}}}

QUESTIONS ATTEMPTED (Read each question carefully and classify its specific topic/sub-topic):
{{#each questionDetails}}
- Q{{questionNumber}}: "{{questionText}}" | Difficulty '{{difficulty}}' | Attempted: {{isAttempted}} | Correct: {{isCorrect}} | Time: {{timeSpentSeconds}}s
{{/each}}

YOUR TASK — STEP BY STEP:

**STEP 1: CLASSIFY EACH QUESTION'S TOPIC (questionTopics array)**
Read each question text carefully. Based on the chapter "{{{chapterName}}}" in subject "{{{subjectName}}}", classify each question into its specific sub-topic within that chapter. For example:
- If the chapter is "Cell Biology", topics could be: "Cell Organelles", "Cell Division", "Cell Membrane Transport", etc.
- If the chapter is "Chemical Bonding", topics could be: "Ionic Bonding", "Covalent Bonding", "VSEPR Theory", "Molecular Orbital Theory", etc.
- Be specific — do NOT use generic labels like "General" or just repeat the chapter name.
Return the topic for EVERY question as questionTopics array with questionNumber and classifiedTopic.

**STEP 2: TOPIC ANALYSIS (topicAnalysis array)**
After classifying all questions, group them by topic and for EACH topic, classify it:
- 'strong': High accuracy (70%+) AND reasonable time (<80s avg). Student is confident here.
- 'weak': Low accuracy (<50%) OR many incorrect answers. Needs immediate revision.
- 'needs_practice': Decent accuracy but slow (>80s avg), OR moderate accuracy (50-70%). Can improve with practice.
- 'not_attempted': All questions in this topic were skipped.
Include a 1-line insight for each topic explaining WHY you classified it that way, referencing the student's actual performance.

**STEP 3: RED FLAGS (redFlags array, max 5)**
Identify specific topics (using YOUR classified topic names) that fall into these categories:
- danger_zone: Questions taking > 90 seconds.
- concept_gap: Slow AND wrong. (e.g. "You spent 3 min on Cell Division questions and got 2/3 wrong.")
- careless_rushing: Fast BUT wrong. (e.g. "Blazing through Ionic Bonding at 28s but 40% accuracy. NEET punishes this.")
- slow_but_correct: Slow BUT correct. (e.g. "Good accuracy on Thermodynamics, but 110s per question won't survive the exam.")
- ideal_zone: Fast AND correct. Celebrate this.

**STEP 4: PRACTICE RECOMMENDATIONS (practiceRecommendations array, 3-5 items)**
Give specific, actionable recommendations referencing the CLASSIFIED TOPICS:
- "Revise [specific topic] fundamentals before practicing more questions"
- "Practice [specific topic] timed — aim for under 60s per question"
- "Your [specific topic] is strong — maintain it with daily practice"

**STEP 5: MENTOR VERDICT (mentorVerdict string)**
A 4-5 line overall assessment that:
- Calls out the student's strongest and weakest topics BY NAME (your classified names)
- States what their biggest exam-day risk is if this pattern continues
- Gives one clear priority action for tomorrow
- References specific numbers (accuracy%, time taken)

Return the data structured exactly matching the provided JSON schema.`
});

export const auraFarmMentorAnalysisFlow = ai.defineFlow(
    {
        name: 'auraFarmMentorAnalysisFlow',
        inputSchema: AuraFarmMentorInputSchema,
        outputSchema: AuraFarmMentorOutputSchema,
    },
    async (input) => {
        const { output } = await auraFarmMentorPrompt(input);
        return output!;
    }
);
