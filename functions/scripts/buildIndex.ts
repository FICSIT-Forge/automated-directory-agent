import * as fs from "fs";
import { DOCS_PATH, INDEX_PATH } from "./paths";
import { DataParser } from "../src/data/parser";
import { enrichEntities } from "../src/data/enricher";
import { EmbeddingEngine } from "../src/data/embeddings";
import type { EntityType, GameEntity } from "../src/data/types";

// ─── Validation ─────────────────────────────────────────────────────────────

interface SanityQuery {
  readonly query: string;
  readonly expected: string;
  readonly type: EntityType;
}

const REQUIRED_TYPES: readonly EntityType[] = [
  "item",
  "recipe",
  "manufacturer",
  "generator",
  "extractor",
  "schematic",
];

const SANITY_QUERIES: readonly SanityQuery[] = [
  { query: "iron plate recipe", expected: "Iron Plate", type: "recipe" },
  { query: "coal generator power", expected: "Coal", type: "generator" },
  { query: "bauxite ore", expected: "Bauxite", type: "item" },
  {
    query: "constructor power consumption",
    expected: "Constructor",
    type: "manufacturer",
  },
  { query: "tier 3 milestone", expected: "Steel", type: "schematic" },
];

function countByType(entities: readonly GameEntity[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of entities) {
    counts.set(e.entityType, (counts.get(e.entityType) ?? 0) + 1);
  }
  return counts;
}

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function validateParserOutput(entities: readonly GameEntity[]): void {
  console.log("\n--- Parser Quality Checks ---");

  const typeCounts = countByType(entities);

  for (const type of REQUIRED_TYPES) {
    if (!typeCounts.has(type)) fail(`Missing required entity type: ${type}`);
    console.log(`  ${type}: ${typeCounts.get(type)}`);
  }

  const ironPlateRecipe = entities.find(
    (e) => e.entityType === "recipe" && e.displayName === "Iron Plate",
  );
  if (!ironPlateRecipe) fail("Iron Plate recipe not found");

  if (ironPlateRecipe.embeddingText.includes("Desc_"))
    fail("Recipe embeddingText contains unresolved class names");

  if (!ironPlateRecipe.embeddingText.includes("/min"))
    fail("Recipe embeddingText missing rate calculations");

  console.log("  Parser checks passed");
}

function validateEnrichment(entities: readonly GameEntity[]): void {
  console.log("\n--- Enrichment Quality Checks ---");

  // Iron Plate item should have recipe cross-refs
  const ironPlateItem = entities.find(
    (e) => e.entityType === "item" && e.displayName === "Iron Plate",
  );
  if (ironPlateItem && !ironPlateItem.embeddingText.includes("Produced by:"))
    fail("Iron Plate item missing 'Produced by:' enrichment");

  // At least one recipe should have unlock info
  const recipesWithUnlocks = entities.filter(
    (e) =>
      e.entityType === "recipe" && e.embeddingText.includes("Unlocked by:"),
  );
  if (recipesWithUnlocks.length === 0)
    fail("No recipes have 'Unlocked by:' enrichment");

  // EST_Alternate schematics are intentionally excluded from the index: they
  // crowd out genuine Milestone/MAM milestones in retrieval. Assert none leaked.
  const alternateSchematics = entities.filter(
    (e) => e.entityType === "schematic" && e.metadata.type === "EST_Alternate",
  );
  if (alternateSchematics.length > 0)
    fail(
      `${alternateSchematics.length} EST_Alternate schematics present (should be excluded)`,
    );

  // Instead, recipes unlocked by a Hard Drive (EST_Alternate) scan carry their
  // provenance directly. Most are alternate recipes, but a few standard recipes
  // share a hard-drive unlock too.
  const hardDriveTagged = entities.filter(
    (e) =>
      e.entityType === "recipe" &&
      e.embeddingText.includes("Hard Drive scan (MAM research)"),
  );
  if (hardDriveTagged.length === 0)
    fail("No recipes tagged with Hard Drive scan provenance");

  // Check for unresolved classNames in embeddingText
  const unresolved = entities.filter((e) => /Desc_\w+_C/.test(e.embeddingText));
  if (unresolved.length > 0) {
    console.warn(
      `  ${unresolved.length} entities with unresolved classNames (cosmetic variants):`,
    );
    for (const e of unresolved.slice(0, 5)) {
      console.warn(`    - ${e.displayName} (${e.className})`);
    }
  }

  console.log(`  ${recipesWithUnlocks.length} recipes with unlock info`);
  console.log(`  ${hardDriveTagged.length} recipes tagged (Hard Drive scan)`);
  console.log("  Enrichment checks passed");
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Building game data index ===\n");

  // 1. Locate source
  if (!fs.existsSync(DOCS_PATH)) fail(`Docs file not found at ${DOCS_PATH}`);

  // 2. Parse
  console.log("Parsing game data...");
  const parser = new DataParser(DOCS_PATH);
  await parser.load();
  const entities = parser.parse();
  console.log(`Parsed ${entities.length} entities`);

  // 3. Validate parser output
  validateParserOutput(entities);

  // 4. Enrich with cross-entity relationships
  console.log("\nEnriching entities with cross-references...");
  enrichEntities(entities, parser.hardDriveRecipes);

  // 5. Validate enrichment
  validateEnrichment(entities);

  // 6. Generate embeddings
  console.log("\nGenerating embeddings (batch size 20)...");
  const startTime = Date.now();
  const engine = await EmbeddingEngine.build(entities);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Embedding generation completed in ${elapsed}s`);

  // 7. Save index
  const indexed = engine.getIndexedEntities();
  fs.writeFileSync(INDEX_PATH, JSON.stringify(indexed, null, 2));
  const fileSizeMB = (fs.statSync(INDEX_PATH).size / 1024 / 1024).toFixed(1);
  console.log(`\nSaved index: ${fileSizeMB} MB → ${INDEX_PATH}`);

  // 8. Sanity-check search
  console.log("\n--- Search Sanity Checks ---");
  for (const { query, expected, type } of SANITY_QUERIES) {
    const embedding = await engine.embedQuery(query);
    const [topResult] = engine.search(embedding, 3, [type]);
    const hit = topResult?.displayName.includes(expected);
    const label = hit ? "ok" : "MISS";
    console.log(
      `  [${label}] "${query}" -> ${topResult?.displayName ?? "no results"} (${topResult?.score.toFixed(4) ?? "n/a"})`,
    );
  }

  console.log("\n=== Build completed successfully ===");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
