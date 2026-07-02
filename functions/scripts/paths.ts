import * as path from "path";

/**
 * Single source of truth for the data files the pipeline scripts operate on.
 * When a new game version ships, update DOCS_FILENAME here and rebuild
 * (pnpm build:index && pnpm verify:index && pnpm eval).
 */
export const DOCS_FILENAME = "Docs-en-US-UTF-8-1.2.json";

export const DOCS_PATH = path.resolve(import.meta.dirname, "..", DOCS_FILENAME);

export const INDEX_PATH = path.resolve(
  import.meta.dirname,
  "../game_data_index.json",
);
