/**
 * Cross-entity relationship enricher for game data.
 *
 * Runs as a batch transform between DataParser.parse() and EmbeddingEngine.build().
 * Builds reverse indexes from parsed entities, then enriches embeddingText and
 * metadata with cross-entity relationships (items ↔ recipes ↔ schematics ↔ buildings).
 */

import {
  schematicTypeLabel,
  schematicTypeLabelShort,
  type GameEntity,
  type ItemEntity,
  type ManufacturerEntity,
  type RecipeEntity,
  type SchematicEntity,
  type SchematicRef,
} from "./types.js";

// ─── Reverse Index Types ────────────────────────────────────────────────────

interface ReverseIndexes {
  readonly recipesByProduct: ReadonlyMap<string, readonly RecipeEntity[]>;
  readonly recipesByIngredient: ReadonlyMap<string, readonly RecipeEntity[]>;
  readonly recipesByBuilding: ReadonlyMap<string, readonly RecipeEntity[]>;
  readonly schematicByRecipeClass: ReadonlyMap<
    string,
    readonly SchematicEntity[]
  >;
  readonly tierByItemClass: ReadonlyMap<string, number>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function appendToMap<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) {
    list.push(value);
  } else {
    map.set(key, [value]);
  }
}

function computeMinTier(
  recipes: readonly RecipeEntity[],
  schematicByRecipeClass: ReadonlyMap<string, readonly SchematicEntity[]>,
): number | undefined {
  let minTier = Infinity;
  for (const recipe of recipes) {
    const schematics = schematicByRecipeClass.get(recipe.className);
    if (!schematics) continue;
    for (const schematic of schematics) {
      if (schematic.metadata.techTier > 0) {
        minTier = Math.min(minTier, schematic.metadata.techTier);
      }
    }
  }
  return minTier === Infinity ? undefined : minTier;
}

// ─── Index Builder ──────────────────────────────────────────────────────────

function buildReverseIndexes(entities: readonly GameEntity[]): ReverseIndexes {
  const recipesByProduct = new Map<string, RecipeEntity[]>();
  const recipesByIngredient = new Map<string, RecipeEntity[]>();
  const recipesByBuilding = new Map<string, RecipeEntity[]>();
  const schematicByRecipeClass = new Map<string, SchematicEntity[]>();

  for (const entity of entities) {
    if (entity.entityType === "recipe") {
      for (const p of entity.metadata.products) {
        appendToMap(recipesByProduct, p.className, entity);
      }
      for (const i of entity.metadata.ingredients) {
        appendToMap(recipesByIngredient, i.className, entity);
      }
      for (const building of entity.metadata.producedIn) {
        appendToMap(recipesByBuilding, building, entity);
      }
    } else if (entity.entityType === "schematic") {
      for (const recipeClass of entity.metadata.unlockClassNames) {
        appendToMap(schematicByRecipeClass, recipeClass, entity);
      }
    }
  }

  // Compute earliest tech tier per item className
  const tierByItemClass = new Map<string, number>();
  for (const [itemClass, recipes] of recipesByProduct) {
    const tier = computeMinTier(recipes, schematicByRecipeClass);
    if (tier !== undefined) {
      tierByItemClass.set(itemClass, tier);
    }
  }

  return {
    recipesByProduct,
    recipesByIngredient,
    recipesByBuilding,
    schematicByRecipeClass,
    tierByItemClass,
  };
}

// ─── Per-Entity Enrichers ───────────────────────────────────────────────────

function enrichItem(entity: ItemEntity, indexes: ReverseIndexes): void {
  const producedBy = indexes.recipesByProduct.get(entity.className);
  const usedIn = indexes.recipesByIngredient.get(entity.className);
  const tier = indexes.tierByItemClass.get(entity.className);

  const lines: string[] = [];

  if (producedBy?.length) {
    const names = producedBy.map((r) => r.displayName);
    entity.metadata.producedByRecipes = names;
    lines.push(`Produced by: ${names.join(", ")}`);
  }

  if (usedIn?.length) {
    const names = usedIn.map((r) => r.displayName);
    entity.metadata.usedInRecipes = names;
    lines.push(`Used in: ${names.join(", ")}`);
  }

  if (tier !== undefined) {
    entity.metadata.earliestTechTier = tier;
    lines.push(`Available from: Tier ${tier}`);
  }

  if (lines.length > 0) {
    entity.embeddingText += "\n" + lines.join("\n");
  }
}

/** Generic unlock provenance for recipes obtained via Hard Drive (MAM) scans. */
const HARD_DRIVE_UNLOCK = "Unlocked by: Hard Drive scan (MAM research)";

function enrichRecipe(
  entity: RecipeEntity,
  indexes: ReverseIndexes,
  hardDriveRecipes: ReadonlySet<string>,
): void {
  const schematics = indexes.schematicByRecipeClass.get(entity.className);

  // EST_Alternate schematics are not indexed, so recipes unlocked only by a
  // Hard Drive scan have no schematic cross-ref here. Tag exactly those (the
  // set is derived from the real EST_Alternate unlock lists during parsing)
  // with their generic hard-drive provenance.
  if (!schematics?.length) {
    if (hardDriveRecipes.has(entity.className)) {
      entity.embeddingText += `\n${HARD_DRIVE_UNLOCK}`;
    }
    return;
  }

  const refs: SchematicRef[] = schematics.map((s) => ({
    displayName: s.displayName,
    type: s.metadata.type,
    techTier: s.metadata.techTier,
  }));
  entity.metadata.unlockedBy = refs;

  const labels = refs.map((r) => {
    const tierStr = r.techTier > 0 ? `Tier ${r.techTier}, ` : "";
    return `${r.displayName} (${tierStr}${schematicTypeLabelShort(r.type)})`;
  });
  entity.embeddingText += `\nUnlocked by: ${labels.join(", ")}`;
}

function enrichManufacturer(
  entity: ManufacturerEntity,
  indexes: ReverseIndexes,
): void {
  const recipes = indexes.recipesByBuilding.get(entity.displayName);
  if (!recipes?.length) return;

  const names = recipes.map((r) => r.displayName);
  entity.embeddingText += `\nRecipes produced here: ${names.join(", ")}`;
}

function enrichSchematic(entity: SchematicEntity): void {
  const { type, techTier } = entity.metadata;
  const tierStr = techTier > 0 ? `Tier ${techTier} ` : "";
  entity.embeddingText += `\nProgression: ${tierStr}${schematicTypeLabel(type)}`;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Enriches entities in-place with cross-entity relationships.
 * Returns the same array for chaining convenience.
 *
 * @param hardDriveRecipes Recipe classNames unlocked by EST_Alternate schematics
 *   (Hard Drive scans). Recipes in this set with no indexed Milestone/MAM
 *   unlock are tagged with their hard-drive provenance. See DataParser.hardDriveRecipes.
 */
export function enrichEntities(
  entities: GameEntity[],
  hardDriveRecipes: ReadonlySet<string> = new Set(),
): GameEntity[] {
  const indexes = buildReverseIndexes(entities);

  for (const entity of entities) {
    switch (entity.entityType) {
      case "item":
        enrichItem(entity, indexes);
        break;
      case "recipe":
        enrichRecipe(entity, indexes, hardDriveRecipes);
        break;
      case "manufacturer":
        enrichManufacturer(entity, indexes);
        break;
      case "schematic":
        enrichSchematic(entity);
        break;
    }
  }

  return entities;
}
