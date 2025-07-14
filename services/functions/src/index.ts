import { genkit, z } from "genkit";
import { googleAI } from "@genkit-ai/googleai";
import { onCallGenkit } from "firebase-functions/https";
import { defineSecret } from "firebase-functions/params";

const apiKey = defineSecret("GEMINI_API_KEY");

const ai = genkit({
  plugins: [googleAI()],
  model: googleAI.model('gemini-2.5-flash')
});

const generatePoemFlow = ai.defineFlow(
  {
    name: "generatePoem",
    inputSchema: z.string(),
    outputSchema: z.string(),
  },
  async (subject: string) => {
    const { text } = await ai.generate(`Comport a poem about ${subject}.`);
    return text;
  }
);

export const generatePoem = onCallGenkit(
  {
    secrets: [apiKey],
  },
  generatePoemFlow
);
