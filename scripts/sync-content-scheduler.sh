#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
RUN_SCRIPT_PATH="${SCRIPT_DIR}/run-sync-content-job.sh"
LOG_FILE_PATH="${PROJECT_DIR}/logs/sync-content-scheduler.log"
CRON_MARKER="# WB_AUTOMATION_V2_SYNC_CONTENT"
DEFAULT_CRON_EXPRESSION="0 6 * * *"

usage() {
  cat <<EOF
Usage:
  scripts/sync-content-scheduler.sh start ["<cron-expression>"]
  scripts/sync-content-scheduler.sh stop
  scripts/sync-content-scheduler.sh status
  scripts/sync-content-scheduler.sh run

Examples:
  scripts/sync-content-scheduler.sh start
  scripts/sync-content-scheduler.sh start "30 2 * * *"
  scripts/sync-content-scheduler.sh stop
  scripts/sync-content-scheduler.sh status
  scripts/sync-content-scheduler.sh run

Notes:
  - start installs a crontab entry for the current OS user.
  - run executes one sync job immediately.
EOF
}

require_crontab() {
  if ! command -v crontab >/dev/null 2>&1; then
    echo "[sync-content-scheduler] crontab command is not available on this system." >&2
    exit 1
  fi
}

resolve_bun_bin() {
  local bun_bin

  if [[ -n "${BUN_BIN:-}" ]]; then
    bun_bin="${BUN_BIN}"
  else
    bun_bin="$(command -v bun || true)"
  fi

  if [[ -z "${bun_bin}" ]]; then
    echo "[sync-content-scheduler] bun binary not found. Set BUN_BIN or add bun to PATH." >&2
    exit 1
  fi

  if [[ ! -x "${bun_bin}" ]]; then
    echo "[sync-content-scheduler] bun path is not executable: ${bun_bin}" >&2
    exit 1
  fi

  echo "${bun_bin}"
}

get_existing_crontab() {
  crontab -l 2>/dev/null || true
}

strip_marker_lines() {
  grep -v "${CRON_MARKER}" || true
}

install_schedule() {
  require_crontab

  local cron_expression="${1:-${DEFAULT_CRON_EXPRESSION}}"
  local bun_bin
  bun_bin="$(resolve_bun_bin)"

  mkdir -p "${PROJECT_DIR}/logs"

  local entry
  entry="${cron_expression} BUN_BIN='${bun_bin}' bash '${RUN_SCRIPT_PATH}' >> '${LOG_FILE_PATH}' 2>&1 ${CRON_MARKER}"

  local existing
  existing="$(get_existing_crontab)"

  {
    printf "%s\n" "${existing}" | strip_marker_lines
    printf "%s\n" "${entry}"
  } | crontab -

  echo "[sync-content-scheduler] installed cron entry: ${cron_expression}"
  echo "[sync-content-scheduler] log file: ${LOG_FILE_PATH}"
}

remove_schedule() {
  require_crontab

  local existing
  existing="$(get_existing_crontab)"

  printf "%s\n" "${existing}" | strip_marker_lines | crontab -

  echo "[sync-content-scheduler] cron entry removed"
}

show_status() {
  require_crontab

  local existing
  existing="$(get_existing_crontab)"
  local line
  line="$(printf "%s\n" "${existing}" | grep "${CRON_MARKER}" || true)"

  if [[ -z "${line}" ]]; then
    echo "[sync-content-scheduler] status: stopped"
    echo "[sync-content-scheduler] no cron entry with marker ${CRON_MARKER}"
    return
  fi

  echo "[sync-content-scheduler] status: running"
  echo "[sync-content-scheduler] cron entry: ${line}"
  echo "[sync-content-scheduler] log file: ${LOG_FILE_PATH}"
}

run_now() {
  BUN_BIN="$(resolve_bun_bin)" bash "${RUN_SCRIPT_PATH}"
}

main() {
  local command="${1:-}"

  case "${command}" in
    start)
      install_schedule "${2:-}"
      ;;
    stop)
      remove_schedule
      ;;
    status)
      show_status
      ;;
    run)
      run_now
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
