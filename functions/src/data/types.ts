// ─── Metadata Types ───────────────────────────────────────────────────────────

export interface ResolvedAmount {
  className: string;
  displayName: string;
  amount: number;
  ratePerMin: number;
}

export interface ItemMetadata {
  stackSize: string;
  energyValueMJ: number;
  form: string;
  earliestTechTier?: number;
  producedByRecipes?: string[];
  usedInRecipes?: string[];
}

export interface RecipeMetadata {
  ingredients: ResolvedAmount[];
  products: ResolvedAmount[];
  producedIn: string[];
  durationSecs: number;
  isAlternate: boolean;
  unlockedBy?: SchematicRef[];
}

export interface ManufacturerMetadata {
  powerConsumptionMW: number;
  manufacturingSpeed: number;
}

export interface GeneratorFuel {
  fuelName: string;
  supplementalResource: string | null;
  byproduct: string | null;
}

export interface GeneratorMetadata {
  powerProductionMW: number;
  fuels: GeneratorFuel[];
}

export interface ExtractorMetadata {
  extractCycleSecs: number;
  itemsPerCycle: number;
  ratePerMin: number;
  powerConsumptionMW: number;
  allowedResourceForms: string;
}

export interface SchematicCost {
  displayName: string;
  amount: number;
}

export type SchematicType = "EST_Milestone" | "EST_MAM" | "EST_Alternate";

const SCHEMATIC_TYPES = new Set<string>([
  "EST_Milestone",
  "EST_MAM",
  "EST_Alternate",
]);

export function isSchematicType(type: string): type is SchematicType {
  return SCHEMATIC_TYPES.has(type);
}

export function schematicTypeLabel(type: SchematicType): string {
  switch (type) {
    case "EST_Milestone":
      return "Milestone";
    case "EST_Alternate":
      return "Alternate Recipe Unlock";
    case "EST_MAM":
      return "MAM Research";
  }
}

export function schematicTypeLabelShort(type: SchematicType): string {
  switch (type) {
    case "EST_Milestone":
      return "Milestone";
    case "EST_Alternate":
      return "Alternate";
    case "EST_MAM":
      return "MAM";
  }
}

export interface SchematicRef {
  displayName: string;
  type: SchematicType;
  techTier: number;
}

export interface SchematicMetadata {
  type: SchematicType;
  techTier: number;
  cost: SchematicCost[];
  unlocks: string[];
  unlockClassNames: string[];
  prerequisites?: string[];
}

export interface VehicleMetadata {
  fuelConsumption: string;
}

// ─── Game Entities (discriminated union on entityType) ────────────────────────

interface BaseEntity {
  className: string;
  displayName: string;
  description: string;
  nativeClass: string;
  embeddingText: string;
}

export interface ItemEntity extends BaseEntity {
  entityType: "item";
  metadata: ItemMetadata;
}

export interface RecipeEntity extends BaseEntity {
  entityType: "recipe";
  metadata: RecipeMetadata;
}

export interface ManufacturerEntity extends BaseEntity {
  entityType: "manufacturer";
  metadata: ManufacturerMetadata;
}

export interface GeneratorEntity extends BaseEntity {
  entityType: "generator";
  metadata: GeneratorMetadata;
}

export interface ExtractorEntity extends BaseEntity {
  entityType: "extractor";
  metadata: ExtractorMetadata;
}

export interface SchematicEntity extends BaseEntity {
  entityType: "schematic";
  metadata: SchematicMetadata;
}

export interface VehicleEntity extends BaseEntity {
  entityType: "vehicle";
  metadata: VehicleMetadata;
}

export type GameEntity =
  | ItemEntity
  | RecipeEntity
  | ManufacturerEntity
  | GeneratorEntity
  | ExtractorEntity
  | SchematicEntity
  | VehicleEntity;

// Derived from GameEntity — stays in sync automatically.
export type EntityType = GameEntity["entityType"];

// ─── Derived Types ────────────────────────────────────────────────────────────

// Intersection distributes over the union, so each member retains its discriminant.
export type IndexedEntity = GameEntity & { embedding: number[] };
export type SearchResult = GameEntity & { score: number };
