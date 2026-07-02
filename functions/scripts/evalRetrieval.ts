/**
 * Layer-2 retrieval-quality eval for the game-data RAG index.
 *
 * Thin orchestration around the pure scoring logic in src/eval/metrics.ts:
 * parse args, load the index, embed queries (cached), run the same
 * EmbeddingEngine search the production tools use, then report and gate.
 *
 * Why a script, not a vitest test: it needs GEMINI_API_KEY (to embed queries),
 * loads the ~73MB index, and hits the network. The deterministic metric math is
 * unit-tested in src/eval/metrics.test.ts (Layer 1); this is Layer 2.
 *
 * Usage:
 *   pnpm eval                      # run + gate against baseline
 *   pnpm eval --update-baseline    # accept current numbers as the new baseline
 *   pnpm eval --vs <indexPath>     # A/B: also run a second index, print the diff
 *   pnpm eval --index <indexPath>  # evaluate a non-default index
 *
 * Query embeddings are cached (eval/.query-embedding-cache.json) so reruns are
 * free and deterministic. The cache is index-independent, so --vs reuses it for
 * both indexes — only the stored document embeddings differ between them.
 */

import * as fs from "fs";
import * as path from "path";
import { INDEX_PATH } from "./paths";
import { EmbeddingEngine } from "../src/data/embeddings";
import type { EntityType, IndexedEntity } from "../src/data/types";
import {
  computeMetrics,
  evaluateGate,
  metricsByCategory,
  scoreCase,
} from "../src/eval/metrics";
import type {
  CaseResult,
  GoldCase,
  GoldSet,
  Metrics,
  RankedResult,
} from "../src/eval/types";

/** Search depth: production tools fetch 4–10; we look at 10 to score MRR. */
const SEARCH_DEPTH = 10;

const EVAL_DIR = path.resolve(import.meta.dirname, "../eval");
const GOLD_PATH = path.join(EVAL_DIR, "gold-set.json");
const BASELINE_PATH = path.join(EVAL_DIR, "baseline-metrics.json");
const CACHE_PATH = path.join(EVAL_DIR, ".query-embedding-cache.json");
const DEFAULT_INDEX = INDEX_PATH;

// ─── CLI args ────────────────────────────────────────────────────────────────

interface Args {
  readonly indexPath: string;
  readonly vsPath?: string;
  readonly updateBaseline: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const valueOf = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    indexPath: valueOf("--index") ?? DEFAULT_INDEX,
    vsPath: valueOf("--vs"),
    updateBaseline: argv.includes("--update-baseline"),
  };
}

// ─── I/O ─────────────────────────────────────────────────────────────────────

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}

function loadEngine(indexPath: string): EmbeddingEngine {
  if (!fs.existsSync(indexPath)) {
    throw new Error(`Index not found: ${indexPath} (run 'pnpm build:index')`);
  }
  return EmbeddingEngine.fromIndex(readJson<IndexedEntity[]>(indexPath));
}

function readBaseline(): Metrics | null {
  return fs.existsSync(BASELINE_PATH) ? readJson<Metrics>(BASELINE_PATH) : null;
}

/**
 * Embed every query, reusing a JSON cache keyed by query text. The cache is
 * independent of the index, so it serves both sides of an --vs comparison.
 */
async function embedQueriesCached(
  engine: EmbeddingEngine,
  queries: readonly string[],
): Promise<Map<string, number[]>> {
  const cache: Record<string, number[]> = fs.existsSync(CACHE_PATH)
    ? readJson<Record<string, number[]>>(CACHE_PATH)
    : {};
  const out = new Map<string, number[]>();
  let misses = 0;

  for (const query of queries) {
    const cached = cache[query];
    const embedding = cached ?? (await engine.embedQuery(query));
    if (!cached) {
      cache[query] = embedding;
      misses++;
    }
    out.set(query, embedding);
  }

  if (misses > 0) {
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache));
    console.log(`Embedded ${misses} new queries (cache updated).`);
  }
  return out;
}

// ─── Eval ──────────────────────────────────────────────────────────────────────

function runCases(
  engine: EmbeddingEngine,
  cases: readonly GoldCase[],
  embeddings: Map<string, number[]>,
): CaseResult[] {
  return cases.map((c) => {
    const embedding = embeddings.get(c.query);
    if (!embedding) throw new Error(`Missing embedding for query: ${c.query}`);
    const ranked: RankedResult[] = engine
      .search(embedding, SEARCH_DEPTH, c.types as EntityType[] | undefined)
      .map((r) => ({ className: r.className, score: r.score }));
    return scoreCase(c, ranked);
  });
}

// ─── Reporting ───────────────────────────────────────────────────────────────

const pct = (x: number) => `${(x * 100).toFixed(0).padStart(3)}%`;
const num = (x: number) => x.toFixed(3);
const signed = (x: number) => `${x >= 0 ? "+" : ""}${num(x)}`;

function printMetricsTable(
  label: string,
  byCat: Record<string, Metrics>,
  overall: Metrics,
): void {
  console.log(`\n=== ${label} ===`);
  console.log(
    "\n  category        n   Hit@1  Hit@3  Hit@5   MRR\n" +
      "  ------------------------------------------------",
  );
  const row = (name: string, m: Metrics) =>
    `  ${name.padEnd(13)} ${String(m.n).padStart(2)}   ${pct(m.hitAt1)}   ${pct(m.hitAt3)}   ${pct(m.hitAt5)}  ${num(m.mrr)}`;
  for (const [cat, m] of Object.entries(byCat)) console.log(row(cat, m));
  console.log("  ------------------------------------------------");
  console.log(row("OVERALL", overall));
}

function printMisses(results: readonly CaseResult[]): void {
  const misses = results.filter((r) => r.rank === null || r.rank > 5);
  if (misses.length === 0) {
    console.log("\n  No misses at K=5. 🎉");
    return;
  }
  console.log(
    `\n  --- ${misses.length} miss(es) at K=5 (is the label wrong, or retrieval?) ---`,
  );
  for (const m of misses) {
    console.log(
      `\n  [${m.id}] "${m.query}"  (first relevant at rank ${m.rank ?? ">" + SEARCH_DEPTH})`,
    );
    console.log(`    expected any of: ${m.relevant.join(", ")}`);
    console.log(
      `    got: ${m.top.map((t) => `${t.className} (${num(t.score)})`).join(", ")}`,
    );
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const gold = readJson<GoldSet>(GOLD_PATH);

  // Skip unfilled slots (empty relevant set / TODO placeholders).
  const cases = gold.queries.filter((q) => q.relevant.length > 0);
  const skipped = gold.queries.length - cases.length;
  console.log(
    `Loaded ${cases.length} labeled cases (${skipped} unfilled slots skipped).`,
  );

  console.log(`Loading index: ${args.indexPath}`);
  const engine = loadEngine(args.indexPath);
  const embeddings = await embedQueriesCached(
    engine,
    cases.map((c) => c.query),
  );

  const results = runCases(engine, cases, embeddings);
  const overall = computeMetrics(results);
  printMetricsTable(
    path.basename(args.indexPath),
    metricsByCategory(results),
    overall,
  );
  printMisses(results);

  // A/B comparison mode — diagnostic only, no gating.
  if (args.vsPath) {
    const engineB = loadEngine(args.vsPath);
    const resultsB = runCases(engineB, cases, embeddings);
    const overallB = computeMetrics(resultsB);
    printMetricsTable(
      path.basename(args.vsPath),
      metricsByCategory(resultsB),
      overallB,
    );
    console.log(
      `\n=== A/B delta (primary − comparison) ===\n` +
        `  Hit@5: ${signed(overall.hitAt5 - overallB.hitAt5)}   MRR: ${signed(overall.mrr - overallB.mrr)}`,
    );
    return;
  }

  if (args.updateBaseline) {
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(overall, null, 2) + "\n");
    console.log(
      `\nBaseline updated → ${path.relative(process.cwd(), BASELINE_PATH)}`,
    );
    return;
  }

  const gate = evaluateGate(overall, gold.thresholds, readBaseline());
  if (gate.baselineDelta) {
    console.log(
      `\n  vs baseline:  Hit@5 ${signed(gate.baselineDelta.hitAt5)}   MRR ${signed(gate.baselineDelta.mrr)}`,
    );
  } else {
    console.log(
      "\n  (no baseline-metrics.json yet — run with --update-baseline to create one)",
    );
  }
  for (const f of gate.failures) console.error(`FAIL: ${f}`);
  console.log("\n=== Eval complete ===");
  if (!gate.passed) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
