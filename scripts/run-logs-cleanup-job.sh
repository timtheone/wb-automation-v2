#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOGS_DIR="${PROJECT_DIR}/logs"
RETENTION_DAYS="${LOG_RETENTION_DAYS:-30}"

if ! [[ "${RETENTION_DAYS}" =~ ^[0-9]+$ ]] || [[ "${RETENTION_DAYS}" -lt 1 ]]; then
  echo "[run-logs-cleanup-job] LOG_RETENTION_DAYS must be a positive integer" >&2
  exit 1
fi

mkdir -p "${LOGS_DIR}"

echo "[run-logs-cleanup-job] started (logsDir=${LOGS_DIR}, retentionDays=${RETENTION_DAYS})"

deleted_count="$({ find "${LOGS_DIR}" -mindepth 1 -type f -mtime +"${RETENTION_DAYS}" -print -delete || true; } | wc -l | tr -d ' ')"

echo "[run-logs-cleanup-job] completed (deletedFiles=${deleted_count})"
