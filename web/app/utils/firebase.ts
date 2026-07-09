/**
 * Firebase client bootstrap shared by the chat transport and the feedback
 * callable. The config comes from Firebase Hosting's reserved
 * /__/firebase/init.json, so no keys live in the bundle.
 *
 * App Check tokens are attached to agent requests as the X-Firebase-AppCheck
 * header (verified by Express middleware server-side — the agent endpoint is
 * an HTTP function, not a callable, so the SDK doesn't do this for us).
 */

import { initializeApp } from "firebase/app";
import {
  getToken,
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from "firebase/app-check";

let appCheck: AppCheck | undefined;
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
    appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(recaptchaSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  }
  initialized = true;
}

/** Per-request headers for the agent endpoints. Empty when App Check is not
 * configured (local dev — the emulator server skips verification). */
export async function appCheckHeaders(): Promise<Record<string, string>> {
  if (!appCheck) return {};
  const { token } = await getToken(appCheck);
  return { "X-Firebase-AppCheck": token };
}
