/**
 * @fileOverview A flow for parsing raw quiz text into a structured JSON format.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import type { QuizStructure, Section, Chapter, Question } from '@/types/quiz';


// The input schema remains the same, as we still need to provide this data to the flow.
export const QuizParserInputSchema = z.object({
  rawQuestions: z.string().describe("The raw, unstructured text containing all the quiz questions. Questions may be prefixed with markers like '#PHY #000001' to indicate their section and chapter."),
  rawAnswers: z.string().describe("The raw text of the answer key. This includes the correct option and potentially an explanation for each question number."),
  structure: z.array(z.object({
    id: z.string(),
    name: z.string(),
    chapters: z.array(z.object({
      name: z.string(),
      binaryCode: z.string(),
    })),
  })).describe("The predefined structure of the quiz. This provides context for section and chapter names."),
});
export type QuizParserInput = z.infer<typeof QuizParserInputSchema>;


// This is the FLAT schema we'll ask the AI to produce. It's much simpler.
const FlatQuestionOutputSchema = z.object({
    questionNumber: z.number().describe("The original number of the question from the raw text."),
    text: z.string().describe("The full text of the question."),
    options: z.array(z.object({
        id: z.string().describe("A, B, C, or D"),
        text: z.string(),
    })).describe("The multiple choice options for the question."),
    correctOptionId: z.string().describe("The ID (A, B, C, or D) of the correct option."),
    explanation: z.string().optional().describe("An explanation for the correct answer, if available in the answer key."),
    sectionId: z.string().describe("The 3-character ID of the section this question belongs to (e.g., 'PHY', 'CHE')."),
    chapterBinaryCode: z.string().describe("The 6-digit binary code of the chapter this question belongs to."),
});

const AiOutputSchema = z.object({
    questions: z.array(FlatQuestionOutputSchema)
});


// The final output schema of the FLOW remains the same nested structure.
// We are just changing how we get here.
export const QuizParserOutputSchema = z.object({
  parsedStructure: z.custom<QuizStructure>()
});
export type QuizParserOutput = z.infer<typeof QuizParserOutputSchema>;


export async function parseQuiz(input: QuizParserInput): Promise<QuizParserOutput> {
  return quizParserFlow(input);
}


// The prompt is updated to request the FLAT structure.
const quizParserPrompt = ai.definePrompt({
  name: 'quizParserPrompt',
  input: { schema: z.object({ // Prompt input is just the raw text parts
      rawQuestions: QuizParserInputSchema.shape.rawQuestions,
      rawAnswers: QuizParserInputSchema.shape.rawAnswers,
      structure: z.string(), // We'll stringify it
  }) },
  output: { schema: AiOutputSchema }, // The AI's direct output is the FLAT schema
  prompt: `You are an expert data parser for a competitive exam preparation app.
Your task is to convert raw text for questions and answers into a structured JSON format.

You will be given the raw questions, the raw answer key, and the target JSON structure of the quiz.

**Instructions:**

1.  **Parse Questions**: Read the raw questions text. Each question starts with a number (e.g., "1.", "2.").
2.  **Extract IDs**:
    *   Some questions will be prefixed with a section ID and a chapter binary code. The format can be space-separated (e.g., \`#PHY #000001 1. ...\`) or hyphen-separated (e.g., \`#3C0-001001 1. ...\`).
    *   For the hyphenated format like \`#3C0-001001\`, the sectionId is \`3C0\` and the chapterBinaryCode is \`001001\`. You must parse both formats correctly.
    *   Use these markers to get the \`sectionId\` and \`chapterBinaryCode\` for each question.
    *   If a question has no markers, it continues to belong to the previously specified chapter/section. The markers only appear when the chapter changes.
    *   If a question has markers that do not correspond to any defined section or chapter, assign it to a section with id "GEN" and chapter code "000000".
3.  **Parse Answers**: Read the raw answers text. Match the question number to find its correct answer and explanation.
4.  **Construct FLAT JSON**: Create a SINGLE FLAT ARRAY of question objects. Each object must conform to the JSON schema.
5.  **Strict Output**: The final output MUST be a single, valid JSON object that strictly conforms to the output schema. Do not include any other text, explanations, or markdown formatting like \`\`\`json. The output should be just the \`{ "questions": [...] }\` object.

**Input Data:**

*   **Reference Structure (for names):**
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

Now, parse the data and generate the flat JSON output.`,
});


// The flow now contains the re-grouping logic.
const quizParserFlow = ai.defineFlow(
  {
    name: 'quizParserFlow',
    inputSchema: QuizParserInputSchema,
    outputSchema: QuizParserOutputSchema,
  },
  async (input) => {
    // 1. Call the AI to get the flat list of questions
    const { output: flatData } = await quizParserPrompt({
        rawQuestions: input.rawQuestions,
        rawAnswers: input.rawAnswers,
        // @ts-ignore - handlebars templates can't be typed
        structure: JSON.stringify(input.structure.map(s => ({...s, chapters: s.chapters.map(c => ({name: c.name, binaryCode: c.binaryCode}))})), null, 2)
    });

    if (!flatData || !flatData.questions) {
        throw new Error('AI parsing failed to produce a valid question list.');
    }

    // 2. Group the flat list into the nested structure (the "re-grouping logic")
    const finalStructure: QuizStructure = JSON.parse(JSON.stringify(input.structure)); // Deep copy to start

    // Create a map for quick lookup of chapters
    const chapterMap: Map<string, Chapter> = new Map();
    finalStructure.forEach(section => {
        section.chapters.forEach(chapter => {
            chapter.questions = []; // Ensure questions array is initialized and empty
            const mapKey = `${section.id}__${chapter.binaryCode}`;
            chapterMap.set(mapKey, chapter);
        });
    });

    // A separate map for sections to add chapters to if they don't exist
    const sectionMap: Map<string, Section> = new Map();
    finalStructure.forEach(section => {
        sectionMap.set(section.id, section);
    });

    // Process each question from the AI's flat output
    flatData.questions.forEach(q => {
        const questionData: Question = {
            questionNumber: q.questionNumber,
            text: q.text,
            options: q.options,
            correctOptionId: q.correctOptionId,
            explanation: q.explanation
        };

        const mapKey = `${q.sectionId}__${q.chapterBinaryCode}`;
        let chapter = chapterMap.get(mapKey);

        if (!chapter) {
            let section = sectionMap.get(q.sectionId);
            if (!section) {
                section = {
                    id: q.sectionId,
                    name: `Section ${q.sectionId}`, // Default name if section is new
                    chapters: []
                };
                sectionMap.set(q.sectionId, section);
                finalStructure.push(section);
            }
            chapter = {
                name: `Chapter ${q.chapterBinaryCode}`, // Default name if chapter is new
                binaryCode: q.chapterBinaryCode,
                questions: []
            };
            section.chapters.push(chapter);
            chapterMap.set(mapKey, chapter);
        }
        
        chapter.questions?.push(questionData);
    });
    
    // Sort questions within each chapter by their original number
    finalStructure.forEach(section => {
        section.chapters.forEach(chapter => {
            chapter.questions?.sort((a, b) => a.questionNumber - b.questionNumber);
        });
    });

    return { parsedStructure: finalStructure };
  }
);
