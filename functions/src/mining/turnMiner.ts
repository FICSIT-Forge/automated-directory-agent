/**
 * Production-traffic triage for eval curation (issue #7).
 *
 * Reads per-turn records (TurnStore's `turns` collection) and thumbs up/down
 * docs (`feedback` collection) from Firestore, joins them by question, and
 * produces gold-set candidate skeletons ordered by triage value: errors
 * first, thumbs-down next, then the rest by recency.
 *
 * The Firestore I/O lives in TurnMiner (injected db, unit-tested via fakes);
 * the join/ranking logic is the pure triage() below. CLI entry point:
 * scripts/mineTurns.ts (`pnpm mine:turns`).
 */

import type { Firestore, Timestamp } from "firebase-admin/firestore";
import type { ToolCallRecord } from "../turnStore.js";

export type Verdict = "up" | "down";

export interface MinedTurn {
  readonly question: string;
  readonly sessionId?: string;
  /** ISO-8601, from the doc's server timestamp. */
  readonly timestamp: string;
  readonly toolCalls: readonly ToolCallRecord[];
  readonly answer?: string;
  readonly answerChars: number;
  readonly latencyMs?: number;
  readonly error?: string;
}

export interface Candidate extends MinedTurn {
  readonly occurrences: number;
  readonly feedback: Verdict | null;
  /** Pre-filled gold-set slot — copy into eval/gold-set.json and label. */
  readonly goldSkeleton: {
    readonly query: string;
    readonly category: string;
    readonly types: readonly string[];
    readonly relevant: readonly string[];
    readonly source: string;
    readonly notes: string;
  };
}

// ─── Pure triage logic ──────────────────────────────────────────────────────

/**
 * Dedups turns by question (keeping the most recent, counting repeats), joins
 * feedback, and ranks: errored → thumbs-down → unlabeled → thumbs-up, with
 * recency as the tiebreak.
 */
export function triage(
  turns: readonly MinedTurn[],
  feedback: ReadonlyMap<string, Verdict>,
): Candidate[] {
  const byQuestion = new Map<
    string,
    { turn: MinedTurn; occurrences: number }
  >();
  for (const turn of turns) {
    const existing = byQuestion.get(turn.question);
    if (!existing) {
      byQuestion.set(turn.question, { turn, occurrences: 1 });
    } else {
      existing.occurrences++;
      if (turn.timestamp > existing.turn.timestamp) existing.turn = turn;
    }
  }

  const candidates: Candidate[] = [...byQuestion.values()].map(
    ({ turn, occurrences }) => ({
      ...turn,
      occurrences,
      feedback: feedback.get(turn.question) ?? null,
      goldSkeleton: {
        query: turn.question,
        category: "",
        types: [],
        relevant: [],
        source: turn.error ? "observed-miss" : "production",
        notes: `From production turns (${turn.timestamp}). LABEL ME: resolve relevant classNames against the index.`,
      },
    }),
  );

  const rank = (c: Candidate) =>
    c.error ? 0 : c.feedback === "down" ? 1 : c.feedback === "up" ? 3 : 2;
  return candidates.sort(
    (a, b) => rank(a) - rank(b) || b.timestamp.localeCompare(a.timestamp),
  );
}

// ─── Firestore-backed miner ─────────────────────────────────────────────────

export class TurnMiner {
  constructor(private readonly db: Firestore) {}

  async fetchTurns(since: Date): Promise<MinedTurn[]> {
    const snap = await this.db
      .collection("turns")
      .where("createdAt", ">=", since)
      .get();

    const turns: MinedTurn[] = [];
    for (const doc of snap.docs) {
      const d = doc.data();
      if (typeof d.question !== "string") continue;
      turns.push({
        question: d.question,
        sessionId: typeof d.sessionId === "string" ? d.sessionId : undefined,
        timestamp: isTimestamp(d.createdAt)
          ? d.createdAt.toDate().toISOString()
          : "",
        toolCalls: Array.isArray(d.toolCalls)
          ? (d.toolCalls as ToolCallRecord[])
          : [],
        answer: typeof d.answer === "string" ? d.answer : undefined,
        answerChars: typeof d.answerChars === "number" ? d.answerChars : 0,
        latencyMs: typeof d.latencyMs === "number" ? d.latencyMs : undefined,
        error: typeof d.error === "string" ? d.error : undefined,
      });
    }
    return turns;
  }

  async fetchFeedback(since: Date): Promise<Map<string, Verdict>> {
    const snap = await this.db
      .collection("feedback")
      .where("createdAt", ">=", since)
      .get();

    const byQuestion = new Map<string, Verdict>();
    for (const doc of snap.docs) {
      const d = doc.data();
      if (typeof d.question !== "string") continue;
      // "down" wins over "up" for the same question: triage the complaint.
      if (byQuestion.get(d.question) !== "down") {
        byQuestion.set(d.question, d.verdict === "down" ? "down" : "up");
      }
    }
    return byQuestion;
  }

  async mine(days: number): Promise<{
    turns: MinedTurn[];
    feedback: Map<string, Verdict>;
    candidates: Candidate[];
  }> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const [turns, feedback] = await Promise.all([
      this.fetchTurns(since),
      this.fetchFeedback(since),
    ]);
    return { turns, feedback, candidates: triage(turns, feedback) };
  }
}

function isTimestamp(value: unknown): value is Timestamp {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as Timestamp).toDate === "function"
  );
}
