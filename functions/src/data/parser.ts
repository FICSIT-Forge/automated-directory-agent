import * as fs from "fs";
import {
  isSchematicType,
  schematicTypeLabel,
  type GameEntity,
  type ItemEntity,
  type RecipeEntity,
  type ManufacturerEntity,
  type GeneratorEntity,
  type ExtractorEntity,
  type SchematicEntity,
  type SchematicType,
  type VehicleEntity,
  type ResolvedAmount,
  type GeneratorFuel,
} from "./types.js";
import {
  extractClassName,
  parseItemAmountList,
  parseClassList,
  parseSchematicUnlocks,
  parseSchematicDependencies,
} from "./rawParser.js";

// ─── Raw JSON structure of the Docs-en-US-UTF-8-*.json game data export ─────

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

const DESC_PREFIX = "Desc_";
const BUILD_PREFIX = "Build_";

// The game marks removed MAM research as "Discontinued - X": dead content
// that would otherwise crowd out real schematics in progression retrieval.
const DISCONTINUED_PREFIX = "Discontinued";

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

function matchesAny(nc: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => nc.includes(p));
}

// ─── DataParser ──────────────────────────────────────────────────────────────

export class DataParser {
  private rawData: RawData[] = [];
  private hardDriveRecipeClasses = new Set<string>();

  constructor(private filePath: string) {}

  /**
   * Recipe classNames unlocked by EST_Alternate schematics (i.e. obtained via
   * Hard Drive scans at the MAM). Populated by parse(); consumed by
   * enrichEntities to tag exactly those recipes with their hard-drive
   * provenance. Most are alternate recipes, but a few standard recipes share a
   * hard-drive unlock too.
   */
  public get hardDriveRecipes(): ReadonlySet<string> {
    return this.hardDriveRecipeClasses;
  }

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
    const fluidClasses = this.buildFluidLookup();
    const entities: GameEntity[] = [];
    this.hardDriveRecipeClasses = new Set();

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
            entities.push(this.parseRecipe(cls, nc, nameLookup, fluidClasses));
        }
      } else if (nc.includes(SCHEMATIC_PATTERN)) {
        for (const cls of group.Classes) {
          const type = cls.mType as string;
          if (!cls.mDisplayName || !isSchematicType(type)) continue;
          if ((cls.mDisplayName as string).startsWith(DISCONTINUED_PREFIX))
            continue;
          if (type === "EST_Alternate") {
            // EST_Alternate schematics are obtained by scanning Hard Drives at
            // the MAM. We don't index them as standalone entities (they crowd
            // out genuine Milestone/MAM milestones in retrieval); instead we
            // record exactly which recipes they unlock so the enricher can tag
            // those recipes with their hard-drive provenance.
            for (const recipeClass of parseSchematicUnlocks(
              (cls.mUnlocks as readonly unknown[]) ?? [],
            )) {
              this.hardDriveRecipeClasses.add(recipeClass);
            }
            continue;
          }
          entities.push(this.parseSchematic(cls, nc, nameLookup));
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
    this.resolveDescriptorNames(lookup);
    return lookup;
  }

  /** ClassNames of items whose form is Liquid or Gas — their amounts in
   * Docs.json are liters and need ÷1000 scaling to m³ (issue #22). */
  private buildFluidLookup(): Set<string> {
    const fluids = new Set<string>();
    for (const group of this.rawData) {
      for (const cls of group.Classes) {
        const form = cls.mForm as string | undefined;
        if (form === "RF_LIQUID" || form === "RF_GAS") {
          fluids.add(cls.ClassName);
        }
      }
    }
    return fluids;
  }

  /**
   * Building descriptors (Desc_X_C) often lack mDisplayName in the source data.
   * Resolve them via two fallback strategies:
   *  1. Case-insensitive stem match to the corresponding Build_X_C display name
   *  2. Recipe display name where this descriptor is the product
   */
  private resolveDescriptorNames(lookup: Map<string, string>): void {
    const buildNamesByStem = this.collectBuildNamesByStem(lookup);
    const recipeNamesByProduct = this.collectRecipeNamesByProduct();

    for (const group of this.rawData) {
      for (const cls of group.Classes) {
        if (lookup.has(cls.ClassName) || !cls.ClassName.startsWith(DESC_PREFIX))
          continue;

        const stem = cls.ClassName.slice(DESC_PREFIX.length).toLowerCase();
        const resolved =
          buildNamesByStem.get(stem) ?? recipeNamesByProduct.get(cls.ClassName);

        if (resolved) lookup.set(cls.ClassName, resolved);
      }
    }
  }

  private collectBuildNamesByStem(
    lookup: ReadonlyMap<string, string>,
  ): ReadonlyMap<string, string> {
    const stems = new Map<string, string>();
    for (const [className, displayName] of lookup) {
      if (className.startsWith(BUILD_PREFIX)) {
        stems.set(
          className.slice(BUILD_PREFIX.length).toLowerCase(),
          displayName,
        );
      }
    }
    return stems;
  }

  private collectRecipeNamesByProduct(): ReadonlyMap<string, string> {
    const names = new Map<string, string>();
    for (const group of this.rawData) {
      if (!group.NativeClass.includes(RECIPE_PATTERN)) continue;
      for (const cls of group.Classes) {
        if (!cls.mDisplayName || !cls.mProduct) continue;
        const match = (cls.mProduct as string).match(/([\w-]+_C)(?=['"])/);
        if (match) names.set(match[1], cls.mDisplayName as string);
      }
    }
    return names;
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
    fluidClasses: ReadonlySet<string>,
  ): ResolvedAmount {
    // Docs.json stores Liquid/Gas amounts in liters; the game displays m³
    // (issue #22). Without this, every fluid in every recipe is 1000× off —
    // and the model faithfully repeats it ("50,000/min Excited Photonic
    // Matter" reached a real player).
    const isFluid = fluidClasses.has(item.className);
    const amount = isFluid ? item.amount / 1000 : item.amount;
    return {
      className: item.className,
      displayName: this.resolveName(item.className, lookup),
      amount,
      ratePerMin: Math.round((amount / durationSecs) * 60 * 100) / 100,
      ...(isFluid ? { isFluid } : {}),
    };
  }

  /** `3x Iron Ingot (30/min)` for solids, `3 m³ Crude Oil (30/min)` for fluids. */
  private formatAmount(a: ResolvedAmount): string {
    return `${a.amount}${a.isFluid ? " m³" : "x"} ${a.displayName} (${a.ratePerMin}/min)`;
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
    const rawItemsPerCycle = this.parseNumber(cls.mItemsPerCycle) || 1;
    const powerMW = this.parseNumber(cls.mPowerConsumption);
    // Fluid extractors (Water/Oil/Resource Well) report mItemsPerCycle in
    // liters, like recipe fluid amounts (issue #22). The ≥1000 guard protects
    // entities with placeholder values (Resource Well Pressurizer has
    // mItemsPerCycle=1 and no real extraction rate of its own).
    const forms = (cls.mAllowedResourceForms as string) || "";
    const isFluid =
      /RF_LIQUID|RF_GAS/.test(forms) &&
      !forms.includes("RF_SOLID") &&
      rawItemsPerCycle >= 1000;
    const itemsPerCycle = isFluid ? rawItemsPerCycle / 1000 : rawItemsPerCycle;
    const ratePerMin = Math.round(
      ((itemsPerCycle / cycleSecs) * 60 * 100) / 100,
    );
    const rateUnit = isFluid ? " m³/min" : "/min";

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
        `Base extraction rate: ${ratePerMin}${rateUnit}`,
        `Power consumption: ${powerMW} MW`,
      ].join("\n"),
    };
  }

  private parseRecipe(
    cls: RawClass,
    nativeClass: string,
    nameLookup: Map<string, string>,
    fluidClasses: ReadonlySet<string>,
  ): RecipeEntity {
    const name = cls.mDisplayName as string;
    const durationSecs = this.parseNumber(cls.mManufactoringDuration) || 1;
    const isAlternate =
      name.startsWith("Alternate:") || cls.ClassName.includes("Alternate");

    const ingredients = parseItemAmountList(
      (cls.mIngredients as string) || "",
    ).map((item) =>
      this.resolveAmount(item, durationSecs, nameLookup, fluidClasses),
    );

    const products = parseItemAmountList((cls.mProduct as string) || "").map(
      (item) =>
        this.resolveAmount(item, durationSecs, nameLookup, fluidClasses),
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
        `Ingredients: ${ingredients.map((i) => this.formatAmount(i)).join(", ")}`,
      );
    if (products.length > 0)
      lines.push(
        `Products: ${products.map((p) => this.formatAmount(p)).join(", ")}`,
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
    const type = cls.mType as SchematicType;
    const techTier = parseInt((cls.mTechTier as string) || "0", 10);

    const cost = parseItemAmountList((cls.mCost as string) || "").map(
      (item) => ({
        displayName: this.resolveName(item.className, nameLookup),
        amount: item.amount,
      }),
    );

    const unlockClassNames = parseSchematicUnlocks(
      (cls.mUnlocks as readonly unknown[]) ?? [],
    );
    const unlocks = unlockClassNames.map((r) =>
      this.resolveName(r, nameLookup),
    );

    const prerequisites = parseSchematicDependencies(
      (cls.mSchematicDependencies as readonly unknown[]) ?? [],
    )
      .map((r) => this.resolveName(r, nameLookup))
      .filter((n) => !n.startsWith("Schematic_")); // filter unresolved classNames

    const label = schematicTypeLabel(type);
    const tierSuffix = techTier > 0 ? ` (Tier ${techTier})` : "";
    const lines = [`${label}: ${name}${tierSuffix}`];
    if (desc) lines.push(`Description: ${desc}`);
    if (cost.length > 0)
      lines.push(
        `Cost: ${cost.map((c) => `${c.amount}x ${c.displayName}`).join(", ")}`,
      );
    if (unlocks.length > 0) lines.push(`Unlocks: ${unlocks.join(", ")}`);
    if (prerequisites.length > 0)
      lines.push(`Requires: ${prerequisites.join(", ")}`);

    return {
      className: cls.ClassName,
      displayName: name,
      description: desc || `${label}: ${name}`,
      nativeClass,
      entityType: "schematic",
      metadata: {
        type,
        techTier,
        cost,
        unlocks,
        unlockClassNames,
        prerequisites,
      },
      embeddingText: lines.join("\n"),
    };
  }
}
