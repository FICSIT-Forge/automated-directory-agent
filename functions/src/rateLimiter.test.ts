import { describe, it, expect } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import {
  currentWindowId,
  decide,
  RateLimiter,
  type WindowSpec,
} from "./rateLimiter.js";

const HOUR = 60 * 60;
const sessionSpec: WindowSpec = {
  name: "session hourly limit",
  docId: "session:abc",
  limit: 3,
  windowSecs: HOUR,
};
const globalSpec: WindowSpec = {
  name: "global daily cap",
  docId: "global",
  limit: 5,
  windowSecs: 24 * HOUR,
};

// A fixed reference instant, 10 minutes into an hour window.
const NOW_MS = (1_000_000 * HOUR + 600) * 1000;

describe("currentWindowId", () => {
  it("buckets timestamps into fixed windows", () => {
    expect(currentWindowId(0, HOUR)).toBe(0);
    expect(currentWindowId(HOUR * 1000 - 1, HOUR)).toBe(0);
    expect(currentWindowId(HOUR * 1000, HOUR)).toBe(1);
  });
});

describe("decide", () => {
  it("allows and counts a first request", () => {
    const d = decide(NOW_MS, [sessionSpec], new Map());
    expect(d.allowed).toBe(true);
    expect(d.updates.get("session:abc")).toEqual({
      windowId: currentWindowId(NOW_MS, HOUR),
      count: 1,
    });
  });

  it("increments within the same window", () => {
    const windowId = currentWindowId(NOW_MS, HOUR);
    const states = new Map([["session:abc", { windowId, count: 2 }]]);
    const d = decide(NOW_MS, [sessionSpec], states);
    expect(d.allowed).toBe(true);
    expect(d.updates.get("session:abc")?.count).toBe(3);
  });

  it("blocks at the limit and reports retryAfter to window end", () => {
    const windowId = currentWindowId(NOW_MS, HOUR);
    const states = new Map([["session:abc", { windowId, count: 3 }]]);
    const d = decide(NOW_MS, [sessionSpec], states);
    expect(d.allowed).toBe(false);
    expect(d.blockedBy).toBe("session hourly limit");
    // 10 minutes into the window → 50 minutes until it resets.
    expect(d.retryAfterSecs).toBe(50 * 60);
    expect(d.updates.size).toBe(0);
  });

  it("resets the count when the window rolls over", () => {
    const staleWindow = currentWindowId(NOW_MS, HOUR) - 1;
    const states = new Map([
      ["session:abc", { windowId: staleWindow, count: 99 }],
    ]);
    const d = decide(NOW_MS, [sessionSpec], states);
    expect(d.allowed).toBe(true);
    expect(d.updates.get("session:abc")?.count).toBe(1);
  });

  it("evaluates all specs and blocks on whichever trips", () => {
    const states = new Map([
      ["global", { windowId: currentWindowId(NOW_MS, 24 * HOUR), count: 5 }],
    ]);
    const d = decide(NOW_MS, [globalSpec, sessionSpec], states);
    expect(d.allowed).toBe(false);
    expect(d.blockedBy).toBe("global daily cap");
  });

  it("updates every window when all allow", () => {
    const d = decide(NOW_MS, [globalSpec, sessionSpec], new Map());
    expect(d.allowed).toBe(true);
    expect([...d.updates.keys()].sort()).toEqual(["global", "session:abc"]);
  });
});

// ─── RateLimiter (Firestore transaction wrapper) ────────────────────────────

/**
 * Minimal in-memory stand-in for the slice of Firestore the limiter touches:
 * collection().doc() refs plus a transaction with get/set.
 */
function fakeFirestore(seed: Record<string, unknown> = {}) {
  const docs = new Map<string, Record<string, unknown>>(
    Object.entries(seed) as [string, Record<string, unknown>][],
  );
  const db = {
    collection: (name: string) => ({
      doc: (id: string) => ({ path: `${name}/${id}` }),
    }),
    runTransaction: async <T>(
      fn: (tx: {
        get: (ref: { path: string }) => Promise<{
          exists: boolean;
          data: () => Record<string, unknown> | undefined;
        }>;
        set: (ref: { path: string }, data: Record<string, unknown>) => void;
      }) => Promise<T>,
    ) =>
      fn({
        get: async (ref) => ({
          exists: docs.has(ref.path),
          data: () => docs.get(ref.path),
        }),
        set: (ref, data) => {
          docs.set(ref.path, data);
        },
      }),
  };
  return { db: db as unknown as Firestore, docs };
}

const LIMITS = { sessionPerHour: 2, globalPerDay: 5 };

describe("RateLimiter", () => {
  it("allows a first request and persists windows with expiresAt", async () => {
    const { db, docs } = fakeFirestore();
    const limiter = new RateLimiter(db, LIMITS, () => NOW_MS);

    const result = await limiter.check("abc");

    expect(result.allowed).toBe(true);
    const session = docs.get("rateLimits/session:abc");
    const global = docs.get("rateLimits/global");
    expect(session).toMatchObject({
      windowId: currentWindowId(NOW_MS, HOUR),
      count: 1,
    });
    expect(global).toMatchObject({
      windowId: currentWindowId(NOW_MS, 24 * HOUR),
      count: 1,
    });
    // expiresAt = window end + 1 day slack, so TTL cleanup can't race a
    // live window.
    const windowEndMs = (currentWindowId(NOW_MS, HOUR) + 1) * HOUR * 1000;
    expect(session?.expiresAt).toEqual(
      new Date(windowEndMs + 24 * HOUR * 1000),
    );
  });

  it("counts up across calls and blocks past the session limit", async () => {
    const { db, docs } = fakeFirestore();
    const limiter = new RateLimiter(db, LIMITS, () => NOW_MS);

    expect((await limiter.check("abc")).allowed).toBe(true);
    expect((await limiter.check("abc")).allowed).toBe(true);
    const blocked = await limiter.check("abc");

    expect(blocked.allowed).toBe(false);
    expect(blocked.blockedBy).toBe("session hourly limit");
    expect(blocked.retryAfterSecs).toBeGreaterThan(0);
    // Blocked request is not counted.
    expect(docs.get("rateLimits/session:abc")?.count).toBe(2);
  });

  it("enforces the global cap without a sessionId", async () => {
    const { db } = fakeFirestore({
      "rateLimits/global": {
        windowId: currentWindowId(NOW_MS, 24 * HOUR),
        count: 5,
      },
    });
    const limiter = new RateLimiter(db, LIMITS, () => NOW_MS);

    const result = await limiter.check(undefined);
    expect(result.allowed).toBe(false);
    expect(result.blockedBy).toBe("global daily cap");
  });

  it("fails open when Firestore is unavailable", async () => {
    const db = {
      collection: () => {
        throw new Error("firestore down");
      },
    } as unknown as Firestore;
    const limiter = new RateLimiter(db, LIMITS, () => NOW_MS);

    const result = await limiter.check("abc");
    expect(result).toEqual({ allowed: true });
  });
});
