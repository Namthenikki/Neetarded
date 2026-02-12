"use server";

import {
  parseQuiz,
  type QuizParserInput,
  type QuizParserOutput,
} from "@/ai/flows/quiz-parser";

export async function generateQuizAction(
  input: QuizParserInput
): Promise<QuizParserOutput> {
  return parseQuiz(input);
}
