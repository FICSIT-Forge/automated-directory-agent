import { ai } from "./genkit.js";

// Register game data tools with Genkit runtime (side-effect imports)
import "./tools/gameDataTools.js";

// Cloud Functions for Firebase supports Genkit natively. The onCallGenkit function creates a callable
// function from a Genkit action. It automatically implements streaming if your flow does.
// The https library also has other utility methods such as hasClaim, which verifies that
// a caller's token has a specific claim (optionally matching a specific value)
import { onCallGenkit } from "firebase-functions/https";

// Genkit models generally depend on an API key. APIs should be stored in Cloud Secret Manager so that
// access to these sensitive values can be controlled. defineSecret does this for you automatically.
// If you are using Google generative AI you can get an API key at https://aistudio.google.com/app/apikey
import { defineSecret } from "firebase-functions/params";
const apiKey = defineSecret("GEMINI_API_KEY");

// The Firebase telemetry plugin exports a combination of metrics, traces, and logs to Google Cloud
// Observability. Traces include full tool inputs/outputs — the detailed half of the
// per-turn record; the structured "adagent_turn" log below is the cheap queryable half.
// See https://firebase.google.com/docs/genkit/observability/telemetry-collection.
import { enableFirebaseTelemetry } from "@genkit-ai/firebase";
import * as logger from "firebase-functions/logger";
import { UserFacingError } from "genkit";
import { parseTurnRequest } from "./request.js";
import { checkRateLimit } from "./rateLimiter.js";
enableFirebaseTelemetry();

const adagentFlow = ai.defineFlow(
  {
    name: "adagentFlow",
  },
  async (input, { sendChunk }) => {
    const startMs = Date.now();
    // Normalize the client payload FIRST: the raw object must never reach the
    // prompt (it renders as "[object Object]" and the model never sees the
    // question). Do not add inputSchema here — see CLAUDE.md gotcha.
    const { question, sessionId } = parseTurnRequest(input);
    try {
      const rate = await checkRateLimit(sessionId);
      if (!rate.allowed) {
        logger.warn("adagent_rate_limited", {
          blockedBy: rate.blockedBy,
          retryAfterSecs: rate.retryAfterSecs,
          sessionId,
        });
        throw new UserFacingError(
          "RESOURCE_EXHAUSTED",
          "FICSIT compliance notice: this terminal has exceeded its allotted " +
            "inquiry quota. Productivity is appreciated — please resume " +
            `in ${Math.ceil((rate.retryAfterSecs ?? 3600) / 60)} minutes.`,
        );
      }

      // Construct prompt using prompts/adagent.prompt.
      const adagentPrompt = ai.prompt("adagent");

      const { response, stream } = adagentPrompt.stream({ question });

      for await (const chunk of stream) {
        sendChunk(chunk.text);
      }

      const result = await response;

      // One structured record per turn: question → tool calls → answer shape.
      // This is the raw material for gold-set / accuracy-dataset triage
      // (issue #7). No user identifiers.
      const toolCalls = result.messages
        .flatMap((m) => m.content)
        .filter((part) => part.toolRequest)
        .map((part) => ({
          tool: part.toolRequest?.name,
          input: part.toolRequest?.input,
        }));
      logger.info("adagent_turn", {
        question,
        sessionId,
        toolCalls,
        answerChars: result.text.length,
        latencyMs: Date.now() - startMs,
      });

      return result.text;
    } catch (e) {
      // Genkit/Google AI error objects can crash util.inspect in Firebase's
      // logger — log plain strings only.
      // NB: field must not be named "message" — the logger merges this object
      // into jsonPayload and a "message" key would clobber the log marker.
      logger.error("adagent_turn_error", {
        question,
        sessionId,
        latencyMs: Date.now() - startMs,
        error: e instanceof Error ? e.message : String(e),
        errorStack: e instanceof Error ? e.stack : undefined,
      });
      throw e;
    }
  },
);

export { submitFeedback } from "./feedback.js";

export const adagent = onCallGenkit(
  {
    memory: "1GiB",
    // Force redeploy
    // Uncomment to enable AppCheck. This can reduce costs by ensuring only your Verified
    // app users can use your API. Read more at https://firebase.google.com/docs/app-check/cloud-functions
    enforceAppCheck: true,

    // authPolicy can be any callback that accepts an AuthData (a uid and tokens dictionary) and the
    // request data. The isSignedIn() and hasClaim() helpers can be used to simplify. The following
    // will require the user to have the email_verified claim, for example.
    // authPolicy: hasClaim("email_verified"),

    // Grant access to the API key to this function:
    secrets: [apiKey],
    // cors: true,
  },
  adagentFlow,
);
