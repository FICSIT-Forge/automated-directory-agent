import { DataParser } from "../src/data/parser.ts";
import {
  parseClassList,
  parseSchematicUnlocks,
} from "../src/data/rawParser.ts";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  // Quick unit test of parseClassList
  const testStr = `("/Script/Engine.BlueprintGeneratedClass'/Game/FactoryGame/Recipes/Buildings/Recipe_GeneratorCoal.Recipe_GeneratorCoal_C'","/Script/Engine.BlueprintGeneratedClass'/Game/FactoryGame/Recipes/Buildings/Recipe_WaterPump.Recipe_WaterPump_C'")`;
  console.log("parseClassList test:", parseClassList(testStr));

  const parser = new DataParser(
    path.resolve(__dirname, "../Docs-en-US-UTF-8.json"),
  );
  await parser.load();
  const entities = parser.parse();

  const counts: Record<string, number> = {};
  for (const e of entities) {
    counts[e.entityType] = (counts[e.entityType] || 0) + 1;
  }
  console.log("Entity counts:", counts);
  console.log("Total:", entities.length);

  const ironPlate = entities.find(
    (e) => e.displayName === "Iron Plate" && e.entityType === "recipe",
  );
  if (ironPlate) {
    console.log("\n=== Iron Plate Recipe ===");
    console.log(ironPlate.embeddingText);
  }

  const coalGen = entities.find(
    (e) => e.displayName?.includes("Coal") && e.entityType === "generator",
  );
  if (coalGen) {
    console.log("\n=== Coal Generator ===");
    console.log(coalGen.embeddingText);
  }

  const schematic = entities.find(
    (e) => e.entityType === "schematic" && e.displayName?.includes("Coal"),
  );
  if (schematic) {
    console.log("\n=== Coal Schematic ===");
    console.log(schematic.embeddingText);
    console.log("Metadata:", JSON.stringify(schematic.metadata, null, 2));
  }

  // Additional data points for eval dataset
  const hmf = entities.find(
    (e) => e.displayName === "Heavy Modular Frame" && e.entityType === "recipe",
  );
  if (hmf) {
    console.log("\n=== Heavy Modular Frame Recipe ===");
    console.log(hmf.embeddingText);
  }

  const constructor = entities.find(
    (e) => e.displayName === "Constructor" && e.entityType === "manufacturer",
  );
  if (constructor) {
    console.log("\n=== Constructor ===");
    console.log(constructor.embeddingText);
  }

  const screwRecipes = entities.filter(
    (e) => e.entityType === "recipe" && e.displayName?.includes("Screw"),
  );
  console.log("\n=== Screw Recipes ===");
  for (const r of screwRecipes.slice(0, 4)) {
    console.log(r.embeddingText);
    console.log("---");
  }
}
main();
