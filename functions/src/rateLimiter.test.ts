import { describe, it, expect } from "vitest";
import { currentWindowId, decide, type WindowSpec } from "./rateLimiter.js";

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
