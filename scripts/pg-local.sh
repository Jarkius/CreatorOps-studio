#!/usr/bin/env bash
# Run a local PostgreSQL 16 server without Docker.
#
# Usage: scripts/pg-local.sh {start|stop|status|reset|url}
#
#   start   initialize the data dir if empty, start the server, create the DB
#   stop    stop the server (no error if already stopped)
#   status  print running/stopped; exit 0 if running, 1 if stopped
#   reset   stop the server and delete the data dir and log
#   url     print the DATABASE_URL (the only command that prints the password)
#
# Environment overrides:
#   PG_LOCAL_DIR       data dir          (default: <repo>/.data/pg)
#   PG_LOCAL_PORT      TCP port          (default: 5432)
#   PG_LOCAL_PASSWORD  superuser password (default: change-me, a local-dev placeholder)
#
# Server log: <data dir parent>/pg.log (default: .data/pg.log).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

PG_USER_NAME="creatorops"
PG_DB_NAME="creatorops"
PG_PASSWORD="${PG_LOCAL_PASSWORD:-change-me}"
PG_PORT="${PG_LOCAL_PORT:-5432}"
DATA_DIR="${PG_LOCAL_DIR:-$REPO_ROOT/.data/pg}"
DATA_PARENT="$(dirname "$DATA_DIR")"
LOG_FILE="$DATA_PARENT/pg.log"
SOCKET_DIR="/tmp"
SERVER_USER="pgdev"

# PostgreSQL refuses to run as root, so server commands run as $SERVER_USER.
if [[ "${EUID}" -eq 0 ]]; then IS_ROOT=1; else IS_ROOT=0; fi

die() {
  echo "pg-local: $*" >&2
  exit 1
}

log() {
  echo "pg-local: $*"
}

find_bin_dir() {
  local dir=""
  if command -v pg_config >/dev/null 2>&1; then
    dir="$(pg_config --bindir 2>/dev/null || true)"
  fi
  if [[ -z "$dir" || ! -x "$dir/pg_ctl" ]]; then
    dir="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -n 1 || true)"
  fi
  if [[ -z "$dir" || ! -x "$dir/initdb" || ! -x "$dir/pg_ctl" ]]; then
    die "PostgreSQL server binaries not found (install postgresql-16 or make pg_config available)"
  fi
  printf '%s' "$dir"
}

BIN_DIR=""
need_bins() {
  if [[ -z "$BIN_DIR" ]]; then
    BIN_DIR="$(find_bin_dir)"
  fi
}

# Run a command as the server user (or directly when not root).
as_server() {
  if [[ "$IS_ROOT" -eq 1 ]]; then
    runuser -u "$SERVER_USER" -- "$@"
  else
    "$@"
  fi
}

ensure_server_user() {
  if [[ "$IS_ROOT" -eq 1 ]] && ! id -u "$SERVER_USER" >/dev/null 2>&1; then
    log "creating system user $SERVER_USER"
    useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVER_USER"
  fi
}

is_running() {
  [[ -f "$DATA_DIR/PG_VERSION" ]] || return 1
  as_server "$BIN_DIR/pg_ctl" -D "$DATA_DIR" status >/dev/null 2>&1
}

prepare_parent() {
  if [[ ! -d "$DATA_PARENT" ]]; then
    mkdir -p "$DATA_PARENT"
    if [[ "$IS_ROOT" -eq 1 ]]; then
      chown "$SERVER_USER" "$DATA_PARENT"
    fi
  fi
  if [[ ! -e "$LOG_FILE" ]]; then
    touch "$LOG_FILE"
  fi
  if [[ "$IS_ROOT" -eq 1 ]]; then
    chown "$SERVER_USER" "$LOG_FILE"
  fi
}

init_cluster() {
  log "initializing cluster in $DATA_DIR"
  if [[ "$IS_ROOT" -eq 1 ]]; then
    mkdir -p "$DATA_DIR"
    chown "$SERVER_USER" "$DATA_DIR"
  fi

  # The password goes through a temp file, never on the command line.
  local pwfile
  pwfile="$(mktemp)"
  trap 'rm -f -- "$pwfile"' EXIT
  printf '%s\n' "$PG_PASSWORD" > "$pwfile"
  if [[ "$IS_ROOT" -eq 1 ]]; then
    chown "$SERVER_USER" "$pwfile"
  fi

  as_server "$BIN_DIR/initdb" \
    -D "$DATA_DIR" \
    -U "$PG_USER_NAME" \
    --pwfile="$pwfile" \
    --auth-host=scram-sha-256 \
    --auth-local=trust \
    -E UTF8 >/dev/null

  rm -f -- "$pwfile"
  trap - EXIT
}

start_server() {
  local opts="-p $PG_PORT -c listen_addresses=localhost -c unix_socket_directories=$SOCKET_DIR"
  log "starting PostgreSQL on localhost:$PG_PORT"
  if ! as_server "$BIN_DIR/pg_ctl" -D "$DATA_DIR" -l "$LOG_FILE" -o "$opts" -w -t 30 start >/dev/null; then
    tail -n 20 "$LOG_FILE" >&2 || true
    die "server failed to start (see $LOG_FILE)"
  fi
}

wait_ready() {
  local i
  for i in $(seq 1 30); do
    if "$BIN_DIR/pg_isready" -q -h localhost -p "$PG_PORT" -t 1; then
      return 0
    fi
    sleep 1
  done
  die "PostgreSQL did not accept connections within 30s (see $LOG_FILE)"
}

ensure_database() {
  local exists
  exists="$("$BIN_DIR/psql" -X -w -q -A -t -h "$SOCKET_DIR" -p "$PG_PORT" -U "$PG_USER_NAME" -d postgres \
    -v ON_ERROR_STOP=1 -c "SELECT 1 FROM pg_database WHERE datname = '$PG_DB_NAME'")"
  if [[ "$exists" != "1" ]]; then
    "$BIN_DIR/createdb" -w -h "$SOCKET_DIR" -p "$PG_PORT" -U "$PG_USER_NAME" "$PG_DB_NAME"
    log "created database $PG_DB_NAME"
  fi
}

cmd_start() {
  need_bins
  ensure_server_user
  prepare_parent
  if is_running; then
    log "already running on localhost:$PG_PORT"
  else
    if [[ ! -f "$DATA_DIR/PG_VERSION" ]]; then
      if [[ -d "$DATA_DIR" ]] && [[ -n "$(ls -A "$DATA_DIR" 2>/dev/null)" ]]; then
        die "$DATA_DIR is not empty and is not a PostgreSQL cluster; run: $0 reset"
      fi
      init_cluster
    fi
    start_server
  fi
  wait_ready
  ensure_database
  log "ready on localhost:$PG_PORT (print the connection string with: $0 url)"
}

cmd_stop() {
  need_bins
  if ! is_running; then
    log "already stopped"
    return 0
  fi
  as_server "$BIN_DIR/pg_ctl" -D "$DATA_DIR" -m fast -w -t 30 stop >/dev/null
  log "stopped"
}

cmd_status() {
  need_bins
  if is_running; then
    log "running on localhost:$PG_PORT (data: $DATA_DIR)"
    return 0
  fi
  log "stopped (data: $DATA_DIR)"
  return 1
}

cmd_reset() {
  case "$DATA_DIR" in
    ""|"/"|"$HOME"|"$REPO_ROOT") die "refusing to delete $DATA_DIR" ;;
  esac
  cmd_stop
  if [[ -e "$DATA_DIR" ]]; then
    rm -rf -- "$DATA_DIR"
    log "deleted $DATA_DIR"
  else
    log "no data dir at $DATA_DIR"
  fi
  if [[ -e "$LOG_FILE" ]]; then
    rm -f -- "$LOG_FILE"
    log "deleted $LOG_FILE"
  fi
}

cmd_url() {
  printf 'postgres://%s:%s@localhost:%s/%s\n' "$PG_USER_NAME" "$PG_PASSWORD" "$PG_PORT" "$PG_DB_NAME"
}

main() {
  case "${1:-}" in
    start) cmd_start ;;
    stop) cmd_stop ;;
    status) cmd_status ;;
    reset) cmd_reset ;;
    url) cmd_url ;;
    *) echo "usage: $0 {start|stop|status|reset|url}" >&2; exit 2 ;;
  esac
}

main "$@"
