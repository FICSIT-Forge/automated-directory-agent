# Issue #5: Agentic RAG Implementation Plan

## Confirmed Architecture: Comprehensive (Approach B)

**Pattern**: Tool-based/Agentic RAG using `ai.defineTool()` with dotprompt `tools:` frontmatter.
**Key decisions**: Multi-file, 3 specialized tools, two-pass parser, typed metadata, LLM-as-judge evaluator.

## Confirmed Decisions

| Decision | Choice |
|----------|--------|
| RAG pattern | Tool-based / Agentic (`ai.defineTool()`) |
| Data enrichment | Two-pass parsing: Pass 1 builds className-to-displayName lookup, Pass 2 resolves names + computes rates |
| Parser scope | Items, recipes, manufacturers, generators, extractors, vehicles, schematics. Skip structural/cosmetic. |
| Recipe filtering | Exclude FGCustomizationRecipe (cosmetic). Include all production recipes including alternates. |
| Runtime storage | In-memory singleton on Cloud Function (load JSON at cold start) |
| Tools | 3 tools: searchGameData, searchRecipes, searchSchematics |
| Tool output | Structured JSON via zod schemas |
| Index batch size | 20 (up from 1), 200ms delay (down from 1000ms) |
| Index rebuild | From scratch |
| Frontend changes | None |
| Prompt approach | Keep dotprompt with tools listed in frontmatter |
| Evaluator | ai.defineEvaluator() with LLM-as-judge + test dataset |
| Dep upgrades | Separate commit first (Step 0) |
| Code style | Multi-file, clean separation, typed interfaces |

## Entity Types

| EntityType | NativeClass patterns | Include? |
|------------|---------------------|----------|
| item | FGItemDescriptor, FGResourceDescriptor, FGItemDescriptorBiomass, FGEquipmentDescriptor, FGConsumableDescriptor, FGItemDescriptorNuclearFuel, FGAmmoType*, FGPowerShardDescriptor, FGVehicleDescriptor | Yes |
| recipe | FGRecipe (NOT FGCustomizationRecipe) | Yes |
| manufacturer | FGBuildableManufacturer, FGBuildableManufacturerVariablePower | Yes |
| generator | FGBuildableGeneratorFuel, FGBuildableGeneratorNuclear, FGBuildableGeneratorGeoThermal | Yes |
| extractor | FGBuildableResourceExtractor, FGBuildableFrackingExtractor, FGBuildableFrackingActivator, FGBuildableWaterPump | Yes |
| schematic | FGSchematic (only EST_Milestone, EST_MAM) | Yes |
| Skip | Beams, walls, foundations, ramps, pillars, corner walls, doors, walkways, ladders, barriers, lights, signs, snow dispensers, FGCustomizationRecipe | No |

## EmbeddingText Templates

- Recipe: "Recipe: {name}\nProduced in: {building}\nIngredients: {Nx item (rate/min)}\nProducts: {Nx item (rate/min)}\nCycle time: {duration}s"
- Item: "Item: {name}\nDescription: {desc}\nForm: {solid/liquid/gas}\nStack size: {n}\nEnergy: {n} MJ"
- Manufacturer: "Building: {name} (Manufacturer)\nDescription: {desc}\nPower consumption: {n} MW\nSpeed: {n}x"
- Generator: "Building: {name} (Generator)\nDescription: {desc}\nPower production: {n} MW\nFuel types: {list}\nSupplemental: {resource or None}"
- Extractor: "Building: {name} (Resource Extractor)\nDescription: {desc}\nExtraction rate: {items/min}\nPower consumption: {n} MW"
- Schematic: "{Milestone|MAM Research}: {name} (Tier {n})\nCost: {Nx item, ...}\nUnlocks: {recipe/building list}"

## Files to Create/Modify

| # | File | Action |
|---|------|--------|
| 0 | functions/package.json | Upgrade deps (separate commit) |
| 1 | functions/src/data/types.ts | CREATE - All interfaces, EntityType, typed metadata |
| 2 | functions/src/data/rawParser.ts | CREATE - Unreal Engine string parsers |
| 3 | functions/src/data/parser.ts | REWRITE - Two-pass DataParser |
| 4 | functions/src/data/embeddings.ts | MODIFY - batch=20, delay=200ms, IndexedEntity type |
| 5 | functions/src/data/searchService.ts | CREATE - Singleton cold-start loader |
| 6 | functions/src/tools/gameDataTools.ts | CREATE - 3 Genkit tool definitions |
| 7 | functions/prompts/adagent.prompt | MODIFY - tools frontmatter + RAG instructions |
| 8 | functions/src/index.ts | MODIFY - import tools for registration |
| 9 | functions/scripts/buildIndex.ts | REWRITE - batch=20, type breakdown, validation |
| 10 | functions/src/eval/accuracy.ts | CREATE - LLM-as-judge evaluator |
| 11 | functions/eval/accuracy_dataset.json | CREATE - Test dataset |

## Implementation Order

1. Step 0: Upgrade dependencies (separate commit)
2. Step 1: types.ts + rawParser.ts (foundation)
3. Step 2: parser.ts rewrite (two-pass)
4. Step 3: embeddings.ts modifications
5. Step 4: searchService.ts (singleton loader)
6. Step 5: gameDataTools.ts (3 Genkit tools)
7. Step 6: adagent.prompt + index.ts (wire tools)
8. Step 7: buildIndex.ts rewrite + rebuild index
9. Step 8: accuracy evaluator + dataset
10. Step 9: Build, verify, test

## Raw Data Parsing Notes

- Ingredient regex: /ItemClass="[^"]*?(\w+)'",Amount=(\d+)/g
- ProducedIn regex: /(\w+_C)['"]/g
- Rate formula: (amount / durationSecs) * 60 = items/min
- Schematic mType values: EST_Milestone, EST_MAM, EST_HardDrive, EST_Custom, EST_Tutorial
- mManufactoringDuration is a float string in seconds (note the typo in raw data)
- Generator mFuel is array of objects with mFuelClass and mSupplementalResourceClass
