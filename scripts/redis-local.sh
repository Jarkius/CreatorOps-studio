#!/usr/bin/env bash
# Run a local Redis 7 server without Docker (D-054).
#
# Usage: scripts/redis-local.sh {start|stop|status|reset|url}
#
#   start   write the config (first run), start the server
#   stop    stop the server (no error if already stopped)
#   status  print running/stopped; exit 0 if running, 1 if stopped
#   reset   stop the server and delete the data, config, password and log
#   url     print the REDIS_URL (the only command that prints the password)
#
# Environment overrides:
#   REDIS_LOCAL_DIR   data dir  (default: <repo>/.data/redis)
#   REDIS_LOCAL_PORT  TCP port  (default: 6379)
#
# The server listens on 127.0.0.1 only, requires a password that is generated on first start
# (stored in <data dir parent>/redis.pass, mode 600), keeps an append-only file, and never evicts
# keys (a full Redis refuses writes instead of silently dropping queue messages). When this
# script runs as root, the server runs as the unprivileged user "redisdev".
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

PORT="${REDIS_LOCAL_PORT:-6379}"
DATA_DIR="${REDIS_LOCAL_DIR:-$REPO_ROOT/.data/redis}"
DATA_PARENT="$(dirname "$DATA_DIR")"
CONF_FILE="$DATA_PARENT/redis.conf"
PASS_FILE="$DATA_PARENT/redis.pass"
LOG_FILE="$DATA_PARENT/redis.log"
PID_FILE="$DATA_PARENT/redis.pid"
SERVER_USER="redisdev"

if [[ "${EUID}" -eq 0 ]]; then IS_ROOT=1; else IS_ROOT=0; fi

die() {
  echo "redis-local: $*" >&2
  exit 1
}

log() {
  echo "redis-local: $*"
}

need_bins() {
  command -v redis-server >/dev/null 2>&1 || die "redis-server not found (install redis-server 7)"
  command -v redis-cli >/dev/null 2>&1 || die "redis-cli not found (install redis-tools)"
}

as_server() {
  if [[ "$IS_ROOT" -eq 1 ]]; then
    runuser -u "$SERVER_USER" -- "$@"
  else
    "$@"
  fi
}

refuse_symlink() {
  if [[ -L "$1" ]]; then
    die "refusing to use $1: it is a symbolic link"
  fi
}

# Same trust model as pg-local.sh: the parent stays owned by the invoking user so the server user
# can never replace the config, the password file or the log with a symlink.
prepare_parent() {
  refuse_symlink "$DATA_PARENT"
  mkdir -p "$DATA_PARENT"
  if [[ "$IS_ROOT" -eq 1 ]]; then
    local owner mode
    owner="$(stat -c '%u' "$DATA_PARENT")"
    mode="$(stat -c '%a' "$DATA_PARENT")"
    if [[ "$owner" != "0" || "$mode" =~ [2367].$ || "$mode" =~ [2367]$ ]]; then
      die "$DATA_PARENT must be owned by root and not writable by group or others (found owner $owner, mode $mode). Fix with: chown root '$DATA_PARENT' && chmod 755 '$DATA_PARENT'"
    fi
    if ! id -u "$SERVER_USER" >/dev/null 2>&1; then
      log "creating system user $SERVER_USER"
      useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVER_USER"
    fi
  fi
  refuse_symlink "$DATA_DIR"
  mkdir -p "$DATA_DIR"
  refuse_symlink "$LOG_FILE"
  [[ -e "$LOG_FILE" ]] || : > "$LOG_FILE"
  chmod 600 "$LOG_FILE"
  if [[ "$IS_ROOT" -eq 1 ]]; then
    chown -h "$SERVER_USER" "$DATA_DIR" "$LOG_FILE"
  fi
}

ensure_password() {
  refuse_symlink "$PASS_FILE"
  if [[ ! -s "$PASS_FILE" ]]; then
    (umask 077 && head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$PASS_FILE")
  fi
  chmod 600 "$PASS_FILE"
}

password() {
  tr -d '\n' < "$PASS_FILE"
}

# The password lives in the config file (mode 600, readable by the server user only), never on a
# command line where `ps` would show it.
write_conf() {
  refuse_symlink "$CONF_FILE"
  (
    umask 077
    {
      echo "bind 127.0.0.1"
      echo "protected-mode yes"
      echo "port $PORT"
      echo "requirepass $(password)"
      echo "dir $DATA_DIR"
      echo "appendonly yes"
      echo "maxmemory-policy noeviction"
      echo "daemonize yes"
      echo "pidfile $PID_FILE"
      echo "logfile $LOG_FILE"
    } > "$CONF_FILE"
  )
  chmod 600 "$CONF_FILE"
  if [[ "$IS_ROOT" -eq 1 ]]; then
    chown -h "$SERVER_USER" "$CONF_FILE"
  fi
}

cli() {
  REDISCLI_AUTH="$(password)" redis-cli --no-auth-warning -h 127.0.0.1 -p "$PORT" "$@"
}

is_running() {
  [[ -s "$PASS_FILE" ]] || return 1
  [[ "$(cli ping 2>/dev/null || true)" == "PONG" ]]
}

cmd_start() {
  need_bins
  prepare_parent
  ensure_password
  if is_running; then
    log "already running on 127.0.0.1:$PORT"
    return 0
  fi
  write_conf
  # redis-server forks into the background (daemonize yes) once the config is read.
  if [[ "$IS_ROOT" -eq 1 ]]; then
    # The pid file is written by the server user, so its directory entry is created by it.
    # PID_FILE is under a root-owned parent: pre-create it for the server user.
    : > "$PID_FILE"
    chown -h "$SERVER_USER" "$PID_FILE"
  fi
  as_server redis-server "$CONF_FILE" >/dev/null
  local i
  for i in $(seq 1 30); do
    if is_running; then
      log "ready on 127.0.0.1:$PORT (print the connection string with: $0 url)"
      return 0
    fi
    sleep 0.5
  done
  tail -n 20 "$LOG_FILE" >&2 || true
  die "server did not answer within 15s (see $LOG_FILE)"
}

cmd_stop() {
  need_bins
  if ! is_running; then
    log "already stopped"
    return 0
  fi
  cli shutdown >/dev/null 2>&1 || true
  local i
  for i in $(seq 1 30); do
    is_running || { log "stopped"; return 0; }
    sleep 0.5
  done
  die "server did not stop within 15s"
}

cmd_status() {
  need_bins
  if is_running; then
    log "running on 127.0.0.1:$PORT (data: $DATA_DIR)"
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
  rm -rf -- "$DATA_DIR"
  rm -f -- "$CONF_FILE" "$PASS_FILE" "$LOG_FILE" "$PID_FILE"
  log "deleted the data, config, password and log"
}

cmd_url() {
  [[ -s "$PASS_FILE" ]] || die "no password yet; run: $0 start"
  printf 'redis://default:%s@127.0.0.1:%s\n' "$(password)" "$PORT"
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
