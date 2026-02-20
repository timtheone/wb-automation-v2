#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ -n "${NODE_BIN:-}" ]]; then
  NODE_CMD="${NODE_BIN}"
else
  NODE_CMD="$(command -v node || true)"
fi

if [[ -z "${NODE_CMD}" ]]; then
  echo "[run-wb-token-expiration-job] node binary not found. Set NODE_BIN or add node to PATH." >&2
  exit 1
fi

mkdir -p "${PROJECT_DIR}/logs"

cd "${PROJECT_DIR}"
"${NODE_CMD}" "apps/backend/dist/run-wb-token-expiration-job.js"
