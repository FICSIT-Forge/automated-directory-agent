/**
 * Firebase client bootstrap shared by the chat transport and the feedback
 * callable. The config comes from Firebase Hosting's reserved
 * /__/firebase/init.json, so no keys live in the bundle.
 *
 * App Check tokens are attached to agent requests as the X-Firebase-AppCheck
 * header (verified by Express middleware server-side — the agent endpoint is
 * an HTTP function, not a callable, so the SDK doesn't do this for us).
 *
 * GOTCHA: GenkitChatTransport calls its `headers` function WITHOUT awaiting
 * it (client.js resolveHeaders, @genkit-ai/vercel-ai 0.2.0), so it must be
 * synchronous — an async function's Promise spreads to an empty object and
 * the header silently disappears. We therefore keep the current token in a
 * module variable via onTokenChanged (primed once at init; the SDK
 * auto-refreshes it) and read it synchronously per request.
 */

import { initializeApp } from "firebase/app";
import {
  getToken,
  initializeAppCheck,
  onTokenChanged,
  ReCaptchaEnterpriseProvider,
} from "firebase/app-check";

let currentToken: string | undefined;
let initialized = false;

export async function initFirebase(recaptchaSiteKey?: string): Promise<void> {
  if (initialized) return;
  const response = await fetch("/__/firebase/init.json");
  if (!response.ok) {
    console.warn("Could not load Firebase init.json — running unconfigured.");
    return;
  }
  // Creates the default app, which getFunctions() (feedback) relies on too.
  const app = initializeApp(await response.json());
  if (recaptchaSiteKey) {
    const appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(recaptchaSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
    onTokenChanged(appCheck, (result) => {
      currentToken = result.token;
    });
    // Prime the first token before the initial prompt goes out.
    try {
      currentToken = (await getToken(appCheck)).token;
    } catch (e) {
      console.error("App Check token fetch failed:", e);
    }
  }
  initialized = true;
}

/** Synchronous per-request headers for the agent endpoints — see GOTCHA
 * above. Empty when App Check is not configured (local dev — the emulator
 * server skips verification). */
export function appCheckHeaders(): Record<string, string> {
  return currentToken ? { "X-Firebase-AppCheck": currentToken } : {};
}
