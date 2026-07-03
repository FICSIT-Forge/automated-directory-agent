import { describe, it, expect } from "vitest";
import {
  isSchematicType,
  schematicTypeLabel,
  schematicTypeLabelShort,
} from "./types.js";
import type { SchematicType } from "./types.js";

describe("isSchematicType", () => {
  it("returns true for valid schematic types", () => {
    expect(isSchematicType("EST_Milestone")).toBe(true);
    expect(isSchematicType("EST_MAM")).toBe(true);
    expect(isSchematicType("EST_Alternate")).toBe(true);
  });

  it("returns false for invalid schematic types", () => {
    expect(isSchematicType("EST_Custom")).toBe(false);
    expect(isSchematicType("")).toBe(false);
    expect(isSchematicType("EST_Tutorial")).toBe(false);
  });
});

describe("schematicTypeLabel", () => {
  const cases: Array<[SchematicType, string]> = [
    ["EST_Milestone", "Milestone"],
    ["EST_MAM", "MAM Research"],
    ["EST_Alternate", "Alternate Recipe Unlock"],
  ];

  it.each(cases)("maps %s to %s", (type, expected) => {
    expect(schematicTypeLabel(type)).toBe(expected);
  });
});

describe("schematicTypeLabelShort", () => {
  const cases: Array<[SchematicType, string]> = [
    ["EST_Milestone", "Milestone"],
    ["EST_MAM", "MAM"],
    ["EST_Alternate", "Alternate"],
  ];

  it.each(cases)("maps %s to %s", (type, expected) => {
    expect(schematicTypeLabelShort(type)).toBe(expected);
  });
});
