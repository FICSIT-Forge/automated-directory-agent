/**
 * End-to-end agent check (issue #18): the REAL stack, minus production.
 *
 *   Express app → agent wire protocol → Gemini (2 turns, the second a
 *   context-dependent follow-up) → Firestore emulator.
 *
 * Asserts the contracts that unit tests can't: streaming works over the wire,
 * session history persists and is actually used for context, and every turn
 * lands in the `turns` collection with tool calls + sessionId.
 *
 * Run via `pnpm e2e` (wraps `firebase emulators:exec`). Requires
 * GEMINI_API_KEY in the environment — locally: `set -a; source .env.local`.
 * Costs two gemini-flash calls per run.
 *
 * The context assertion greps the follow-up answer for iron/ingot/smelter/30
 * — broad enough that a correct answer can't miss it, but still model
 * output: if this ever flakes in CI, soften it before blaming the code.
 */
process.env.FUNCTIONS_EMULATOR = "true"; // App Check bypass in app.ts

import assert from "node:assert";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";

assert(process.env.FIRESTORE_EMULATOR_HOST, "must run under emulators:exec");
assert(process.env.GEMINI_API_KEY, "GEMINI_API_KEY required");

const { app } = await import("../src/app.js");
const { getDb } = await import("../src/firestore.js");

const server = app.listen(0);
const port = (server.address() as AddressInfo).port;
const url = `http://127.0.0.1:${port}/api/adagent`;
const sessionId = randomUUID();

async function sendTurn(text: string): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      data: { message: { role: "user", content: [{ text }] } },
      init: { sessionId },
    }),
  });
  assert.equal(res.status, 200, `turn HTTP status ${res.status}`);
  const raw = await res.text();
  // Agent stream chunks: {message: {modelChunk: {content: [{text}]}}}
  let streamed = "";
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const chunk = JSON.parse(line.slice("data: ".length));
    for (const part of chunk?.message?.modelChunk?.content ?? []) {
      if (typeof part?.text === "string") streamed += part.text;
    }
  }
  return streamed;
}

console.log("=== turn 1: base question ===");
const t1 = await sendTurn("What does a Smelter produce from Iron Ore?");
console.log(t1.slice(0, 300));
assert(t1.length > 0, "turn 1 produced no streamed text");

console.log("\n=== turn 2: context-dependent follow-up ===");
const t2 = await sendTurn("How many per minute does that recipe produce?");
console.log(t2.slice(0, 300));
assert(t2.length > 0, "turn 2 produced no streamed text");

// --- Firestore assertions ---
const db = getDb();

const turnsSnap = await db
  .collection("turns")
  .where("sessionId", "==", sessionId)
  .get();
assert.equal(turnsSnap.size, 2, `expected 2 turn docs, got ${turnsSnap.size}`);
const turnDocs = turnsSnap.docs.map((d) => d.data());
const first = turnDocs.find((t) => t.question.startsWith("What"));
const second = turnDocs.find((t) => t.question.startsWith("How"));
assert(first, "missing turn record for base question");
assert(second, "missing turn record for follow-up");
assert(first.toolCalls.length > 0, "turn 1 recorded no tool calls");
assert(first.answer.length > 0, "turn 1 recorded no answer");
assert(second.answer.length > 0, "turn 2 recorded no answer");
assert(first.latencyMs >= 0 && second.latencyMs > 0, "latency not recorded");
console.log("\nturn records:", {
  q1Tools: first.toolCalls.map((c: { tool: string }) => c.tool),
  q1AnswerChars: first.answer.length,
  q2AnswerChars: second.answer.length,
  q2LatencyMs: second.latencyMs,
});

// Session snapshots live in genkit-sessions/{prefix}/snapshots/{id}.
const snapshotDocs = await db.collectionGroup("snapshots").get();
const forSession = snapshotDocs.docs
  .map((d) => d.data())
  .filter((d) => d.sessionId === sessionId);
assert(forSession.length >= 2, "expected a snapshot per turn");
assert(
  forSession.every((s) => s.status === "completed"),
  `non-completed snapshot: ${forSession.map((s) => s.status).join(",")}`,
);
console.log(`session snapshots: ${forSession.length} (all completed)`);

const contextual = /ingot|smelter|30|iron/i.test(t2);
assert(contextual, "follow-up answer shows no conversation context");
console.log("follow-up references turn-1 context: true");

server.close();
console.log("\nE2E AGENT CHECK PASSED ✔");
process.exit(0);
