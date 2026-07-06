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

// Observability has three deliberate layers (issue #7):
//  1. OTel traces/metrics via the Firebase telemetry plugin → Cloud Trace /
//     Monitoring. Full span-level fidelity for interactively debugging a
//     single turn in the Genkit Monitoring console. Span schema is a Genkit
//     internal — nothing of ours may parse it.
//  2. The `turns` Firestore collection (TurnStore): one self-contained,
//     schema-stable record per turn. System of record for eval mining
//     (scripts/mineTurns.ts) — no log-retention window, joins with
//     `feedback` in the same database.
//  3. The `adagent_turn` log line: synchronous stdout, delivered even if the
//     instance dies mid-turn. Ops/alerting signal and fallback record.
import { enableFirebaseTelemetry } from "@genkit-ai/firebase";
import * as logger from "firebase-functions/logger";
import { UserFacingError } from "genkit";
import { parseTurnRequest } from "./request.js";
import { getDb } from "./firestore.js";
import { RateLimiter } from "./rateLimiter.js";
import { TurnStore, summarizeToolActivity } from "./turnStore.js";
enableFirebaseTelemetry();

const db = getDb();
const rateLimiter = new RateLimiter(db);
const turnStore = new TurnStore(db);

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

    // Rate-limit blocks are thrown before the recorded section: they carry no
    // retrieval signal, so they get their own log line instead of a turn doc.
    const rate = await rateLimiter.check(sessionId);
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

    try {
      // Construct prompt using prompts/adagent.prompt.
      const adagentPrompt = ai.prompt("adagent");

      const { response, stream } = adagentPrompt.stream({ question });

      for await (const chunk of stream) {
        sendChunk(chunk.text);
      }

      const result = await response;

      const toolCalls = summarizeToolActivity(result.messages);
      const latencyMs = Date.now() - startMs;
      logger.info("adagent_turn", {
        question,
        sessionId,
        toolCalls: toolCalls.map(({ tool, input }) => ({ tool, input })),
        answerChars: result.text.length,
        latencyMs,
      });
      // Awaited so the write survives instance freeze; the answer has already
      // been streamed via sendChunk, so players don't feel this. record()
      // never throws.
      await turnStore.record({
        question,
        sessionId,
        toolCalls,
        answer: result.text,
        latencyMs,
      });

      return result.text;
    } catch (e) {
      // Genkit/Google AI error objects can crash util.inspect in Firebase's
      // logger — log plain strings only.
      // NB: field must not be named "message" — the logger merges this object
      // into jsonPayload and a "message" key would clobber the log marker.
      const latencyMs = Date.now() - startMs;
      const error = e instanceof Error ? e.message : String(e);
      logger.error("adagent_turn_error", {
        question,
        sessionId,
        latencyMs,
        error,
        errorStack: e instanceof Error ? e.stack : undefined,
      });
      await turnStore.record({
        question,
        sessionId,
        toolCalls: [],
        latencyMs,
        error,
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
