/**
 * Single place that initializes firebase-admin and hands out Firestore.
 * Everything server-side (rate limiter, turn store, feedback) goes through
 * here so init happens exactly once per instance.
 */

import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

export function getDb(): Firestore {
  if (!getApps().length) initializeApp();
  return getFirestore();
}
