import * as fs from "fs";
import type {
  GameEntity,
  ItemEntity,
  RecipeEntity,
  ManufacturerEntity,
  GeneratorEntity,
  ExtractorEntity,
  SchematicEntity,
  VehicleEntity,
  ResolvedAmount,
  GeneratorFuel,
} from "./types.js";
import {
  extractClassName,
  parseItemAmountList,
  parseClassList,
  parseSchematicUnlocks,
} from "./rawParser.js";

// ─── Raw JSON structure from Docs-en-US-UTF-8.json ───────────────────────────

interface RawClass {
  ClassName: string;
  mDisplayName?: string;
  mDescription?: string;
  [key: string]: unknown;
}

interface RawData {
  NativeClass: string;
  Classes: RawClass[];
}

// ─── NativeClass inclusion patterns ──────────────────────────────────────────

const ITEM_PATTERNS = [
  "FGItemDescriptor",
  "FGResourceDescriptor",
  "FGItemDescriptorBiomass",
  "FGEquipmentDescriptor",
  "FGConsumableDescriptor",
  "FGItemDescriptorNuclearFuel",
  "FGAmmoTypeProjectile",
  "FGAmmoTypeSpreadshot",
  "FGAmmoTypeInstantHit",
  "FGPowerShardDescriptor",
  "FGItemDescriptorPowerBoosterFuel",
];

const VEHICLE_PATTERNS = ["FGVehicleDescriptor"];

const MANUFACTURER_PATTERNS = [
  "FGBuildableManufacturer'",
  "FGBuildableManufacturerVariablePower",
];

const GENERATOR_PATTERNS = [
  "FGBuildableGeneratorFuel",
  "FGBuildableGeneratorNuclear",
  "FGBuildableGeneratorGeoThermal",
];

const EXTRACTOR_PATTERNS = [
  "FGBuildableResourceExtractor",
  "FGBuildableFrackingExtractor",
  "FGBuildableFrackingActivator",
  "FGBuildableWaterPump",
];

const RECIPE_PATTERN = "FGRecipe'";
const CUSTOMIZATION_RECIPE_PATTERN = "FGCustomizationRecipe";
const SCHEMATIC_PATTERN = "FGSchematic";

const WORKBENCH_EXCLUSIONS = [
  "WorkBench",
  "WorkshopComponent",
  "AutomatedWorkBench",
];

const FORM_LABELS: Record<string, string> = {
  RF_SOLID: "Solid",
  RF_LIQUID: "Liquid",
  RF_GAS: "Gas",
};

// ─── Module-level helpers ─────────────────────────────────────────────────────

function matchesAny(nc: string, patterns: string[]): boolean {
  return patterns.some((p) => nc.includes(p));
}

// ─── DataParser ──────────────────────────────────────────────────────────────

export class DataParser {
  private rawData: RawData[] = [];

  constructor(private filePath: string) {}

  public async load(): Promise<void> {
    let fileContent = await fs.promises.readFile(this.filePath, "utf-8");
    if (fileContent.charCodeAt(0) === 0xfeff) {
      fileContent = fileContent.slice(1);
    }
    this.rawData = JSON.parse(fileContent);
  }

  /**
   * Two-pass parsing:
   * Pass 1: Build className → displayName lookup from ALL groups
   * Pass 2: Parse entities with resolved cross-references
   */
  public parse(): GameEntity[] {
    const nameLookup = this.buildNameLookup();
    const entities: GameEntity[] = [];

    for (const group of this.rawData) {
      const nc = group.NativeClass;

      if (matchesAny(nc, ITEM_PATTERNS)) {
        for (const cls of group.Classes) {
          if (cls.mDisplayName) entities.push(this.parseItem(cls, nc));
        }
      } else if (matchesAny(nc, VEHICLE_PATTERNS)) {
        for (const cls of group.Classes) {
          if (cls.mDisplayName) entities.push(this.parseVehicle(cls, nc));
        }
      } else if (matchesAny(nc, MANUFACTURER_PATTERNS)) {
        for (const cls of group.Classes) {
          if (cls.mDisplayName) entities.push(this.parseManufacturer(cls, nc));
        }
      } else if (matchesAny(nc, GENERATOR_PATTERNS)) {
        for (const cls of group.Classes) {
          if (cls.mDisplayName)
            entities.push(this.parseGenerator(cls, nc, nameLookup));
        }
      } else if (matchesAny(nc, EXTRACTOR_PATTERNS)) {
        for (const cls of group.Classes) {
          if (cls.mDisplayName) entities.push(this.parseExtractor(cls, nc));
        }
      } else if (
        nc.includes(RECIPE_PATTERN) &&
        !nc.includes(CUSTOMIZATION_RECIPE_PATTERN)
      ) {
        for (const cls of group.Classes) {
          if (cls.mDisplayName)
            entities.push(this.parseRecipe(cls, nc, nameLookup));
        }
      } else if (nc.includes(SCHEMATIC_PATTERN)) {
        for (const cls of group.Classes) {
          const type = cls.mType as string;
          if (
            cls.mDisplayName &&
            (type === "EST_Milestone" || type === "EST_MAM")
          ) {
            entities.push(this.parseSchematic(cls, nc, nameLookup));
          }
        }
      }
      // All other NativeClasses are skipped (structural, cosmetic, etc.)
    }

    return entities;
  }

  // ─── Pass 1: Build lookup ────────────────────────────────────────────────

  private buildNameLookup(): Map<string, string> {
    const lookup = new Map<string, string>();
    for (const group of this.rawData) {
      for (const cls of group.Classes) {
        if (cls.mDisplayName) {
          lookup.set(cls.ClassName, cls.mDisplayName as string);
        }
      }
    }
    return lookup;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private resolveName(className: string, lookup: Map<string, string>): string {
    return lookup.get(className) ?? className;
  }

  private parseNumber(val: unknown): number {
    if (typeof val === "number") return val;
    if (typeof val === "string") return parseFloat(val) || 0;
    return 0;
  }

  private cleanDescription(desc: unknown): string {
    if (typeof desc !== "string") return "";
    return desc.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  }

  private resolveAmount(
    item: { className: string; amount: number },
    durationSecs: number,
    lookup: Map<string, string>,
  ): ResolvedAmount {
    return {
      className: item.className,
      displayName: this.resolveName(item.className, lookup),
      amount: item.amount,
      ratePerMin: Math.round((item.amount / durationSecs) * 60 * 100) / 100,
    };
  }

  private parseFuels(
    cls: RawClass,
    nameLookup: Map<string, string>,
  ): GeneratorFuel[] {
    const fuelArray = cls.mFuel as Array<Record<string, unknown>> | undefined;

    if (Array.isArray(fuelArray)) {
      return fuelArray.map((fuel) => {
        const fuelClass = extractClassName((fuel.mFuelClass as string) || "");
        const suppClass = fuel.mSupplementalResourceClass
          ? extractClassName(fuel.mSupplementalResourceClass as string)
          : null;
        const byproductClass = fuel.mByproduct
          ? extractClassName(fuel.mByproduct as string)
          : null;
        return {
          fuelName: this.resolveName(fuelClass, nameLookup),
          supplementalResource: suppClass
            ? this.resolveName(suppClass, nameLookup)
            : null,
          byproduct: byproductClass
            ? this.resolveName(byproductClass, nameLookup)
            : null,
        };
      });
    }

    if (cls.mDefaultFuelClasses) {
      return parseClassList(cls.mDefaultFuelClasses as string).map((fc) => ({
        fuelName: this.resolveName(fc, nameLookup),
        supplementalResource: null,
        byproduct: null,
      }));
    }

    return [];
  }

  // ─── Entity Parsers ─────────────────────────────────────────────────────

  private parseItem(cls: RawClass, nativeClass: string): ItemEntity {
    const name = cls.mDisplayName as string;
    const desc = this.cleanDescription(cls.mDescription);
    const form = (cls.mForm as string) || "";
    const energyMJ = this.parseNumber(cls.mEnergyValue);
    const formLabel = FORM_LABELS[form] ?? form;

    const lines = [`Item: ${name}`, `Description: ${desc}`];
    if (formLabel) lines.push(`Form: ${formLabel}`);
    if (cls.mStackSize) lines.push(`Stack size: ${cls.mStackSize}`);
    if (energyMJ > 0) lines.push(`Energy: ${energyMJ} MJ`);

    return {
      className: cls.ClassName,
      displayName: name,
      description: desc,
      nativeClass,
      entityType: "item",
      metadata: {
        stackSize: (cls.mStackSize as string) || "",
        energyValueMJ: energyMJ,
        form: formLabel,
      },
      embeddingText: lines.join("\n"),
    };
  }

  private parseVehicle(cls: RawClass, nativeClass: string): VehicleEntity {
    const name = cls.mDisplayName as string;
    const desc = this.cleanDescription(cls.mDescription);

    return {
      className: cls.ClassName,
      displayName: name,
      description: desc,
      nativeClass,
      entityType: "vehicle",
      metadata: { fuelConsumption: (cls.mFuelConsumption as string) || "" },
      embeddingText: `Vehicle: ${name}\nDescription: ${desc}`,
    };
  }

  private parseManufacturer(
    cls: RawClass,
    nativeClass: string,
  ): ManufacturerEntity {
    const name = cls.mDisplayName as string;
    const desc = this.cleanDescription(cls.mDescription);
    const powerMW = this.parseNumber(cls.mPowerConsumption);
    const speed = this.parseNumber(cls.mManufacturingSpeed) || 1;

    const lines = [
      `Building: ${name} (Manufacturer)`,
      `Description: ${desc}`,
      `Power consumption: ${powerMW} MW`,
    ];
    if (speed !== 1) lines.push(`Manufacturing speed: ${speed}x`);

    return {
      className: cls.ClassName,
      displayName: name,
      description: desc,
      nativeClass,
      entityType: "manufacturer",
      metadata: { powerConsumptionMW: powerMW, manufacturingSpeed: speed },
      embeddingText: lines.join("\n"),
    };
  }

  private parseGenerator(
    cls: RawClass,
    nativeClass: string,
    nameLookup: Map<string, string>,
  ): GeneratorEntity {
    const name = cls.mDisplayName as string;
    const desc = this.cleanDescription(cls.mDescription);
    const powerMW = this.parseNumber(cls.mPowerProduction);
    const fuels = this.parseFuels(cls, nameLookup);

    const lines = [
      `Building: ${name} (Generator)`,
      `Description: ${desc}`,
      `Power production: ${powerMW} MW`,
    ];
    if (fuels.length > 0) {
      lines.push(`Fuel types: ${fuels.map((f) => f.fuelName).join(", ")}`);
      const supp = fuels.find((f) => f.supplementalResource);
      if (supp)
        lines.push(`Supplemental resource: ${supp.supplementalResource}`);
    }

    return {
      className: cls.ClassName,
      displayName: name,
      description: desc,
      nativeClass,
      entityType: "generator",
      metadata: { powerProductionMW: powerMW, fuels },
      embeddingText: lines.join("\n"),
    };
  }

  private parseExtractor(cls: RawClass, nativeClass: string): ExtractorEntity {
    const name = cls.mDisplayName as string;
    const desc = this.cleanDescription(cls.mDescription);
    const cycleSecs = this.parseNumber(cls.mExtractCycleTime) || 1;
    const itemsPerCycle = this.parseNumber(cls.mItemsPerCycle) || 1;
    const powerMW = this.parseNumber(cls.mPowerConsumption);
    const ratePerMin = Math.round(
      ((itemsPerCycle / cycleSecs) * 60 * 100) / 100,
    );

    return {
      className: cls.ClassName,
      displayName: name,
      description: desc,
      nativeClass,
      entityType: "extractor",
      metadata: {
        extractCycleSecs: cycleSecs,
        itemsPerCycle,
        ratePerMin,
        powerConsumptionMW: powerMW,
        allowedResourceForms: (cls.mAllowedResourceForms as string) || "",
      },
      embeddingText: [
        `Building: ${name} (Resource Extractor)`,
        `Description: ${desc}`,
        `Base extraction rate: ${ratePerMin}/min`,
        `Power consumption: ${powerMW} MW`,
      ].join("\n"),
    };
  }

  private parseRecipe(
    cls: RawClass,
    nativeClass: string,
    nameLookup: Map<string, string>,
  ): RecipeEntity {
    const name = cls.mDisplayName as string;
    const durationSecs = this.parseNumber(cls.mManufactoringDuration) || 1;
    const isAlternate =
      name.startsWith("Alternate:") || cls.ClassName.includes("Alternate");

    const ingredients = parseItemAmountList(
      (cls.mIngredients as string) || "",
    ).map((item) => this.resolveAmount(item, durationSecs, nameLookup));

    const products = parseItemAmountList((cls.mProduct as string) || "").map(
      (item) => this.resolveAmount(item, durationSecs, nameLookup),
    );

    const producedIn = parseClassList((cls.mProducedIn as string) || "")
      .map((c) => this.resolveName(c, nameLookup))
      .filter((n) => !WORKBENCH_EXCLUSIONS.some((ex) => n.includes(ex)));

    const lines = [
      isAlternate ? `Alternate Recipe: ${name}` : `Recipe: ${name}`,
    ];
    if (producedIn.length > 0)
      lines.push(`Produced in: ${producedIn.join(", ")}`);
    if (ingredients.length > 0)
      lines.push(
        `Ingredients: ${ingredients.map((i) => `${i.amount}x ${i.displayName} (${i.ratePerMin}/min)`).join(", ")}`,
      );
    if (products.length > 0)
      lines.push(
        `Products: ${products.map((p) => `${p.amount}x ${p.displayName} (${p.ratePerMin}/min)`).join(", ")}`,
      );
    lines.push(`Cycle time: ${durationSecs}s`);

    return {
      className: cls.ClassName,
      displayName: name,
      description: `Recipe to craft ${name}`,
      nativeClass,
      entityType: "recipe",
      metadata: {
        ingredients,
        products,
        producedIn,
        durationSecs,
        isAlternate,
      },
      embeddingText: lines.join("\n"),
    };
  }

  private parseSchematic(
    cls: RawClass,
    nativeClass: string,
    nameLookup: Map<string, string>,
  ): SchematicEntity {
    const name = cls.mDisplayName as string;
    const desc = this.cleanDescription(cls.mDescription);
    const type = cls.mType as string;
    const techTier = parseInt((cls.mTechTier as string) || "0", 10);

    const cost = parseItemAmountList((cls.mCost as string) || "").map(
      (item) => ({
        displayName: this.resolveName(item.className, nameLookup),
        amount: item.amount,
      }),
    );

    const unlocks = parseSchematicUnlocks(
      (cls.mUnlocks as unknown[]) || [],
    ).map((r) => this.resolveName(r, nameLookup));

    const typeLabel = type === "EST_Milestone" ? "Milestone" : "MAM Research";
    const lines = [
      `${typeLabel}: ${name}${techTier > 0 ? ` (Tier ${techTier})` : ""}`,
    ];
    if (desc) lines.push(`Description: ${desc}`);
    if (cost.length > 0)
      lines.push(
        `Cost: ${cost.map((c) => `${c.amount}x ${c.displayName}`).join(", ")}`,
      );
    if (unlocks.length > 0) lines.push(`Unlocks: ${unlocks.join(", ")}`);

    return {
      className: cls.ClassName,
      displayName: name,
      description: desc || `${typeLabel}: ${name}`,
      nativeClass,
      entityType: "schematic",
      metadata: { type, techTier, cost, unlocks },
      embeddingText: lines.join("\n"),
    };
  }
}
