<genkit_prompts hash="5b57dd6d">

<!-- Genkit Context - Auto-generated, do not edit -->

Genkit Framework Instructions:

- @./GENKIT.md

</genkit_prompts>

# Functions — Backend Context

Firebase Cloud Functions backend for ADAgent. See the root `.claude/CLAUDE.md` for full project context.

## Key Source Files

| File                          | Purpose                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| `src/index.ts`                | `adagentFlow` (Genkit flow) + `adagent` Firebase callable export                     |
| `src/genkit.ts`               | Genkit init with Google GenAI plugin, Gemini 3 Flash model                           |
| `src/data/parser.ts`          | `DataParser` — parses game JSON into `GameEntity[]` (items, buildings, recipes)      |
| `src/data/embeddings.ts`      | `EmbeddingEngine` — batch embedding generation + cosine similarity search            |
| `prompts/adagent.prompt`      | Main dotprompt template; input schema: `{ question: string }`                        |
| `prompts/_personality.prompt` | ADA personality system prompt (sarcastic, Satisfactory-focused)                      |
| `scripts/buildIndex.ts`       | Offline script: parse game data → generate embeddings → write `game_data_index.json` |
| `scripts/verifyIndex.ts`      | Validate the generated embeddings index                                              |

## Commands

```bash
pnpm dev                # Watch mode (tsx)
pnpm genkit:dev         # Genkit dev UI + watch
pnpm genkit:emulate     # Genkit dev UI + Firebase emulator (needed for AppCheck)
pnpm build              # tsc + lint + format check
pnpm build:index        # Generate/refresh game_data_index.json
pnpm verify:index       # Validate game_data_index.json
pnpm deploy             # Deploy this function only
```

## Data Pipeline Notes

- `Docs-en-US.json` (~9.6MB) is the raw Satisfactory game data source
- `DataParser` filters by NativeClass patterns: `FGItemDescriptor`, `FGBuildable`, `FGRecipe`, etc.
- `EmbeddingEngine` uses `googleai/gemini-embedding-001`; batch size=1, 1s delay between items
- Pre-generated index is at `game_data_index.json` — re-run `pnpm build:index` after game data updates

## Issue #5 — RAG (Design Phase Only)

`EmbeddingEngine` and `DataParser` are built and the index is generated. The next step (NOT yet implemented) is:

- Load `game_data_index.json` at cold start
- Embed the user query with `embedQuery()`
- Call `search()` to retrieve top-K relevant game entities
- Inject retrieved context into the `adagent.prompt` before generation
