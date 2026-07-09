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
- Genkit 1.39 (**`genkit/beta`** — Agents API) with `@genkit-ai/google-genai` plugin
- Model: `gemini-3-flash-preview` — Embedding: `googleai/gemini-embedding-001`
- Conversational agent (`definePromptAgent`, issue #18): server-managed sessions in
  Firestore (`FirestoreSessionStore`), served over the agent wire protocol by an
  Express app in an `onRequest` function (`adagentApi`); `submitFeedback` remains
  an `onCall` callable
- Node.js 22, TypeScript 6, ESM, pnpm

**Frontend (`web/`):**
- Nuxt 4.2 + Nuxt UI 4.2 (AI Chat components)
- Firebase SDK 12 + AI SDK Vue 2 (streaming)
- Tailwind CSS 4, Nuxt MDC 0.19 (markdown rendering)
- TypeScript 5.9, ESM, pnpm

**Infrastructure:**
- Firebase project: `ficsit-forge`
- Firebase Hosting → `web/.output/public` (Nuxt SSG)
- AppCheck enforced via Express middleware on all three agent routes
  (turn/getSnapshot/abort in `functions/src/app.ts`); bypassed only under the
  emulator (`FUNCTIONS_EMULATOR`/`GENKIT_ENV=dev`). Web sends the token in the
  `X-Firebase-AppCheck` header. Hosting rewrites `/api/**` → `adagentApi`
  (same-origin; local dev sets `NUXT_PUBLIC_AGENT_URL` to the emulator URL)
- GEMINI_API_KEY stored in Cloud Secret Manager
- Cloud Function memory: `1GiB` (required for ~73MB game data index)
- Firestore is **server-side only** (`turns`, `feedback`, `rateLimits`, and the
  agent-managed `genkit-sessions[-pointers|-shards]` collections;
  Admin SDK via `functions/src/firestore.ts`). Rules (deny-all for clients) + indexes
  live in `firestore.rules` / `firestore.indexes.json`, deployed with
  `firebase deploy --only firestore`. TTL on `rateLimits.expiresAt` is the one piece
  the Firebase CLI can't do — `scripts/provisionFirestore.sh` (idempotent gcloud)
- CI/CD (issue #8): GitHub Actions in `.github/workflows/` — `ci.yml` PR checks
  (`functions` + `web` jobs, required by main's branch protection), `eval.yml`
  path-filtered retrieval gate (needs `GEMINI_API_KEY` repo secret), `deploy.yml`
  deploys functions+hosting+firestore on push to main, `preview.yml` hosting
  preview channels on web PRs, `e2e.yml` live-model agent e2e on functions PRs
  (not required — model-dependent). GCP auth is WIF **with service-account
  impersonation** (pool `github`, provider `adagent-repo` scoped to this repo →
  impersonates `github-deployer@` SA holding least-privilege custom role
  `adagentDeployer`; no SA keys). Direct WIF does NOT work: firebase-tools
  crashes on external_account credentials ("reading 'access_token'")

## Commands

### Functions (from `functions/`)
```bash
pnpm dev                  # Watch mode (tsx)
pnpm genkit:dev           # Genkit dev UI + watch
pnpm genkit:emulate       # Genkit dev UI + Firebase emulator
pnpm build                # tsc + lint + format check
pnpm test                 # Vitest unit tests (parser, enricher, eval metrics)
pnpm e2e                  # Agent e2e vs Firestore emulator (needs GEMINI_API_KEY; 2 live Gemini calls)
pnpm build:index          # Generate game data embeddings → game_data_index.json
pnpm verify:index         # Validate generated embeddings index
pnpm verify:alternates    # Check EST_Alternate / hard-drive tagging invariants
pnpm eval                 # Layer-2 retrieval eval (Hit@K/MRR gate vs baseline)
pnpm mine:turns           # Triage production turns + feedback → eval candidates
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
3. The agent is `adagentAgent` in `functions/src/agent.ts` (wraps
   `prompts/adagent.prompt`); HTTP surface + guards live in `functions/src/app.ts`
4. Always run `pnpm build` before committing
5. Firebase predeploy runs format → lint → build automatically

## Upgrade Philosophy: Adoption-First

This project is deliberately a **learning vehicle**: chasing latest-and-greatest across
the stack (Genkit, Nuxt, Firebase, Gemini models, Node) is a project goal, not a risk.
Bias toward early adoption — treat new majors, previews, and betas as opportunities to
try, not churn to defer. The safety net is the test suite + retrieval eval gate + CI
(issue #8), not version conservatism. Breaking changes are accepted, planned effort.

## Resuming After Downtime (re-entry ritual)

Work here is sporadic — weeks can pass between sessions. When resuming:

1. `git fetch && git status` — check for unmerged Renovate PRs and open branches
2. Skim open issues labeled/titled as stack-watch digests (filed by the scheduled
   stack-watch agent: model deprecations, runtime EOLs, notable new features)
3. `pnpm outdated` in `functions/` and `web/` — anything Renovate hasn't automerged
   (majors) is a candidate to adopt now, per the philosophy above
4. Check whether a new Satisfactory data export exists; if so: bump `DOCS_FILENAME`
   in `functions/scripts/paths.ts` → `pnpm build:index` → `pnpm verify:index` →
   `pnpm eval`
5. **If `gemini-embedding-001` is ever deprecated/replaced:** switching embedding
   models requires a full index rebuild AND re-baselining the eval
   (`pnpm eval --update-baseline`) — treat it as a mini-project, not a version bump

## Data Pipeline (Game Data / RAG)

1. Source: versioned raw game data export — filename pinned in `functions/scripts/paths.ts` (`DOCS_FILENAME`, currently `Docs-en-US-UTF-8-1.2.json`)
2. Parse: `DataParser` in `functions/src/data/parser.ts` → `GameEntity[]`
3. Enrich: `enrichEntities` in `functions/src/data/enricher.ts` — cross-entity relationships (items ↔ recipes ↔ schematics ↔ buildings) appended to embedding text + metadata
4. Embed: `EmbeddingEngine` in `functions/src/data/embeddings.ts` (batch size 20, 200ms delay)
5. Index: `functions/game_data_index.json` (pre-computed embeddings, ~73MB)
6. Serve: `SearchService` lazy-loads index on first tool call; three tools (`searchGameData`, `searchRecipes`, `searchSchematics`) registered in `adagent.prompt`
7. Regenerate: `pnpm build:index`, then `pnpm verify:index` and `pnpm eval` (retrieval-quality gate against `eval/gold-set.json` + `eval/baseline-metrics.json`)

**New game version:** update `DOCS_FILENAME` in `functions/scripts/paths.ts`, then rebuild + verify + eval as above.

## Observability (issue #7) — three deliberate layers

1. **OTel traces/metrics** (`enableFirebaseTelemetry` → Cloud Trace/Monitoring):
   span-level fidelity for interactively debugging a single turn in the Genkit
   Monitoring console. The span schema is a Genkit internal — never write code
   that parses it.
2. **`turns` Firestore collection** (`TurnStore`, fed by
   `TurnRecordingSessionStore` in `functions/src/agentSessionStore.ts` — a
   decorator around the agent's session store that sees each turn exactly once
   at snapshot save): one self-contained record per turn — question, tool
   calls, top-K names + scores, answer (capped 4KB), sessionId. System of
   record for eval mining (`pnpm mine:turns` joins it with `feedback`); its
   schema is OURS and stays stable even when the beta agent snapshot format
   changes. Rate-limit blocks and aborted turns are deliberately NOT recorded.
3. **`adagent_turn` log line**: synchronous stdout — survives instance death;
   ops/alerting signal and fallback if the Firestore write fails.

## Active Work & Roadmap

**Decided sequence (2026-07-02): instrument → publish → build #6 from real traffic.**
Rationale: real player traffic is both the requirements document for Issue #6 (which
wiki content/aliases matter) and the observed-miss generator the saturated eval gold
set needs. Do NOT build #6 first in isolation.

1. **#7 Instrumentation** — DONE, merged (PR #12) and deployed to prod 2026-07-06
2. **Soft-launch** to a small player circle (beta framing) — UNBLOCKED, next up
3. **#6 Wiki RAG** built during the traffic-collection window, informed by it — parallel
   index + `searchWikiGuides` tool; the eval framework (`src/eval/metrics.ts`,
   gold-set schema) is source-agnostic and reusable; traffic-derived cases (e.g.
   gold-set `syn-03` "HOR") become its acceptance tests
4. **In parallel:** #8 CI/CD (PR checks + deploys from main — implemented, see
   Infrastructure above), #9 move the ~74MB
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

- **Agent wire protocol body is `{ data: <AgentInput>, init: { sessionId } }`** — GenkitChatTransport puts the sessionId in `init`, NOT in `data`. Middleware reading the body must look there (see `rateLimitGuard` in `app.ts`). Chat ids must be bare UUIDs (transport enforces it).
- **Genkit errors crash `util.inspect`** — Firebase's logger can't format complex Genkit/Google AI error objects. Sanitize to plain strings before logging in catch blocks.
- **Game data index requires 1GiB memory** — `game_data_index.json` (~73MB) is parsed via `JSON.parse` at runtime. Default 256MB Cloud Functions memory causes OOM.
- **Side-effect imports are required** — `import "./tools/gameDataTools.js"` in `agent.ts` registers tools with Genkit. Without it, `adagent.prompt` fails with "Unable to resolve tool".
- **Session snapshots live in subcollections** — `genkit-sessions/{prefix}/snapshots/{id}`; query with `collectionGroup("snapshots")`, a plain collection get returns nothing.
