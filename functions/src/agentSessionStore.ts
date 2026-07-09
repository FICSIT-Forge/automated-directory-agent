/**
 * Session-store decorator that feeds the `turns` collection (issue #18).
 *
 * The agent runtime persists a snapshot at the end of every turn through its
 * SessionStore. Wrapping the store is the one place that sees each turn
 * exactly once, with the full message history and terminal status — without
 * parsing any Genkit-internal wire format beyond the documented
 * SessionSnapshot shape. TurnStore keeps its own stable schema so eval mining
 * (scripts/mineTurns.ts) stays decoupled from the beta agent internals.
 *
 * Turn boundaries are derived by message count: the count last seen for a
 * session (at load, or after the previous recorded turn) marks where the new
 * turn's messages begin. Aborted turns are deliberately not recorded — like
 * rate-limit blocks, a player cancelling mid-answer carries no retrieval
 * signal.
 */

import * as logger from "firebase-functions/logger";
import type { MessageData } from "genkit";
import type {
  SessionSnapshot,
  SessionSnapshotInput,
  SessionStore,
  SessionStoreOptions,
  SnapshotMutator,
} from "genkit/beta";

/** Not re-exported from genkit/beta — derive it from the interface. */
type GetSnapshotOptions = Parameters<SessionStore["getSnapshot"]>[0];
import type { TurnStore } from "./turnStore.js";
import { summarizeToolActivity } from "./turnStore.js";

function textOf(message: MessageData): string {
  return message.content
    .map((part) => ("text" in part && part.text ? part.text : ""))
    .join("");
}

export class TurnRecordingSessionStore<S = unknown> implements SessionStore<S> {
  /** Message count already persisted per session — the turn boundary. */
  private readonly knownMessageCount = new Map<string, number>();
  /** Turn start per session, stamped when the session is loaded. */
  private readonly turnStartedAt = new Map<string, number>();

  constructor(
    private readonly inner: SessionStore<S>,
    private readonly turnStore: TurnStore,
    private readonly now: () => number = Date.now,
  ) {}

  async getSnapshot(
    opts: GetSnapshotOptions,
  ): Promise<SessionSnapshot<S> | undefined> {
    const snapshot = await this.inner.getSnapshot(opts);
    const sessionId = snapshot?.sessionId ?? opts.sessionId;
    if (sessionId) {
      this.knownMessageCount.set(
        sessionId,
        snapshot?.state?.messages?.length ?? 0,
      );
      this.turnStartedAt.set(sessionId, this.now());
    }
    return snapshot;
  }

  async saveSnapshot(
    snapshotId: string | undefined,
    mutator: SnapshotMutator<S>,
    options?: SessionStoreOptions,
  ): Promise<string | null> {
    let persisted: SessionSnapshotInput<S> | null = null;
    const savedId = await this.inner.saveSnapshot(
      snapshotId,
      (current) => {
        persisted = mutator(current);
        return persisted;
      },
      options,
    );
    if (savedId !== null && persisted !== null) {
      // record() and everything here must never break the save path.
      try {
        this.observe(persisted);
      } catch (e) {
        logger.warn("turn_recording_failed", {
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return savedId;
  }

  onSnapshotStateChange(
    snapshotId: string,
    callback: (snapshot: SessionSnapshot<S>) => void,
    options?: SessionStoreOptions,
  ): void | (() => void) {
    return this.inner.onSnapshotStateChange?.(snapshotId, callback, options);
  }

  private observe(snapshot: SessionSnapshotInput<S>): void {
    if (snapshot.status !== "completed" && snapshot.status !== "failed") {
      return;
    }
    const sessionId = snapshot.sessionId ?? snapshot.state?.sessionId;
    const messages = snapshot.state?.messages ?? [];
    const from = sessionId ? (this.knownMessageCount.get(sessionId) ?? 0) : 0;
    const turnMessages = messages.slice(from);
    if (sessionId) {
      this.knownMessageCount.set(sessionId, messages.length);
    }

    const question = turnMessages
      .filter((m) => m.role === "user")
      .map(textOf)
      .find((t) => t.length > 0);
    const modelMessages = turnMessages.filter((m) => m.role === "model");
    const answer = textOf(
      modelMessages[modelMessages.length - 1] ?? {
        role: "model",
        content: [],
      },
    );
    const startedAt = sessionId ? this.turnStartedAt.get(sessionId) : undefined;
    const latencyMs = startedAt ? this.now() - startedAt : 0;
    const toolCalls = summarizeToolActivity(turnMessages);
    const error = snapshot.error?.message;

    // Layer-3 observability: synchronous stdout line that survives instance
    // death even if the Firestore write below is lost.
    logger.info(error ? "adagent_turn_error" : "adagent_turn", {
      question: question ?? "",
      sessionId,
      toolCalls: toolCalls.map(({ tool, input }) => ({ tool, input })),
      answerChars: answer.length,
      latencyMs,
      ...(error ? { error } : {}),
    });

    // Fire-and-forget by contract (record() never throws); not awaited so a
    // slow turns-write cannot delay the snapshot save the runtime waits on.
    void this.turnStore.record({
      question: question ?? "",
      sessionId,
      toolCalls,
      answer: error ? undefined : answer,
      latencyMs,
      ...(error ? { error } : {}),
    });
  }
}
