#!/usr/bin/env bash

set -euo pipefail

SCHEDULER_NAME="${SCHEDULER_NAME:-cron-scheduler}"
SCHEDULER_TZ="${SCHEDULER_TZ:-Europe/Berlin}"
CRON_EXPRESSION="${CRON_EXPRESSION:-}"
JOB_COMMAND="${JOB_COMMAND:-}"

if [[ -z "${CRON_EXPRESSION}" ]]; then
  echo "[${SCHEDULER_NAME}] CRON_EXPRESSION is required" >&2
  exit 1
fi

if [[ -z "${JOB_COMMAND}" ]]; then
  echo "[${SCHEDULER_NAME}] JOB_COMMAND is required" >&2
  exit 1
fi

if [[ ! -x "/usr/local/bin/supercronic" ]]; then
  echo "[${SCHEDULER_NAME}] supercronic binary was not found" >&2
  exit 1
fi

CRON_FILE_PATH="$(mktemp)"
trap 'rm -f "${CRON_FILE_PATH}"' EXIT

printf "CRON_TZ=%s\n%s %s\n" "${SCHEDULER_TZ}" "${CRON_EXPRESSION}" "${JOB_COMMAND}" > "${CRON_FILE_PATH}"

echo "[${SCHEDULER_NAME}] timezone: ${SCHEDULER_TZ}"
echo "[${SCHEDULER_NAME}] schedule: ${CRON_EXPRESSION}"
echo "[${SCHEDULER_NAME}] command: ${JOB_COMMAND}"

exec /usr/local/bin/supercronic -passthrough-logs "${CRON_FILE_PATH}"
