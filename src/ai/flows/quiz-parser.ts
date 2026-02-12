/**
 * @fileOverview A flow for parsing raw quiz text into a structured JSON format.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

// We need a schema for the input structure without questions, as that's what we pass to the AI.
const InputChapterSchema = z.object({
  name: z.string(),
  binaryCode: z.string(),
});
const InputSectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  chapters: z.array(InputChapterSchema),
});

export const QuizParserInputSchema = z.object({
  rawQuestions: z.string().describe("The raw, unstructured text containing all the quiz questions. Questions may be prefixed with markers like '#PHY #000001' to indicate their section and chapter."),
  rawAnswers: z.string().describe("The raw text of the answer key. This includes the correct option and potentially an explanation for each question number."),
  structure: z.array(InputSectionSchema).describe("The predefined structure of the quiz, including sections and chapters with their unique IDs and binary codes. The AI should use this to correctly categorize the parsed questions."),
});
export type QuizParserInput = z.infer<typeof QuizParserInputSchema>;

// The output should be a full QuizStructure, which means it includes the questions.
const OutputQuestionSchema = z.object({
  questionNumber: z.number().describe("The original number of the question from the raw text."),
  text: z.string().describe("The full text of the question."),
  options: z.array(z.object({
    id: z.string().describe("A, B, C, or D"),
    text: z.string(),
  })).describe("The multiple choice options for the question."),
  correctOptionId: z.string().describe("The ID (A, B, C, or D) of the correct option."),
  explanation: z.string().optional().describe("An explanation for the correct answer, if available in the answer key."),
});

const OutputChapterSchema = z.object({
  name: z.string(),
  binaryCode: z.string(),
  questions: z.array(OutputQuestionSchema),
});

const OutputSectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  chapters: z.array(OutputChapterSchema),
});

export const QuizParserOutputSchema = z.object({
  parsedStructure: z.array(OutputSectionSchema),
});
export type QuizParserOutput = z.infer<typeof QuizParserOutputSchema>;

export async function parseQuiz(input: QuizParserInput): Promise<QuizParserOutput> {
  return quizParserFlow(input);
}

const quizParserPrompt = ai.definePrompt({
  name: 'quizParserPrompt',
  input: { schema: QuizParserInputSchema },
  output: { schema: QuizParserOutputSchema },
  prompt: `You are an expert data parser for a competitive exam preparation app.
Your task is to convert raw text for questions and answers into a structured JSON format.

You will be given the raw questions, the raw answer key, and the target JSON structure of the quiz (with sections and chapters defined).

**Instructions:**

1.  **Parse Questions**: Read the raw questions text. Each question starts with a number (e.g., "1.", "2.").
2.  **Assign to Chapters**:
    *   Some questions will be prefixed with a section ID and a chapter binary code (e.g., \`#PHY #000001 1. A ball is thrown...\`).
    *   Use these markers to assign the question to the correct chapter within the provided structure.
    *   If a question has no markers, it continues to belong to the previously specified chapter/section. The markers only appear when the chapter changes.
    *   If a question has markers that do not correspond to any defined section or chapter, assign it to a section with id "GEN" and name "General", under a chapter with name "Uncategorized" and binary code "000000".
3.  **Parse Answers**: Read the raw answers text. Match the question number to find its correct answer and explanation.
4.  **Construct JSON**: Populate the \`questions\` array for each chapter in the structure. Each question object must include the question number, text, options (A, B, C, D), the correct option ID, and an optional explanation.
5.  **Strict Output**: The final output MUST be a single, valid JSON object that strictly conforms to the output schema. Do not include any other text, explanations, or markdown formatting like \`\`\`json. The output should be just the \`{ "parsedStructure": [...] }\` object.

**Input Data:**

*   **Predefined Structure:**
    \`\`\`json
    {{{structure}}}
    \`\`\`
*   **Raw Questions:**
    \`\`\`
    {{{rawQuestions}}}
    \`\`\`
*   **Raw Answer Key:**
    \`\`\`
    {{{rawAnswers}}}
    \`\`\`

Now, parse the data and generate the JSON output.`,
});

const quizParserFlow = ai.defineFlow(
  {
    name: 'quizParserFlow',
    inputSchema: QuizParserInputSchema,
    outputSchema: QuizParserOutputSchema,
  },
  async (input) => {
    const { output } = await quizParserPrompt({
        ...input,
        // @ts-ignore - handlebars templates can't be typed
        structure: JSON.stringify(input.structure, null, 2)
    });
    if (!output) {
      throw new Error('AI parsing failed to produce an output.');
    }
    return output;
  }
);
