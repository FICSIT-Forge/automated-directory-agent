# ADAgent — Automated Directory Agent

AI-powered chatbot for Satisfactory game players, embodying ADA's personality.

## Project Structure

```
automated-directory-agent/
├── functions/          # Firebase Cloud Functions backend (Genkit + Gemini)
├── web/                # Nuxt 4 frontend
├── firebase.json       # Firebase deployment configuration
└── .firebaserc         # Firebase project: ficsit-forge
```

## Tech Stack

**Backend (`functions/`):**
- Genkit 1.30+ with `@genkit-ai/google-genai` plugin
- Model: `gemini-3-flash-preview` — Embedding: `googleai/gemini-embedding-001`
- Firebase Cloud Functions 7 (`onCallGenkit` for streaming)
- Node.js 22, TypeScript 5.9, ESM, pnpm

**Frontend (`web/`):**
- Nuxt 4.2 + Nuxt UI 4.2 (AI Chat components)
- Firebase SDK 12 + AI SDK Vue 2 (streaming)
- Tailwind CSS 4, Nuxt MDC 0.19 (markdown rendering)
- TypeScript 5.9, ESM, pnpm

**Infrastructure:**
- Firebase project: `ficsit-forge`
- Firebase Hosting → `web/.output/public` (Nuxt SSG)
- AppCheck enforced on the `adagent` callable function
- GEMINI_API_KEY stored in Cloud Secret Manager
- Cloud Function memory: `1GiB` (required for ~73MB game data index)

## Commands

### Functions (from `functions/`)
```bash
pnpm dev                  # Watch mode (tsx)
pnpm genkit:dev           # Genkit dev UI + watch
pnpm genkit:emulate       # Genkit dev UI + Firebase emulator
pnpm build                # tsc + lint + format check
pnpm test                 # Vitest unit tests (parser, enricher, eval metrics)
pnpm build:index          # Generate game data embeddings → game_data_index.json
pnpm verify:index         # Validate generated embeddings index
pnpm verify:alternates    # Check EST_Alternate / hard-drive tagging invariants
pnpm eval                 # Layer-2 retrieval eval (Hit@K/MRR gate vs baseline)
pnpm deploy               # Deploy functions only
```

### Web (from `web/`)
```bash
pnpm dev                  # Nuxt dev server
pnpm build                # Prettier + ESLint + Nuxt SSG generate
pnpm deploy               # Deploy to Firebase Hosting (site: adagent)
```

## Development Workflow

1. Use `pnpm genkit:emulate` for local development (required for AppCheck bypass)
2. Prompt files live in `functions/prompts/` — edit `.prompt` files (Genkit dotprompt format)
3. The main flow is `adagentFlow` in `functions/src/index.ts`
4. Always run `pnpm build` before committing
5. Firebase predeploy runs format → lint → build automatically

## Data Pipeline (Game Data / RAG)

1. Source: versioned raw game data export — filename pinned in `functions/scripts/paths.ts` (`DOCS_FILENAME`, currently `Docs-en-US-UTF-8-1.2.json`)
2. Parse: `DataParser` in `functions/src/data/parser.ts` → `GameEntity[]`
3. Enrich: `enrichEntities` in `functions/src/data/enricher.ts` — cross-entity relationships (items ↔ recipes ↔ schematics ↔ buildings) appended to embedding text + metadata
4. Embed: `EmbeddingEngine` in `functions/src/data/embeddings.ts` (batch size 20, 200ms delay)
5. Index: `functions/game_data_index.json` (pre-computed embeddings, ~73MB)
6. Serve: `SearchService` lazy-loads index on first tool call; three tools (`searchGameData`, `searchRecipes`, `searchSchematics`) registered in `adagent.prompt`
7. Regenerate: `pnpm build:index`, then `pnpm verify:index` and `pnpm eval` (retrieval-quality gate against `eval/gold-set.json` + `eval/baseline-metrics.json`)

**New game version:** update `DOCS_FILENAME` in `functions/scripts/paths.ts`, then rebuild + verify + eval as above.

## Active Work & Roadmap

**Decided sequence (2026-07-02): instrument → publish → build #6 from real traffic.**
Rationale: real player traffic is both the requirements document for Issue #6 (which
wiki content/aliases matter) and the observed-miss generator the saturated eval gold
set needs. Do NOT build #6 first in isolation.

1. **#7 Instrumentation** (pre-publish prerequisite): Genkit telemetry, per-turn
   structured logs (question → tool calls → top-K + scores → answer), thumbs up/down
   in web UI, strategy-question guardrail in `adagent.prompt`, rate limiting
2. **Soft-launch** to a small player circle (beta framing) once #7 lands
3. **#6 Wiki RAG** built during the traffic-collection window, informed by it — parallel
   index + `searchWikiGuides` tool; the eval framework (`src/eval/metrics.ts`,
   gold-set schema) is source-agnostic and reusable; traffic-derived cases (e.g.
   gold-set `syn-03` "HOR") become its acceptance tests
4. **In parallel:** #8 CI/CD (PR checks + deploys from main), #9 move the ~74MB
   `game_data_index.json` out of git (history bloat per rebuild), #10 Layer-3
   LLM-judge answer-accuracy eval (where #6 acceptance tests and #7 thumbs-down
   triage converge)

**Issue #5** (this branch): DONE pending PR — agentic tools + cross-entity enrichment +
retrieval eval gate (`pnpm eval`, baseline n=34, Hit@5 1.0). Gold set grows via real
player queries (4 TODO slots open; `pnpm mine:reddit` or paste-and-label).

**Community-vocabulary gap (feeds #6):** queries only hit when full sentence context
compensates for terms absent from game data ("HOR", "water pump", "drill"). Wiki
aliases are the intended fix; see gold-set notes on syn-03/syn-04.

**Discord:** scraping violates ToS — the plan is ADA as a legitimate Discord bot
(second client of the same callable) once #7 + soft-launch prove the loop.

## Gotchas

- **Do NOT add `inputSchema`/`outputSchema` to `adagentFlow`** — `onCallGenkit` passes `req.data` (object from client) directly to the Genkit action. Schema validation runs before the flow function, and the client sends `{ question: "..." }` not a plain string.
- **Genkit errors crash `util.inspect`** — Firebase's logger can't format complex Genkit/Google AI error objects. Sanitize to plain strings before logging in catch blocks.
- **Game data index requires 1GiB memory** — `game_data_index.json` (~73MB) is parsed via `JSON.parse` at runtime. Default 256MB Cloud Functions memory causes OOM.
- **Side-effect imports are required** — `import "./tools/gameDataTools.js"` in `index.ts` registers tools with Genkit. Without it, `adagent.prompt` fails with "Unable to resolve tool".
