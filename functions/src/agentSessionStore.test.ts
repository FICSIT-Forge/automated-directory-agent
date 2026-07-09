import { describe, expect, it, vi } from "vitest";
import type { MessageData } from "genkit";
import type {
  SessionSnapshot,
  SessionSnapshotInput,
  SessionStore,
  SnapshotMutator,
} from "genkit/beta";
import { TurnRecordingSessionStore } from "./agentSessionStore.js";
import type { TurnStore } from "./turnStore.js";

function user(text: string): MessageData {
  return { role: "user", content: [{ text }] };
}
function model(text: string): MessageData {
  return { role: "model", content: [{ text }] };
}
function toolRound(tool: string, input: unknown, output: unknown) {
  return [
    {
      role: "model" as const,
      content: [{ toolRequest: { name: tool, ref: "1", input } }],
    },
    {
      role: "tool" as const,
      content: [{ toolResponse: { name: tool, ref: "1", output } }],
    },
  ];
}

/** Minimal inner store: keeps the latest snapshot per session. */
function fakeInnerStore(): SessionStore & {
  latest: Map<string, SessionSnapshot>;
} {
  const latest = new Map<string, SessionSnapshot>();
  return {
    latest,
    async getSnapshot(opts) {
      return opts.sessionId ? latest.get(opts.sessionId) : undefined;
    },
    async saveSnapshot(
      snapshotId: string | undefined,
      mutator: SnapshotMutator,
    ) {
      const result = mutator(undefined);
      if (result === null) return null;
      const id = snapshotId ?? `snap-${latest.size + 1}`;
      const snapshot = { ...result, snapshotId: id } as SessionSnapshot;
      if (snapshot.sessionId) latest.set(snapshot.sessionId, snapshot);
      return id;
    },
  };
}

function fakeTurnStore() {
  return { record: vi.fn().mockResolvedValue(undefined) };
}

function snapshot(
  sessionId: string,
  messages: MessageData[],
  status: "pending" | "completed" | "failed" = "completed",
  error?: { message: string },
): SessionSnapshotInput {
  return {
    sessionId,
    createdAt: new Date().toISOString(),
    status,
    ...(error ? { error } : {}),
    state: { sessionId, messages },
  };
}

describe("TurnRecordingSessionStore", () => {
  it("records a completed first turn with question, answer, and tool calls", async () => {
    const turns = fakeTurnStore();
    const store = new TurnRecordingSessionStore(
      fakeInnerStore(),
      turns as unknown as TurnStore,
    );

    const messages = [
      user("What does a Smelter make?"),
      ...toolRound("searchGameData", { query: "Smelter" }, [
        { displayName: "Smelter", score: 0.91 },
      ]),
      model("Iron Ingots, obviously."),
    ];
    await store.saveSnapshot(undefined, () => snapshot("s1", messages));

    expect(turns.record).toHaveBeenCalledTimes(1);
    const record = turns.record.mock.calls[0]![0];
    expect(record.question).toBe("What does a Smelter make?");
    expect(record.answer).toBe("Iron Ingots, obviously.");
    expect(record.sessionId).toBe("s1");
    expect(record.toolCalls).toEqual([
      {
        tool: "searchGameData",
        input: { query: "Smelter" },
        results: [{ name: "Smelter", score: 0.91 }],
      },
    ]);
  });

  it("records only the delta after a session load (follow-up turns)", async () => {
    const inner = fakeInnerStore();
    const turns = fakeTurnStore();
    const store = new TurnRecordingSessionStore(
      inner,
      turns as unknown as TurnStore,
    );

    const firstTurn = [user("q1"), model("a1")];
    inner.latest.set("s1", {
      ...snapshot("s1", firstTurn),
      snapshotId: "snap-0",
    } as SessionSnapshot);

    // Runner loads the session at turn start…
    await store.getSnapshot({ sessionId: "s1" });
    // …then persists the terminal snapshot with the full history.
    await store.saveSnapshot(undefined, () =>
      snapshot("s1", [...firstTurn, user("q2 follow-up"), model("a2")]),
    );

    expect(turns.record).toHaveBeenCalledTimes(1);
    const record = turns.record.mock.calls[0]![0];
    expect(record.question).toBe("q2 follow-up");
    expect(record.answer).toBe("a2");
  });

  it("tracks consecutive turns on a warm instance without reloads", async () => {
    const turns = fakeTurnStore();
    const store = new TurnRecordingSessionStore(
      fakeInnerStore(),
      turns as unknown as TurnStore,
    );

    const turn1 = [user("q1"), model("a1")];
    await store.saveSnapshot(undefined, () => snapshot("s1", turn1));
    await store.saveSnapshot(undefined, () =>
      snapshot("s1", [...turn1, user("q2"), model("a2")]),
    );

    expect(turns.record).toHaveBeenCalledTimes(2);
    expect(turns.record.mock.calls[1]![0].question).toBe("q2");
    expect(turns.record.mock.calls[1]![0].answer).toBe("a2");
  });

  it("records failed turns with the error and no answer", async () => {
    const turns = fakeTurnStore();
    const store = new TurnRecordingSessionStore(
      fakeInnerStore(),
      turns as unknown as TurnStore,
    );

    await store.saveSnapshot(undefined, () =>
      snapshot("s1", [user("q")], "failed", { message: "model exploded" }),
    );

    const record = turns.record.mock.calls[0]![0];
    expect(record.error).toBe("model exploded");
    expect(record.answer).toBeUndefined();
  });

  it("ignores pending snapshots and skipped saves", async () => {
    const turns = fakeTurnStore();
    const store = new TurnRecordingSessionStore(
      fakeInnerStore(),
      turns as unknown as TurnStore,
    );

    await store.saveSnapshot(undefined, () =>
      snapshot("s1", [user("q")], "pending"),
    );
    await store.saveSnapshot(undefined, () => null);

    expect(turns.record).not.toHaveBeenCalled();
  });

  it("computes latency from session load to terminal save", async () => {
    const inner = fakeInnerStore();
    const turns = fakeTurnStore();
    let nowMs = 1000;
    const store = new TurnRecordingSessionStore(
      inner,
      turns as unknown as TurnStore,
      () => nowMs,
    );

    await store.getSnapshot({ sessionId: "s1" });
    nowMs = 4200;
    await store.saveSnapshot(undefined, () =>
      snapshot("s1", [user("q"), model("a")]),
    );

    expect(turns.record.mock.calls[0]![0].latencyMs).toBe(3200);
  });

  it("never breaks the save path when recording throws", async () => {
    const turns = {
      record: vi.fn(() => {
        throw new Error("boom");
      }),
    };
    const store = new TurnRecordingSessionStore(
      fakeInnerStore(),
      turns as unknown as TurnStore,
    );

    const savedId = await store.saveSnapshot(undefined, () =>
      snapshot("s1", [user("q"), model("a")]),
    );
    expect(savedId).not.toBeNull();
  });
});
