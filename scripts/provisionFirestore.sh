#!/usr/bin/env bash
# Idempotent Firestore provisioning for ficsit-forge (issue #7).
#
# Uses the Firebase CLI wherever possible (same tool + credential CI/CD
# already needs for deploys); gcloud only for the TTL policy, which the
# Firebase CLI cannot manage.
#
#   1. Database creation — edition and location are FIXED at creation time.
#      Decision (2026-07-05): Standard edition, us-central1 (colocated with
#      the Cloud Functions), (default) database so the free tier applies.
#      TTL-delete cost in Standard is bounded by the rate limiter's global
#      daily cap: ~30K deletes/month worst case ≈ $0.003, within free tier.
#   2. TTL policy that garbage-collects stale rate-limit window docs.
#      RateLimiter stamps each rateLimits doc with `expiresAt` (window end
#      + 1 day slack); this enables server-side TTL deletion on that field.
#
# Declarative pieces (security rules, composite indexes) live in
# firestore.rules / firestore.indexes.json and deploy separately with:
#   firebase deploy --only firestore
#
# Requirements: firebase CLI + gcloud authenticated on the project.
# Safe to re-run.

set -euo pipefail

PROJECT="ficsit-forge"
LOCATION="us-central1"
EDITION="standard"

if firebase firestore:databases:list --project="${PROJECT}" 2> /dev/null \
  | grep -q "(default)"; then
  echo "Database (default) already exists in ${PROJECT} — skipping creation."
else
  echo "Creating (default) Firestore database (${EDITION}, ${LOCATION})..."
  firebase firestore:databases:create "(default)" \
    --project="${PROJECT}" \
    --location="${LOCATION}" \
    --edition="${EDITION}" \
    --delete-protection=ENABLED
fi

echo "Enabling TTL on rateLimits.expiresAt in ${PROJECT}..."
gcloud firestore fields ttls update expiresAt \
  --collection-group=rateLimits \
  --enable-ttl \
  --project="${PROJECT}"

echo "Done. Verify with:"
echo "  firebase firestore:databases:list --project=${PROJECT}"
echo "  gcloud firestore fields ttls list --project=${PROJECT}"
echo "Then deploy rules + indexes:"
echo "  firebase deploy --only firestore"
