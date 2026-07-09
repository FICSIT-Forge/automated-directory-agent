/**
 * The ADAgent conversational agent (issue #18).
 *
 * Server-managed sessions: conversation history lives in Firestore
 * (`genkit-sessions` + derived `-pointers`/`-shards` collections), keyed by
 * the sessionId the web client sends (the AI SDK chat id). The session store
 * is wrapped with TurnRecordingSessionStore so every completed/failed turn
 * also lands in the stable `turns` collection for eval mining (issue #7).
 *
 * The prompt (system text, tools, model, config) stays in
 * prompts/adagent.prompt — definePromptAgent looks it up per invocation, so
 * prompt edits keep working without touching agent wiring.
 */

// Side-effect import registers the search tools with the Genkit runtime —
// the prompt this agent wraps resolves them by name. Lives here (not in
// index.ts) so the agent is usable by any entry point.
import "./tools/gameDataTools.js";

import { FirestoreSessionStore } from "@genkit-ai/firebase/beta";
import { ai } from "./genkit.js";
import { getDb } from "./firestore.js";
import { TurnRecordingSessionStore } from "./agentSessionStore.js";
import { TurnStore } from "./turnStore.js";

const db = getDb();
export const turnStore = new TurnStore(db);

const store = new TurnRecordingSessionStore(
  new FirestoreSessionStore({ db }),
  turnStore,
);

export const adagentAgent = ai.definePromptAgent({
  promptName: "adagent",
  store,
});
