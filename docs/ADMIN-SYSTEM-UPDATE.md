# ReadBox AU-01 — Admin Panel Docker Compose system updates

## Scope, tested versus live
AU-01 is a **source-only implementation**, not permission to change an existing VPS.
The current production Compose installation lives at /opt/readbox on the host.
The web app runs as UID/GID 1001 and must never receive root, a privileged
container, a writable host root, or /var/run/docker.sock.

The original ZIP/systemd upgrade.sh remains for legacy host installations.
It is incompatible with a Docker Compose web container and must never be
run from that container. The AU-01 Docker path instead uses the existing
host-side scripts/install/readbox-update.sh, which captures an encrypted R05
consistent snapshot before a clean non-force Git fast-forward and Compose
rebuild. No automatic destructive database rollback is attempted.

## Host architecture
- Docker Compose creates a dedicated named volume: readbox_readbox_update_ipc.
- The web service mounts it READ-ONLY at /run/readbox-updater. It contains only
  a root-managed Unix socket and a root:1001 0640 HMAC access token.
- The root-only systemd unit readbox-updater-bridge.service runs
  scripts/updater/compose_host_worker.py on the approved host.
- The worker accepts authenticated Unix POST /rpc actions ONLY: status,
  preflight, start with a 40-hex lower-case target SHA + explicit confirmation.
  SO_PEERCRED enforces UID/GID 1001; fresh timestamp/nonce/HMAC and replay
  refusal are required. No user-submitted commands, URL, path or Docker args.
- A single persisted root-only status file records lifecycle, sanitized error
  or success; an interrupted update becomes operator-review-required and
  cannot be retried from the UI.
- When starting, the host verifies BOTH official main Git SHA values independently,
  refuses mismatch, checks a clean main checkout, private environment/key,
  recovery image, private backup folder and existing guarded updater, before
  executing scripts/install/readbox-update.sh with a pinned target.
- The updater takes the same global backup/restore maintenance lock and
  creates an encrypted R05 backup. Docker health checks are bounded. It
  never resets the database, deletes volumes or issues an automatic restore.

## Safe installation boundary — DO NOT run before independent approval
An operator, only after explicit approval and a snapshot of the current
deployment, deploys the approved source release with the existing operator
workflow, then installs the root bridge:

    cd /opt/readbox
    bash scripts/install/readbox-updater-host-install.sh

Prerequisites: age + Python 3.12, pre-existing mode-0600 .env, private
/var/lib/readbox-backup/identity.txt, mode-0700
/root/.readbox-secrets/pre-update, Ubuntu 24.04 recovery image, Docker
Engine/Compose, a clean main Git checkout and a Compose-created
readbox_readbox_update_ipc volume. The installer is idempotent, never
rotates an existing token, never replaces an unknown customized systemd
unit, and never starts an update. Test the installed bridge with the
Admin Panel's Recheck Preflight.

## Browser flow
1. Authorized admin opens System Update and selects Check for Updates.
2. Docker mode reads the source and mirror GitHub main refs; a mismatch
   BLOCKS update. If an approved stable release is present it is displayed
   as informational metadata only: the Docker flow uses verified source SHA,
   not untrusted ZIP assets or an implicit stable-release claim.
3. The screen shows current host SHA, proposed immutable SHA and readiness.
   Unavailable host bridge / active backup / failed update => BLOCKED.
4. After explicit admin confirmation, the server routes a SHA-only request
   through the authenticated root Unix socket; it never accepts remote URLs
   or shell arguments in Docker mode.
5. The root worker independently checks both refs and the host preflight,
   obtains encrypted pre-update backup, runs safe fast-forward/Compose update,
   bounds the health gate and records sanitized durable status. A failed
   backup prevents code mutation. A failed build/migration preserves the
   encrypted artifact and requires an operator-directed recovery decision.

## Security and limitations
- No live VPS deployment, Docker build on production, real Cloudflare R2,
  production restore, release tag or stable release was performed by AU-01.
- Source SHA equality is NOT a cryptographic signature over a release binary,
  and a successful GitHub CI run is not proof of a live VPS update.
- The root bridge must not run in Coolify or another orchestrator unless its
  exact filesystem/deployment owner and update policy match the approved
  /opt/readbox Compose contract; otherwise remain BLOCKED.
- An interrupted or failed update requires host operator review.
- The private age decryption identity needs independent off-VPS custody;
  local snapshots alone do not constitute independent disaster recovery.
- A live update needs a fresh approval and maintenance window. No browser
  backup/restore/update action should be used as a shortcut for production GO.

## AU-01/UI-01 — Display-only consistency

- In Docker Compose mode, the System Update installation header displays the
  canonical `vibtoolshq/ReadBox` repository instead of the legacy
  `vibtools/ReadBox` environment alias. Non-Docker installations preserve
  their existing repository display behavior.
- After a verified Docker source-channel check, the **System is Up to Date**
  modal displays the current host Git SHA (first 12 hex characters), exactly
  as the Current Version card does, rather than the package `0.1.0` version.
  A missing verified host SHA displays `Unknown`, never a misleading package
  version. The legacy stable-release dialog continues to display its semantic
  package version unchanged.
- This is a UI-only source correction: no update execution, Docker build,
  host updater changes, production VPS deployment, mailserver or R2 actions.
