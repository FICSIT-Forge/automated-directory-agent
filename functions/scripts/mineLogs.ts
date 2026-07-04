/**
 * Production-traffic triage for eval curation (issue #7).
 *
 * Pulls the structured per-turn logs ("adagent_turn" / "adagent_turn_error")
 * from Cloud Logging plus thumbs up/down docs from the Firestore `feedback`
 * collection, joins them by question, and emits gold-set candidate skeletons
 * ordered by triage value: errors first, thumbs-down next, then the rest by
 * recency.
 *
 * Usage:
 *   pnpm mine:logs                 # last 7 days
 *   pnpm mine:logs --days 14
 *   pnpm mine:logs --out eval/log-candidates.json
 *
 * Requirements: `gcloud` CLI authenticated with access to the project
 * (Logs Viewer). Feedback join additionally needs Application Default
 * Credentials for Firestore; it degrades to logs-only with a warning.
 */

import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";

const PROJECT = "ficsit-forge";
const EVAL_DIR = path.resolve(import.meta.dirname, "../eval");

// ─── CLI args ────────────────────────────────────────────────────────────────

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const DAYS = Number(argValue("--days")) || 7;
const OUT_PATH = path.resolve(
  argValue("--out") ?? path.join(EVAL_DIR, "log-candidates.json"),
);

// ─── Types ───────────────────────────────────────────────────────────────────

interface ToolCall {
  readonly tool?: string;
  readonly input?: unknown;
}

interface Turn {
  readonly question: string;
  readonly sessionId?: string;
  readonly timestamp: string;
  readonly toolCalls?: readonly ToolCall[];
  readonly answerChars?: number;
  readonly latencyMs?: number;
  readonly error?: string;
}

interface Candidate extends Turn {
  readonly occurrences: number;
  readonly feedback: "up" | "down" | null;
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

// ─── Sources ─────────────────────────────────────────────────────────────────

function readTurnLogs(): Turn[] {
  const filter =
    'jsonPayload.message="adagent_turn" OR jsonPayload.message="adagent_turn_error"';
  let raw: string;
  try {
    raw = execFileSync(
      "gcloud",
      [
        "logging",
        "read",
        filter,
        `--project=${PROJECT}`,
        `--freshness=${DAYS}d`,
        "--limit=1000",
        "--format=json",
      ],
      { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (e) {
    console.error(
      "FAIL: could not read Cloud Logging via gcloud. Is gcloud installed " +
        `and authenticated for ${PROJECT}?\n` +
        (e instanceof Error ? e.message : String(e)),
    );
    process.exit(1);
  }

  interface LogEntry {
    timestamp?: string;
    jsonPayload?: Record<string, unknown>;
  }
  const entries = JSON.parse(raw) as LogEntry[];
  const turns: Turn[] = [];
  for (const entry of entries) {
    const p = entry.jsonPayload;
    if (!p || typeof p.question !== "string") continue;
    turns.push({
      question: p.question,
      sessionId: typeof p.sessionId === "string" ? p.sessionId : undefined,
      timestamp: entry.timestamp ?? "",
      toolCalls: Array.isArray(p.toolCalls)
        ? (p.toolCalls as ToolCall[])
        : undefined,
      answerChars:
        typeof p.answerChars === "number" ? p.answerChars : undefined,
      latencyMs: typeof p.latencyMs === "number" ? p.latencyMs : undefined,
      error: typeof p.error === "string" ? p.error : undefined,
    });
  }
  return turns;
}

async function readFeedback(): Promise<Map<string, "up" | "down">> {
  const byQuestion = new Map<string, "up" | "down">();
  try {
    const { getApps, initializeApp } = await import("firebase-admin/app");
    const { getFirestore } = await import("firebase-admin/firestore");
    if (!getApps().length) initializeApp({ projectId: PROJECT });
    const cutoff = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);
    const snap = await getFirestore()
      .collection("feedback")
      .where("createdAt", ">=", cutoff)
      .get();
    for (const doc of snap.docs) {
      const d = doc.data();
      if (typeof d.question === "string") {
        // "down" wins over "up" for the same question: triage the complaint.
        const existing = byQuestion.get(d.question);
        if (existing !== "down") {
          byQuestion.set(d.question, d.verdict === "down" ? "down" : "up");
        }
      }
    }
  } catch (e) {
    console.warn(
      "WARN: feedback join skipped (no Firestore credentials?): " +
        (e instanceof Error ? e.message : String(e)),
    );
  }
  return byQuestion;
}

// ─── Triage ──────────────────────────────────────────────────────────────────

function triage(
  turns: readonly Turn[],
  feedback: ReadonlyMap<string, "up" | "down">,
): Candidate[] {
  // Dedup by question, keeping the most recent turn and counting repeats.
  const byQuestion = new Map<string, { turn: Turn; occurrences: number }>();
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
        notes: `From production logs (${turn.timestamp}). LABEL ME: resolve relevant classNames against the index.`,
      },
    }),
  );

  const rank = (c: Candidate) =>
    c.error ? 0 : c.feedback === "down" ? 1 : c.feedback === "up" ? 3 : 2;
  return candidates.sort(
    (a, b) => rank(a) - rank(b) || b.timestamp.localeCompare(a.timestamp),
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Reading ${DAYS}d of adagent_turn logs from ${PROJECT}...`);
  const turns = readTurnLogs();
  const feedback = await readFeedback();
  const candidates = triage(turns, feedback);

  const errors = candidates.filter((c) => c.error).length;
  const downs = candidates.filter((c) => c.feedback === "down").length;
  console.log(
    `\n${turns.length} turns → ${candidates.length} unique questions ` +
      `(${errors} errored, ${downs} thumbs-down, ${feedback.size} with feedback)`,
  );

  fs.writeFileSync(OUT_PATH, JSON.stringify(candidates, null, 2) + "\n");
  console.log(`Wrote ${path.relative(process.cwd(), OUT_PATH)}`);
  console.log(
    "\nNext: label the top candidates into eval/gold-set.json " +
      "(Layer 2) or eval/accuracy_dataset (Layer 3, issue #10).",
  );
}

main();
