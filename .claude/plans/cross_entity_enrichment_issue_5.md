# Cross-Entity Relationship Enrichment — Implementation Plan

**Issue:** #5 (Reduce AI agent hallucinations with game data)
**Branch:** `5-reduce-ai-agent-hallucinations-with-game-data`
**Status:** In progress — agentic RAG infrastructure is built and deployed. This plan covers the remaining work: enriching embedding text with cross-entity relationships for better contextual reasoning.

## Architecture: Clean Architecture with Separate Enricher

### Approach
- **New file** `functions/src/data/enricher.ts` — `EntityEnricher` class with static `enrich(entities)` method
- Enricher builds reverse-index maps from parsed entities, then mutates `embeddingText` and metadata
- Runs between `DataParser.parse()` and `EmbeddingEngine.build()` in the build pipeline
- `DataParser` stays focused on raw UE data parsing; enricher handles cross-entity reasoning

### Why this approach
- Separation of concerns: parsing UE formats vs. computing entity relationships
- Positions well for Issue #6 (wiki RAG) — a parallel wiki enrichment module can be added later
- className-based joins (via `unlockClassNames`) are more robust than display name matching
- The enricher is a pure batch transform — no runtime impact

## Confirmed Decisions

| Decision | Choice |
|----------|--------|
| Enrichment scope | All entity types — items, recipes, buildings, schematics |
| Cross-ref capping | No cap — list all references |
| Metadata additions | Yes — `earliestTechTier`, `producedByRecipes`, `usedInRecipes` on items; `unlockedBy` on recipes |
| EST_Alternate schematics | Parse them (currently filtered out) |
| Schematic dependencies | Parse `mSchematicDependencies` for progression chain |
| className preservation | Add `unlockClassNames: string[]` to `SchematicMetadata` for robust joins |
| Power consumption on recipes | Skip for now — model can get it via `searchGameData` tool |
| Build script checks | Add enrichment-specific sanity checks |

## Type Changes (`functions/src/data/types.ts`)

### New interface
```ts
export interface SchematicRef {
  displayName: string;
  type: string;       // "EST_Milestone" | "EST_MAM" | "EST_Alternate"
  techTier: number;
}
```

### Modified interfaces (additive only)

**`ItemMetadata`** — add:
```ts
earliestTechTier?: number;      // lowest tier where any recipe producing this item unlocks
producedByRecipes?: string[];   // display names of recipes that output this item
usedInRecipes?: string[];       // display names of recipes that consume this item
```

**`RecipeMetadata`** — add:
```ts
unlockedBy?: SchematicRef[];    // schematics that unlock this recipe
```

**`SchematicMetadata`** — add:
```ts
unlockClassNames: string[];     // recipe classNames (for enricher joins)
prerequisites?: string[];       // display names of prerequisite schematics
```

## Parser Changes (`functions/src/data/parser.ts`)

1. **Add `EST_Alternate` to schematic filter** (line ~154): Change 2-way OR to 3-way OR
2. **Add `typeLabel` branch**: `"Alternate Recipe Unlock"` for `EST_Alternate`
3. **Preserve `unlockClassNames`**: In `parseSchematic`, capture raw classNames before resolving to display names
4. **Parse `mSchematicDependencies`**: Extract prerequisite schematic references, resolve to display names, store in `metadata.prerequisites`
5. **Add prerequisite info to embeddingText**: Append "Requires: [prerequisite names]"

## Parser Helper Changes (`functions/src/data/rawParser.ts`)

1. **Add `parseSchematicDependencies` function**: Extract schematic classNames from `mSchematicDependencies` field (array of objects with `mSchematics` class list strings)

## Enricher Design (`functions/src/data/enricher.ts`)

### Phase A — Build reverse indexes (single pass over all entities)

```
recipesByProduct: Map<itemClassName, RecipeEntity[]>       — from recipe.metadata.products[].className
recipesByIngredient: Map<itemClassName, RecipeEntity[]>     — from recipe.metadata.ingredients[].className
recipesByBuilding: Map<buildingDisplayName, RecipeEntity[]> — from recipe.metadata.producedIn[]
schematicByRecipeClass: Map<recipeClassName, SchematicEntity[]> — from schematic.metadata.unlockClassNames[]
tierByItemClass: Map<itemClassName, number>                 — computed: min tier across producing recipes
```

### Phase B — Enrich each entity type

**Items** (`entityType === "item"`):
- Append: `Produced by: [recipe names]`
- Append: `Used in: [recipe names]`
- Append: `Available from: Tier N` (if tier > 0)
- Set: `metadata.earliestTechTier`, `metadata.producedByRecipes`, `metadata.usedInRecipes`

**Recipes** (`entityType === "recipe"`):
- Append: `Unlocked by: [schematic name] (Tier N, Milestone/MAM/Alternate)`
- Set: `metadata.unlockedBy`

**Manufacturers** (`entityType === "manufacturer"`):
- Append: `Recipes produced here: [recipe names]`

**Generators** (`entityType === "generator"`):
- No recipe cross-refs (generators don't run recipes in the FGRecipe sense)

**Extractors** (`entityType === "extractor"`):
- No recipe cross-refs

**Schematics** (`entityType === "schematic"`):
- Append: `Progression: Tier N Milestone/MAM Research` (reinforces tier in embedding)
- Prerequisites already added in parser via `mSchematicDependencies`

**Vehicles** (`entityType === "vehicle"`):
- No cross-references needed

## Build Script Changes (`functions/scripts/buildIndex.ts`)

1. Import `EntityEnricher`
2. Insert `EntityEnricher.enrich(entities)` between parse and embed
3. Add sanity checks:
   - Iron Plate item embeddingText contains "Produced by:"
   - At least one recipe has "Unlocked by:" in embeddingText
   - Alternate schematics count > 0
   - No embeddingText contains unresolved `Desc_*_C` classNames

## Implementation Tasks (in order)

### Task 1: Update types.ts
- Add `SchematicRef` interface
- Add optional fields to `ItemMetadata`, `RecipeMetadata`, `SchematicMetadata`
- Run `pnpm build` to confirm no breakage

### Task 2: Update rawParser.ts
- Add `parseSchematicDependencies()` function
- Run `pnpm build`

### Task 3: Update parser.ts
- Add `EST_Alternate` to schematic filter
- Add `typeLabel` branch for alternates
- Preserve `unlockClassNames` in `parseSchematic`
- Parse `mSchematicDependencies` and store as `prerequisites`
- Run `pnpm build`

### Task 4: Create enricher.ts
- Implement `EntityEnricher` class with Phase A (index building) and Phase B (enrichment)
- Run `pnpm build`

### Task 5: Add unit tests with coverage
- Add `vitest@^4.1.5` and `@vitest/coverage-v8@^4.1.5` as dev dependencies
- Add scripts to `package.json`:
  - `"test": "vitest run"`
  - `"test:watch": "vitest"`
  - `"test:coverage": "vitest run --coverage"`
- Create `functions/vitest.config.ts` with coverage thresholds (80% lines/branches/functions/statements)
- Create `functions/src/data/enricher.test.ts` with tests:
  - Items get `producedByRecipes` and `usedInRecipes` populated from recipe cross-refs
  - Items get `earliestTechTier` computed from schematic unlock tiers
  - Item embeddingText contains "Produced by:", "Used in:", "Available from: Tier N"
  - Recipes get `unlockedBy` populated from schematic cross-refs
  - Recipe embeddingText contains "Unlocked by:"
  - Manufacturers get recipe list appended to embeddingText
  - Entities without cross-refs are unchanged (embeddingText not modified)
  - Multiple schematics unlocking same recipe produces array in `unlockedBy`
  - Empty entity array returns empty array
  - Items produced by recipes with no schematic get no tier
  - Schematics get progression context appended
- Create `functions/src/data/rawParser.test.ts` with tests for new function:
  - `parseSchematicDependencies()` extracts prerequisite schematic classNames
  - Edge cases: empty array, missing `mSchematics` field, malformed strings
- Create `functions/src/data/parser.test.ts` (replace existing debug script) with tests:
  - `EST_Alternate` schematics are parsed
  - Schematics have `unlockClassNames` populated
  - Schematics have `prerequisites` populated from `mSchematicDependencies`
  - Alternate schematic `typeLabel` renders as "Alternate Recipe Unlock"
- Run `pnpm test` and `pnpm test:coverage` — coverage must meet thresholds for new files

### Task 6: Update buildIndex.ts
- Wire enricher between parse and embed
- Add enrichment-specific sanity checks:
  - Iron Plate item embeddingText contains "Produced by:"
  - At least one recipe has "Unlocked by:" in embeddingText
  - Alternate schematics count > 0
  - No embeddingText contains unresolved `Desc_*_C` classNames
- Run `pnpm build`

### Task 7: Update verifyIndex.ts
- Add enrichment-specific search queries to validate cross-entity retrieval:
  - `"how to make iron plates"` → expect Iron Plate item result contains recipe refs
  - `"tier 3 progression what to build next"` → expect schematic results with tier/prereq context
  - `"constructor recipes"` → expect Constructor manufacturer with recipe list
  - `"unlock heavy modular frame"` → expect schematic result with unlock info
  - `"alternate recipe screws"` → expect alternate schematic result
- For each result, print embeddingText snippet (first 300 chars) to verify enrichment
- Add a check that prints entity type breakdown including alternate schematic count
- Run `pnpm build`

### Task 8: Rebuild index and verify
- Run `pnpm build:index` (requires GEMINI_API_KEY — will need to confirm with user)
- Run `pnpm verify:index`
- Manually inspect sample embeddingTexts

### Task 9: Full build and quality review
- Run `pnpm build` from functions/
- Review code for correctness, conventions, edge cases

## Data Flow

```
Docs-en-US-UTF-8.json
       │
  DataParser.load() + parse()
       │  Pass 1: buildNameLookup()
       │  Pass 2: parse entities (now includes EST_Alternate, mSchematicDependencies)
       │
  GameEntity[]  (base embeddingText, no cross-refs)
       │
  EntityEnricher.enrich()
       │  Phase A: build reverse indexes
       │  Phase B: enrich embeddingText + metadata per entity type
       │
  GameEntity[]  (enriched embeddingText with cross-refs + progression)
       │
  EmbeddingEngine.build() → game_data_index.json
       │
  SearchService (runtime, unchanged)
       │
  gameDataTools (unchanged)
```

## Files to Create/Modify

| File | Action |
|------|--------|
| `functions/package.json` | Modify — add vitest, @vitest/coverage-v8, test scripts |
| `functions/vitest.config.ts` | **Create** — vitest config with coverage thresholds |
| `functions/src/data/types.ts` | Modify — add `SchematicRef`, extend 3 metadata interfaces |
| `functions/src/data/rawParser.ts` | Modify — add `parseSchematicDependencies()` |
| `functions/src/data/rawParser.test.ts` | **Create** — unit tests for `parseSchematicDependencies()` |
| `functions/src/data/parser.ts` | Modify — EST_Alternate, unlockClassNames, prerequisites |
| `functions/src/data/parser.test.ts` | **Create** (replace debug script) — parser unit tests |
| `functions/src/data/enricher.ts` | **Create** — `EntityEnricher` class |
| `functions/src/data/enricher.test.ts` | **Create** — enricher unit tests |
| `functions/scripts/buildIndex.ts` | Modify — wire enricher, add sanity checks |
| `functions/scripts/verifyIndex.ts` | Modify — add enrichment-specific search queries |

## Important Context

- `producedIn` on RecipeMetadata stores display names (className lost at parse time) — enricher must key building→recipe maps on display name
- `parseSchematicUnlocks` in rawParser.ts returns classNames, which are then resolved to display names — we add `unlockClassNames` to preserve the raw classNames for the enricher
- Recipes not unlocked by any parsed schematic (starter recipes, etc.) get no `unlockedBy` — this is expected
- `mSchematicDependencies` is an array of objects with `mSchematics` class list strings — similar structure to `mUnlocks`
- Items with `earliestTechTier = 0` or undefined mean "available from start" — don't append tier line
- The index file is ~73MB and requires GEMINI_API_KEY to regenerate
- Cloud Function requires 1GiB memory for the index
