import { describe, it, expect } from "vitest";
import {
  computeMetrics,
  evaluateGate,
  metricsByCategory,
  rankOfFirstRelevant,
  scoreCase,
} from "./metrics.js";
import type {
  CaseResult,
  GoldCase,
  RankedResult,
  Thresholds,
} from "./types.js";

// ─── Test helpers ──────────────────────────────────────────────────────────────

const ranked = (...classNames: string[]): RankedResult[] =>
  classNames.map((className, i) => ({ className, score: 1 - i * 0.1 }));

const caseResult = (rank: number | null, category = "factual"): CaseResult => ({
  id: "x",
  query: "q",
  category,
  rank,
  top: [],
  relevant: [],
});

const thresholds: Thresholds = {
  hitAt5Floor: 0.7,
  mrrFloor: 0.6,
  regressionTolerance: 0.03,
};

// ─── rankOfFirstRelevant ────────────────────────────────────────────────────────

describe("rankOfFirstRelevant", () => {
  it("returns 1-based rank of the first relevant result", () => {
    const results = ranked("A", "B", "C");
    expect(rankOfFirstRelevant(results, new Set(["B"]))).toBe(2);
  });

  it("returns the earliest rank when multiple results are relevant", () => {
    const results = ranked("A", "B", "C");
    expect(rankOfFirstRelevant(results, new Set(["C", "B"]))).toBe(2);
  });

  it("returns null when no result is relevant", () => {
    const results = ranked("A", "B");
    expect(rankOfFirstRelevant(results, new Set(["Z"]))).toBeNull();
  });

  it("returns null for an empty result list", () => {
    expect(rankOfFirstRelevant([], new Set(["A"]))).toBeNull();
  });
});

// ─── scoreCase ──────────────────────────────────────────────────────────────────

describe("scoreCase", () => {
  const goldCase: GoldCase = {
    id: "fact-01",
    query: "iron plate recipe",
    category: "factual",
    relevant: ["Recipe_IronPlate_C"],
    source: "authored",
  };

  it("scores a hit with the correct rank", () => {
    const result = scoreCase(
      goldCase,
      ranked("Recipe_Other_C", "Recipe_IronPlate_C"),
    );
    expect(result.rank).toBe(2);
    expect(result.id).toBe("fact-01");
    expect(result.category).toBe("factual");
  });

  it("records rank null on a miss", () => {
    const result = scoreCase(goldCase, ranked("Recipe_Other_C"));
    expect(result.rank).toBeNull();
  });

  it("retains only the top 3 results for diagnostics", () => {
    const result = scoreCase(goldCase, ranked("A", "B", "C", "D", "E"));
    expect(result.top.map((t) => t.className)).toEqual(["A", "B", "C"]);
  });
});

// ─── computeMetrics ──────────────────────────────────────────────────────────────

describe("computeMetrics", () => {
  it("returns zeros for an empty set", () => {
    expect(computeMetrics([])).toEqual({
      n: 0,
      hitAt1: 0,
      hitAt3: 0,
      hitAt5: 0,
      mrr: 0,
    });
  });

  it("computes Hit@K and MRR over a mixed set", () => {
    // ranks 1, 2, miss → Hit@1 1/3, Hit@3 2/3, Hit@5 2/3, MRR (1 + 0.5 + 0)/3
    const m = computeMetrics([caseResult(1), caseResult(2), caseResult(null)]);
    expect(m.n).toBe(3);
    expect(m.hitAt1).toBeCloseTo(1 / 3);
    expect(m.hitAt3).toBeCloseTo(2 / 3);
    expect(m.hitAt5).toBeCloseTo(2 / 3);
    expect(m.mrr).toBeCloseTo(0.5);
  });

  it("respects the K boundary (rank 4 hits @5 but not @3 or @1)", () => {
    const m = computeMetrics([caseResult(4)]);
    expect(m.hitAt1).toBe(0);
    expect(m.hitAt3).toBe(0);
    expect(m.hitAt5).toBe(1);
    expect(m.mrr).toBeCloseTo(0.25);
  });
});

// ─── metricsByCategory ───────────────────────────────────────────────────────────

describe("metricsByCategory", () => {
  it("groups by category with sorted keys", () => {
    const byCat = metricsByCategory([
      caseResult(1, "relational"),
      caseResult(null, "factual"),
      caseResult(1, "factual"),
    ]);
    expect(Object.keys(byCat)).toEqual(["factual", "relational"]);
    expect(byCat.factual.n).toBe(2);
    expect(byCat.factual.hitAt5).toBeCloseTo(0.5);
    expect(byCat.relational.hitAt5).toBe(1);
  });
});

// ─── evaluateGate ────────────────────────────────────────────────────────────────

describe("evaluateGate", () => {
  const strong = { n: 10, hitAt1: 0.8, hitAt3: 0.9, hitAt5: 0.9, mrr: 0.85 };

  it("passes above floors with no baseline", () => {
    const gate = evaluateGate(strong, thresholds, null);
    expect(gate.passed).toBe(true);
    expect(gate.failures).toEqual([]);
    expect(gate.baselineDelta).toBeNull();
  });

  it("fails when Hit@5 is below the floor", () => {
    const gate = evaluateGate({ ...strong, hitAt5: 0.5 }, thresholds, null);
    expect(gate.passed).toBe(false);
    expect(gate.failures.some((f) => f.includes("Hit@5"))).toBe(true);
  });

  it("fails when MRR is below the floor", () => {
    const gate = evaluateGate({ ...strong, mrr: 0.4 }, thresholds, null);
    expect(gate.passed).toBe(false);
    expect(gate.failures.some((f) => f.includes("MRR"))).toBe(true);
  });

  it("fails and reports the delta on regression beyond tolerance", () => {
    const baseline = { ...strong, hitAt5: 0.95, mrr: 0.9 };
    const gate = evaluateGate({ ...strong, hitAt5: 0.8 }, thresholds, baseline);
    expect(gate.passed).toBe(false);
    expect(gate.baselineDelta?.hitAt5).toBeCloseTo(-0.15);
    expect(gate.failures.some((f) => f.includes("regressed"))).toBe(true);
  });

  it("passes when a drop is within tolerance and floors are met", () => {
    const baseline = { ...strong, hitAt5: 0.92, mrr: 0.86 };
    const gate = evaluateGate({ ...strong, hitAt5: 0.9 }, thresholds, baseline);
    expect(gate.passed).toBe(true);
    expect(gate.baselineDelta?.hitAt5).toBeCloseTo(-0.02);
  });

  it("passes and reports a positive delta on improvement", () => {
    const baseline = { ...strong, hitAt5: 0.8, mrr: 0.75 };
    const gate = evaluateGate(strong, thresholds, baseline);
    expect(gate.passed).toBe(true);
    expect(gate.baselineDelta?.hitAt5).toBeCloseTo(0.1);
  });
});
