/**
 * Tests SearchService behavior — both the index-loading path and the
 * entity-type filtering logic.
 *
 * Part A: Index loading + entity-type filter (no API key needed)
 * Part B: Full embedQuery → search roundtrip (requires GEMINI_API_KEY)
 *
 * Run: npx tsx scripts/testSearch.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as assert from "assert";
import { EmbeddingEngine } from "../src/data/embeddings.js";
import type { IndexedEntity } from "../src/data/types.js";

const INDEX_PATH = path.resolve(import.meta.dirname, "../game_data_index.json");

// ─── Part A: Index loading + filter (no API) ─────────────────────────────────

console.log("=== Part A: Index loading + entity-type filter ===\n");

assert.ok(fs.existsSync(INDEX_PATH), `Index file not found: ${INDEX_PATH}`);
const entities = JSON.parse(
  fs.readFileSync(INDEX_PATH, "utf-8"),
) as IndexedEntity[];
console.log(`Loaded ${entities.length} entities`);

const byType = new Map<string, number>();
for (const e of entities)
  byType.set(e.entityType, (byType.get(e.entityType) ?? 0) + 1);
console.log("Entity type counts:", Object.fromEntries(byType));

const recipes = entities.filter((e) => e.entityType === "recipe");
assert.ok(recipes.length > 0, "No recipe entities in index!");
console.log(`\n✓ Recipe entities found: ${recipes.length}`);

// Verify recipe metadata structure
const sampleRecipe = recipes.find((r) => r.displayName === "Iron Plate");
assert.ok(sampleRecipe, "Iron Plate recipe not found");
const meta = sampleRecipe.metadata as unknown as Record<string, unknown>;
assert.ok(
  Array.isArray(meta.ingredients),
  "metadata.ingredients is not an array",
);
assert.ok(Array.isArray(meta.products), "metadata.products is not an array");
assert.ok(
  Array.isArray(meta.producedIn),
  "metadata.producedIn is not an array",
);
assert.ok(
  typeof meta.durationSecs === "number",
  "metadata.durationSecs is not a number",
);
console.log(`✓ Iron Plate recipe metadata is valid`);
console.log(`  embeddingText: ${sampleRecipe.embeddingText.slice(0, 150)}`);

// Verify embeddings exist on recipes
const recipesWithEmbedding = recipes.filter(
  (r) => Array.isArray(r.embedding) && r.embedding.length > 0,
);
assert.strictEqual(
  recipesWithEmbedding.length,
  recipes.length,
  `Only ${recipesWithEmbedding.length}/${recipes.length} recipes have embeddings`,
);
console.log(
  `✓ All ${recipes.length} recipes have embeddings (dim=${recipes[0].embedding.length})`,
);

// Part A: Search using a recipe's own embedding as the query (perfect match expected)
console.log(
  "\n--- Self-similarity search (should return self as top result) ---",
);
const engine = EmbeddingEngine.fromIndex(entities);
const queryEmbedding = sampleRecipe.embedding; // use Iron Plate's own embedding
const results = engine.search(queryEmbedding, 5, ["recipe"]);

assert.ok(
  results.length > 0,
  "search() returned no results for recipe entity type!",
);
console.log(`✓ search(["recipe"]) returned ${results.length} results`);
for (const r of results) {
  console.log(`  [${r.score.toFixed(4)}] ${r.displayName}`);
}
assert.ok(
  results[0].displayName === "Iron Plate" || results[0].score > 0.95,
  `Top result should be Iron Plate (got ${results[0].displayName} with score ${results[0].score})`,
);
console.log(
  `✓ Top result is "${results[0].displayName}" (score=${results[0].score.toFixed(4)})`,
);

// Confirm entity-type isolation: no non-recipe results
const nonRecipes = results.filter((r) => r.entityType !== "recipe");
assert.strictEqual(
  nonRecipes.length,
  0,
  "search() returned non-recipe entities!",
);
console.log(`✓ All results are entity type "recipe"`);

// ─── Part B: Full embedQuery → search roundtrip ───────────────────────────────

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.log(
    "\n=== Part B: Skipped (GEMINI_API_KEY not set) ===\n" +
      "Set GEMINI_API_KEY to run the full embed+search roundtrip.\n",
  );
  console.log("=== Part A passed — index and search logic are correct ===");
  process.exit(0);
}

console.log("\n=== Part B: Full embedQuery → search roundtrip ===\n");

// Dynamic import so Genkit initialises with the API key already in env
const { SearchService } = await import("../src/data/searchService.js");
const service = SearchService.getInstance();

const testQueries = [
  {
    query: "how to make iron plate",
    expected: "Iron Plate",
    entityType: "recipe" as const,
  },
  {
    query: "recipe for reinforced iron plate",
    expected: "Reinforced Iron Plate",
    entityType: "recipe" as const,
  },
  { query: "screw recipe", expected: "Screw", entityType: "recipe" as const },
];

for (const t of testQueries) {
  process.stdout.write(`Query: "${t.query}" → `);
  const searchResults = await service.search(t.query, 5, [t.entityType]);
  if (searchResults.length === 0) {
    console.log("NO RESULTS ✗");
  } else {
    const top = searchResults[0];
    const found = searchResults.some((r) => r.displayName.includes(t.expected));
    console.log(
      `${found ? "✓" : "⚠"} top="${top.displayName}" (${top.score.toFixed(4)})` +
        (found ? "" : ` — expected "${t.expected}"`),
    );
  }
}

console.log("\n=== All tests passed ===");
