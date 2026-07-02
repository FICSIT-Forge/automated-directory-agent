/**
 * Types for the Layer-2 retrieval-quality eval.
 *
 * GoldCase/GoldSet mirror the eval/gold-set.json schema (the labeled inputs).
 * RankedResult/CaseResult/Metrics/GateResult describe the scoring outputs.
 * Kept free of any I/O or engine dependency so the scoring logic stays pure
 * and unit-testable.
 */

import type { EntityType } from "../data/types.js";

/** A single labeled gold-set case: a query and its acceptable answers. */
export interface GoldCase {
  readonly id: string;
  readonly query: string;
  readonly category: string;
  /** Entity-type filter mirroring the tool that serves this query. */
  readonly types?: readonly EntityType[];
  /** Acceptable answer classNames; ANY one in top-K counts as a hit. */
  readonly relevant: readonly string[];
  readonly source: string;
  readonly notes?: string;
}

export interface Thresholds {
  readonly hitAt5Floor: number;
  readonly mrrFloor: number;
  readonly regressionTolerance: number;
}

export interface GoldSet {
  readonly k: number;
  readonly thresholds: Thresholds;
  readonly queries: readonly GoldCase[];
}

/** A retrieved result reduced to what scoring and diagnostics need. */
export interface RankedResult {
  readonly className: string;
  readonly score: number;
}

/** Outcome of evaluating one gold case against an index. */
export interface CaseResult {
  readonly id: string;
  readonly query: string;
  readonly category: string;
  /** 1-based rank of the first relevant result, or null if none in range. */
  readonly rank: number | null;
  /** Top few results, retained for miss diagnostics. */
  readonly top: readonly RankedResult[];
  readonly relevant: readonly string[];
}

/** Aggregate retrieval metrics over a set of cases. */
export interface Metrics {
  readonly n: number;
  readonly hitAt1: number;
  readonly hitAt3: number;
  readonly hitAt5: number;
  readonly mrr: number;
}

/** Result of the pass/fail gate (absolute floors + regression check). */
export interface GateResult {
  readonly passed: boolean;
  readonly failures: readonly string[];
  /** Hit@5 / MRR deltas vs baseline, or null when no baseline exists. */
  readonly baselineDelta: {
    readonly hitAt5: number;
    readonly mrr: number;
  } | null;
}
