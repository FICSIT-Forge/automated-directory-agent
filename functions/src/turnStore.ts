/**
 * Durable per-turn records in Firestore (issue #7).
 *
 * One document per turn in the `turns` collection: question → tool calls →
 * retrieved top-K (name + score) → answer. This is the minable system of
 * record for eval curation (scripts/mineTurns.ts) and the raw material for
 * the Layer-3 accuracy dataset (issue #10) — Firestore instead of log
 * retention windows, and it lives next to `feedback` so the two join in one
 * database. The `adagent_turn` log line remains as the cheap ops signal.
 * No user identifiers are stored.
 */

import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import type { MessageData } from "genkit";

const MAX_ANSWER_CHARS = 4000;

export interface ToolResultSummary {
  readonly name: string;
  readonly score: number;
}

export interface ToolCallRecord {
  readonly tool: string;
  readonly input: unknown;
  /** Top-K retrieval hits (display name + similarity score), when present. */
  readonly results: readonly ToolResultSummary[];
}

export interface TurnRecord {
  readonly question: string;
  readonly sessionId?: string;
  readonly toolCalls: readonly ToolCallRecord[];
  readonly answer?: string;
  readonly latencyMs: number;
  readonly error?: string;
}

/**
 * Extracts tool activity from a completed generation's message history.
 *
 * Requests and responses are paired by Genkit's correlation `ref` when set,
 * falling back to arrival order per tool name. Result summaries only capture
 * entries shaped like search hits (a display-name string + numeric score) —
 * exactly what gold-set labeling needs; full outputs stay in Cloud Trace.
 */
export function summarizeToolActivity(
  messages: readonly MessageData[],
): ToolCallRecord[] {
  interface PendingCall {
    tool: string;
    input: unknown;
    ref?: string;
    results: ToolResultSummary[];
  }
  const calls: PendingCall[] = [];

  for (const message of messages) {
    for (const part of message.content) {
      if (part.toolRequest) {
        calls.push({
          tool: part.toolRequest.name,
          input: part.toolRequest.input,
          ref: part.toolRequest.ref,
          results: [],
        });
      } else if (part.toolResponse) {
        const { name, ref, output } = part.toolResponse;
        const match =
          (ref !== undefined && calls.find((c) => c.ref === ref)) ||
          calls.find((c) => c.tool === name && c.results.length === 0);
        if (match) match.results = summarizeOutput(output);
      }
    }
  }

  return calls.map(({ tool, input, results }) => ({ tool, input, results }));
}

function summarizeOutput(output: unknown): ToolResultSummary[] {
  if (!Array.isArray(output)) return [];
  const summaries: ToolResultSummary[] = [];
  for (const item of output) {
    if (item === null || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    // The three search tools use different name keys (see gameDataTools.ts).
    const name = record.displayName ?? record.recipeName ?? record.name;
    if (typeof name === "string" && typeof record.score === "number") {
      summaries.push({ name, score: record.score });
    }
  }
  return summaries;
}

export class TurnStore {
  constructor(private readonly db: Firestore) {}

  /**
   * Persists one turn. Never throws — a turn-store outage must not turn into
   * an agent outage (same posture as the rate limiter).
   */
  async record(turn: TurnRecord): Promise<void> {
    try {
      await this.db.collection("turns").add({
        question: turn.question,
        sessionId: turn.sessionId ?? null,
        toolCalls: turn.toolCalls.map((c) => ({
          tool: c.tool,
          input: c.input ?? null,
          results: c.results.map((r) => ({ name: r.name, score: r.score })),
        })),
        answer: turn.answer?.slice(0, MAX_ANSWER_CHARS) ?? null,
        answerChars: turn.answer?.length ?? 0,
        latencyMs: turn.latencyMs,
        error: turn.error ?? null,
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (e) {
      logger.warn("turn_store_unavailable", {
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }
}
