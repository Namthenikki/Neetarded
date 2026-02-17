/**
 * @fileOverview A flow for parsing raw quiz text into a structured JSON format.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import type { QuizStructure, Section, Chapter, Question } from '@/types/quiz';
import { QUIZ_SUBJECTS } from '@/lib/quiz-data';


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

    // 2. Build a master lookup map for ALL possible chapters from the canonical source
    const masterChapterMap: Map<string, { name: string; subjectId: string }> = new Map();
    QUIZ_SUBJECTS.forEach(subject => {
        subject.chapters.forEach(chapter => {
            const mapKey = `${subject.id}__${chapter.binaryCode}`;
            masterChapterMap.set(mapKey, { name: chapter.name, subjectId: subject.id });
        });
    });

    // 3. Group the flat list into the nested structure (the "re-grouping logic")
    const finalStructure: QuizStructure = JSON.parse(JSON.stringify(input.structure)); // Deep copy to start

    // Create maps for quick lookups of existing sections and chapters
    const sectionMap = new Map<string, Section>(finalStructure.map(s => [s.id, s]));
    const chapterMap = new Map<string, Chapter>();
    finalStructure.forEach(section => {
        section.chapters.forEach(chapter => {
            chapter.questions = []; // Ensure questions array is initialized and empty
            const mapKey = `${section.id}__${chapter.binaryCode}`;
            chapterMap.set(mapKey, chapter);
        });
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

        // If the chapter doesn't exist in the admin-defined structure, create it dynamically
        if (!chapter) {
            // Find its parent section. If it doesn't exist, create it too.
            let section = sectionMap.get(q.sectionId);
            if (!section) {
                const subjectData = QUIZ_SUBJECTS.find(s => s.id === q.sectionId);
                section = {
                    id: q.sectionId,
                    name: subjectData ? subjectData.name : `Section ${q.sectionId}`,
                    chapters: []
                };
                sectionMap.set(q.sectionId, section);
                finalStructure.push(section); // Add new section to the main structure
            }
            
            // Look up the correct chapter name from our master list
            const masterChapterData = masterChapterMap.get(mapKey);
            
            chapter = {
                name: masterChapterData ? masterChapterData.name : `Chapter ${q.chapterBinaryCode}`,
                binaryCode: q.chapterBinaryCode,
                questions: []
            };
            
            section.chapters.push(chapter); // Add the new chapter to its section
            chapterMap.set(mapKey, chapter); // Add to map for future lookups
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
