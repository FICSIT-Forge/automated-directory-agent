import * as fs from "fs";
import * as path from "path";
import { EmbeddingEngine } from "./embeddings.js";
import type { EntityType, GameEntity, IndexedEntity } from "./types.js";

let instance: SearchService | null = null;

/**
 * Singleton search service that loads the pre-built game data index at cold
 * start and exposes typed semantic search over all entity kinds.
 */
export class SearchService {
  private constructor(private readonly engine: EmbeddingEngine) {}

  /**
   * Returns the singleton, loading game_data_index.json on first call.
   * If the index is missing, search always returns empty results and a
   * CRITICAL error is logged — run `pnpm build:index` to fix.
   */
  static getInstance(): SearchService {
    if (instance) return instance;

    const indexPath = path.resolve(
      import.meta.dirname,
      "../../game_data_index.json",
    );

    try {
      const entities = JSON.parse(
        fs.readFileSync(indexPath, "utf-8"),
      ) as IndexedEntity[];
      console.log(
        `SearchService: Loaded ${entities.length} entities from index`,
      );
      instance = new SearchService(EmbeddingEngine.fromIndex(entities));
    } catch (e) {
      console.error(
        `SearchService: CRITICAL — Failed to load index from ${indexPath}. ` +
          `All game data searches will return empty results. ` +
          `Run 'pnpm build:index' to generate the index file.`,
        e instanceof Error ? e.message : String(e),
      );
      instance = new SearchService(EmbeddingEngine.fromIndex([]));
    }

    return instance;
  }

  /**
   * Embed a query and return the top-K most relevant entities.
   * Narrows the return type to the requested entity variants when entityTypes
   * is passed as a const-literal array (e.g., ["recipe"]).
   */
  async search<T extends EntityType = EntityType>(
    query: string,
    topK = 5,
    entityTypes?: T[],
  ): Promise<
    Array<Extract<GameEntity, { entityType: T }> & { score: number }>
  > {
    const queryEmbedding = await this.engine.embedQuery(query);
    return this.engine.search(queryEmbedding, topK, entityTypes);
  }
}
