#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ -n "${BUN_BIN:-}" ]]; then
  BUN_CMD="${BUN_BIN}"
else
  BUN_CMD="$(command -v bun || true)"
fi

if [[ -z "${BUN_CMD}" ]]; then
  echo "[run-wb-token-expiration-job] bun binary not found. Set BUN_BIN or add bun to PATH." >&2
  exit 1
fi

mkdir -p "${PROJECT_DIR}/logs"

cd "${PROJECT_DIR}"
"${BUN_CMD}" run "apps/backend/src/run-wb-token-expiration-job.ts"
