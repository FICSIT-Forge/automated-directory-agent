/**
 * Player feedback callable (issue #7): the web UI's thumbs up/down lands here.
 * Each document is a labeled (question, answer) pair — the highest-precision
 * signal for gold-set and accuracy-dataset triage (scripts/mineLogs.ts).
 * No user identifiers are stored.
 */

import { onCall, HttpsError } from "firebase-functions/https";
import { FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { getDb } from "./firestore.js";

const MAX_TEXT_CHARS = 4000;

interface FeedbackPayload {
  verdict: "up" | "down";
  question: string;
  answer: string;
  sessionId?: string;
}

function parsePayload(data: unknown): FeedbackPayload {
  const d = (data ?? {}) as Record<string, unknown>;
  if (d.verdict !== "up" && d.verdict !== "down") {
    throw new HttpsError("invalid-argument", "verdict must be 'up' or 'down'");
  }
  if (typeof d.question !== "string" || d.question.trim().length === 0) {
    throw new HttpsError("invalid-argument", "question is required");
  }
  if (typeof d.answer !== "string") {
    throw new HttpsError("invalid-argument", "answer is required");
  }
  return {
    verdict: d.verdict,
    question: d.question.slice(0, MAX_TEXT_CHARS),
    answer: d.answer.slice(0, MAX_TEXT_CHARS),
    sessionId:
      typeof d.sessionId === "string" && d.sessionId.length > 0
        ? d.sessionId.slice(0, 128)
        : undefined,
  };
}

export const submitFeedback = onCall({ enforceAppCheck: true }, async (req) => {
  const payload = parsePayload(req.data);

  await getDb()
    .collection("feedback")
    .add({
      verdict: payload.verdict,
      question: payload.question,
      answer: payload.answer,
      sessionId: payload.sessionId ?? null,
      createdAt: FieldValue.serverTimestamp(),
    });

  logger.info("adagent_feedback", {
    verdict: payload.verdict,
    question: payload.question,
  });
  return { ok: true };
});
