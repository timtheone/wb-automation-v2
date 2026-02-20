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

resolve_node_bin() {
  local node_bin

  if [[ -n "${NODE_BIN:-}" ]]; then
    node_bin="${NODE_BIN}"
  else
    node_bin="$(command -v node || true)"
  fi

  if [[ -z "${node_bin}" ]]; then
    echo "[sync-content-scheduler] node binary not found. Set NODE_BIN or add node to PATH." >&2
    exit 1
  fi

  if [[ ! -x "${node_bin}" ]]; then
    echo "[sync-content-scheduler] node path is not executable: ${node_bin}" >&2
    exit 1
  fi

  echo "${node_bin}"
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
  local node_bin
  node_bin="$(resolve_node_bin)"

  mkdir -p "${PROJECT_DIR}/logs"

  local entry
  entry="${cron_expression} NODE_BIN='${node_bin}' bash '${RUN_SCRIPT_PATH}' >> '${LOG_FILE_PATH}' 2>&1 ${CRON_MARKER}"

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
  NODE_BIN="$(resolve_node_bin)" bash "${RUN_SCRIPT_PATH}"
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
