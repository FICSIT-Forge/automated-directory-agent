/**
 * Express app serving the ADAgent agent over the Genkit agent wire protocol
 * (issue #18): the turn endpoint plus its snapshot/abort companions, consumed
 * by GenkitChatTransport in the web client (via a Firebase Hosting rewrite of
 * /api/** to this function, so requests are same-origin in production).
 *
 * onCallGenkit's built-in protections are re-created here as middleware:
 *  - App Check: verifies the X-Firebase-AppCheck header on ALL agent routes.
 *    Snapshot IDs are conversation-scoped credentials — the snapshot and
 *    abort endpoints get the same guard as the turn endpoint.
 *  - Rate limiting: fixed-window per-session + global caps (issue #7),
 *    rejected before the agent runs so blocks never become turn records.
 */

import { expressHandler } from "@genkit-ai/express";
import cors from "cors";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import { getAppCheck } from "firebase-admin/app-check";
import * as logger from "firebase-functions/logger";
import { adagentAgent } from "./agent.js";
import { getDb } from "./firestore.js";
import { RateLimiter } from "./rateLimiter.js";

const rateLimiter = new RateLimiter(getDb());

/** True under `pnpm genkit:emulate` / the Functions emulator, where client
 * App Check tokens are not obtainable. Production sets neither variable. */
function isLocalDev(): boolean {
  return (
    process.env.FUNCTIONS_EMULATOR === "true" ||
    process.env.GENKIT_ENV === "dev"
  );
}

async function appCheckGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (isLocalDev()) {
    next();
    return;
  }
  const token = req.header("X-Firebase-AppCheck");
  if (!token) {
    res.status(401).json({
      error: { status: "UNAUTHENTICATED", message: "App Check token missing" },
    });
    return;
  }
  try {
    await getAppCheck().verifyToken(token);
    next();
  } catch (e) {
    // Genkit/Google error objects can crash util.inspect — strings only.
    logger.warn("adagent_appcheck_rejected", {
      reason: e instanceof Error ? e.message : String(e),
    });
    res.status(401).json({
      error: { status: "UNAUTHENTICATED", message: "App Check token invalid" },
    });
  }
}

async function rateLimitGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Wire shape (genkit client protocol): { data: <AgentInput>, init? }.
  // GenkitChatTransport puts the chat's sessionId in init.
  const body = req.body as
    | { init?: { sessionId?: unknown }; data?: { sessionId?: unknown } }
    | undefined;
  const raw = body?.init?.sessionId ?? body?.data?.sessionId;
  const sessionId = typeof raw === "string" ? raw : undefined;
  const rate = await rateLimiter.check(sessionId);
  if (rate.allowed) {
    next();
    return;
  }
  // Deliberately NOT recorded as a turn — no retrieval signal in a block.
  logger.warn("adagent_rate_limited", {
    blockedBy: rate.blockedBy,
    retryAfterSecs: rate.retryAfterSecs,
    sessionId,
  });
  res
    .status(429)
    .set("Retry-After", String(rate.retryAfterSecs ?? 3600))
    .json({
      error: {
        status: "RESOURCE_EXHAUSTED",
        message:
          "FICSIT compliance notice: this terminal has exceeded its allotted " +
          "inquiry quota. Productivity is appreciated — please resume " +
          `in ${Math.ceil((rate.retryAfterSecs ?? 3600) / 60)} minutes.`,
      },
    });
}

export const app = express();
// CORS is not a security boundary here — App Check is. Reflecting the origin
// keeps local dev (Nuxt on :3000 → emulator) and direct function URLs working.
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use("/api/adagent", appCheckGuard);

app.post("/api/adagent", rateLimitGuard, expressHandler(adagentAgent));
app.post(
  "/api/adagent/getSnapshot",
  expressHandler(adagentAgent.getSnapshotDataAction),
);
app.post("/api/adagent/abort", expressHandler(adagentAgent.abortAgentAction));
