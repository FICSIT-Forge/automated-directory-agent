import { describe, it, expect } from "vitest";
import { enrichEntities } from "./enricher.js";
import type {
  GameEntity,
  ItemEntity,
  RecipeEntity,
  ManufacturerEntity,
  SchematicEntity,
} from "./types.js";

// ─── Test Fixtures ──────────────────────────────────────────────────────────

function makeItem(
  overrides: Partial<ItemEntity> & { className: string; displayName: string },
): ItemEntity {
  return {
    entityType: "item",
    description: "",
    nativeClass: "FGItemDescriptor",
    embeddingText: `Item: ${overrides.displayName}`,
    metadata: { stackSize: "SS_MEDIUM", energyValueMJ: 0, form: "Solid" },
    ...overrides,
  };
}

function makeRecipe(
  overrides: Partial<RecipeEntity> & {
    className: string;
    displayName: string;
  },
): RecipeEntity {
  return {
    entityType: "recipe",
    description: "",
    nativeClass: "FGRecipe",
    embeddingText: `Recipe: ${overrides.displayName}`,
    metadata: {
      ingredients: [],
      products: [],
      producedIn: [],
      durationSecs: 4,
      isAlternate: false,
      ...overrides.metadata,
    },
    ...overrides,
    // Re-apply metadata after spread to avoid it being overwritten by top-level overrides
  } as RecipeEntity;
}

function makeSchematic(
  overrides: Partial<SchematicEntity> & {
    className: string;
    displayName: string;
  },
): SchematicEntity {
  return {
    entityType: "schematic",
    description: "",
    nativeClass: "FGSchematic",
    embeddingText: `Milestone: ${overrides.displayName}`,
    metadata: {
      type: "EST_Milestone",
      techTier: 0,
      cost: [],
      unlocks: [],
      unlockClassNames: [],
      ...overrides.metadata,
    },
    ...overrides,
  } as SchematicEntity;
}

function makeManufacturer(
  overrides: Partial<ManufacturerEntity> & {
    className: string;
    displayName: string;
  },
): ManufacturerEntity {
  return {
    entityType: "manufacturer",
    description: "",
    nativeClass: "FGBuildableManufacturer",
    embeddingText: `Building: ${overrides.displayName}`,
    metadata: { powerConsumptionMW: 4, manufacturingSpeed: 1 },
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("enrichEntities", () => {
  it("returns empty array for empty input", () => {
    expect(enrichEntities([])).toEqual([]);
  });

  it("leaves entities without cross-refs unchanged", () => {
    const item = makeItem({
      className: "Desc_Lonely_C",
      displayName: "Lonely Item",
    });
    const originalText = item.embeddingText;

    enrichEntities([item]);

    expect(item.embeddingText).toBe(originalText);
    expect(item.metadata.producedByRecipes).toBeUndefined();
    expect(item.metadata.usedInRecipes).toBeUndefined();
    expect(item.metadata.earliestTechTier).toBeUndefined();
  });

  describe("item enrichment", () => {
    it("populates producedByRecipes from recipe products", () => {
      const item = makeItem({
        className: "Desc_IronPlate_C",
        displayName: "Iron Plate",
      });
      const recipe = makeRecipe({
        className: "Recipe_IronPlate_C",
        displayName: "Iron Plate",
        metadata: {
          ingredients: [
            {
              className: "Desc_IronIngot_C",
              displayName: "Iron Ingot",
              amount: 3,
              ratePerMin: 30,
            },
          ],
          products: [
            {
              className: "Desc_IronPlate_C",
              displayName: "Iron Plate",
              amount: 2,
              ratePerMin: 20,
            },
          ],
          producedIn: ["Constructor"],
          durationSecs: 6,
          isAlternate: false,
        },
      });

      enrichEntities([item, recipe]);

      expect(item.metadata.producedByRecipes).toEqual(["Iron Plate"]);
      expect(item.embeddingText).toContain("Produced by: Iron Plate");
    });

    it("populates usedInRecipes from recipe ingredients", () => {
      const item = makeItem({
        className: "Desc_IronIngot_C",
        displayName: "Iron Ingot",
      });
      const recipe = makeRecipe({
        className: "Recipe_IronPlate_C",
        displayName: "Iron Plate",
        metadata: {
          ingredients: [
            {
              className: "Desc_IronIngot_C",
              displayName: "Iron Ingot",
              amount: 3,
              ratePerMin: 30,
            },
          ],
          products: [
            {
              className: "Desc_IronPlate_C",
              displayName: "Iron Plate",
              amount: 2,
              ratePerMin: 20,
            },
          ],
          producedIn: [],
          durationSecs: 6,
          isAlternate: false,
        },
      });

      enrichEntities([item, recipe]);

      expect(item.metadata.usedInRecipes).toEqual(["Iron Plate"]);
      expect(item.embeddingText).toContain("Used in: Iron Plate");
    });

    it("computes earliestTechTier from schematic unlock chain", () => {
      const item = makeItem({
        className: "Desc_IronPlate_C",
        displayName: "Iron Plate",
      });
      const recipe = makeRecipe({
        className: "Recipe_IronPlate_C",
        displayName: "Iron Plate",
        metadata: {
          ingredients: [],
          products: [
            {
              className: "Desc_IronPlate_C",
              displayName: "Iron Plate",
              amount: 2,
              ratePerMin: 20,
            },
          ],
          producedIn: [],
          durationSecs: 4,
          isAlternate: false,
        },
      });
      const schematic = makeSchematic({
        className: "Schematic_1-1_C",
        displayName: "Base Building",
        metadata: {
          type: "EST_Milestone",
          techTier: 1,
          cost: [],
          unlocks: ["Iron Plate"],
          unlockClassNames: ["Recipe_IronPlate_C"],
        },
      });

      enrichEntities([item, recipe, schematic]);

      expect(item.metadata.earliestTechTier).toBe(1);
      expect(item.embeddingText).toContain("Available from: Tier 1");
    });

    it("picks minimum tier across multiple schematics", () => {
      const item = makeItem({
        className: "Desc_IronPlate_C",
        displayName: "Iron Plate",
      });
      const recipe1 = makeRecipe({
        className: "Recipe_IronPlate_C",
        displayName: "Iron Plate",
        metadata: {
          ingredients: [],
          products: [
            {
              className: "Desc_IronPlate_C",
              displayName: "Iron Plate",
              amount: 2,
              ratePerMin: 20,
            },
          ],
          producedIn: [],
          durationSecs: 4,
          isAlternate: false,
        },
      });
      const recipe2 = makeRecipe({
        className: "Recipe_IronPlateAlt_C",
        displayName: "Alternate: Iron Plate",
        metadata: {
          ingredients: [],
          products: [
            {
              className: "Desc_IronPlate_C",
              displayName: "Iron Plate",
              amount: 4,
              ratePerMin: 40,
            },
          ],
          producedIn: [],
          durationSecs: 4,
          isAlternate: true,
        },
      });
      const schematic1 = makeSchematic({
        className: "Schematic_3-1_C",
        displayName: "Tier 3 Milestone",
        metadata: {
          type: "EST_Milestone",
          techTier: 3,
          cost: [],
          unlocks: [],
          unlockClassNames: ["Recipe_IronPlate_C"],
        },
      });
      const schematic2 = makeSchematic({
        className: "Schematic_1-1_C",
        displayName: "Tier 1 Milestone",
        metadata: {
          type: "EST_Milestone",
          techTier: 1,
          cost: [],
          unlocks: [],
          unlockClassNames: ["Recipe_IronPlateAlt_C"],
        },
      });

      enrichEntities([item, recipe1, recipe2, schematic1, schematic2]);

      expect(item.metadata.earliestTechTier).toBe(1);
    });

    it("does not set tier for items with no schematic-linked recipes", () => {
      const item = makeItem({
        className: "Desc_IronPlate_C",
        displayName: "Iron Plate",
      });
      const recipe = makeRecipe({
        className: "Recipe_IronPlate_C",
        displayName: "Iron Plate",
        metadata: {
          ingredients: [],
          products: [
            {
              className: "Desc_IronPlate_C",
              displayName: "Iron Plate",
              amount: 2,
              ratePerMin: 20,
            },
          ],
          producedIn: [],
          durationSecs: 4,
          isAlternate: false,
        },
      });
      // No schematic unlocking Recipe_IronPlate_C

      enrichEntities([item, recipe]);

      expect(item.metadata.earliestTechTier).toBeUndefined();
      expect(item.embeddingText).not.toContain("Available from:");
    });
  });

  describe("recipe enrichment", () => {
    it("populates unlockedBy from schematics", () => {
      const recipe = makeRecipe({
        className: "Recipe_IronPlate_C",
        displayName: "Iron Plate",
      });
      const schematic = makeSchematic({
        className: "Schematic_1-1_C",
        displayName: "Base Building",
        metadata: {
          type: "EST_Milestone",
          techTier: 1,
          cost: [],
          unlocks: ["Iron Plate"],
          unlockClassNames: ["Recipe_IronPlate_C"],
        },
      });

      enrichEntities([recipe, schematic]);

      expect(recipe.metadata.unlockedBy).toEqual([
        { displayName: "Base Building", type: "EST_Milestone", techTier: 1 },
      ]);
      expect(recipe.embeddingText).toContain(
        "Unlocked by: Base Building (Tier 1, Milestone)",
      );
    });

    it("handles multiple schematics unlocking same recipe", () => {
      const recipe = makeRecipe({
        className: "Recipe_IronPlate_C",
        displayName: "Iron Plate",
      });
      const schematic1 = makeSchematic({
        className: "Schematic_1-1_C",
        displayName: "Tier 1 Milestone",
        metadata: {
          type: "EST_Milestone",
          techTier: 1,
          cost: [],
          unlocks: [],
          unlockClassNames: ["Recipe_IronPlate_C"],
        },
      });
      const schematic2 = makeSchematic({
        className: "Schematic_MAM_1_C",
        displayName: "MAM Node",
        metadata: {
          type: "EST_MAM",
          techTier: 0,
          cost: [],
          unlocks: [],
          unlockClassNames: ["Recipe_IronPlate_C"],
        },
      });

      enrichEntities([recipe, schematic1, schematic2]);

      expect(recipe.metadata.unlockedBy).toHaveLength(2);
      expect(recipe.embeddingText).toContain("Tier 1, Milestone");
      expect(recipe.embeddingText).toContain("MAM Node (MAM)");
    });

    it("does not enrich recipes with no matching schematic", () => {
      const recipe = makeRecipe({
        className: "Recipe_Starter_C",
        displayName: "Starter Recipe",
      });

      enrichEntities([recipe]);

      expect(recipe.metadata.unlockedBy).toBeUndefined();
      expect(recipe.embeddingText).not.toContain("Unlocked by:");
    });

    it("tags recipes in the hard-drive set that lack an indexed schematic", () => {
      const recipe = makeRecipe({
        className: "Recipe_Alternate_Foo_C",
        displayName: "Alternate: Foo",
        metadata: {
          ingredients: [],
          products: [],
          producedIn: [],
          durationSecs: 4,
          isAlternate: true,
        },
      });

      enrichEntities([recipe], new Set(["Recipe_Alternate_Foo_C"]));

      expect(recipe.embeddingText).toContain(
        "Unlocked by: Hard Drive scan (MAM research)",
      );
      // No schematic, so no structured unlockedBy refs.
      expect(recipe.metadata.unlockedBy).toBeUndefined();
    });

    it("tags non-alternate recipes too when they are hard-drive unlocks", () => {
      // e.g. Unpackage Turbofuel: a standard recipe unlocked by an EST_Alternate
      // (Hard Drive) schematic alongside the alternate fuel recipe.
      const recipe = makeRecipe({
        className: "Recipe_UnpackageTurboFuel_C",
        displayName: "Unpackage Turbofuel",
        metadata: {
          ingredients: [],
          products: [],
          producedIn: [],
          durationSecs: 4,
          isAlternate: false,
        },
      });

      enrichEntities([recipe], new Set(["Recipe_UnpackageTurboFuel_C"]));

      expect(recipe.embeddingText).toContain(
        "Unlocked by: Hard Drive scan (MAM research)",
      );
    });

    it("does not tag alternate recipes that are absent from the hard-drive set", () => {
      // e.g. Distilled Silica is classed "Alternate" but is an EST_Custom (not a
      // Hard Drive) unlock, so it must NOT receive the hard-drive line.
      const recipe = makeRecipe({
        className: "Recipe_Alternate_Silica_Distilled_C",
        displayName: "Alternate: Distilled Silica",
        metadata: {
          ingredients: [],
          products: [],
          producedIn: [],
          durationSecs: 4,
          isAlternate: true,
        },
      });

      enrichEntities([recipe]); // empty hard-drive set

      expect(recipe.embeddingText).not.toContain("Hard Drive scan");
      expect(recipe.embeddingText).not.toContain("Unlocked by:");
    });

    it("prefers a real schematic ref over the generic Hard Drive line", () => {
      const recipe = makeRecipe({
        className: "Recipe_Alternate_Turbofuel_C",
        displayName: "Alternate: Turbofuel",
        metadata: {
          ingredients: [],
          products: [],
          producedIn: [],
          durationSecs: 4,
          isAlternate: true,
        },
      });
      const schematic = makeSchematic({
        className: "Schematic_MAM_Turbofuel_C",
        displayName: "Turbofuel Research",
        metadata: {
          type: "EST_MAM",
          techTier: 0,
          cost: [],
          unlocks: [],
          unlockClassNames: ["Recipe_Alternate_Turbofuel_C"],
        },
      });

      // Even if it is also in the hard-drive set, the indexed schematic wins.
      enrichEntities(
        [recipe, schematic],
        new Set(["Recipe_Alternate_Turbofuel_C"]),
      );

      expect(recipe.embeddingText).toContain(
        "Unlocked by: Turbofuel Research (MAM)",
      );
      expect(recipe.embeddingText).not.toContain("Hard Drive scan");
      expect(recipe.metadata.unlockedBy).toHaveLength(1);
    });
  });

  describe("manufacturer enrichment", () => {
    it("appends recipe list to embeddingText", () => {
      const manufacturer = makeManufacturer({
        className: "Build_ConstructorMk1_C",
        displayName: "Constructor",
      });
      const recipe = makeRecipe({
        className: "Recipe_IronPlate_C",
        displayName: "Iron Plate",
        metadata: {
          ingredients: [],
          products: [],
          producedIn: ["Constructor"],
          durationSecs: 4,
          isAlternate: false,
        },
      });

      enrichEntities([manufacturer, recipe]);

      expect(manufacturer.embeddingText).toContain(
        "Recipes produced here: Iron Plate",
      );
    });

    it("does not enrich manufacturer with no recipes", () => {
      const manufacturer = makeManufacturer({
        className: "Build_Empty_C",
        displayName: "Empty Building",
      });
      const originalText = manufacturer.embeddingText;

      enrichEntities([manufacturer]);

      expect(manufacturer.embeddingText).toBe(originalText);
    });
  });

  describe("schematic enrichment", () => {
    it("appends progression context for milestones", () => {
      const schematic = makeSchematic({
        className: "Schematic_3-1_C",
        displayName: "Basic Steel Production",
        metadata: {
          type: "EST_Milestone",
          techTier: 3,
          cost: [],
          unlocks: [],
          unlockClassNames: [],
        },
      });

      enrichEntities([schematic]);

      expect(schematic.embeddingText).toContain(
        "Progression: Tier 3 Milestone",
      );
    });

    it("appends progression context for MAM research", () => {
      const schematic = makeSchematic({
        className: "Schematic_MAM_C",
        displayName: "Caterium Research",
        metadata: {
          type: "EST_MAM",
          techTier: 0,
          cost: [],
          unlocks: [],
          unlockClassNames: [],
        },
      });

      enrichEntities([schematic]);

      expect(schematic.embeddingText).toContain("Progression: MAM Research");
    });

    it("appends progression context for alternate unlocks", () => {
      const schematic = makeSchematic({
        className: "Schematic_Alt_C",
        displayName: "Alternate: Steel Screw",
        metadata: {
          type: "EST_Alternate",
          techTier: 0,
          cost: [],
          unlocks: [],
          unlockClassNames: [],
        },
      });

      enrichEntities([schematic]);

      expect(schematic.embeddingText).toContain(
        "Progression: Alternate Recipe Unlock",
      );
    });
  });

  describe("full cross-entity scenario", () => {
    it("enriches a complete item-recipe-schematic chain", () => {
      const entities: GameEntity[] = [
        makeItem({
          className: "Desc_IronIngot_C",
          displayName: "Iron Ingot",
        }),
        makeItem({
          className: "Desc_IronPlate_C",
          displayName: "Iron Plate",
        }),
        makeRecipe({
          className: "Recipe_IronPlate_C",
          displayName: "Iron Plate",
          metadata: {
            ingredients: [
              {
                className: "Desc_IronIngot_C",
                displayName: "Iron Ingot",
                amount: 3,
                ratePerMin: 30,
              },
            ],
            products: [
              {
                className: "Desc_IronPlate_C",
                displayName: "Iron Plate",
                amount: 2,
                ratePerMin: 20,
              },
            ],
            producedIn: ["Constructor"],
            durationSecs: 6,
            isAlternate: false,
          },
        }),
        makeManufacturer({
          className: "Build_ConstructorMk1_C",
          displayName: "Constructor",
        }),
        makeSchematic({
          className: "Schematic_1-1_C",
          displayName: "Base Building",
          metadata: {
            type: "EST_Milestone",
            techTier: 1,
            cost: [],
            unlocks: ["Iron Plate"],
            unlockClassNames: ["Recipe_IronPlate_C"],
          },
        }),
      ];

      enrichEntities(entities);

      const ironIngot = entities[0] as ItemEntity;
      const ironPlate = entities[1] as ItemEntity;
      const recipe = entities[2] as RecipeEntity;
      const constructor = entities[3] as ManufacturerEntity;
      const schematic = entities[4] as SchematicEntity;

      // Iron Ingot is used as ingredient
      expect(ironIngot.metadata.usedInRecipes).toEqual(["Iron Plate"]);
      expect(ironIngot.embeddingText).toContain("Used in: Iron Plate");

      // Iron Plate is produced
      expect(ironPlate.metadata.producedByRecipes).toEqual(["Iron Plate"]);
      expect(ironPlate.metadata.earliestTechTier).toBe(1);
      expect(ironPlate.embeddingText).toContain("Available from: Tier 1");

      // Recipe is unlocked by schematic
      expect(recipe.metadata.unlockedBy).toHaveLength(1);
      expect(recipe.embeddingText).toContain("Unlocked by: Base Building");

      // Constructor has recipe list
      expect(constructor.embeddingText).toContain(
        "Recipes produced here: Iron Plate",
      );

      // Schematic has progression context
      expect(schematic.embeddingText).toContain(
        "Progression: Tier 1 Milestone",
      );
    });
  });
});
