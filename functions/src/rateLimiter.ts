/**
 * Fixed-window rate limiting backed by Firestore (issue #7).
 *
 * Two windows guard the Gemini spend behind the public beta:
 *  - per-session hourly limit (sessionId is client-supplied and spoofable,
 *    but AppCheck already gates requests to the real web app — the threat
 *    model is an enthusiastic player, not an attacker)
 *  - global daily cap: a hard cost backstop across all users
 *
 * The decision math is pure (see decide) and unit-tested; Firestore I/O is a
 * thin transaction around it (RateLimiter, also unit-tested via an injected
 * fake). Any infrastructure error FAILS OPEN: for a beta, availability beats
 * strict limiting, and the global cap still bounds a full outage of the
 * limiter at one day of spend.
 *
 * Window docs carry an `expiresAt` timestamp so a Firestore TTL policy can
 * garbage-collect stale session docs — see scripts/provisionFirestore.sh.
 */

import type { Firestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";

// ─── Pure decision logic ────────────────────────────────────────────────────

export interface WindowSpec {
  /** Shown in logs and block reasons. */
  readonly name: string;
  /** Firestore doc id under rateLimits/. */
  readonly docId: string;
  readonly limit: number;
  readonly windowSecs: number;
}

export interface WindowState {
  readonly windowId?: number;
  readonly count?: number;
}

export interface RateDecision {
  readonly allowed: boolean;
  readonly blockedBy?: string;
  readonly retryAfterSecs?: number;
  /** New states to persist (only when allowed). */
  readonly updates: ReadonlyMap<string, Required<WindowState>>;
}

export function currentWindowId(nowMs: number, windowSecs: number): number {
  return Math.floor(nowMs / 1000 / windowSecs);
}

/**
 * Evaluates all windows against their stored states. Blocked requests are not
 * counted (no updates), so a blocked client's retries don't extend the block.
 */
export function decide(
  nowMs: number,
  specs: readonly WindowSpec[],
  states: ReadonlyMap<string, WindowState>,
): RateDecision {
  const updates = new Map<string, Required<WindowState>>();

  for (const spec of specs) {
    const windowId = currentWindowId(nowMs, spec.windowSecs);
    const state = states.get(spec.docId);
    const count = state?.windowId === windowId ? (state.count ?? 0) : 0;

    if (count + 1 > spec.limit) {
      const windowEndSecs = (windowId + 1) * spec.windowSecs;
      return {
        allowed: false,
        blockedBy: spec.name,
        retryAfterSecs: Math.max(1, Math.ceil(windowEndSecs - nowMs / 1000)),
        updates: new Map(),
      };
    }
    updates.set(spec.docId, { windowId, count: count + 1 });
  }

  return { allowed: true, updates };
}

// ─── Firestore-backed limiter ───────────────────────────────────────────────

export interface RateLimits {
  readonly sessionPerHour: number;
  readonly globalPerDay: number;
}

export function limitsFromEnv(): RateLimits {
  return {
    sessionPerHour: Number(process.env.RATE_LIMIT_SESSION_PER_HOUR) || 30,
    globalPerDay: Number(process.env.RATE_LIMIT_GLOBAL_PER_DAY) || 1000,
  };
}

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly blockedBy?: string;
  readonly retryAfterSecs?: number;
}

/** Grace period past window end before TTL may delete a window doc. */
const EXPIRY_SLACK_SECS = 24 * 60 * 60;

export class RateLimiter {
  constructor(
    private readonly db: Firestore,
    private readonly limits: RateLimits = limitsFromEnv(),
    private readonly now: () => number = Date.now,
  ) {}

  private specsFor(sessionId: string | undefined): WindowSpec[] {
    const specs: WindowSpec[] = [
      {
        name: "global daily cap",
        docId: "global",
        limit: this.limits.globalPerDay,
        windowSecs: 24 * 60 * 60,
      },
    ];
    if (sessionId) {
      specs.push({
        name: "session hourly limit",
        docId: `session:${sessionId}`,
        limit: this.limits.sessionPerHour,
        windowSecs: 60 * 60,
      });
    }
    return specs;
  }

  async check(sessionId: string | undefined): Promise<RateLimitResult> {
    const specs = this.specsFor(sessionId);
    try {
      const col = this.db.collection("rateLimits");

      return await this.db.runTransaction(async (tx) => {
        const states = new Map<string, WindowState>();
        for (const spec of specs) {
          const snap = await tx.get(col.doc(spec.docId));
          if (snap.exists) states.set(spec.docId, snap.data() as WindowState);
        }

        const decision = decide(this.now(), specs, states);
        if (decision.allowed) {
          for (const spec of specs) {
            const state = decision.updates.get(spec.docId);
            if (!state) continue;
            const windowEndSecs = (state.windowId + 1) * spec.windowSecs;
            tx.set(col.doc(spec.docId), {
              ...state,
              expiresAt: new Date((windowEndSecs + EXPIRY_SLACK_SECS) * 1000),
            });
          }
        }
        return decision;
      });
    } catch (e) {
      // Fail open: never turn a limiter outage into an agent outage.
      logger.warn("rate_limiter_unavailable", {
        reason: e instanceof Error ? e.message : String(e),
      });
      return { allowed: true };
    }
  }
}
