/**
 * Genkit tool definitions for searching Satisfactory game data.
 *
 * Three specialized tools give the model precise control over what to search:
 * - searchGameData: Items, buildings, generators, extractors, vehicles
 * - searchRecipes: Crafting recipes with ingredients, rates, and buildings
 * - searchSchematics: Milestones and MAM research nodes
 */

import { z } from "genkit";
import { ai } from "../genkit.js";
import { SearchService } from "../data/searchService.js";
import type { ResolvedAmount } from "../data/types.js";

// ─── Shared helpers ───────────────────────────────────────────────────────────

const GAME_DATA_TYPES = [
  "item",
  "manufacturer",
  "generator",
  "extractor",
  "vehicle",
] as const;

type GameDataType = (typeof GAME_DATA_TYPES)[number];

function topKSchema(max: number, defaultValue = 5) {
  return z
    .number()
    .int()
    .min(1)
    .max(max)
    .default(defaultValue)
    .describe("Number of results to return");
}

const resolvedAmountSchema = z.object({
  displayName: z.string(),
  amount: z.number(),
  ratePerMin: z.number(),
});

function toAmountOutput(a: ResolvedAmount) {
  return {
    displayName: a.displayName,
    amount: a.amount,
    ratePerMin: a.ratePerMin,
  };
}

// ─── Tool 1: General game data search ────────────────────────────────────────

export const searchGameData = ai.defineTool(
  {
    name: "searchGameData",
    description: `Search Satisfactory game data for items, buildings, generators, resource extractors, and vehicles.
Use this for questions about what something is, its stats, power consumption/production, fuel types, or extraction rates.
Examples: "what is copper wire", "how much power does a constructor use", "coal generator fuel", "what vehicles are available".`,
    inputSchema: z.object({
      query: z
        .string()
        .describe("Natural language search query about a game entity"),
      entityTypes: z
        .array(z.enum(GAME_DATA_TYPES))
        .optional()
        .describe(
          "Filter to specific entity types. Omit to search all non-recipe, non-schematic types.",
        ),
      topK: topKSchema(10),
    }),
    outputSchema: z.array(
      z.object({
        displayName: z.string(),
        entityType: z.string(),
        description: z.string(),
        details: z.string().describe("Full game data details for this entity"),
        score: z.number(),
      }),
    ),
  },
  async ({ query, entityTypes, topK }) => {
    try {
      const service = SearchService.getInstance();
      const types: GameDataType[] = entityTypes ?? [...GAME_DATA_TYPES];
      const results = await service.search(query, topK ?? 5, types);
      return results.map((r) => ({
        displayName: r.displayName,
        entityType: r.entityType,
        description: r.description,
        details: r.embeddingText,
        score: r.score,
      }));
    } catch (e) {
      console.error(
        "searchGameData tool error:",
        e instanceof Error ? e.message : String(e),
      );
      return [];
    }
  },
);

// ─── Tool 2: Recipe search ───────────────────────────────────────────────────

export const searchRecipes = ai.defineTool(
  {
    name: "searchRecipes",
    description: `Search for crafting and production recipes in Satisfactory.
Use this for questions about how to make something, production rates, ingredients, which building produces it, and alternate recipes.
Examples: "how do I make reinforced iron plates", "recipe for plastic", "alternate recipes for screws", "60 iron plates per minute".`,
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          "Item name or description of what you want to produce or craft",
        ),
      includeAlternates: z
        .boolean()
        .default(true)
        .describe("Whether to include alternate recipes in results"),
      topK: topKSchema(10),
    }),
    outputSchema: z.array(
      z.object({
        recipeName: z.string(),
        isAlternate: z.boolean(),
        producedIn: z.array(z.string()),
        durationSecs: z.number(),
        ingredients: z.array(resolvedAmountSchema),
        products: z.array(resolvedAmountSchema),
        score: z.number(),
      }),
    ),
  },
  async ({ query, includeAlternates, topK }) => {
    try {
      const service = SearchService.getInstance();
      const resolvedTopK = topK ?? 5;
      // Fetch extra results to allow filtering alternates
      let results = await service.search(query, resolvedTopK * 2, ["recipe"]);

      if (!includeAlternates) {
        results = results.filter((r) => !r.metadata.isAlternate);
      }

      return results.slice(0, resolvedTopK).map((r) => ({
        recipeName: r.displayName,
        isAlternate: r.metadata.isAlternate,
        producedIn: r.metadata.producedIn,
        durationSecs: r.metadata.durationSecs,
        ingredients: r.metadata.ingredients.map(toAmountOutput),
        products: r.metadata.products.map(toAmountOutput),
        score: r.score,
      }));
    } catch (e) {
      console.error(
        "searchRecipes tool error:",
        e instanceof Error ? e.message : String(e),
      );
      return [];
    }
  },
);

// ─── Tool 3: Schematic search ────────────────────────────────────────────────

export const searchSchematics = ai.defineTool(
  {
    name: "searchSchematics",
    description: `Search for milestones and MAM research nodes in Satisfactory.
Use this for questions about what tier something unlocks at, what a milestone costs, or what gets unlocked.
Examples: "when do I unlock coal power", "what does tier 4 unlock", "how do I unlock the assembler", "MAM research for alien carapace".`,
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          "Milestone name, recipe name, or description of what to unlock",
        ),
      topK: topKSchema(8, 4),
    }),
    outputSchema: z.array(
      z.object({
        name: z.string(),
        type: z.string().describe("EST_Milestone or EST_MAM"),
        techTier: z.number(),
        cost: z.array(z.object({ item: z.string(), amount: z.number() })),
        unlocks: z.array(z.string()),
        score: z.number(),
      }),
    ),
  },
  async ({ query, topK }) => {
    try {
      const service = SearchService.getInstance();
      const results = await service.search(query, topK ?? 4, ["schematic"]);
      return results.map((r) => ({
        name: r.displayName,
        type: r.metadata.type,
        techTier: r.metadata.techTier,
        cost: r.metadata.cost.map((c) => ({
          item: c.displayName,
          amount: c.amount,
        })),
        unlocks: r.metadata.unlocks,
        score: r.score,
      }));
    } catch (e) {
      console.error(
        "searchSchematics tool error:",
        e instanceof Error ? e.message : String(e),
      );
      return [];
    }
  },
);
