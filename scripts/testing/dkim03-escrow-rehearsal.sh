#!/usr/bin/env bash
# DKIM-03: independent disposable Linux/GitHub-only key escrow rehearsal.
set -Eeuo pipefail
[[ "${GITHUB_ACTIONS:-}" == "true" &&
   "${GITHUB_REPOSITORY:-}" == "JILLU-Games/ReadBox" &&
   "${READBOX_DKIM03_DISPOSABLE:-}" == "1" ]] || {
  echo "DKIM03_CI_ONLY" >&2; exit 2;
}
[[ -n "${GITHUB_WORKSPACE:-}" && -d "${GITHUB_WORKSPACE}" ]] || exit 2
cd -- "$GITHUB_WORKSPACE"
[[ ! -e .env && ! -e /var/lib/readbox-backup/identity.txt ]] || {
  echo "DKIM03_PRODUCTION_STATE_REFUSED" >&2; exit 2;
}
command -v age >/dev/null
command -v age-keygen >/dev/null
command -v openssl >/dev/null
command -v docker >/dev/null
test "$(id -u)" -eq 0
export PYTHONDONTWRITEBYTECODE=1
python3 -B deployment/dkim/test_escrow.py
docker build --no-cache --progress=plain -f deployment/dkim/Dockerfile \
  -t "readbox-dkim03-disposable:${GITHUB_RUN_ID:-ci}" .
echo "DKIM03_DISPOSABLE_AGE_R2_MOCK_NONROOT_AND_AGENT_PASS"
