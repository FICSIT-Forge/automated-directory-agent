import * as fs from "fs";
import { INDEX_PATH } from "./paths";
import { EmbeddingEngine } from "../src/data/embeddings";
import type { EntityType, IndexedEntity } from "../src/data/types";

// ─── Test Queries ───────────────────────────────────────────────────────────

interface VerifyQuery {
  readonly query: string;
  readonly expected: string;
  readonly types?: readonly EntityType[];
  readonly checkEnrichment?: string;
}

const QUERIES: readonly VerifyQuery[] = [
  // Original sanity checks
  { query: "red ore", expected: "Bauxite" },
  { query: "floating transport", expected: "Drone" },
  // Known-weak query (gold-set rel-01): the Jetpack runs on PACKAGED fuels,
  // not Solid Biofuel. Kept here so we notice when retrieval starts getting
  // it right; a MISS on this line is expected for now.
  { query: "fuel for jetpack", expected: "Packaged" },
  { query: "basic iron part", expected: "Iron Plate" },

  // Enrichment-specific: item ↔ recipe cross-refs
  {
    query: "how to make iron plates",
    expected: "Iron Plate",
    types: ["item"],
    checkEnrichment: "Produced by:",
  },

  // Enrichment-specific: schematic progression context
  {
    query: "tier 3 progression what to build next",
    expected: "Steel",
    types: ["schematic"],
    checkEnrichment: "Progression:",
  },

  // Enrichment-specific: manufacturer ↔ recipe list
  {
    query: "constructor recipes",
    expected: "Constructor",
    types: ["manufacturer"],
    checkEnrichment: "Recipes produced here:",
  },

  // Enrichment-specific: schematic unlock info. The HMF milestone is
  // "Industrial Manufacturing" (Tier 6) — see gold-set prog-01.
  {
    query: "unlock heavy modular frame",
    expected: "Industrial Manufacturing",
    types: ["schematic"],
  },

  // Enrichment-specific: alternate schematics
  {
    query: "alternate recipe screws",
    expected: "Screw",
    types: ["schematic", "recipe"],
  },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function countByType(entities: readonly IndexedEntity[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of entities) {
    counts.set(e.entityType, (counts.get(e.entityType) ?? 0) + 1);
  }
  return counts;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(INDEX_PATH)) fail("Index file not found");

  console.log("Loading index...");
  const entities = JSON.parse(
    fs.readFileSync(INDEX_PATH, "utf-8"),
  ) as IndexedEntity[];

  const withEmbedding = entities.filter((e) => e.embedding.length > 0);
  console.log(
    `Loaded ${entities.length} entities (${withEmbedding.length} with embeddings)`,
  );
  if (withEmbedding.length === 0) fail("No embeddings found in index");

  // Entity type breakdown
  console.log("\n--- Entity Breakdown ---");
  const typeCounts = countByType(entities);
  for (const [type, count] of typeCounts) {
    console.log(`  ${type}: ${count}`);
  }

  // EST_Alternate schematics are excluded from the index; alternate recipes
  // instead carry generic Hard Drive provenance. Report both as a guard.
  const leakedAltSchematics = entities.filter(
    (e) => e.entityType === "schematic" && e.metadata.type === "EST_Alternate",
  ).length;
  const taggedAltRecipes = entities.filter(
    (e) =>
      e.entityType === "recipe" &&
      e.embeddingText.includes("Hard Drive scan (MAM research)"),
  ).length;
  console.log(
    `  (EST_Alternate schematics: ${leakedAltSchematics}, expected 0)`,
  );
  console.log(`  (alternate recipes tagged Hard Drive: ${taggedAltRecipes})`);

  // Search queries
  console.log("\n--- Search Verification ---");
  const engine = EmbeddingEngine.fromIndex(entities);

  for (const { query, expected, types, checkEnrichment } of QUERIES) {
    const embedding = await engine.embedQuery(query);
    const results = engine.search(
      embedding,
      3,
      types as EntityType[] | undefined,
    );
    const [top] = results;

    const hit = top?.displayName.includes(expected);
    const label = hit ? "ok" : "MISS";
    console.log(
      `\n  [${label}] "${query}" -> ${top?.displayName ?? "no results"} (${top?.score.toFixed(4) ?? "n/a"})`,
    );

    // Print embeddingText snippet for enrichment verification. Check the
    // full text: enrichment lines are appended at the end, past the snippet.
    if (top && checkEnrichment) {
      const snippet = top.embeddingText.slice(0, 300);
      const hasEnrichment = top.embeddingText.includes(checkEnrichment);
      console.log(
        `    enrichment "${checkEnrichment}": ${hasEnrichment ? "present" : "MISSING"}`,
      );
      console.log(`    snippet: ${snippet}...`);
    }
  }

  console.log("\n=== Verification complete ===");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
