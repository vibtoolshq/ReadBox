#!/usr/bin/env bash
# QIS-01 safe host-side Docker update; NO automatic destructive rollback.
set -Eeuo pipefail
umask 077
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
cd "$ROOT"
PROJECT="${READBOX_COMPOSE_PROJECT:-readbox}"
ENV="$ROOT/.env"
if [[ $# -ne 0 || ! "$PROJECT" =~ ^[a-z][a-z0-9_-]{2,55}$ ]]; then
  echo "Usage: bash scripts/install/readbox-update.sh" >&2; exit 2
fi
for cmd in git docker python3 age flock; do
  command -v "$cmd" >/dev/null || { echo "Missing: $cmd" >&2; exit 2; }
done
if [[ ! -f "$ENV" || -L "$ENV" || "$(stat -c %a "$ENV")" != "600" ]]; then
  echo "Private .env missing or unsafe. Refusing update." >&2; exit 2
fi
if ! git diff --quiet HEAD -- || ! git diff --cached --quiet || [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
  echo "Checkout has local changes. Refusing automatic update." >&2; exit 2
fi
remote="$(git remote get-url origin)"
case "$remote" in
  https://github.com/vibtoolshq/ReadBox|https://github.com/vibtoolshq/ReadBox.git|https://github.com/JILLU-Games/ReadBox|https://github.com/JILLU-Games/ReadBox.git)
    ;;
  *) echo "Unapproved Git remote; refusing update." >&2; exit 2 ;;
esac
recipient="${READBOX_BACKUP_RECIPIENT:-}"
if [[ -z "$recipient" ]]; then
  count="$(grep -Ec '^READBOX_BACKUP_RECIPIENT=' "$ENV" || true)"
  if [[ "$count" == "1" ]]; then
    value="$(grep -E '^READBOX_BACKUP_RECIPIENT=' "$ENV")"
    recipient="${value#*=}"
  fi
fi
if ! [[ "$recipient" =~ ^age1[023456789acdefghjklmnpqrstuvwxyz]{55,}$ ]]; then
  echo "An age backup public recipient is required before any code update." >&2
  exit 2
fi
# BR-04: host code updates must never race with an active backup,
# R2 upload or destructive restore. This is the same exact global advisory
# lock used by the root-only backup agent; hold it through this update.
GLOBAL_BACKUP_LOCK=/run/lock/readbox-backup-global.lock
if [[ -L "$GLOBAL_BACKUP_LOCK" || ! -d /run/lock ]]; then
  echo "BR04_UNSAFE_MAINTENANCE_LOCK" >&2; exit 2
fi
exec 9<>"$GLOBAL_BACKUP_LOCK" || {
  echo "BR04_MAINTENANCE_LOCK_UNAVAILABLE" >&2; exit 2
}
flock -n 9 || {
  echo "BR04_ACTIVE_BACKUP_OR_RESTORE_UPDATE_REFUSED" >&2; exit 2
}
docker image inspect ubuntu:24.04 >/dev/null || {
  echo "Pre-pull and audit ubuntu:24.04 recovery sidecar before updating." >&2; exit 2
}
docker compose --project-name "$PROJECT" -f docker-compose.yml config --quiet
# AU-01 bridge pins an exact verified main SHA and independent mirror parity.
# Legacy manual invocation remains allowed without the opt-in pin.
expected="${READBOX_UPDATE_TARGET_SHA:-}"
if [[ -n "$expected" && ! "$expected" =~ ^[0-9a-f]{40}$ ]]; then
  echo "AU01_INVALID_PINNED_TARGET" >&2; exit 2
fi
if [[ "${READBOX_UPDATE_REQUIRE_PARITY:-0}" == 1 ]]; then
  [[ -n "$expected" ]] || { echo "AU01_TARGET_REQUIRED" >&2; exit 2; }
  source_sha="$(git ls-remote --exit-code https://github.com/vibtoolshq/ReadBox.git refs/heads/main | cut -f1)"
  mirror_sha="$(git ls-remote --exit-code https://github.com/JILLU-Games/ReadBox.git refs/heads/main | cut -f1)"
  [[ "$source_sha" == "$expected" && "$mirror_sha" == "$expected" ]] || {
    echo "AU01_SOURCE_MIRROR_SHA_MISMATCH" >&2; exit 2
  }
fi
before="$(git rev-parse HEAD)"
git fetch --no-tags origin main
after="$(git rev-parse FETCH_HEAD)"
if [[ -n "$expected" && "$after" != "$expected" ]]; then
  echo "AU01_FETCHED_SHA_MISMATCH" >&2; exit 2
fi
if [[ "$before" == "$after" ]]; then
  echo "QIS01_ALREADY_UP_TO_DATE"; exit 0
fi
git merge-base --is-ancestor "$before" "$after" || {
  echo "Non-fast-forward upgrade refused." >&2; exit 2
}
BACKUP_DIR="${READBOX_BACKUP_DIR:-$HOME/.local/share/readbox/backup}"
[[ "$BACKUP_DIR" = /* && ! -L "$BACKUP_DIR" ]] || {
  echo "Backup target must be a real absolute directory." >&2; exit 2
}
mkdir -p -- "$BACKUP_DIR"
chmod 0700 "$BACKUP_DIR"
snapshot="$BACKUP_DIR/pre-update-$before-$(date -u +%Y%m%dT%H%M%SZ).age"
python3 deployment/operations/compose_recovery.py backup \
  --compose-file "$ROOT/docker-compose.yml" --project "$PROJECT" \
  --db-user readbox --db-name readbox --recipient "$recipient" \
  --output "$snapshot" --confirm-maintenance
echo "QIS01_ENCRYPTED_PRE_UPDATE_BACKUP_READY"
git merge --ff-only "$after"
if ! docker compose --project-name "$PROJECT" -f docker-compose.yml up -d --build postgres web worker; then
  echo "QIS01_UPDATE_FAILED: the encrypted rollback artifact is preserved." >&2
  echo "Database migrations may already have been applied. Do NOT run git reset or delete volumes." >&2
  echo "Follow an explicitly approved rollback/restore plan; no automatic destructive rollback." >&2
  exit 1
fi
# AU-01: bounded Compose health, not merely a successful build/start exit.
# Do not restore data or reset Git on an uncertain/migration failure.
if [[ -n "$expected" ]]; then
  healthy=0
  for attempt in {1..45}; do
    all_healthy=1
    for svc in postgres web worker; do
      cid="$(docker compose --project-name "$PROJECT" -f docker-compose.yml ps -q "$svc")"
      if [[ -z "$cid" ]]; then all_healthy=0; break; fi
      state="$(docker inspect -f '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid")"
      case "$state" in running\|healthy|running\|none) ;; *) all_healthy=0; break ;; esac
    done
    if [[ "$all_healthy" == 1 ]]; then healthy=1; break; fi
    sleep 2
  done
  if [[ "$healthy" != 1 || "$(git rev-parse HEAD)" != "$expected" ]]; then
    echo "AU01_POST_UPDATE_HEALTH_OR_SHA_FAILED_BACKUP_RETAINED" >&2
    exit 1
  fi
fi
echo "QIS01_SAFE_COMPOSE_UPDATE_COMPLETED"
echo "SMTP/public TLS/DNS are not altered by the updater."
