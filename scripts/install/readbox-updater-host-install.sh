#!/usr/bin/env bash
# AU-01: install only on an explicitly approved Docker Compose host.
set -Eeuo pipefail
umask 077
[[ ${EUID:-$(id -u)} == 0 && $# == 0 ]] || { echo ROOT_REQUIRED >&2; exit 2; }
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
[[ "$ROOT" == /opt/readbox && -f "$ROOT/docker-compose.yml" ]] || {
  echo APPROVED_COMPOSE_ROOT_REQUIRED >&2; exit 2;
}
for cmd in docker git python3 systemctl stat openssl; do
  command -v "$cmd" >/dev/null || { echo "MISSING_$cmd" >&2; exit 2; }
done
[[ -f "$ROOT/.env" && ! -L "$ROOT/.env" && "$(stat -c %a "$ROOT/.env")" == 600 ]] || {
  echo PRIVATE_ENV_REQUIRED >&2; exit 2;
}
[[ "$(git -C "$ROOT" branch --show-current)" == main ]] || {
  echo APPROVED_MAIN_BRANCH_REQUIRED >&2; exit 2;
}
[[ -z "$(git -C "$ROOT" status --porcelain)" ]] || {
  echo DIRTY_WORKTREE_REFUSED >&2; exit 2;
}
docker compose -f "$ROOT/docker-compose.yml" --project-name readbox config --quiet
VOLUME=readbox_readbox_update_ipc
docker volume inspect "$VOLUME" >/dev/null 2>&1 || {
  echo UPDATE_IPC_VOLUME_MISSING_DEPLOY_COMPOSE_FIRST >&2; exit 2;
}
SOCKET_DIR="$(docker volume inspect "$VOLUME" --format '{{.Mountpoint}}')"
[[ "$SOCKET_DIR" == /* && -d "$SOCKET_DIR" && ! -L "$SOCKET_DIR" ]] || {
  echo UNSAFE_UPDATE_IPC_VOLUME >&2; exit 2;
}
for item in "$SOCKET_DIR"/* "$SOCKET_DIR"/.[!.]*; do
  [[ -e "$item" || -L "$item" ]] || continue
  case "${item##*/}" in access.token|agent.sock) ;;
    *) echo FOREIGN_IPC_ENTRY_REFUSED >&2; exit 2 ;;
  esac
done
chown 0:1001 "$SOCKET_DIR"
chmod 0750 "$SOCKET_DIR"
TOKEN="$SOCKET_DIR/access.token"
if [[ -e "$TOKEN" || -L "$TOKEN" ]]; then
  [[ -f "$TOKEN" && ! -L "$TOKEN" &&
     "$(stat -c '%u:%g:%a' "$TOKEN")" == 0:1001:640 &&
     "$(<"$TOKEN")" =~ ^[0-9a-f]{64}$ ]] || {
    echo EXISTING_TOKEN_UNSAFE >&2; exit 2;
  }
else
  TOKEN_TMP="$(mktemp "$SOCKET_DIR/.token.XXXXXXXX")"
  trap 'rm -f -- "${TOKEN_TMP:-}"' EXIT
  openssl rand -hex 32 > "$TOKEN_TMP"
  chown 0:1001 "$TOKEN_TMP"
  chmod 0640 "$TOKEN_TMP"
  ln "$TOKEN_TMP" "$TOKEN" || { echo TOKEN_CREATION_RACE >&2; exit 2; }
  rm -f "$TOKEN_TMP"
  trap - EXIT
fi
STATE=/var/lib/readbox-updater
[[ ! -L "$STATE" ]] || { echo UNSAFE_HOST_UPDATE_STATE >&2; exit 2; }
install -d -o root -g root -m 0700 "$STATE"
CONFIG=/etc/readbox-updater-bridge.env
EXPECTED="READBOX_UPDATE_SOCKET_DIR=$SOCKET_DIR"
if [[ -e "$CONFIG" || -L "$CONFIG" ]]; then
  [[ -f "$CONFIG" && ! -L "$CONFIG" &&
    "$(stat -c '%u:%g:%a' "$CONFIG")" == 0:0:600 &&
    "$(<"$CONFIG")" == "$EXPECTED" ]] || {
    echo EXISTING_HOST_UPDATER_CONFIG_MISMATCH >&2; exit 2;
  }
else
  install -m 0600 /dev/null "$CONFIG"
  printf '%s\n' "$EXPECTED" > "$CONFIG"
fi
UNIT=/etc/systemd/system/readbox-updater-bridge.service
SOURCE="$ROOT/deployment/updater/systemd/readbox-updater-bridge.service"
[[ -f "$SOURCE" && ! -L "$SOURCE" ]] || {
  echo SOURCE_UNIT_MISSING >&2; exit 2;
}
if [[ -e "$UNIT" || -L "$UNIT" ]]; then
  [[ -f "$UNIT" && ! -L "$UNIT" &&
    "$(stat -c '%u:%g:%a' "$UNIT")" == 0:0:644 ]] || {
    echo UNSAFE_EXISTING_BRIDGE_UNIT >&2; exit 2;
  }
  cmp -s "$SOURCE" "$UNIT" || {
    echo EXISTING_BRIDGE_UNIT_CUSTOMIZED_REFUSED >&2; exit 2;
  }
else
  install -o root -g root -m 0644 "$SOURCE" "$UNIT"
fi
PYTHONPYCACHEPREFIX="$STATE/pycache" /usr/bin/python3 -m py_compile "$ROOT/scripts/updater/compose_host_worker.py"
systemctl daemon-reload
systemctl enable --now readbox-updater-bridge.service
for attempt in {1..40}; do
  if systemctl is-active --quiet readbox-updater-bridge.service &&
     [[ -S "$SOCKET_DIR/agent.sock" ]]; then
    echo AU01_HOST_BRIDGE_ACTIVE
    echo DOCKER_SOCKET_NOT_EXPOSED_TO_WEB
    echo NO_UPDATE_REQUESTED
    exit 0
  fi
  sleep 0.25
done
echo AU01_HOST_BRIDGE_READINESS_FAILED >&2
exit 1
