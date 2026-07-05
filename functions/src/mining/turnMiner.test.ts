import { describe, it, expect } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { triage, TurnMiner, type MinedTurn } from "./turnMiner.js";

function turn(overrides: Partial<MinedTurn> & { question: string }): MinedTurn {
  return {
    timestamp: "2026-07-01T00:00:00.000Z",
    toolCalls: [],
    answerChars: 100,
    ...overrides,
  };
}

describe("triage", () => {
  it("dedups by question, keeping the most recent turn and counting repeats", () => {
    const turns = [
      turn({ question: "q", timestamp: "2026-07-01T00:00:00.000Z" }),
      turn({
        question: "q",
        timestamp: "2026-07-03T00:00:00.000Z",
        answerChars: 42,
      }),
      turn({ question: "q", timestamp: "2026-07-02T00:00:00.000Z" }),
    ];
    const candidates = triage(turns, new Map());
    expect(candidates).toHaveLength(1);
    expect(candidates[0].occurrences).toBe(3);
    expect(candidates[0].timestamp).toBe("2026-07-03T00:00:00.000Z");
    expect(candidates[0].answerChars).toBe(42);
  });

  it("ranks errors, then thumbs-down, then unlabeled, then thumbs-up", () => {
    const turns = [
      turn({ question: "liked", timestamp: "2026-07-04T00:00:00.000Z" }),
      turn({ question: "plain", timestamp: "2026-07-03T00:00:00.000Z" }),
      turn({ question: "disliked", timestamp: "2026-07-02T00:00:00.000Z" }),
      turn({
        question: "crashed",
        timestamp: "2026-07-01T00:00:00.000Z",
        error: "boom",
      }),
    ];
    const feedback = new Map<string, "up" | "down">([
      ["liked", "up"],
      ["disliked", "down"],
    ]);
    const order = triage(turns, feedback).map((c) => c.question);
    expect(order).toEqual(["crashed", "disliked", "plain", "liked"]);
  });

  it("breaks rank ties by recency, newest first", () => {
    const turns = [
      turn({ question: "older", timestamp: "2026-07-01T00:00:00.000Z" }),
      turn({ question: "newer", timestamp: "2026-07-02T00:00:00.000Z" }),
    ];
    const order = triage(turns, new Map()).map((c) => c.question);
    expect(order).toEqual(["newer", "older"]);
  });

  it("pre-fills the gold-set skeleton and flags errored turns as observed-miss", () => {
    const candidates = triage(
      [turn({ question: "how many HOR", error: "boom" })],
      new Map(),
    );
    expect(candidates[0].goldSkeleton).toMatchObject({
      query: "how many HOR",
      source: "observed-miss",
      relevant: [],
    });
  });
});

// ─── TurnMiner (Firestore reads) ────────────────────────────────────────────

function fakeTimestamp(iso: string) {
  return { toDate: () => new Date(iso) };
}

/** Fakes the collection().where().get() chain for the two collections read. */
function fakeDb(data: Record<string, Record<string, unknown>[]>) {
  const captured: Record<string, unknown[]> = {};
  const db = {
    collection: (name: string) => ({
      where: (field: string, op: string, value: unknown) => {
        captured[name] = [field, op, value];
        return {
          get: async () => ({
            docs: (data[name] ?? []).map((d) => ({ data: () => d })),
          }),
        };
      },
    }),
  };
  return { db: db as unknown as Firestore, captured };
}

describe("TurnMiner", () => {
  it("maps turn docs and filters malformed ones", async () => {
    const { db, captured } = fakeDb({
      turns: [
        {
          question: "how do I make screws",
          sessionId: "s1",
          createdAt: fakeTimestamp("2026-07-01T12:00:00.000Z"),
          toolCalls: [{ tool: "searchRecipes", input: {}, results: [] }],
          answer: "Constructor.",
          answerChars: 12,
          latencyMs: 900,
          error: null,
        },
        { notAQuestion: true },
      ],
    });
    const since = new Date("2026-06-24T00:00:00.000Z");
    const turns = await new TurnMiner(db).fetchTurns(since);

    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      question: "how do I make screws",
      sessionId: "s1",
      timestamp: "2026-07-01T12:00:00.000Z",
      answer: "Constructor.",
      latencyMs: 900,
      error: undefined,
    });
    expect(captured.turns).toEqual(["createdAt", ">=", since]);
  });

  it("joins feedback with down winning over up", async () => {
    const { db } = fakeDb({
      feedback: [
        { question: "q1", verdict: "up" },
        { question: "q1", verdict: "down" },
        { question: "q1", verdict: "up" },
        { question: "q2", verdict: "up" },
      ],
    });
    const feedback = await new TurnMiner(db).fetchFeedback(new Date());
    expect(feedback.get("q1")).toBe("down");
    expect(feedback.get("q2")).toBe("up");
  });

  it("mine() wires turns + feedback into ranked candidates", async () => {
    const { db } = fakeDb({
      turns: [
        {
          question: "good one",
          createdAt: fakeTimestamp("2026-07-02T00:00:00.000Z"),
        },
        {
          question: "bad one",
          createdAt: fakeTimestamp("2026-07-01T00:00:00.000Z"),
        },
      ],
      feedback: [{ question: "bad one", verdict: "down" }],
    });
    const { candidates } = await new TurnMiner(db).mine(7);
    expect(candidates.map((c) => c.question)).toEqual(["bad one", "good one"]);
    expect(candidates[0].feedback).toBe("down");
  });
});
