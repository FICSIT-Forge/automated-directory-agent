import { ai } from "../genkit";
import { GameEntity } from "./parser";

export interface SearchResult extends GameEntity {
  score: number;
}

export class EmbeddingEngine {
  // Using gemini-embedding-001 as requested
  private static EMBEDDING_MODEL = "googleai/gemini-embedding-001";

  constructor(private entities: GameEntity[] = []) {}

  /**
   * Generates embeddings for all entities in the list.
   * Modifies the entities in-place by adding the embedding field (if we were storing it on the object),
   * but for now we'll return a new list or just rely on the fact that we're processing them.
   */
  public async generateEmbeddings(): Promise<void> {
    const texts = this.entities.map((e) => e.embeddingText);

    // Process in batches to avoid hitting rate limits or payload size limits
    const BATCH_SIZE = 1;

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      console.log(
        `Generating embeddings for batch ${i / BATCH_SIZE + 1}/${Math.ceil(texts.length / BATCH_SIZE)}...`,
      );

      await this.generateBatchWithRetry(batch, i);

      // Rate limit delay (conservative 1s)
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  private async generateBatchWithRetry(
    batch: string[],
    startIndex: number,
    attempt = 1,
  ): Promise<void> {
    try {
      const embeddings = await ai.embedMany({
        embedder: EmbeddingEngine.EMBEDDING_MODEL,
        content: batch,
      });

      for (let j = 0; j < embeddings.length; j++) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.entities[startIndex + j] as any).embedding =
          embeddings[j].embedding;
      }
    } catch (e: unknown) {
      const err = e as Record<string, unknown>;
      if (err?.status === "RESOURCE_EXHAUSTED" || err?.code === 429) {
        if (attempt > 5) throw e;
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
        console.warn(
          `Rate limit hit. Retrying batch in ${delay.toFixed(0)}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.generateBatchWithRetry(batch, startIndex, attempt + 1);
      }
      console.error("Error generating embeddings for batch:", e);
    }
  }

  public search(queryEmbedding: number[], topK: number = 5): SearchResult[] {
    if (this.entities.length === 0) return [];

    // Simple cosine similarity search
    const results = this.entities.map((entity) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const vector = (entity as any).embedding as number[] | undefined;
      if (!vector) return { ...entity, score: -1 };

      const score = this.cosineSimilarity(queryEmbedding, vector);
      return { ...entity, score };
    });

    return results.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  public async embedQuery(query: string): Promise<number[]> {
    try {
      const result = await ai.embed({
        embedder: EmbeddingEngine.EMBEDDING_MODEL,
        content: query,
      });

      // Genkit's Google AI plugin returns a structure that might be wrapped differently.
      // We check for standard embedding field or the nested embeddings array.
      if (Array.isArray(result) && result.length > 0 && result[0].embedding) {
        return result[0].embedding;
      }

      // Fallback for other possible response formats
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (result as any).embedding || [];
    } catch (e) {
      console.error(`Error embedding query "${query}":`, e);
      throw e;
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
