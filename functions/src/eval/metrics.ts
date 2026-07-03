/**
 * Pure scoring + gating logic for the Layer-2 retrieval eval.
 *
 * Everything here is deterministic and free of I/O or the embedding engine, so
 * it can be unit-tested directly (see metrics.test.ts). The script that drives
 * the embedding model and the index lives in scripts/evalRetrieval.ts.
 */

import type {
  CaseResult,
  GateResult,
  GoldCase,
  Metrics,
  RankedResult,
  Thresholds,
} from "./types.js";

/** How many of the top results to retain on each case for miss diagnostics. */
const TOP_N_DISPLAY = 3;

/**
 * 1-based rank of the first relevant className in a best-first result list,
 * or null when none of the results are relevant.
 */
export function rankOfFirstRelevant(
  ordered: readonly RankedResult[],
  relevant: ReadonlySet<string>,
): number | null {
  const idx = ordered.findIndex((r) => relevant.has(r.className));
  return idx === -1 ? null : idx + 1;
}

/** Score a single gold case against an ordered (best-first) result list. */
export function scoreCase(
  c: GoldCase,
  ordered: readonly RankedResult[],
): CaseResult {
  return {
    id: c.id,
    query: c.query,
    category: c.category,
    rank: rankOfFirstRelevant(ordered, new Set(c.relevant)),
    top: ordered.slice(0, TOP_N_DISPLAY),
    relevant: c.relevant,
  };
}

const reciprocalRank = (rank: number | null): number =>
  rank === null ? 0 : 1 / rank;

const hitRateAt = (results: readonly CaseResult[], k: number): number =>
  results.filter((r) => r.rank !== null && r.rank <= k).length / results.length;

/** Aggregate Hit@{1,3,5} and MRR over a set of scored cases. */
export function computeMetrics(results: readonly CaseResult[]): Metrics {
  const n = results.length;
  if (n === 0) return { n: 0, hitAt1: 0, hitAt3: 0, hitAt5: 0, mrr: 0 };
  return {
    n,
    hitAt1: hitRateAt(results, 1),
    hitAt3: hitRateAt(results, 3),
    hitAt5: hitRateAt(results, 5),
    mrr: results.reduce((sum, r) => sum + reciprocalRank(r.rank), 0) / n,
  };
}

/** Per-category metrics, keyed by category name (sorted for stable output). */
export function metricsByCategory(
  results: readonly CaseResult[],
): Record<string, Metrics> {
  const categories = [...new Set(results.map((r) => r.category))].sort();
  return Object.fromEntries(
    categories.map((category) => [
      category,
      computeMetrics(results.filter((r) => r.category === category)),
    ]),
  );
}

/**
 * Pure gating decision: absolute floors plus regression vs an optional baseline.
 * Returns the verdict and human-readable failure reasons; printing is the
 * caller's concern.
 */
export function evaluateGate(
  overall: Metrics,
  thresholds: Thresholds,
  baseline: Metrics | null,
): GateResult {
  const failures: string[] = [];

  if (overall.hitAt5 < thresholds.hitAt5Floor) {
    failures.push(
      `Hit@5 ${overall.hitAt5.toFixed(3)} below floor ${thresholds.hitAt5Floor}`,
    );
  }
  if (overall.mrr < thresholds.mrrFloor) {
    failures.push(
      `MRR ${overall.mrr.toFixed(3)} below floor ${thresholds.mrrFloor}`,
    );
  }

  let baselineDelta: GateResult["baselineDelta"] = null;
  if (baseline) {
    const dHit = overall.hitAt5 - baseline.hitAt5;
    const dMrr = overall.mrr - baseline.mrr;
    baselineDelta = { hitAt5: dHit, mrr: dMrr };

    const tol = thresholds.regressionTolerance;
    if (dHit < -tol) {
      failures.push(
        `Hit@5 regressed ${(-dHit).toFixed(3)} (> tolerance ${tol})`,
      );
    }
    if (dMrr < -tol) {
      failures.push(`MRR regressed ${(-dMrr).toFixed(3)} (> tolerance ${tol})`);
    }
  }

  return { passed: failures.length === 0, failures, baselineDelta };
}
