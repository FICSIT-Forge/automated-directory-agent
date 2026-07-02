import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DataParser } from "./parser.js";
import type {
  GameEntity,
  GeneratorEntity,
  RecipeEntity,
  SchematicEntity,
} from "./types.js";

// ─── Raw-docs fixture ────────────────────────────────────────────────────────
// A miniature Docs-en-US-UTF-8-*.json exercising the parser's cross-reference
// resolution: UE asset-path strings, hyphenated schematic classNames, the
// EST_Alternate → hardDriveRecipes flow, and descriptor-name fallbacks.

const assetPath = (stem: string) =>
  `/Script/Engine.BlueprintGeneratedClass'/Game/FactoryGame/Fixture/${stem}.${stem}_C'`;

const itemAmount = (stem: string, amount: number) =>
  `(ItemClass="${assetPath(stem)}",Amount=${amount})`;

const RAW_DOCS = [
  {
    NativeClass:
      "/Script/CoreUObject.Class'/Script/FactoryGame.FGItemDescriptor'",
    Classes: [
      {
        ClassName: "Desc_IronIngot_C",
        mDisplayName: "Iron Ingot",
        mDescription: "Used for crafting.\r\nSmelted from Iron Ore.",
        mForm: "RF_SOLID",
        mStackSize: "SS_MEDIUM",
        mEnergyValue: "0",
      },
      {
        ClassName: "Desc_IronPlate_C",
        mDisplayName: "Iron Plate",
        mDescription: "A sturdy plate.",
        mForm: "RF_SOLID",
        mStackSize: "SS_MEDIUM",
        mEnergyValue: "0",
      },
      {
        ClassName: "Desc_Coal_C",
        mDisplayName: "Coal",
        mDescription: "Burnable.",
        mForm: "RF_SOLID",
        mStackSize: "SS_HUGE",
        mEnergyValue: "300",
      },
    ],
  },
  {
    // Not a parsed entity type, but part of the name lookup: descriptors
    // without mDisplayName must resolve via Build_ stem or recipe product.
    NativeClass:
      "/Script/CoreUObject.Class'/Script/FactoryGame.FGBuildingDescriptor'",
    Classes: [
      { ClassName: "Desc_ConstructorMk1_C" },
      { ClassName: "Desc_Widget_C" },
    ],
  },
  {
    NativeClass:
      "/Script/CoreUObject.Class'/Script/FactoryGame.FGBuildableManufacturer'",
    Classes: [
      {
        ClassName: "Build_ConstructorMk1_C",
        mDisplayName: "Constructor",
        mDescription: "Crafts one part into another.",
        mPowerConsumption: "4",
        mManufacturingSpeed: "1",
      },
    ],
  },
  {
    NativeClass:
      "/Script/CoreUObject.Class'/Script/FactoryGame.FGBuildableGeneratorFuel'",
    Classes: [
      {
        ClassName: "Build_GeneratorCoal_C",
        mDisplayName: "Coal-Powered Generator",
        mDescription: "Burns coal.",
        mPowerProduction: "75",
        mFuel: [
          {
            mFuelClass: "Desc_Coal_C",
            mSupplementalResourceClass: assetPath("Desc_Water"),
            mByproduct: "",
          },
        ],
      },
    ],
  },
  {
    NativeClass: "/Script/CoreUObject.Class'/Script/FactoryGame.FGRecipe'",
    Classes: [
      {
        ClassName: "Recipe_IronPlate_C",
        mDisplayName: "Iron Plate",
        mIngredients: `(${itemAmount("Desc_IronIngot", 3)})`,
        mProduct: `(${itemAmount("Desc_IronPlate", 2)})`,
        mManufactoringDuration: "6.0",
        mProducedIn: `("${assetPath("Build_ConstructorMk1")}","${assetPath("BP_WorkBenchComponent")}")`,
      },
      {
        // Building recipe: product is a descriptor with no own display name.
        ClassName: "Recipe_Constructor_C",
        mDisplayName: "Constructor",
        mIngredients: `(${itemAmount("Desc_IronPlate", 8)})`,
        mProduct: `(${itemAmount("Desc_ConstructorMk1", 1)})`,
        mManufactoringDuration: "0",
        mProducedIn: "",
      },
      {
        // Product descriptor resolvable only via this recipe's display name.
        ClassName: "Recipe_Widget_C",
        mDisplayName: "Widget",
        mIngredients: `(${itemAmount("Desc_IronIngot", 1)})`,
        mProduct: `(${itemAmount("Desc_Widget", 1)})`,
        mManufactoringDuration: "2.0",
        mProducedIn: `("${assetPath("Build_ConstructorMk1")}")`,
      },
      {
        ClassName: "Recipe_Alternate_Screw_C",
        mDisplayName: "Alternate: Cast Screw",
        mIngredients: `(${itemAmount("Desc_IronIngot", 5)})`,
        mProduct: `(${itemAmount("Desc_IronPlate", 20)})`,
        mManufactoringDuration: "24.0",
        mProducedIn: `("${assetPath("Build_ConstructorMk1")}")`,
      },
    ],
  },
  {
    NativeClass:
      "/Script/CoreUObject.Class'/Script/FactoryGame.FGCustomizationRecipe'",
    Classes: [
      {
        ClassName: "Recipe_Skin_Foo_C",
        mDisplayName: "Cosmetic Skin",
      },
    ],
  },
  {
    NativeClass: "/Script/CoreUObject.Class'/Script/FactoryGame.FGSchematic'",
    Classes: [
      {
        ClassName: "Schematic_1-1_C",
        mDisplayName: "Base Building",
        mDescription: "Your first milestone.",
        mType: "EST_Milestone",
        mTechTier: "1",
        mCost: `(${itemAmount("Desc_IronPlate", 50)})`,
        mUnlocks: [
          {
            Class: "BP_UnlockRecipe_C",
            mRecipes: `("${assetPath("Recipe_IronPlate")}")`,
          },
        ],
      },
      {
        ClassName: "Schematic_5-2_C",
        mDisplayName: "Industrial Manufacturing",
        mDescription: "Heavy machinery.",
        mType: "EST_Milestone",
        mTechTier: "6",
        mCost: "",
        mUnlocks: [
          {
            Class: "BP_UnlockRecipe_C",
            mRecipes: `("${assetPath("Recipe_Widget")}")`,
          },
        ],
        mSchematicDependencies: [
          {
            Class: "BP_SchematicPurchasedDependency_C",
            // One resolvable (hyphenated className) + one unresolvable dep.
            mSchematics: `("${assetPath("Schematic_1-1")}","${assetPath("Schematic_Unknown")}")`,
            mRequireAllSchematicsToBePurchased: "True",
          },
        ],
      },
      {
        ClassName: "Schematic_Alternate_Screw_C",
        mDisplayName: "Alternate: Cast Screw",
        mType: "EST_Alternate",
        mTechTier: "0",
        mUnlocks: [
          {
            Class: "BP_UnlockRecipe_C",
            mRecipes: `("${assetPath("Recipe_Alternate_Screw")}")`,
          },
        ],
      },
      {
        ClassName: "Schematic_Tutorial1_C",
        mDisplayName: "Hub Upgrade 1",
        mType: "EST_Tutorial",
        mTechTier: "0",
      },
      {
        ClassName: "Research_ACarapace_1_C",
        mDisplayName: "Discontinued - Structural Analysis",
        mType: "EST_MAM",
        mTechTier: "3",
      },
    ],
  },
];

// ─── Setup ──────────────────────────────────────────────────────────────────

let tmpDir: string;
let entities: GameEntity[];
let parser: DataParser;

const byName = <T extends GameEntity>(type: T["entityType"], name: string): T =>
  entities.find((e) => e.entityType === type && e.displayName === name) as T;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "parser-test-"));
  const docsPath = path.join(tmpDir, "docs.json");
  // BOM prefix mirrors the real export's encoding.
  fs.writeFileSync(docsPath, "﻿" + JSON.stringify(RAW_DOCS));
  parser = new DataParser(docsPath);
  await parser.load();
  entities = parser.parse();
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("DataParser.parse", () => {
  it("parses each pattern-matched entity type and skips the rest", () => {
    const counts = new Map<string, number>();
    for (const e of entities)
      counts.set(e.entityType, (counts.get(e.entityType) ?? 0) + 1);

    expect(counts.get("item")).toBe(3);
    expect(counts.get("manufacturer")).toBe(1);
    expect(counts.get("generator")).toBe(1);
    expect(counts.get("recipe")).toBe(4);
    // Only the two milestones: EST_Alternate and EST_Tutorial are excluded.
    expect(counts.get("schematic")).toBe(2);
    // Customization recipes and building descriptors produce no entities.
    expect(
      entities.find((e) => e.displayName === "Cosmetic Skin"),
    ).toBeUndefined();
  });

  it("normalizes CRLF line endings in descriptions", () => {
    const ingot = byName("item", "Iron Ingot");
    expect(ingot.description).toBe(
      "Used for crafting.\nSmelted from Iron Ore.",
    );
  });

  describe("recipes", () => {
    it("resolves ingredient/product names and per-minute rates", () => {
      const recipe = byName<RecipeEntity>("recipe", "Iron Plate");
      expect(recipe.metadata.ingredients).toEqual([
        {
          className: "Desc_IronIngot_C",
          displayName: "Iron Ingot",
          amount: 3,
          ratePerMin: 30,
        },
      ]);
      expect(recipe.metadata.products).toEqual([
        {
          className: "Desc_IronPlate_C",
          displayName: "Iron Plate",
          amount: 2,
          ratePerMin: 20,
        },
      ]);
      expect(recipe.embeddingText).toContain("2x Iron Plate (20/min)");
    });

    it("resolves producedIn to display names and drops workbenches", () => {
      const recipe = byName<RecipeEntity>("recipe", "Iron Plate");
      expect(recipe.metadata.producedIn).toEqual(["Constructor"]);
    });

    it("flags alternate recipes by name and className", () => {
      const alt = byName<RecipeEntity>("recipe", "Alternate: Cast Screw");
      expect(alt.metadata.isAlternate).toBe(true);
      expect(alt.embeddingText).toContain("Alternate Recipe:");
      expect(
        byName<RecipeEntity>("recipe", "Iron Plate").metadata.isAlternate,
      ).toBe(false);
    });
  });

  describe("descriptor name resolution", () => {
    it("resolves nameless building descriptors via the Build_ stem", () => {
      const recipe = byName<RecipeEntity>("recipe", "Constructor");
      expect(recipe.metadata.products[0]).toMatchObject({
        className: "Desc_ConstructorMk1_C",
        displayName: "Constructor",
      });
    });

    it("falls back to the producing recipe's display name", () => {
      const recipe = byName<RecipeEntity>("recipe", "Widget");
      expect(recipe.metadata.products[0]).toMatchObject({
        className: "Desc_Widget_C",
        displayName: "Widget",
      });
    });
  });

  describe("generators", () => {
    it("resolves fuel and supplemental resource names", () => {
      const gen = byName<GeneratorEntity>(
        "generator",
        "Coal-Powered Generator",
      );
      expect(gen.metadata.fuels).toEqual([
        {
          fuelName: "Coal",
          supplementalResource: "Desc_Water_C", // not in fixture lookup: stays raw
          byproduct: null,
        },
      ]);
      expect(gen.embeddingText).toContain("Fuel types: Coal");
    });
  });

  describe("schematics", () => {
    it("preserves raw unlockClassNames and resolves display names", () => {
      const milestone = byName<SchematicEntity>("schematic", "Base Building");
      expect(milestone.metadata.unlockClassNames).toEqual([
        "Recipe_IronPlate_C",
      ]);
      expect(milestone.metadata.unlocks).toEqual(["Iron Plate"]);
      expect(milestone.metadata.techTier).toBe(1);
      expect(milestone.embeddingText).toContain(
        "Milestone: Base Building (Tier 1)",
      );
      expect(milestone.embeddingText).toContain("Cost: 50x Iron Plate");
    });

    it("resolves hyphenated prerequisite classNames and filters unresolved ones", () => {
      const milestone = byName<SchematicEntity>(
        "schematic",
        "Industrial Manufacturing",
      );
      // Schematic_1-1_C resolves to its display name; Schematic_Unknown_C
      // stays a raw className and is filtered out.
      expect(milestone.metadata.prerequisites).toEqual(["Base Building"]);
      expect(milestone.embeddingText).toContain("Requires: Base Building");
    });

    it("excludes EST_Alternate schematics but records their recipes as hard-drive unlocks", () => {
      expect(
        entities.find(
          (e) =>
            e.displayName === "Alternate: Cast Screw" &&
            e.entityType === "schematic",
        ),
      ).toBeUndefined();
      expect([...parser.hardDriveRecipes]).toEqual([
        "Recipe_Alternate_Screw_C",
      ]);
    });

    it("skips non-indexed schematic types entirely", () => {
      expect(
        entities.find((e) => e.displayName === "Hub Upgrade 1"),
      ).toBeUndefined();
    });

    it("skips discontinued (removed-content) schematics", () => {
      expect(
        entities.find((e) => e.displayName.startsWith("Discontinued")),
      ).toBeUndefined();
    });
  });
});
