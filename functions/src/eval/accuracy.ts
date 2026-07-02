/**
 * LLM-as-judge evaluator for game data accuracy.
 *
 * Scores how factually accurate the agent's response is by comparing it
 * against reference answers derived from actual Satisfactory game data.
 * Used with `genkit eval:run` to measure RAG quality.
 */

import { z } from "genkit";
import { googleAI } from "@genkit-ai/google-genai";
import { ai } from "../genkit.js";

const JUDGE_PROMPT = `You are an expert evaluator for a Satisfactory game assistant chatbot.
Your job is to judge whether the assistant's answer is factually accurate
compared to the reference answer, which comes from real game data.

Score on a scale of 0 to 1:
- 1.0: Fully accurate — all numbers, names, and relationships match the reference
- 0.75: Mostly accurate — minor omissions but no wrong facts
- 0.5: Partially accurate — some correct info mixed with errors or significant omissions
- 0.25: Mostly inaccurate — few correct details, mostly wrong or fabricated
- 0.0: Completely wrong or fabricated

Focus on factual correctness of:
- Item/recipe names
- Ingredient amounts and production rates
- Power consumption/production values
- Building assignments (what building produces what)
- Tier/milestone unlock information

Do NOT penalize for personality, tone, or extra helpful context that is still accurate.

Question: {{question}}

Reference Answer: {{reference}}

Assistant's Answer: {{answer}}

Respond with a JSON object: { "score": <number>, "reason": "<brief explanation>" }`;

function coerceToString(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

export const accuracyEvaluator = ai.defineEvaluator(
  {
    name: "accuracy",
    displayName: "Game Data Accuracy",
    definition:
      "Evaluates whether the agent's response contains factually accurate Satisfactory game data (recipes, rates, power, unlocks) compared to a reference answer.",
  },
  async (datapoint) => {
    const question = coerceToString(datapoint.input);
    const answer = coerceToString(datapoint.output);
    const reference = coerceToString(datapoint.reference);

    const prompt = JUDGE_PROMPT.replace("{{question}}", question)
      .replace("{{reference}}", reference)
      .replace("{{answer}}", answer);

    const { output } = await ai.generate({
      model: googleAI.model("gemini-2.5-flash"),
      prompt,
      output: {
        schema: z.object({
          score: z.number().min(0).max(1),
          reason: z.string(),
        }),
      },
    });

    return {
      testCaseId: datapoint.testCaseId,
      evaluation: {
        score: output?.score ?? 0,
        details: { reasoning: output?.reason ?? "No response from judge" },
      },
    };
  },
);
