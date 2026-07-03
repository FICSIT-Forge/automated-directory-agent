import { describe, it, expect } from "vitest";
import {
  extractClassName,
  parseItemAmountList,
  parseClassList,
  parseSchematicUnlocks,
  parseSchematicDependencies,
} from "./rawParser.js";

describe("extractClassName", () => {
  it("extracts className from full UE asset path", () => {
    const path =
      "/Script/Engine.BlueprintGeneratedClass'/Game/Items/Desc_IronIngot.Desc_IronIngot_C'";
    expect(extractClassName(path)).toBe("Desc_IronIngot_C");
  });

  it("returns short-form className as-is", () => {
    expect(extractClassName("Desc_IronIngot_C")).toBe("Desc_IronIngot_C");
  });

  it("returns original string when no _C pattern found", () => {
    expect(extractClassName("SomeRandomString")).toBe("SomeRandomString");
  });

  it("handles hyphenated classNames (milestone schematics)", () => {
    const path =
      "/Script/Engine.BlueprintGeneratedClass'/Game/Schematics/Schematic_5-2.Schematic_5-2_C'";
    expect(extractClassName(path)).toBe("Schematic_5-2_C");
    expect(extractClassName("Schematic_5-2_C")).toBe("Schematic_5-2_C");
  });

  it("ignores stems that merely contain _C mid-name", () => {
    const path =
      "/Script/Engine.BlueprintGeneratedClass'/Game/Parts/CompactedCoal/Desc_CompactedCoal.Desc_CompactedCoal_C'";
    expect(extractClassName(path)).toBe("Desc_CompactedCoal_C");
  });
});

describe("parseItemAmountList", () => {
  it("parses single item amount", () => {
    const raw = `((ItemClass="/Game/.../Desc_IronIngot.Desc_IronIngot_C",Amount=3))`;
    expect(parseItemAmountList(raw)).toEqual([
      { className: "Desc_IronIngot_C", amount: 3 },
    ]);
  });

  it("parses multiple item amounts", () => {
    const raw = `((ItemClass="/Game/.../Desc_IronIngot.Desc_IronIngot_C",Amount=3),(ItemClass="/Game/.../Desc_IronPlate.Desc_IronPlate_C",Amount=6))`;
    expect(parseItemAmountList(raw)).toEqual([
      { className: "Desc_IronIngot_C", amount: 3 },
      { className: "Desc_IronPlate_C", amount: 6 },
    ]);
  });

  it("returns empty array for empty inputs", () => {
    expect(parseItemAmountList("")).toEqual([]);
    expect(parseItemAmountList("()")).toEqual([]);
    expect(parseItemAmountList("None")).toEqual([]);
  });
});

describe("parseClassList", () => {
  it("parses multiple class references", () => {
    const raw = `("/Game/.../Build_ConstructorMk1.Build_ConstructorMk1_C","/Game/.../BP_WorkBenchComponent.BP_WorkBenchComponent_C")`;
    expect(parseClassList(raw)).toEqual([
      "Build_ConstructorMk1_C",
      "BP_WorkBenchComponent_C",
    ]);
  });

  it("returns empty array for empty inputs", () => {
    expect(parseClassList("")).toEqual([]);
    expect(parseClassList("()")).toEqual([]);
    expect(parseClassList("None")).toEqual([]);
  });

  it("keeps hyphenated classNames intact", () => {
    const raw = `("/Game/.../Schematic_1-1.Schematic_1-1_C'","/Game/.../Schematic_5-1-1.Schematic_5-1-1_C'")`;
    expect(parseClassList(raw)).toEqual([
      "Schematic_1-1_C",
      "Schematic_5-1-1_C",
    ]);
  });
});

describe("parseSchematicUnlocks", () => {
  it("extracts recipe classNames from unlock objects", () => {
    const unlocks = [
      {
        Class: "BP_UnlockRecipe_C",
        mRecipes: `("/Game/.../Recipe_IronPlate.Recipe_IronPlate_C","/Game/.../Recipe_IronRod.Recipe_IronRod_C")`,
      },
    ];
    expect(parseSchematicUnlocks(unlocks)).toEqual([
      "Recipe_IronPlate_C",
      "Recipe_IronRod_C",
    ]);
  });

  it("returns empty array when no mRecipes field", () => {
    const unlocks = [{ Class: "BP_UnlockInfoOnly_C" }];
    expect(parseSchematicUnlocks(unlocks)).toEqual([]);
  });

  it("handles empty unlock array", () => {
    expect(parseSchematicUnlocks([])).toEqual([]);
  });

  it("combines recipes from multiple unlock objects", () => {
    const unlocks = [
      {
        Class: "BP_UnlockRecipe_C",
        mRecipes: `("/Game/.../Recipe_A.Recipe_A_C")`,
      },
      {
        Class: "BP_UnlockRecipe_C",
        mRecipes: `("/Game/.../Recipe_B.Recipe_B_C")`,
      },
    ];
    expect(parseSchematicUnlocks(unlocks)).toEqual([
      "Recipe_A_C",
      "Recipe_B_C",
    ]);
  });
});

describe("parseSchematicDependencies", () => {
  it("extracts prerequisite schematic classNames (real names are hyphenated)", () => {
    const deps = [
      {
        Class: "BP_SchematicPurchasedDependency_C",
        mSchematics: `("/Game/.../Schematic_3-1.Schematic_3-1_C","/Game/.../Schematic_3-2.Schematic_3-2_C")`,
      },
    ];
    expect(parseSchematicDependencies(deps)).toEqual([
      "Schematic_3-1_C",
      "Schematic_3-2_C",
    ]);
  });

  it("returns empty array for empty deps", () => {
    expect(parseSchematicDependencies([])).toEqual([]);
  });

  it("returns empty array when mSchematics field is missing", () => {
    const deps = [{ Class: "BP_SomeDependency_C" }];
    expect(parseSchematicDependencies(deps)).toEqual([]);
  });

  it("combines schematics from multiple dependency objects", () => {
    const deps = [
      {
        Class: "BP_SchematicPurchasedDependency_C",
        mSchematics: `("/Game/.../Schematic_A.Schematic_A_C")`,
      },
      {
        Class: "BP_SchematicPurchasedDependency_C",
        mSchematics: `("/Game/.../Schematic_B.Schematic_B_C")`,
      },
    ];
    expect(parseSchematicDependencies(deps)).toEqual([
      "Schematic_A_C",
      "Schematic_B_C",
    ]);
  });
});
