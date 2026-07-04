import { describe, it, expect } from "vitest";
import { parseTurnRequest } from "./request.js";

describe("parseTurnRequest", () => {
  it("accepts the web client payload shape", () => {
    expect(
      parseTurnRequest({ question: "how do I unlock the assembler?" }),
    ).toEqual({ question: "how do I unlock the assembler?" });
  });

  it("carries sessionId through when present", () => {
    expect(parseTurnRequest({ question: "q", sessionId: "chat-42" })).toEqual({
      question: "q",
      sessionId: "chat-42",
    });
  });

  it("accepts a bare string (dev UI / scripts)", () => {
    expect(parseTurnRequest("plain question")).toEqual({
      question: "plain question",
    });
  });

  it("trims whitespace", () => {
    expect(parseTurnRequest({ question: "  q  " }).question).toBe("q");
  });

  it("rejects the double-wrapped object that caused [object Object]", () => {
    expect(() =>
      parseTurnRequest({ question: { question: "q" } }),
    ).toThrowError(/question: string/);
  });

  it("rejects empty, missing, and non-string questions", () => {
    expect(() => parseTurnRequest({ question: "" })).toThrow();
    expect(() => parseTurnRequest({ question: "   " })).toThrow();
    expect(() => parseTurnRequest({})).toThrow();
    expect(() => parseTurnRequest(null)).toThrow();
    expect(() => parseTurnRequest(42)).toThrow();
  });

  it("rejects oversized questions", () => {
    expect(() => parseTurnRequest({ question: "x".repeat(2001) })).toThrow();
  });

  it("ignores non-string sessionId and caps its length", () => {
    expect(
      parseTurnRequest({ question: "q", sessionId: 42 }).sessionId,
    ).toBeUndefined();
    expect(
      parseTurnRequest({ question: "q", sessionId: "s".repeat(500) }).sessionId,
    ).toHaveLength(128);
  });
});
