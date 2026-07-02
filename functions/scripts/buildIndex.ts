import * as path from "path";
import * as fs from "fs";
import { DataParser } from "../src/data/parser";
import { EmbeddingEngine } from "../src/data/embeddings";
import type { EntityType } from "../src/data/types";

async function main() {
  console.log("=== Building game data index ===\n");

  // 1. Locate source file
  const docsPath = path.resolve(
    import.meta.dirname,
    "../Docs-en-US-UTF-8.json",
  );
  if (!fs.existsSync(docsPath)) {
    console.error(`Error: Docs file not found at ${docsPath}`);
    process.exit(1);
  }

  // 2. Parse data with two-pass parser
  console.log("Parsing game data...");
  const parser = new DataParser(docsPath);
  await parser.load();
  const entities = parser.parse();

  // 3. Report entity breakdown by type
  const typeCounts = new Map<string, number>();
  for (const e of entities) {
    typeCounts.set(e.entityType, (typeCounts.get(e.entityType) || 0) + 1);
  }
  console.log(`\nParsed ${entities.length} entities:`);
  for (const [type, count] of typeCounts.entries()) {
    console.log(`  ${type}: ${count}`);
  }

  // 4. Validate parser output quality
  console.log("\n--- Parser Quality Checks ---");
  const recipes = entities.filter((e) => e.entityType === "recipe");
  const sampleRecipe = recipes.find((r) => r.displayName === "Iron Plate");
  if (sampleRecipe) {
    console.log(`✓ Iron Plate recipe found`);
    console.log(`  embeddingText: ${sampleRecipe.embeddingText.slice(0, 200)}`);
    if (sampleRecipe.embeddingText.includes("Desc_")) {
      console.error(
        "✗ FAIL: Recipe embeddingText contains unresolved class names!",
      );
      process.exit(1);
    }
    if (sampleRecipe.embeddingText.includes("/min")) {
      console.log(`✓ Rates are included in embeddingText`);
    } else {
      console.error("✗ FAIL: Recipe embeddingText missing rate calculations!");
      process.exit(1);
    }
  } else {
    console.warn("⚠ Warning: Iron Plate recipe not found in parsed entities");
  }

  const requiredTypes: EntityType[] = [
    "item",
    "recipe",
    "manufacturer",
    "generator",
    "extractor",
    "schematic",
  ];
  for (const type of requiredTypes) {
    if (!typeCounts.has(type)) {
      console.error(`✗ FAIL: Missing required entity type: ${type}`);
      process.exit(1);
    }
    console.log(`✓ ${type} entities present (${typeCounts.get(type)})`);
  }

  // 5. Generate embeddings
  console.log("\nGenerating embeddings (batch size 20)...");
  const startTime = Date.now();
  const engine = await EmbeddingEngine.build(entities);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Embedding generation completed in ${elapsed}s`);

  // 6. Save index
  const outputPath = path.resolve(
    import.meta.dirname,
    "../game_data_index.json",
  );
  console.log(`\nSaving index to ${outputPath}...`);
  const indexed = engine.getIndexedEntities();
  fs.writeFileSync(outputPath, JSON.stringify(indexed, null, 2));
  const fileSizeMB = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(1);
  console.log(`Index file size: ${fileSizeMB} MB`);

  // 7. Sanity check searches
  console.log("\n--- Search Sanity Checks ---");
  const testQueries = [
    {
      query: "iron plate recipe",
      expected: "Iron Plate",
      type: "recipe" as const,
    },
    {
      query: "coal generator power",
      expected: "Coal",
      type: "generator" as const,
    },
    { query: "bauxite ore", expected: "Bauxite", type: "item" as const },
    {
      query: "constructor power consumption",
      expected: "Constructor",
      type: "manufacturer" as const,
    },
    {
      query: "tier 3 milestone",
      expected: "Tier",
      type: "schematic" as const,
    },
  ];

  for (const t of testQueries) {
    const embedding = await engine.embedQuery(t.query);
    const results = engine.search(embedding, 3, [t.type]);
    const topResult = results[0];
    if (topResult && topResult.displayName.includes(t.expected)) {
      console.log(
        `✓ "${t.query}" → ${topResult.displayName} (${topResult.score.toFixed(4)})`,
      );
    } else {
      console.warn(
        `⚠ "${t.query}" → ${topResult?.displayName || "no results"} (expected: ${t.expected})`,
      );
    }
  }

  console.log("\n=== Build completed successfully ===");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
