import { UserFacingError } from "genkit";

const MAX_QUESTION_CHARS = 2000;

export interface TurnRequest {
  readonly question: string;
  readonly sessionId?: string;
}

/**
 * Normalizes the callable payload into a turn request.
 *
 * onCallGenkit passes the client's `req.data` straight through, so `input` is
 * whatever the client sent: the web client sends `{ question, sessionId? }`;
 * a bare string is also accepted for direct flow invocation (Genkit dev UI,
 * scripts). Anything else is rejected.
 *
 * This unwrapping is load-bearing: passing the raw object into the prompt
 * renders as "[object Object]" (dotprompt/handlebars stringifies it) — the
 * model never sees the actual question.
 */
export function parseTurnRequest(input: unknown): TurnRequest {
  let question: unknown;
  let sessionId: unknown;

  if (typeof input === "string") {
    question = input;
  } else if (input !== null && typeof input === "object") {
    question = (input as Record<string, unknown>).question;
    sessionId = (input as Record<string, unknown>).sessionId;
  }

  if (typeof question !== "string" || question.trim().length === 0) {
    throw new UserFacingError(
      "INVALID_ARGUMENT",
      "Expected { question: string } in the request payload.",
    );
  }
  if (question.length > MAX_QUESTION_CHARS) {
    throw new UserFacingError(
      "INVALID_ARGUMENT",
      `Question exceeds ${MAX_QUESTION_CHARS} characters.`,
    );
  }

  return {
    question: question.trim(),
    sessionId:
      typeof sessionId === "string" && sessionId.length > 0
        ? sessionId.slice(0, 128)
        : undefined,
  };
}
