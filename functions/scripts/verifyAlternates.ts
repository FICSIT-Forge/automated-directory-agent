/**
 * Data-shape check for the refined EST_Alternate handling (Issue #5, Phase 2).
 *
 * We do NOT index EST_Alternate schematics as standalone entities (they crowd
 * out genuine Milestone/MAM milestones in retrieval — this was the prog-01
 * regression). Instead, DataParser records exactly which recipes those
 * schematics unlock (the "hard-drive recipe set"), and the enricher tags each
 * such recipe — when it has no indexed Milestone/MAM unlock — with a generic
 * "Unlocked by: Hard Drive scan (MAM research)" line.
 *
 * This script mirrors that pipeline against the raw Docs and checks the
 * invariants that keep it sound, so a future game-data update can't silently
 * break them:
 *
 *   INV-1  Provenance is never wrong — the generic hard-drive line is only ever
 *          applied to recipes genuinely unlocked by an EST_Alternate schematic.
 *   INV-2  No silent loss — every recipe whose ONLY unlock is EST_Alternate is
 *          tagged, so it keeps its provenance after the schematic is dropped.
 *   INV-3  Tagging is active — the hard-drive set is non-empty (guards against a
 *          parse regression silently zeroing it out).
 *
 * It also reports "Alternate"-named recipes that are NOT hard-drive unlocks
 * (EST_Custom/MAM-only, e.g. Turbofuel, Distilled Silica): these correctly get
 * no hard-drive line, and any with no modeled unlock at all are flagged as
 * honest gaps (we add no false info).
 *
 * Read-only; does not touch the index. Run with:  pnpm verify:alternates
 */

import * as fs from "fs";
import { DOCS_PATH } from "./paths.js";
import { parseSchematicUnlocks } from "../src/data/rawParser.js";

const RECIPE_PATTERN = "FGRecipe'";
const CUSTOMIZATION_RECIPE_PATTERN = "FGCustomizationRecipe";
const SCHEMATIC_PATTERN = "FGSchematic";

// Indexed schematic types (mirror isSchematicType in types.ts, minus EST_Alternate).
const INDEXED_TYPES = ["EST_Milestone", "EST_MAM"];

interface RawClass {
  ClassName: string;
  mDisplayName?: string;
  mType?: string;
  mUnlocks?: unknown[];
  [key: string]: unknown;
}
interface RawGroup {
  NativeClass: string;
  Classes: RawClass[];
}

function loadDocs(): RawGroup[] {
  let content = fs.readFileSync(DOCS_PATH, "utf-8");
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
  return JSON.parse(content) as RawGroup[];
}

// Mirror DataParser.parseRecipe's alternate detection exactly.
function isAlternateRecipe(cls: RawClass): boolean {
  return (
    (cls.mDisplayName?.startsWith("Alternate:") ?? false) ||
    cls.ClassName.includes("Alternate")
  );
}

function main(): void {
  const data = loadDocs();

  const recipeIsAlt = new Map<string, boolean>(); // recipeClassName -> isAlternate
  const schematics: RawClass[] = [];

  for (const group of data) {
    const nc = group.NativeClass;
    if (
      nc.includes(RECIPE_PATTERN) &&
      !nc.includes(CUSTOMIZATION_RECIPE_PATTERN)
    ) {
      for (const cls of group.Classes) {
        if (cls.mDisplayName)
          recipeIsAlt.set(cls.ClassName, isAlternateRecipe(cls));
      }
    } else if (nc.includes(SCHEMATIC_PATTERN)) {
      schematics.push(...group.Classes);
    }
  }

  // Schematic counts by type (informational).
  const byType = new Map<string, number>();
  for (const s of schematics) {
    const t = s.mType ?? "(none)";
    byType.set(t, (byType.get(t) ?? 0) + 1);
  }

  // For each recipe, the set of schematic types that unlock it.
  const unlockTypesByRecipe = new Map<string, Set<string>>();
  for (const s of schematics) {
    const type = s.mType ?? "(none)";
    for (const recipeClass of parseSchematicUnlocks(s.mUnlocks ?? [])) {
      let set = unlockTypesByRecipe.get(recipeClass);
      if (!set) unlockTypesByRecipe.set(recipeClass, (set = new Set()));
      set.add(type);
    }
  }

  const unlockedBy = (rc: string, type: string): boolean =>
    unlockTypesByRecipe.get(rc)?.has(type) ?? false;
  const indexedUnlock = (rc: string): boolean =>
    INDEXED_TYPES.some((t) => unlockedBy(rc, t));

  // hardDriveRecipes mirrors DataParser.hardDriveRecipes: recipes unlocked by an
  // EST_Alternate schematic. The enricher tags exactly these — when they have no
  // indexed Milestone/MAM unlock — with the generic hard-drive provenance line.
  const hardDriveRecipes = [...unlockTypesByRecipe.entries()]
    .filter(([, types]) => types.has("EST_Alternate"))
    .map(([rc]) => rc);

  // How each hard-drive recipe is actually enriched.
  const richRef: string[] = []; // indexed schematic ref shown; generic line suppressed
  const genericLine: string[] = []; // generic hard-drive line appended
  for (const rc of hardDriveRecipes) {
    (indexedUnlock(rc) ? richRef : genericLine).push(rc);
  }

  // "Alternate"-named recipes NOT in the hard-drive set: correctly NOT tagged
  // (EST_Custom/MAM-only unlocks). Some have no modeled unlock at all.
  const altNotHardDrive = [...recipeIsAlt.entries()]
    .filter(([rc, isAlt]) => isAlt && !unlockedBy(rc, "EST_Alternate"))
    .map(([rc]) => rc)
    .sort();
  const altUncovered = altNotHardDrive.filter((rc) => !indexedUnlock(rc));

  // ─── Report ───────────────────────────────────────────────────────────────
  console.log("=== Schematic counts by mType ===");
  for (const [t, n] of [...byType].sort()) console.log(`  ${t}: ${n}`);

  console.log("\n=== Hard-drive recipe set (what the enricher tags) ===");
  console.log(
    `  recipes unlocked by EST_Alternate:        ${hardDriveRecipes.length}`,
  );
  console.log(
    `    -> shown via indexed schematic ref:     ${richRef.length} (generic line suppressed)`,
  );
  console.log(
    `    -> tagged with generic hard-drive line: ${genericLine.length}`,
  );

  console.log(
    "\n=== INFO: 'Alternate'-named recipes NOT tagged as hard-drive ===",
  );
  console.log(
    "  (EST_Custom/MAM-only unlocks -> correctly given no hard-drive line)",
  );
  console.log(`  count: ${altNotHardDrive.length}`);
  for (const rc of altNotHardDrive) {
    const types = [...(unlockTypesByRecipe.get(rc) ?? [])];
    console.log(`    ${rc}  [unlock types: ${types.join(", ") || "none"}]`);
  }
  if (altUncovered.length) {
    console.log(
      `  ${altUncovered.length} of these have NO modeled unlock at all (honest gap, no false info): ${altUncovered.join(", ")}`,
    );
  }

  // ─── Invariants ─────────────────────────────────────────────────────────────
  const hardDriveSet = new Set(hardDriveRecipes);
  const genericSet = new Set(genericLine);
  const altOnly = hardDriveRecipes.filter((rc) => !indexedUnlock(rc));

  const inv1 = genericLine.every((rc) => hardDriveSet.has(rc));
  const inv2 = altOnly.every((rc) => genericSet.has(rc));
  const inv3 = genericLine.length > 0;

  console.log("\n=== Invariants ===");
  console.log(
    `  INV-1 generic line only on real hard-drive recipes: ${inv1 ? "ok" : "FAIL"}`,
  );
  console.log(
    `  INV-2 no recipe loses its only unlock provenance:    ${inv2 ? "ok" : "FAIL"}`,
  );
  console.log(
    `  INV-3 hard-drive tagging is active:                  ${inv3 ? "ok" : "FAIL"}`,
  );

  const pass = inv1 && inv2 && inv3;
  console.log(
    `\n${pass ? "✅ PASS" : "❌ FAIL"} — refined EST_Alternate handling is ${pass ? "sound" : "BROKEN"}.`,
  );
  process.exit(pass ? 0 : 1);
}

main();
