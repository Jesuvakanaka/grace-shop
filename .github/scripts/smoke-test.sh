#!/usr/bin/env bash
# Post-deploy smoke test (ZP-470), used by deploy-uat.yml.
# Usage: smoke-test.sh <base-url> <label>
#   GET <url>/api/health            must return 200 (retried: cold start)
#   GET <url>/api/dashboard (no cookie) must return 401
set -euo pipefail

URL="${1:?usage: smoke-test.sh <base-url> <label>}"
LABEL="${2:-service}"
URL="${URL%/}"

echo "Smoke-testing ${LABEL}: ${URL}"

HEALTH=""
for attempt in $(seq 1 10); do
  HEALTH="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 "${URL}/api/health" || true)"
  [[ "${HEALTH}" == "200" ]] && break
  echo "  GET /api/health -> ${HEALTH} (attempt ${attempt}/10), retrying..."
  sleep 6
done
if [[ "${HEALTH}" != "200" ]]; then
  echo "::error::[${LABEL}] GET ${URL}/api/health returned ${HEALTH}, expected 200" >&2
  exit 1
fi
echo "  GET /api/health -> 200"

DASH="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 "${URL}/api/dashboard" || true)"
if [[ "${DASH}" != "401" ]]; then
  echo "::error::[${LABEL}] GET ${URL}/api/dashboard without a cookie returned ${DASH}, expected 401" >&2
  exit 1
fi
echo "  GET /api/dashboard (no cookie) -> 401"
