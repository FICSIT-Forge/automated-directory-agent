import { ai } from "../genkit.js";
import type { EntityType, GameEntity, IndexedEntity } from "./types.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const EMBEDDING_MODEL = "googleai/gemini-embedding-001";
const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 200;
const MAX_RETRIES = 5;

// ─── Module-level pure helpers ────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(e: unknown): boolean {
  const err = e as Record<string, unknown>;
  return err?.status === "RESOURCE_EXHAUSTED" || err?.code === 429;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA * normB);
  return denom === 0 ? 0 : dot / denom;
}

async function generateBatch(
  texts: string[],
  attempt = 1,
): Promise<number[][]> {
  try {
    const embeddings = await ai.embedMany({
      embedder: EMBEDDING_MODEL,
      content: texts,
    });
    return embeddings.map((e) => e.embedding);
  } catch (e) {
    if (isRateLimitError(e)) {
      if (attempt > MAX_RETRIES) throw e;
      const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
      console.warn(`Rate limit hit. Retrying in ${delay.toFixed(0)}ms...`);
      await sleep(delay);
      return generateBatch(texts, attempt + 1);
    }
    throw e;
  }
}

// ─── EmbeddingEngine ─────────────────────────────────────────────────────────

export class EmbeddingEngine {
  private constructor(private readonly entities: IndexedEntity[]) {}

  /**
   * Create an engine from a pre-built index (e.g., loaded from JSON).
   */
  static fromIndex(entities: IndexedEntity[]): EmbeddingEngine {
    return new EmbeddingEngine(entities);
  }

  /**
   * Parse game entities into an indexed engine by generating embeddings.
   * Returns a ready-to-use engine; does not mutate the input array.
   */
  static async build(
    entities: readonly GameEntity[],
  ): Promise<EmbeddingEngine> {
    const indexed: IndexedEntity[] = entities.map((e) => ({
      ...e,
      embedding: [],
    }));
    const texts = indexed.map((e) => e.embeddingText);
    const totalBatches = Math.ceil(texts.length / BATCH_SIZE);

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      console.log(
        `Generating embeddings: batch ${batchNum}/${totalBatches} (${batch.length} items)...`,
      );

      const embeddings = await generateBatch(batch);
      for (let j = 0; j < embeddings.length; j++) {
        indexed[i + j].embedding = embeddings[j];
      }

      if (i + BATCH_SIZE < texts.length) {
        await sleep(BATCH_DELAY_MS);
      }
    }

    return new EmbeddingEngine(indexed);
  }

  /** Returns the indexed entities for serialization. */
  getIndexedEntities(): readonly IndexedEntity[] {
    return this.entities;
  }

  /** Embed a query string for use with search(). */
  async embedQuery(query: string): Promise<number[]> {
    const [result] = await ai.embed({
      embedder: EMBEDDING_MODEL,
      content: query,
    });
    return result.embedding;
  }

  /**
   * Cosine similarity search over indexed entities.
   *
   * When entityTypes is provided, T is inferred from the literal array, so the
   * return type narrows to the matching entity variants (e.g., RecipeEntity
   * when called with ["recipe"]).
   */
  search<T extends EntityType = EntityType>(
    queryEmbedding: number[],
    topK: number,
    entityTypes?: T[],
  ): Array<Extract<GameEntity, { entityType: T }> & { score: number }> {
    type TypedIndexed = Extract<GameEntity, { entityType: T }> & {
      embedding: number[];
    };

    const pool =
      entityTypes && entityTypes.length > 0
        ? this.entities.filter((e): e is TypedIndexed =>
            entityTypes.includes(e.entityType as T),
          )
        : (this.entities as TypedIndexed[]);

    return pool
      .map((entity) => ({
        ...entity,
        score:
          entity.embedding.length > 0
            ? cosineSimilarity(queryEmbedding, entity.embedding)
            : -1,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK) as Array<
      Extract<GameEntity, { entityType: T }> & { score: number }
    >;
  }
}
