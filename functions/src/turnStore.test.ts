import { describe, it, expect } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import type { MessageData } from "genkit";
import { summarizeToolActivity, TurnStore } from "./turnStore.js";

// ─── summarizeToolActivity ──────────────────────────────────────────────────

function modelMessage(content: MessageData["content"]): MessageData {
  return { role: "model", content };
}
function toolMessage(content: MessageData["content"]): MessageData {
  return { role: "tool", content };
}

describe("summarizeToolActivity", () => {
  it("returns empty for a turn without tool calls", () => {
    const messages = [modelMessage([{ text: "Hello, pioneer!" }])];
    expect(summarizeToolActivity(messages)).toEqual([]);
  });

  it("pairs a request with its response and extracts name + score", () => {
    const messages = [
      modelMessage([
        {
          toolRequest: {
            name: "searchGameData",
            ref: "r1",
            input: { query: "iron plate" },
          },
        },
      ]),
      toolMessage([
        {
          toolResponse: {
            name: "searchGameData",
            ref: "r1",
            output: [
              { displayName: "Iron Plate", score: 0.91, details: "..." },
              { displayName: "Iron Rod", score: 0.72, details: "..." },
            ],
          },
        },
      ]),
    ];
    expect(summarizeToolActivity(messages)).toEqual([
      {
        tool: "searchGameData",
        input: { query: "iron plate" },
        results: [
          { name: "Iron Plate", score: 0.91 },
          { name: "Iron Rod", score: 0.72 },
        ],
      },
    ]);
  });

  it("supports the recipe and schematic name keys", () => {
    const messages = [
      modelMessage([
        { toolRequest: { name: "searchRecipes", ref: "a", input: {} } },
        { toolRequest: { name: "searchSchematics", ref: "b", input: {} } },
      ]),
      toolMessage([
        {
          toolResponse: {
            name: "searchRecipes",
            ref: "a",
            output: [{ recipeName: "Alternate: Pure Iron Ingot", score: 0.8 }],
          },
        },
        {
          toolResponse: {
            name: "searchSchematics",
            ref: "b",
            output: [{ name: "Tier 3 - Coal Power", score: 0.9 }],
          },
        },
      ]),
    ];
    const calls = summarizeToolActivity(messages);
    expect(calls[0].results).toEqual([
      { name: "Alternate: Pure Iron Ingot", score: 0.8 },
    ]);
    expect(calls[1].results).toEqual([
      { name: "Tier 3 - Coal Power", score: 0.9 },
    ]);
  });

  it("falls back to order when refs are absent", () => {
    const messages = [
      modelMessage([
        { toolRequest: { name: "searchGameData", input: { query: "q1" } } },
        { toolRequest: { name: "searchGameData", input: { query: "q2" } } },
      ]),
      toolMessage([
        {
          toolResponse: {
            name: "searchGameData",
            output: [{ displayName: "First", score: 1 }],
          },
        },
        {
          toolResponse: {
            name: "searchGameData",
            output: [{ displayName: "Second", score: 1 }],
          },
        },
      ]),
    ];
    const calls = summarizeToolActivity(messages);
    expect(calls[0].results[0].name).toBe("First");
    expect(calls[1].results[0].name).toBe("Second");
  });

  it("ignores malformed or non-array outputs", () => {
    const messages = [
      modelMessage([
        { toolRequest: { name: "searchGameData", ref: "x", input: {} } },
      ]),
      toolMessage([
        {
          toolResponse: {
            name: "searchGameData",
            ref: "x",
            output: [{ displayName: "No score" }, null, "junk", 42],
          },
        },
      ]),
    ];
    expect(summarizeToolActivity(messages)[0].results).toEqual([]);
  });
});

// ─── TurnStore ──────────────────────────────────────────────────────────────

function fakeDb(added: Record<string, unknown>[], failWith?: Error) {
  return {
    collection: (name: string) => ({
      add: async (doc: Record<string, unknown>) => {
        if (failWith) throw failWith;
        added.push({ ...doc, _collection: name });
        return { id: "fake-id" };
      },
    }),
  } as unknown as Firestore;
}

describe("TurnStore", () => {
  it("writes one doc per turn with defaults applied", async () => {
    const added: Record<string, unknown>[] = [];
    const store = new TurnStore(fakeDb(added));
    await store.record({
      question: "how do I make screws",
      toolCalls: [
        {
          tool: "searchRecipes",
          input: { query: "screws" },
          results: [{ name: "Screw", score: 0.95 }],
        },
      ],
      answer: "Use a Constructor.",
      latencyMs: 1234,
    });

    expect(added).toHaveLength(1);
    const doc = added[0];
    expect(doc._collection).toBe("turns");
    expect(doc.question).toBe("how do I make screws");
    expect(doc.sessionId).toBeNull();
    expect(doc.answer).toBe("Use a Constructor.");
    expect(doc.answerChars).toBe("Use a Constructor.".length);
    expect(doc.error).toBeNull();
    expect(doc.toolCalls).toEqual([
      {
        tool: "searchRecipes",
        input: { query: "screws" },
        results: [{ name: "Screw", score: 0.95 }],
      },
    ]);
    expect(doc.createdAt).toBeDefined();
  });

  it("caps stored answers but keeps the true length", async () => {
    const added: Record<string, unknown>[] = [];
    const store = new TurnStore(fakeDb(added));
    await store.record({
      question: "q",
      toolCalls: [],
      answer: "x".repeat(5000),
      latencyMs: 1,
    });
    expect((added[0].answer as string).length).toBe(4000);
    expect(added[0].answerChars).toBe(5000);
  });

  it("records error turns without an answer", async () => {
    const added: Record<string, unknown>[] = [];
    const store = new TurnStore(fakeDb(added));
    await store.record({
      question: "q",
      sessionId: "s1",
      toolCalls: [],
      latencyMs: 10,
      error: "boom",
    });
    expect(added[0].error).toBe("boom");
    expect(added[0].answer).toBeNull();
    expect(added[0].answerChars).toBe(0);
    expect(added[0].sessionId).toBe("s1");
  });

  it("never throws when Firestore is unavailable", async () => {
    const store = new TurnStore(fakeDb([], new Error("unavailable")));
    await expect(
      store.record({ question: "q", toolCalls: [], latencyMs: 1 }),
    ).resolves.toBeUndefined();
  });
});
