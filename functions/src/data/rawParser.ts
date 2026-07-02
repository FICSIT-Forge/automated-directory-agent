/**
 * Pure utility functions for parsing Unreal Engine serialized strings
 * found in the Satisfactory game data JSON.
 *
 * These handle the proprietary string formats for item amounts,
 * class references, and building lists.
 */

/**
 * Extracts the terminal ClassName from an Unreal Engine asset path.
 *
 * Input:  "/Script/Engine.BlueprintGeneratedClass'/Game/.../Desc_IronIngot.Desc_IronIngot_C'"
 * Output: "Desc_IronIngot_C"
 *
 * Also handles short forms like "Desc_IronIngot_C" directly.
 */
export function extractClassName(path: string): string {
  // Match the last segment ending in _C before a quote or end of string
  const match = /(\w+_C)['"]?/.exec(path);
  return match ? match[1] : path;
}

/**
 * Parses an Unreal Engine item amount list string into structured data.
 *
 * Input:  ((ItemClass="...'/Game/.../Desc_IronIngot.Desc_IronIngot_C'",Amount=3))
 * Output: [{ className: "Desc_IronIngot_C", amount: 3 }]
 *
 * Handles multiple items separated by ),(
 */
export function parseItemAmountList(
  raw: string,
): Array<{ className: string; amount: number }> {
  if (!raw || raw === "" || raw === "()" || raw === "None") return [];

  const results: Array<{ className: string; amount: number }> = [];
  const regex = /ItemClass="[^"]*?(\w+_C)'?"?\s*,\s*Amount=(\d+)/g;
  let match;

  while ((match = regex.exec(raw)) !== null) {
    results.push({
      className: match[1],
      amount: parseInt(match[2], 10),
    });
  }

  return results;
}

/**
 * Parses an Unreal Engine class list string (e.g., mProducedIn, mDefaultFuelClasses).
 *
 * Input:  ("/Game/.../Build_ConstructorMk1.Build_ConstructorMk1_C","/Game/.../BP_WorkBenchComponent.BP_WorkBenchComponent_C")
 * Output: ["Build_ConstructorMk1_C", "BP_WorkBenchComponent_C"]
 */
export function parseClassList(raw: string): string[] {
  if (!raw || raw === "" || raw === "()" || raw === "None") return [];

  const results: string[] = [];
  const regex = /(\w+_C)['"\s]*[,)]/g;
  let match;

  while ((match = regex.exec(raw)) !== null) {
    results.push(match[1]);
  }

  return results;
}

/**
 * Parses a schematic unlock array to extract recipe display names.
 *
 * Schematics have an mUnlocks field that is a complex nested structure.
 * We extract recipe class names from it.
 *
 * Input (array of objects): [{ Class: "...", mRecipes: "(...Recipe_IronPlate_C...,...)" }]
 * Output: ["Recipe_IronPlate_C", ...]
 */
export function parseSchematicUnlocks(unlocks: unknown[]): string[] {
  return unlocks.flatMap((unlock) => {
    const u = unlock as Record<string, unknown>;
    const recipesStr = u.mRecipes as string | undefined;
    return recipesStr ? parseClassList(recipesStr) : [];
  });
}
