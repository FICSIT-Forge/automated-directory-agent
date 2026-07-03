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
  // Match a segment ending in _C only at a quote or end of string, so stems
  // that merely contain "_C" (e.g. "Desc_CompactedCoal" inside a full asset
  // path) can't match prematurely. Hyphens are legal in classNames
  // (e.g. milestone "Schematic_5-2_C").
  const match = /([\w-]+_C)(?=['"]|$)/.exec(path);
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
  const regex = /ItemClass="[^"]*?([\w-]+_C)'?"?\s*,\s*Amount=(\d+)/g;
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
  const regex = /([\w-]+_C)['"\s]*[,)]/g;
  let match;

  while ((match = regex.exec(raw)) !== null) {
    results.push(match[1]);
  }

  return results;
}

/**
 * Extracts classNames from an array of Unreal Engine objects by reading
 * a named class-list field from each object.
 *
 * Common structure: [{ Class: "...", mFieldName: "(ClassName_C,...)" }]
 */
function extractClassNamesFromField(
  objects: readonly unknown[],
  fieldName: string,
): string[] {
  if (!objects?.length) return [];
  return objects.flatMap((obj) => {
    const raw = (obj as Record<string, unknown>)[fieldName] as
      | string
      | undefined;
    return raw ? parseClassList(raw) : [];
  });
}

/**
 * Parses a schematic unlock array to extract recipe classNames.
 *
 * Input:  [{ Class: "...", mRecipes: "(...Recipe_IronPlate_C...)" }]
 * Output: ["Recipe_IronPlate_C", ...]
 */
export function parseSchematicUnlocks(unlocks: readonly unknown[]): string[] {
  return extractClassNamesFromField(unlocks, "mRecipes");
}

/**
 * Parses mSchematicDependencies to extract prerequisite schematic classNames.
 *
 * Input:  [{ Class: "...", mSchematics: "(...Schematic_1_C...)" }]
 * Output: ["Schematic_1_C", ...]
 */
export function parseSchematicDependencies(deps: readonly unknown[]): string[] {
  return extractClassNamesFromField(deps, "mSchematics");
}
