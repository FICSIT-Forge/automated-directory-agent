// Genkit models generally depend on an API key. APIs should be stored in Cloud Secret Manager so that
// access to these sensitive values can be controlled. defineSecret does this for you automatically.
import { defineSecret } from "firebase-functions/params";
const apiKey = defineSecret("GEMINI_API_KEY");

// Observability has three deliberate layers (issues #7/#18):
//  1. OTel traces/metrics via the Firebase telemetry plugin → Cloud Trace /
//     Monitoring. Full span-level fidelity for interactively debugging a
//     single turn in the Genkit Monitoring console. Span schema is a Genkit
//     internal — nothing of ours may parse it.
//  2. The `turns` Firestore collection (TurnStore, fed by
//     TurnRecordingSessionStore around the agent's session store): one
//     self-contained, schema-stable record per turn. System of record for
//     eval mining (scripts/mineTurns.ts) — decoupled from the beta agent
//     snapshot format, joins with `feedback` in the same database.
//  3. The `adagent_turn` log line: synchronous stdout, delivered even if the
//     instance dies mid-turn. Ops/alerting signal and fallback record.
// Conversation history itself lives in `genkit-sessions` (+ -pointers /
// -shards), managed entirely by the agent runtime.
import { enableFirebaseTelemetry } from "@genkit-ai/firebase";
import { onRequest } from "firebase-functions/https";
import { app } from "./app.js";
enableFirebaseTelemetry();

export { submitFeedback } from "./feedback.js";

// The agent wire protocol (turn/snapshot/abort endpoints + streaming) does
// not fit onCallGenkit's single-action callable envelope, so the agent is
// served as an HTTP function hosting the Express app. App Check and rate
// limiting are middleware in app.ts. Reached via the Hosting rewrite
// /api/** → this function.
export const adagentApi = onRequest(
  {
    // ~73MB game data index is JSON.parsed at runtime — default 256MB OOMs.
    memory: "1GiB",
    secrets: [apiKey],
  },
  app,
);
