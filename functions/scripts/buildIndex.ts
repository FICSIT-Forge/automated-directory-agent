import * as path from "path";
import * as fs from "fs";
import { DataParser } from "../src/data/parser";
import { EmbeddingEngine } from "../src/data/embeddings";

async function main() {
  console.log("Starting build index process...");

  // Path to the Docs file
  const docsPath = path.resolve(__dirname, "../Docs-en-US-UTF-8.json");
  if (!fs.existsSync(docsPath)) {
    console.error(`Error: Docs file not found at ${docsPath}`);
    process.exit(1);
  }

  // 1. Parse Data
  console.log("Parsing data...");
  const parser = new DataParser(docsPath);
  await parser.load();
  const entities = parser.parse();
  console.log(`Parsed ${entities.length} entities.`);

  // 2. Generate Embeddings
  console.log("Generating embeddings (this may take a while)...");
  const engine = new EmbeddingEngine(entities);
  await engine.generateEmbeddings();

  // 3. Save Index
  const outputPath = path.resolve(__dirname, "../game_data_index.json");
  console.log(`Saving index to ${outputPath}...`);
  fs.writeFileSync(outputPath, JSON.stringify(entities, null, 2));

  // 4. Sanity Check
  console.log("Running sanity checks...");

  const testQueries = [
    { query: "red ore", expected: "Bauxite" },
    { query: "floating transport", expected: "Drone" },
    { query: "fuel for jetpack", expected: "Solid Biofuel" }, // or Turbo fuel
    { query: "basic iron part", expected: "Iron Plate" },
  ];

  for (const t of testQueries) {
    console.log(`\nQuery: "${t.query}"`);
    const embedding = await engine.embedQuery(t.query);
    const results = engine.search(embedding, 3);
    for (const r of results) {
      console.log(
        `  - [${r.score.toFixed(4)}] ${r.displayName} (${r.className})`,
      );
    }
  }

  console.log("\nBuild completed successfully.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
