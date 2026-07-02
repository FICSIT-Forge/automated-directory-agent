# ADAgent — Automated Directory Agent

AI-powered chatbot for Satisfactory game players, embodying ADA's (Automated Directory & Assistant) sarcastic yet helpful personality.

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
- Genkit 1.27.0 with `@genkit-ai/google-genai` plugin
- Model: `gemini-3-flash-preview` (via `googleAI.model()`)
- Embedding model: `googleai/gemini-embedding-001`
- Firebase Cloud Functions 7 (`onCallGenkit` for streaming)
- Firebase Admin SDK 13
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

## Key Commands

### Functions (from `functions/`)
```bash
pnpm dev                  # Watch mode (tsx)
pnpm genkit:dev           # Genkit dev UI + watch
pnpm genkit:emulate       # Genkit dev UI + Firebase emulator
pnpm build                # tsc + lint + format check
pnpm build:index          # Generate game data embeddings → game_data_index.json
pnpm verify:index         # Validate generated embeddings index
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
4. AppCheck is enforced — for direct API testing, use the Firebase emulator

## Deployment

Firebase predeploy steps (auto-run on `firebase deploy`):
1. `pnpm format` — Prettier
2. `pnpm lint` — ESLint
3. `pnpm build` — TypeScript compile

Always run `pnpm build` and tests before committing.

## Data Pipeline (Game Data / RAG)

Game data from Satisfactory is used to reduce hallucinations (see Issue #5):
1. Source: `functions/Docs-en-US.json` (raw game data, ~9.6MB)
2. Parse: `DataParser` in `functions/src/data/parser.ts` → `GameEntity[]` (items, buildings, recipes)
3. Embed: `EmbeddingEngine` in `functions/src/data/embeddings.ts` → cosine similarity search
4. Index: `functions/game_data_index.json` (pre-computed embeddings)
5. Script: `pnpm build:index` to regenerate; `pnpm verify:index` to validate

**Status:** Index is generated but RAG is NOT yet wired into `adagentFlow` (Issue #5 in design phase).

## Active Feature Branch

**Branch:** `5-reduce-ai-agent-hallucinations-with-game-data`
**Issue #5:** Implement RAG using game data to reduce hallucinations — currently in **exploration/design phase only**. Do not implement until explicitly instructed.

## Key Source Files

| File | Purpose |
|------|---------|
| `functions/src/index.ts` | Main Genkit flow (`adagentFlow`) + Firebase callable export |
| `functions/src/genkit.ts` | Genkit + Google GenAI plugin initialization |
| `functions/src/data/parser.ts` | Parses game JSON → `GameEntity[]` |
| `functions/src/data/embeddings.ts` | `EmbeddingEngine`: generate embeddings + cosine similarity search |
| `functions/prompts/adagent.prompt` | Main prompt template (Genkit dotprompt) |
| `functions/prompts/_personality.prompt` | ADA personality system prompt |
| `functions/scripts/buildIndex.ts` | Offline script to build embeddings index |
| `web/app/utils/firebase-chat-transport.ts` | Custom `ChatTransport` wrapping Firebase callable |
| `web/app/pages/chat/[id].vue` | Chat page with streaming message display |
