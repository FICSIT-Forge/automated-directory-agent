<genkit_prompts hash="5b57dd6d">

<!-- Genkit Context - Auto-generated, do not edit -->

Genkit Framework Instructions:

- @./GENKIT.md

</genkit_prompts>

# Functions — Backend Context

See root `.claude/CLAUDE.md` for project overview, commands, and tech stack.

## Data Pipeline Details

- Source data: raw Satisfactory game data export; the active version is pinned in `scripts/paths.ts` (`DOCS_FILENAME`, currently `Docs-en-US-UTF-8-1.2.json`)
- `DataParser` filters by NativeClass patterns: `FGItemDescriptor`, `FGBuildable`, `FGRecipe`, etc.
- `EmbeddingEngine` uses `googleai/gemini-embedding-001`; batch size 20, 200ms delay between batches
- `SearchService` is a singleton — lazy-loads `game_data_index.json` on first tool invocation, not at cold start
- Tools are registered via side-effect import (`import "./tools/gameDataTools.js"`) and referenced by name in `prompts/adagent.prompt`
