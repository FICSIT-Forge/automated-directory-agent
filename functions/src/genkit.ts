// Import the Genkit core libraries and plugins.
// The beta entry point is required for the Agents API (defineAgent /
// definePromptAgent / session stores) — issue #18. Beta APIs may break in
// minor releases; the test suite + emulator e2e are the safety net.
import { genkit } from "genkit/beta";
import { googleAI } from "@genkit-ai/google-genai";

export const ai = genkit({
  plugins: [googleAI()],
  model: googleAI.model("gemini-3-flash-preview"),
});
