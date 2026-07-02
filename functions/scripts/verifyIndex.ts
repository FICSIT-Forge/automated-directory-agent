import * as path from "path";
import * as fs from "fs";
import { EmbeddingEngine } from "../src/data/embeddings";
import { GameEntity } from "../src/data/parser";

async function main() {
  const indexPath = path.resolve(__dirname, "../game_data_index.json");
  if (!fs.existsSync(indexPath)) {
    console.error("Index file not found.");
    process.exit(1);
  }

  console.log("Loading index...");
  const entities = JSON.parse(
    fs.readFileSync(indexPath, "utf-8"),
  ) as GameEntity[];
  console.log(`Loaded ${entities.length} entities.`);

  // Check if embeddings exist
  const withEmbedding = entities.filter(
    (e: any) => e.embedding && e.embedding.length > 0,
  );
  console.log(
    `Entities with embedding: ${withEmbedding.length}/${entities.length}`,
  );

  if (withEmbedding.length === 0) {
    console.error("No embeddings found in index. Generation failed.");
    process.exit(1);
  }

  const engine = new EmbeddingEngine(entities);
  console.log(
    "Engine prototype:",
    Object.getOwnPropertyNames(Object.getPrototypeOf(engine)),
  );

  const testQueries = [
    { query: "red ore", expected: "Bauxite" },
    { query: "floating transport", expected: "Drone" },
    { query: "fuel for jetpack", expected: "Solid Biofuel" },
    { query: "basic iron part", expected: "Iron Plate" },
  ];

  for (const t of testQueries) {
    console.log(`\nQuery: "${t.query}"`);
    try {
      const embedding = await engine.embedQuery(t.query);
      if (!embedding) {
        console.error("Failed to generate query embedding (undefined).");
        continue;
      }
      console.log(`Generated query embedding length: ${embedding.length}`);

      const results = engine.search(embedding, 3);
      for (const r of results) {
        console.log(
          `  - [${r.score.toFixed(4)}] ${r.displayName} (${r.className})`,
        );
      }
    } catch (e) {
      console.error("Search error:", e);
    }
  }
}

main().catch(console.error);
