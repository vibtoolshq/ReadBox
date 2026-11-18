import { env } from "@/config/env";
import { recordAudit } from "@/core/audit/record";
import type { AuditWriteClient } from "@/core/audit/types";
import { getPrismaClient } from "@/core/database/client";
import { logger } from "@/core/server/logger";
import { spawnSync } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { request as unixRequest } from "node:http";
import { constants as fsConstants, existsSync, statSync } from "node:fs";
import {
  access,
  chmod,
  link,
  readFile,
  statfs,
  unlink,
  writeFile,
} from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";

// AU-01: web runs unprivileged. Only a root host bridge receives fixed HMAC
// RPCs through a read-only mounted Unix socket; never mount docker.sock.
const HOST_SOCKET = "/run/readbox-updater/agent.sock";
const HOST_SECRET = "/run/readbox-updater/access.token";
const MAX_HOST_BYTES = 64 * 1024;
const SHA40 = /^[0-9a-f]{40}$/;

interface HostBridgeReply {
  readonly status?: "ready" | "blocked" | "queued" | UpdateStatusPayload;
  readonly current_sha?: string;
  readonly checks?: readonly PreflightCheckItem[];
  readonly error?: string;
}

async function callHostUpdater(
  action: "status" | "preflight" | "start",
  payload: Record<string, unknown> = {},
): Promise<HostBridgeReply> {
  const secret = (await readFile(HOST_SECRET, "utf8")).trim();
  if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error("HOST_BRIDGE_TOKEN_INVALID");
  const body = JSON.stringify({ action, ...payload });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomBytes(16).toString("hex");
  const digest = createHash("sha256").update(body).digest("hex");
  const signature = createHmac("sha256", secret)
    .update([timestamp, nonce, digest].join(".")).digest("hex");
  return new Promise<HostBridgeReply>((resolve, reject) => {
    const req = unixRequest({
      socketPath: HOST_SOCKET, path: "/rpc", method: "POST", timeout: 5_000,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "X-ReadBox-Timestamp": timestamp,
        "X-ReadBox-Nonce": nonce,
        "X-ReadBox-Signature": signature,
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      res.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_HOST_BYTES) req.destroy(new Error("HOST_RESPONSE_TOO_LARGE"));
        else chunks.push(chunk);
      });
      res.on("end", () => {
        try {
          const reply = JSON.parse(Buffer.concat(chunks).toString("utf8")) as HostBridgeReply;
          if ((res.statusCode ?? 500) >= 400) {
            reject(new Error(typeof reply.error === "string" ? reply.error : "HOST_BRIDGE_REFUSED"));
          } else {
            resolve(reply);
          }
        } catch { reject(new Error("HOST_BRIDGE_BAD_RESPONSE")); }
      });
    });
    req.on("timeout", () => req.destroy(new Error("HOST_BRIDGE_TIMEOUT")));
    req.on("error", reject);
    req.end(body);
  });
}

export const MIN_RUNTIME_FREE_BYTES = 100 * 1024 * 1024;

/** The old Compose env default was a historical repo alias. Never follow it. */
export function canonicalUpdateRepository(repo: string): string {
  return repo === "vibtools/ReadBox" ? "vibtoolshq/ReadBox" : repo;
}


export interface PreflightCheckItem {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface UpdatePreflightResult {
  readonly status: "ready" | "blocked";
  readonly checks: readonly PreflightCheckItem[];
  readonly message: string;
  readonly currentSha?: string;
}

export type ReleaseCheckResult =
  | {
      readonly ok: true;
      readonly latest_version: string;
      readonly mode?: "stable" | "source";
      readonly target_sha?: string;
      readonly current_sha?: string;
      readonly release_notes: string;
      readonly archive_url: string;
      readonly checksum_url: string;
      readonly published_at: string;
    }
  | {
      readonly ok: false;
      readonly code: "UPSTREAM_UNAVAILABLE" | "NO_COMPATIBLE_RELEASE";
      readonly status: number;
      readonly error: string;
    };

export interface UpdateStatusPayload {
  readonly step: string;
  readonly message: string;
  readonly progress: number;
}

export type QueueUpdateResult =
  | {
      readonly ok: true;
      readonly status: 200;
      readonly payload: { readonly status: "started" };
    }
  | {
      readonly ok: false;
      readonly status: 400 | 409 | 503 | 500;
      readonly code:
        | "MISSING_URLS"
        | "INVALID_URL"
        | "ALREADY_IN_PROGRESS"
        | "PREFLIGHT_BLOCKED"
        | "INTERNAL_ERROR";
      readonly error: string;
      readonly preflight?: UpdatePreflightResult;
    };

export interface UpdateRuntimeOptions {
  readonly runtimeDir?: string;
  readonly serviceName?: string;
  readonly upgradeScriptPath?: string;
  readonly githubRepo?: string;
  readonly appRoot?: string;
  readonly envFilePath?: string;
  readonly backupRoot?: string;
  readonly systemdUnitDir?: string;
  readonly webServiceName?: string;
  readonly ingestionServiceName?: string;
  readonly containerRuntime?: boolean;
  readonly fetchImpl?: typeof fetch;
  readonly preflightOverride?: () => Promise<UpdatePreflightResult>;
  readonly prisma?: AuditWriteClient | null;
  readonly actorId?: bigint | null;
  readonly authSource?: "admin_table" | "user_table";
  readonly actorUsername?: string;
  readonly headers?: Pick<Headers, "get">;
}

export function isContainerRuntime(options?: {
  readonly dockerEnvExists?: boolean;
  readonly envVars?: Record<string, string | undefined>;
}): boolean {
  const envVars = options?.envVars ?? process.env;
  if (envVars.DOCKER_RUNTIME === "false") {
    return false;
  }
  if (
    envVars.DOCKER_RUNTIME === "true" ||
    Boolean(envVars.COOLIFY_RESOURCE_UUID?.trim()) ||
    Boolean(envVars.COOLIFY_CONTAINER_NAME?.trim())
  ) {
    return true;
  }
  if (options?.dockerEnvExists !== undefined) {
    return options.dockerEnvExists;
  }
  return (
    existsSync("/.dockerenv") ||
    existsSync("/run/.containerenv") ||
    findCommandOnPath("systemctl") === null
  );
}

export async function getCurrentSystemVersion(
  workspaceRoot: string = process.cwd(),
): Promise<string> {
  const candidates = [
    resolve(workspaceRoot, "VERSION"),
  ];
  for (const candidate of candidates) {
    try {
      if (existsSync(/*turbopackIgnore: true*/ candidate)) {
        const raw = (
          await readFile(/*turbopackIgnore: true*/ candidate, "utf8")
        ).trim();
        if (raw) return raw;
      }
    } catch {
      // Try next candidate
    }
  }

  try {
    const pkgRaw = await readFile(resolve(workspaceRoot, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw) as { version?: unknown };
    if (typeof pkg.version === "string" && pkg.version.trim()) {
      return pkg.version.trim();
    }
  } catch {
    // Fallback below
  }

  return "0.1.0";
}

export function isOfficialReleaseUrl(
  value: unknown,
  githubRepo: string = env.updateGithubRepo,
): value is string {
  if (typeof value !== "string" || !value.trim()) {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") {
    return false;
  }
  if (parsed.port !== "" || parsed.username !== "" || parsed.password !== "") {
    return false;
  }
  if (parsed.search !== "" || parsed.hash !== "") {
    return false;
  }

  const requiredPrefix = `/${githubRepo}/releases/download/`;
  if (!parsed.pathname.startsWith(requiredPrefix)) {
    return false;
  }

  const tail = parsed.pathname.slice(requiredPrefix.length);
  if (!tail || tail.includes("..") || tail.includes("//") || tail.includes("\\")) {
    return false;
  }

  return true;
}

// Docker channel: a source SHA is not a stable release. The source and mirror
// must independently advertise the identical immutable main head.
async function checkVerifiedMainSource(
  fetchFn: typeof fetch,
): Promise<ReleaseCheckResult> {
  const mainRef = (repo: string) =>
    "https://api.github.com/repos/" + repo + "/git/ref/heads/main";
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "ReadBox-Updater" };
  try {
    const [sourceRes, mirrorRes] = await Promise.all([
      fetchFn(mainRef("vibtoolshq/ReadBox"), { headers, signal: AbortSignal.timeout(10_000), cache: "no-store" }),
      fetchFn(mainRef("JILLU-Games/ReadBox"), { headers, signal: AbortSignal.timeout(10_000), cache: "no-store" }),
    ]);
    if (!sourceRes.ok || !mirrorRes.ok) throw new Error("REMOTE_UNAVAILABLE");
    const source = (await sourceRes.json()) as { object?: { sha?: unknown } };
    const mirror = (await mirrorRes.json()) as { object?: { sha?: unknown } };
    const sha = source.object?.sha;
    if (typeof sha !== "string" || !SHA40.test(sha) || sha !== mirror.object?.sha) {
      return { ok: false, code: "NO_COMPATIBLE_RELEASE", status: 409,
        error: "Source/mirror main SHA mismatch; automatic updates are refused." };
    }
    let stableDetail = "No approved stable release artifact is assumed.";
    try {
      const stable = await fetchFn("https://api.github.com/repos/vibtoolshq/ReadBox/releases/latest", {
        headers, signal: AbortSignal.timeout(5_000), cache: "no-store",
      });
      if (stable.ok) {
        const item = (await stable.json()) as { tag_name?: unknown; draft?: unknown; prerelease?: unknown };
        if (typeof item.tag_name === "string" && !item.draft && !item.prerelease) {
          stableDetail = "Stable release detected: " + item.tag_name + ". Docker updates use pinned verified main, not legacy ZIP.";
        }
      }
    } catch {
      // Stable metadata is informational and must never override exact main parity.
    }
    let currentSha: string | undefined;
    try {
      const host = await callHostUpdater("preflight");
      currentSha = typeof host.current_sha === "string" && SHA40.test(host.current_sha)
        ? host.current_sha : undefined;
    } catch {
      // Missing bridge is surfaced separately by preflight. No install without it.
    }
    return {
      ok: true, latest_version: sha.slice(0, 12), mode: "source",
      target_sha: sha, current_sha: currentSha,
      release_notes: "Verified source and mirror main: " + sha +
        ". This is a verified source channel, NOT a stable release. " + stableDetail,
      archive_url: "", checksum_url: "", published_at: "",
    };
  } catch {
    return { ok: false, code: "UPSTREAM_UNAVAILABLE", status: 503,
      error: "Cannot verify both official GitHub main refs." };
  }
}

export async function checkLatestRelease(
  options?: UpdateRuntimeOptions,
): Promise<ReleaseCheckResult> {
  if (options?.containerRuntime ?? isContainerRuntime()) {
    return checkVerifiedMainSource(options?.fetchImpl ?? fetch);
  }
  const githubRepo = options?.githubRepo ??
    (env.nodeEnv === "production"
      ? canonicalUpdateRepository(env.updateGithubRepo)
      : env.updateGithubRepo);
  const fetchFn = options?.fetchImpl ?? fetch;
  const url = `https://api.github.com/repos/${githubRepo}/releases/latest`;

  try {
    const response = await fetchFn(url, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "ReadBox-Updater",
      },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });

    if (response.status === 404) {
      return {
        ok: false,
        code: "NO_COMPATIBLE_RELEASE",
        status: 404,
        error: "No releases found.",
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        code: "UPSTREAM_UNAVAILABLE",
        status: response.status === 403 || response.status === 429 ? 503 : 502,
        error: `GitHub release API returned HTTP ${response.status}.`,
      };
    }

    const data = (await response.json()) as {
      tag_name?: unknown;
      draft?: unknown;
      prerelease?: unknown;
      body?: unknown;
      published_at?: unknown;
      assets?: unknown;
    };

    if (
      typeof data.tag_name !== "string" ||
      !data.tag_name.trim() ||
      data.draft === true ||
      data.prerelease === true
    ) {
      return {
        ok: false,
        code: "NO_COMPATIBLE_RELEASE",
        status: 404,
        error: "Latest stable release is unavailable.",
      };
    }

    let archiveUrl: string | null = null;
    let checksumUrl: string | null = null;
    const assets = Array.isArray(data.assets) ? data.assets : [];

    for (const rawAsset of assets) {
      if (!rawAsset || typeof rawAsset !== "object") continue;
      const asset = rawAsset as {
        name?: unknown;
        browser_download_url?: unknown;
      };
      const name = typeof asset.name === "string" ? asset.name : "";
      const downloadUrl =
        typeof asset.browser_download_url === "string"
          ? asset.browser_download_url
          : "";

      if (
        name.endsWith("-source.zip") &&
        isOfficialReleaseUrl(downloadUrl, githubRepo)
      ) {
        archiveUrl = downloadUrl;
      } else if (
        name.endsWith("-source.zip.sha256") &&
        isOfficialReleaseUrl(downloadUrl, githubRepo)
      ) {
        checksumUrl = downloadUrl;
      }
    }

    if (!archiveUrl || !checksumUrl) {
      return {
        ok: false,
        code: "NO_COMPATIBLE_RELEASE",
        status: 404,
        error: "Update artifacts not found for the latest release.",
      };
    }

    const latestVersion = data.tag_name.trim().replace(/^v/i, "");
    return {
      ok: true,
      latest_version: latestVersion,
      release_notes: typeof data.body === "string" ? data.body : "",
      archive_url: archiveUrl,
      checksum_url: checksumUrl,
      published_at:
        typeof data.published_at === "string" ? data.published_at : "",
    };
  } catch (error) {
    logger.warn("system_update_release_check_failed", {
      reason: error instanceof Error ? error.name : "unknown_error",
    });
    return {
      ok: false,
      code: "UPSTREAM_UNAVAILABLE",
      status: 503,
      error: "Unable to reach GitHub release metadata service.",
    };
  }
}

function findCommandOnPath(commandName: string): string | null {
  const pathEnv = process.env.PATH ?? "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, commandName);
    try {
      const st = statSync(candidate);
      if (st.isFile()) {
        return candidate;
      }
    } catch {
      // Continue
    }
  }
  return null;
}

async function isWritableDirectory(path: string): Promise<boolean> {
  try {
    const st = statSync(path);
    if (!st.isDirectory()) return false;
    await access(path, fsConstants.R_OK | fsConstants.W_OK | fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    const st = statSync(path);
    if (!st.isFile()) return false;
    await access(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function runUpdatePreflight(
  options?: UpdateRuntimeOptions,
): Promise<UpdatePreflightResult> {
  const runtimeDir =
    options?.runtimeDir ??
    process.env.UPDATE_RUNTIME_DIR ??
    env.updateRuntimeDir;
  const serviceName =
    options?.serviceName ??
    process.env.UPDATE_SERVICE_NAME ??
    env.updateServiceName;
  const normalizedUnitName = serviceName.endsWith(".service")
    ? serviceName
    : `${serviceName}.service`;

  const defaultUpgradeScript =
    existsSync("/opt/readbox/app/scripts/updater/upgrade.sh")
      ? "/opt/readbox/app/scripts/updater/upgrade.sh"
      : existsSync("/opt/vibmail/app/scripts/updater/upgrade.sh")
        ? "/opt/vibmail/app/scripts/updater/upgrade.sh"
        : env.updateScriptPath;
  const upgradeScriptPath = options?.upgradeScriptPath ?? defaultUpgradeScript;

  const appRoot =
    options?.appRoot ??
    process.env.READBOX_APP_ROOT ??
    (existsSync("/opt/vibmail/app") && !existsSync("/opt/readbox/app")
      ? "/opt/vibmail/app"
      : "/opt/readbox/app");
  const envFilePath =
    options?.envFilePath ??
    process.env.READBOX_ENV_FILE ??
    process.env.VIBMAIL_ENV_FILE ??
    (existsSync("/etc/vibmail/vibmail.env") &&
    !existsSync("/etc/readbox/readbox.env")
      ? "/etc/vibmail/vibmail.env"
      : "/etc/readbox/readbox.env");
  const backupRoot =
    options?.backupRoot ??
    process.env.READBOX_BACKUP_ROOT ??
    (existsSync("/var/backups/vibmail") && !existsSync("/var/backups/readbox")
      ? "/var/backups/vibmail"
      : "/var/backups/readbox");
  const systemdUnitDir = options?.systemdUnitDir ?? "/etc/systemd/system";

  const statusPath = join(/*turbopackIgnore: true*/ runtimeDir, "update_status.json");
  const requestPath = join(/*turbopackIgnore: true*/ runtimeDir, "update_request.json");
  const processingPath = join(/*turbopackIgnore: true*/ runtimeDir, "update_request.processing.json");
  const updaterUnitPath = join(/*turbopackIgnore: true*/ systemdUnitDir, normalizedUnitName);

  const checks: PreflightCheckItem[] = [];
  const check = (name: string, passed: boolean, detail: string) => {
    checks.push({ name, passed, detail });
  };

  let runtimeDirIsDirectory = false;
  try {
    runtimeDirIsDirectory = statSync(/*turbopackIgnore: true*/ runtimeDir).isDirectory();
  } catch {
    runtimeDirIsDirectory = false;
  }

  check("runtime directory", runtimeDirIsDirectory, runtimeDir);
  check(
    "status path writable",
    runtimeDirIsDirectory && (await isWritableDirectory(runtimeDir)),
    statusPath,
  );
  check("request queue available", !existsSync(/*turbopackIgnore: true*/ requestPath), requestPath);
  check(
    "request processing clear",
    !existsSync(/*turbopackIgnore: true*/ processingPath),
    processingPath,
  );

  let updaterUnitExists = false;
  try {
    updaterUnitExists = statSync(/*turbopackIgnore: true*/ updaterUnitPath).isFile();
  } catch {
    updaterUnitExists = false;
  }

  const containerMode =
    options?.containerRuntime !== undefined
      ? options.containerRuntime
      : !updaterUnitExists && isContainerRuntime();

  if (containerMode) {
    try {
      const bridge = await callHostUpdater("preflight");
      const hostStatus = await callHostUpdater("status");
      if ((bridge.status !== "ready" && bridge.status !== "blocked") ||
          !Array.isArray(bridge.checks) || !bridge.checks.length ||
          typeof bridge.current_sha !== "string" || !SHA40.test(bridge.current_sha)) {
        throw new Error("INVALID_HOST_PREFLIGHT");
      }
      const stage = typeof hostStatus.status === "object" && hostStatus.status !== null
        ? hostStatus.status.step : "error";
      const busyOrReview = ["error", "queued", "verify", "update"].includes(stage ?? "error");
      const hostChecks: PreflightCheckItem[] = [
        { name: "deployment runtime", passed: true, detail: "Docker Compose host bridge" },
        { name: "authenticated root host bridge", passed: true,
          detail: "Restricted Unix RPC; no Docker socket in web" },
        ...bridge.checks,
        { name: "host update state", passed: !busyOrReview,
          detail: busyOrReview ? "Update active or operator review required" : "No active update" },
      ];
      const ready = bridge.status === "ready" && !busyOrReview &&
        hostChecks.every((item) => item.passed);
      return {
        status: ready ? "ready" : "blocked",
        checks: hostChecks, currentSha: bridge.current_sha,
        message: ready ? "Docker Compose host updater is ready." :
          "Host preflight blocked or operator review required.",
      };
    } catch {
      // Absent host integration must remain FAIL-CLOSED. Existing Docker-only
      // preflight evidence below is historical, not permission to update.
    }
    check(
      "deployment runtime",
      true,
      "Container runtime (Docker Compose / Coolify)",
    );
    check(
      "application root",
      existsSync(process.cwd()),
      process.cwd(),
    );
    for (const cmd of ["node", "tar", "sha256sum"] as const) {
      const found = findCommandOnPath(cmd);
      check(`command: ${cmd}`, found !== null, cmd);
    }
    try {
      const targetForDisk = runtimeDirIsDirectory ? runtimeDir : process.cwd();
      const fsStats = await statfs(targetForDisk);
      const freeBytes = Number(fsStats.bavail) * Number(fsStats.bsize);
      check(
        "runtime disk space",
        freeBytes >= MIN_RUNTIME_FREE_BYTES,
        `${freeBytes} bytes free`,
      );
    } catch (error) {
      check(
        "runtime disk space",
        false,
        error instanceof Error ? error.message : "disk check failed",
      );
    }
    check(
      "container orchestrator update policy",
      false,
      "Managed by container orchestrator (Coolify / Docker Compose)",
    );

    return {
      status: "blocked",
      checks,
      message:
        "Managed by container orchestrator (Coolify / Docker Compose). Deploy new releases by pulling or rebuilding the container image.",
    };
  }

  check("updater worker installed", updaterUnitExists, updaterUnitPath);
  check(
    "upgrade script executable",
    await isExecutableFile(upgradeScriptPath),
    upgradeScriptPath,
  );

  const requiredPaths: ReadonlyArray<{
    readonly name: string;
    readonly path: string;
    readonly kind: "directory" | "file";
  }> = [
    { name: "application root", path: appRoot, kind: "directory" },
    { name: "runtime environment", path: envFilePath, kind: "file" },
    { name: "backup root", path: backupRoot, kind: "directory" },
  ];

  for (const item of requiredPaths) {
    let ok = false;
    try {
      const st = statSync(/*turbopackIgnore: true*/ item.path);
      ok = item.kind === "directory" ? st.isDirectory() : st.isFile();
    } catch {
      ok = false;
    }
    check(item.name, ok, item.path);
  }

  const requiredCommands = [
    "node",
    "flock",
    "rsync",
    "tar",
    "sha256sum",
    "systemctl",
    "curl",
    "nginx",
    "postfix",
    "realpath",
    "readlink",
    "doveconf",
    "pg_dump",
  ] as const;

  for (const cmd of requiredCommands) {
    const found = findCommandOnPath(cmd);
    check(`command: ${cmd}`, found !== null, cmd);
  }

  const systemctlPath = findCommandOnPath("systemctl");
  const webServiceName =
    options?.webServiceName ??
    process.env.READBOX_WEB_SERVICE ??
    (existsSync(join(systemdUnitDir, "vibmail-web.service")) &&
    !existsSync(join(systemdUnitDir, "readbox-web.service"))
      ? "vibmail-web.service"
      : "readbox-web.service");
  const ingestionServiceName =
    options?.ingestionServiceName ??
    process.env.READBOX_INGESTION_SERVICE ??
    (existsSync(join(systemdUnitDir, "vibmail-ingestion.service")) &&
    !existsSync(join(systemdUnitDir, "readbox-ingestion.service"))
      ? "vibmail-ingestion.service"
      : "readbox-ingestion.service");

  const requiredServices = [
    normalizedUnitName,
    "postgresql.service",
    "postfix.service",
    "dovecot.service",
    "nginx.service",
    webServiceName,
    ingestionServiceName,
  ] as const;

  for (const svc of requiredServices) {
    const label =
      svc === normalizedUnitName
        ? "updater worker active"
        : `service: ${svc.replace(/\.service$/, "")}`;
    if (!systemctlPath) {
      check(label, false, svc);
      continue;
    }
    const candidateUnits = [svc];
    if (svc === webServiceName) {
      if (!candidateUnits.includes("readbox-web.service")) candidateUnits.push("readbox-web.service");
      if (!candidateUnits.includes("vibmail-web.service")) candidateUnits.push("vibmail-web.service");
    } else if (svc === ingestionServiceName) {
      if (!candidateUnits.includes("readbox-ingestion.service")) candidateUnits.push("readbox-ingestion.service");
      if (!candidateUnits.includes("vibmail-ingestion.service")) candidateUnits.push("vibmail-ingestion.service");
    }

    let active = false;
    let testedUnit = svc;
    for (const unit of candidateUnits) {
      const res = spawnSync(systemctlPath, ["is-active", "--quiet", unit], {
        timeout: 2_000,
        windowsHide: true,
      });
      if (res.status === 0) {
        active = true;
        testedUnit = unit;
        break;
      }
    }
    check(label, active, testedUnit);
  }

  const idPath = findCommandOnPath("id");
  if (idPath) {
    const userRes = spawnSync(idPath, ["-u", "vmail"], {
      timeout: 2_000,
      windowsHide: true,
    });
    check("vmail user", userRes.status === 0, "vmail");
  } else {
    check("vmail user", false, "id");
  }

  try {
    const targetForDisk = runtimeDirIsDirectory ? runtimeDir : process.cwd();
    const fsStats = await statfs(targetForDisk);
    const freeBytes = Number(fsStats.bavail) * Number(fsStats.bsize);
    check(
      "runtime disk space",
      freeBytes >= MIN_RUNTIME_FREE_BYTES,
      `${freeBytes} bytes free`,
    );
  } catch (error) {
    check(
      "runtime disk space",
      false,
      error instanceof Error ? error.message : "disk check failed",
    );
  }

  const failed = checks.filter((item) => !item.passed);
  return {
    status: failed.length === 0 ? "ready" : "blocked",
    checks,
    message:
      failed.length === 0
        ? "Updater is ready."
        : `Blocked by ${failed[0]!.name} (${failed[0]!.detail})`,
  };
}

export async function readUpdateStatus(
  options?: UpdateRuntimeOptions,
): Promise<UpdateStatusPayload> {
  if (options?.containerRuntime ?? isContainerRuntime()) {
    try {
      const reply = await callHostUpdater("status");
      const value = reply.status;
      if (typeof value === "object" && value !== null &&
          typeof value.step === "string" &&
          typeof value.message === "string" &&
          typeof value.progress === "number" && Number.isFinite(value.progress)) {
        return { step: value.step, message: value.message, progress: value.progress };
      }
    } catch {
      // An uninstalled host bridge is a capability block, not an active job.
    }
    return { step: "idle", message: "Docker host updater not installed", progress: 0 };
  }
  const runtimeDir = options?.runtimeDir ?? env.updateRuntimeDir;
  const statusPath = join(runtimeDir, "update_status.json");

  try {
    if (!existsSync(statusPath)) {
      return {
        step: "idle",
        message: "No update in progress",
        progress: 0,
      };
    }

    const raw = await readFile(statusPath, "utf8");
    const parsed = JSON.parse(raw) as {
      step?: unknown;
      message?: unknown;
      progress?: unknown;
    };

    return {
      step: typeof parsed.step === "string" ? parsed.step : "idle",
      message:
        typeof parsed.message === "string"
          ? parsed.message
          : "No update in progress",
      progress:
        typeof parsed.progress === "number" && Number.isFinite(parsed.progress)
          ? parsed.progress
          : 0,
    };
  } catch {
    return {
      step: "idle",
      message: "No update in progress",
      progress: 0,
    };
  }
}

export async function queueUpdateRequest(
  input: {
    readonly archiveUrl?: unknown;
    readonly checksumUrl?: unknown;
    readonly targetSha?: unknown;
  },
  options?: UpdateRuntimeOptions,
): Promise<QueueUpdateResult> {
  // Docker update requests contain an immutable SHA only. Legacy ZIP URLs are
  // deliberately excluded from privileged Docker host execution.
  if (options?.containerRuntime ?? isContainerRuntime()) {
    if (typeof input.targetSha !== "string" || !SHA40.test(input.targetSha) ||
        input.archiveUrl || input.checksumUrl) {
      return { ok: false, status: 400, code: "INVALID_URL",
        error: "Docker host updates require an exact verified source SHA." };
    }
    const pf = await runUpdatePreflight(options);
    if (pf.status !== "ready") {
      return { ok: false, status: 503, code: "PREFLIGHT_BLOCKED",
        error: "Docker host updater preflight is blocked.", preflight: pf };
    }
    try {
      const reply = await callHostUpdater("start",
        { target_sha: input.targetSha, confirm: true });
      if (reply.status !== "queued") throw new Error("HOST_REFUSED");
      const client = options?.prisma !== undefined
        ? options.prisma
        : env.databaseUrl ? (getPrismaClient() as unknown as AuditWriteClient) : null;
      if (client) {
        try {
          await recordAudit(client, {
            actorId: options?.actorId ?? null,
            authSource: options?.authSource,
            actorUsername: options?.actorUsername,
            action: "system_update_requested",
            targetType: "system_update",
            targetIdentifier: input.targetSha,
            headers: options?.headers,
            details: { target_sha: input.targetSha, mode: "verified_source_main" },
          });
        } catch {
          logger.error("host_update_audit_write_failed");
        }
      }
      return { ok: true, status: 200, payload: { status: "started" } };
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      return { ok: false, status: code === "UPDATE_ALREADY_RUNNING" ? 409 : 503,
        code: code === "UPDATE_ALREADY_RUNNING" ? "ALREADY_IN_PROGRESS" : "PREFLIGHT_BLOCKED",
        error: "Host updater refused or is unavailable; no retry without checking status." };
    }
  }
  const githubRepo = options?.githubRepo ??
    (env.nodeEnv === "production"
      ? canonicalUpdateRepository(env.updateGithubRepo)
      : env.updateGithubRepo);
  const runtimeDir = options?.runtimeDir ?? env.updateRuntimeDir;
  const statusPath = join(runtimeDir, "update_status.json");
  const requestPath = join(runtimeDir, "update_request.json");

  if (
    typeof input.archiveUrl !== "string" ||
    !input.archiveUrl.trim() ||
    typeof input.checksumUrl !== "string" ||
    !input.checksumUrl.trim()
  ) {
    return {
      ok: false,
      status: 400,
      code: "MISSING_URLS",
      error: "Missing URLs",
    };
  }

  if (
    !isOfficialReleaseUrl(input.archiveUrl, githubRepo) ||
    !isOfficialReleaseUrl(input.checksumUrl, githubRepo)
  ) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_URL",
      error: "Invalid update URL origin. Must be from official repository.",
    };
  }

  if (existsSync(statusPath)) {
    try {
      const currentStatus = JSON.parse(await readFile(statusPath, "utf8")) as {
        step?: unknown;
        progress?: unknown;
      };
      if (
        currentStatus.step !== undefined &&
        currentStatus.step !== null &&
        currentStatus.step !== "idle" &&
        currentStatus.step !== "error" &&
        currentStatus.progress !== 100
      ) {
        return {
          ok: false,
          status: 409,
          code: "ALREADY_IN_PROGRESS",
          error: "An update is already in progress.",
        };
      }
    } catch {
      // Ignore malformed status file before preflight
    }
  }

  const preflight = options?.preflightOverride
    ? await options.preflightOverride()
    : await runUpdatePreflight(options);

  if (preflight.status !== "ready") {
    return {
      ok: false,
      status: 503,
      code: "PREFLIGHT_BLOCKED",
      error: "Update preflight is blocked.",
      preflight,
    };
  }

  const requestPayload = {
    archive_url: input.archiveUrl,
    checksum_url: input.checksumUrl,
    confirm_upgrade: true,
  };

  const tempPath = join(
    runtimeDir,
    `.update-request-${randomBytes(8).toString("hex")}.tmp`,
  );

  try {
    await writeFile(tempPath, JSON.stringify(requestPayload), {
      encoding: "utf8",
      mode: 0o640,
    });
    await chmod(tempPath, 0o640);
    await link(tempPath, requestPath);
  } catch (error) {
    const errCode = (error as NodeJS.ErrnoException | undefined)?.code;
    if (errCode === "EEXIST") {
      return {
        ok: false,
        status: 409,
        code: "ALREADY_IN_PROGRESS",
        error: "An update is already queued or in progress.",
      };
    }
    logger.error("system_update_queue_failed", {
      reason: error instanceof Error ? error.name : "unknown_error",
    });
    return {
      ok: false,
      status: 500,
      code: "INTERNAL_ERROR",
      error: "Failed to queue update request.",
    };
  } finally {
    try {
      await unlink(tempPath);
    } catch {
      // Temp file already cleaned up or never created
    }
  }

  const client =
    options?.prisma !== undefined
      ? options.prisma
      : env.databaseUrl
        ? (getPrismaClient() as unknown as AuditWriteClient)
        : null;

  if (client) {
    await recordAudit(client, {
      actorId: options?.actorId ?? null,
      authSource: options?.authSource,
      actorUsername: options?.actorUsername,
      action: "system_update_requested",
      targetType: "system_update",
      targetIdentifier: input.archiveUrl,
      headers: options?.headers,
      details: {
        archive_url: input.archiveUrl,
        checksum_url: input.checksumUrl,
        confirm_upgrade: true,
      },
    });
  }

  return {
    ok: true,
    status: 200,
    payload: { status: "started" },
  };
}
