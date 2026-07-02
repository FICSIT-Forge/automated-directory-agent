import * as fs from "fs";

// Types for the raw JSON structure
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

// Unified Data Model for our application
export interface GameEntity {
  className: string;
  displayName: string;
  description: string;
  nativeClass: string;
  metadata: Record<string, unknown>;
  embeddingText: string; // The rich text used for embedding
}

export class DataParser {
  private rawData: RawData[] = [];

  constructor(private filePath: string) {}

  public async load(): Promise<void> {
    let fileContent = await fs.promises.readFile(this.filePath, "utf-8");
    // Strip BOM if present
    if (fileContent.charCodeAt(0) === 0xfeff) {
      fileContent = fileContent.slice(1);
    }
    this.rawData = JSON.parse(fileContent);
  }

  public parse(): GameEntity[] {
    const entities: GameEntity[] = [];

    for (const group of this.rawData) {
      const nativeClass = group.NativeClass;

      // Filter for relevant classes
      if (this.isItemClass(nativeClass)) {
        for (const cls of group.Classes) {
          entities.push(this.parseItem(cls, nativeClass));
        }
      } else if (this.isBuildingClass(nativeClass)) {
        for (const cls of group.Classes) {
          entities.push(this.parseBuilding(cls, nativeClass));
        }
      } else if (this.isRecipeClass(nativeClass)) {
        for (const cls of group.Classes) {
          // We might want to store recipes differently, but for embeddings,
          // searching for "Recipe for Iron Ingot" is useful.
          entities.push(this.parseRecipe(cls, nativeClass));
        }
      }
      // TODO: Add Schematics parsing
    }

    return entities;
  }

  private isItemClass(nativeClass: string): boolean {
    return (
      nativeClass.includes("FGItemDescriptor") ||
      nativeClass.includes("FGEquipmentDescriptor") ||
      nativeClass.includes("FGConsumableDescriptor") ||
      nativeClass.includes("FGItemDescriptorNuclearFuel") ||
      nativeClass.includes("FGAmmoType")
    );
  }

  private isBuildingClass(nativeClass: string): boolean {
    return (
      nativeClass.includes("FGBuildable") ||
      nativeClass.includes("FGBuildingDescriptor")
    ); // Descriptors for buildings
  }

  private isRecipeClass(nativeClass: string): boolean {
    return nativeClass.includes("FGRecipe");
  }

  private parseItem(cls: RawClass, nativeClass: string): GameEntity {
    const name = cls.mDisplayName || cls.ClassName;
    const desc = cls.mDescription || "";

    return {
      className: cls.ClassName,
      displayName: name,
      description: desc,
      nativeClass,
      metadata: {
        stackSize: cls.mStackSize,
        energyValue: cls.mEnergyValue,
        form: cls.mForm,
      },
      embeddingText: `Item: ${name}\nDescription: ${desc}\nType: Resource/Item`,
    };
  }

  private parseBuilding(cls: RawClass, nativeClass: string): GameEntity {
    const name = cls.mDisplayName || cls.ClassName;
    const desc = cls.mDescription || "";

    return {
      className: cls.ClassName,
      displayName: name,
      description: desc,
      nativeClass,
      metadata: {
        powerConsumption: cls.mPowerConsumption, // Example field, need to verify exact key
        powerProduction: cls.mPowerProduction,
      },
      embeddingText: `Building: ${name}\nDescription: ${desc}`,
    };
  }

  private parseRecipe(cls: RawClass, nativeClass: string): GameEntity {
    const name = cls.mDisplayName || cls.ClassName; // Recipes often have display names like "Iron Ingot"
    // Recipes don't usually have descriptions, but they have ingredients/products
    return {
      className: cls.ClassName,
      displayName: name,
      description: `Recipe to craft ${name}`,
      nativeClass,
      metadata: {
        ingredients: cls.mIngredients,
        product: cls.mProduct,
        duration: cls.mManufactoringDuration,
      },
      embeddingText: `Recipe: ${name}\nCrafts: ${name}`, // We will enhance this with ingredient names later
    };
  }
}
