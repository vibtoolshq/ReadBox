"use client";

import {
  AlertBanner,
  Badge,
  Button,
  CaptionText,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Icon,
  Label,
  notify,
  PageHeader,
  Panel,
  PanelBody,
  PanelHeader,
  ProgressBar,
  SectionTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui";
import type {
  PreflightCheckItem,
  UpdatePreflightResult,
  UpdateStatusPayload,
} from "@/core/updates/service";
import {
  Check,
  CheckCircle2,
  Download,
  RefreshCw,
  Terminal,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export interface SystemUpdateConsoleProps {
  readonly currentVersion: string;
  readonly githubRepo: string;
  readonly runtimeDir: string;
  readonly initialPreflight: UpdatePreflightResult;
  readonly initialStatus: UpdateStatusPayload;
}

interface LogEntry {
  readonly id: number;
  readonly time: string;
  readonly level: "info" | "success" | "error";
  readonly message: string;
}

export function SystemUpdateConsole({
  currentVersion,
  githubRepo,
  runtimeDir,
  initialPreflight,
  initialStatus,
}: SystemUpdateConsoleProps) {
  const [preflight, setPreflight] =
    useState<UpdatePreflightResult>(initialPreflight);
  const [status, setStatus] = useState<UpdateStatusPayload>(initialStatus);
  const [latestVersion, setLatestVersion] = useState<string>("Unknown");
  const [releaseMode, setReleaseMode] = useState<"stable" | "source">("stable");
  const [sourceSha, setSourceSha] = useState<string>("");
  const [currentSha, setCurrentSha] = useState(initialPreflight.currentSha ?? "");
  const isDockerMode = initialPreflight.checks.some((item) =>
    item.name === "deployment runtime" && /Docker|Container/.test(item.detail));
  const [releaseNotes, setReleaseNotes] = useState<string>(
    "Click 'Check for Updates' to fetch release metadata.",
  );
  const [publishedAt, setPublishedAt] = useState<string>("");
  const [archiveUrl, setArchiveUrl] = useState<string>("");
  const [checksumUrl, setChecksumUrl] = useState<string>("");
  const [availabilityLabel, setAvailabilityLabel] =
    useState<string>("Check required");
  const [lastCheckedLabel, setLastCheckedLabel] = useState<string>(
    initialStatus.step && initialStatus.step !== "idle"
      ? initialStatus.step
      : "Idle",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(
    initialStatus.step === "error" || initialStatus.progress === -1
      ? `Previous update failed: ${initialStatus.message}`
      : null,
  );
  const [isCheckingRelease, setIsCheckingRelease] = useState(false);
  const [isCheckingPreflight, setIsCheckingPreflight] = useState(false);
  const [isStartingUpdate, setIsStartingUpdate] = useState(false);
  const [isPolling, setIsPolling] = useState(
    Boolean(
      initialStatus.step &&
        initialStatus.step !== "idle" &&
        initialStatus.step !== "error" &&
        initialStatus.progress >= 0 &&
        initialStatus.progress < 100,
    ),
  );
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showUpToDateModal, setShowUpToDateModal] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);
  const [doubleConfirmChecked, setDoubleConfirmChecked] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const lastLoggedMessageRef = useRef<string>("");
  const logCounterRef = useRef<number>(1);

  const appendLog = useCallback(
    (level: "info" | "success" | "error", message: string) => {
      const time = new Date().toLocaleTimeString("en-US", { hour12: false });
      const nextId = logCounterRef.current++;
      setLogs((prev) => [...prev, { id: nextId, time, level, message }]);
    },
    [],
  );

  const refreshPreflight = useCallback(async () => {
    setIsCheckingPreflight(true);
    try {
      const res = await fetch("/api/vcon/update/preflight", {
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as UpdatePreflightResult;
      setPreflight(data);
      if (data.currentSha) setCurrentSha(data.currentSha);
      return data;
    } catch {
      const fallback: UpdatePreflightResult = {
        status: "blocked",
        checks: preflight.checks,
        message: "Manual action required: updater readiness could not be checked.",
      };
      setPreflight(fallback);
      return fallback;
    } finally {
      setIsCheckingPreflight(false);
    }
  }, [preflight.checks]);

  const performReleaseCheck = useCallback(
    async (showModalFeedback: boolean) => {
      setIsCheckingRelease(true);
      setErrorMessage(null);
      setLastCheckedLabel("Checking...");
      setAvailabilityLabel("Checking");

      try {
        const res = await fetch("/api/vcon/update/check", {
          cache: "no-store",
        });
        const data = (await res.json()) as {
          ok?: boolean;
          latest_version?: string;
          mode?: "source" | "stable";
          target_sha?: string;
          current_sha?: string;
          release_notes?: string;
          archive_url?: string;
          checksum_url?: string;
          published_at?: string;
          error?: string;
        };

        if (!res.ok || !data.latest_version) {
          throw new Error(data.error || "Failed to check for updates.");
        }

        setLatestVersion(data.latest_version);
        setReleaseMode(data.mode === "source" ? "source" : "stable");
        setSourceSha(data.mode === "source" ? data.target_sha || "" : "");
        if (data.current_sha) setCurrentSha(data.current_sha);
        setReleaseNotes(data.release_notes || "No release notes provided.");
        setArchiveUrl(data.archive_url || "");
        setChecksumUrl(data.checksum_url || "");
        setPublishedAt(data.published_at || "");
        setLastCheckedLabel(
          new Date().toLocaleTimeString("en-US", { hour12: false }),
        );

        await refreshPreflight();

        const available = data.mode === "source"
          ? Boolean(data.target_sha && data.target_sha !== (data.current_sha || currentSha))
          : data.latest_version !== currentVersion &&
            Boolean(data.archive_url && data.checksum_url);
        const upToDate = data.mode === "source"
          ? Boolean(data.target_sha && data.target_sha === (data.current_sha || currentSha))
          : Boolean(data.archive_url && data.checksum_url);
        if (available) {
          setAvailabilityLabel("Update available");
          if (showModalFeedback) {
            setDoubleConfirmChecked(false);
            setShowConfirmModal(true);
          }
        } else if (upToDate) {
          setAvailabilityLabel("Up to date");
          if (showModalFeedback) setShowUpToDateModal(true);
        } else {
          setAvailabilityLabel("Source metadata unavailable");
          setErrorMessage("Pinned update target could not be verified.");
        }
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Failed to check for updates.";
        setErrorMessage(msg);
        setAvailabilityLabel("Unavailable");
        setLastCheckedLabel("Failed");
        if (showModalFeedback) {
          notify.error(msg);
        }
      } finally {
        setIsCheckingRelease(false);
      }
    },
    [currentVersion, currentSha, refreshPreflight],
  );

  useEffect(() => {
    if (!isPolling) return;

    const timer = setInterval(async () => {
      try {
        const res = await fetch("/api/vcon/update/status", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as UpdateStatusPayload;
        setStatus(data);

        if (data.message && lastLoggedMessageRef.current !== data.message) {
          lastLoggedMessageRef.current = data.message;
          appendLog(
            data.step === "error" || data.progress === -1 ? "error" : "info",
            data.message,
          );
        }

        if (data.progress === 100) {
          setIsPolling(false);
          appendLog(
            "success",
            "Update complete; host reported successful Docker health checks.",
          );
          notify.success("System update completed.");
        } else if (data.step === "error" || data.progress === -1) {
          setIsPolling(false);
          setErrorMessage(data.message || "Update failed.");
          appendLog("error", `Update failed: ${data.message}`);
          notify.error(data.message || "System update failed.");
        }
      } catch {
        // Keep polling on transient network blip during service restart
      }
    }, 2_000);

    return () => clearInterval(timer);
  }, [appendLog, isPolling]);

  async function handleStartUpdate() {
    if (!doubleConfirmChecked) {
      notify.error("Please confirm the pre-upgrade backup and maintenance check.");
      return;
    }

    setShowConfirmModal(false);
    if (preflight.status !== "ready") {
      setErrorMessage(
        "Update preflight is blocked. Resolve the reported condition and try again.",
      );
      notify.error("Update preflight is blocked.");
      return;
    }

    setIsStartingUpdate(true);
    setErrorMessage(null);

    try {
      const res = await fetch("/api/vcon/update/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(releaseMode === "source"
            ? { target_sha: sourceSha }
            : { archive_url: archiveUrl, checksum_url: checksumUrl }),
        }),
      });
      const data = (await res.json()) as {
        status?: string;
        error?: string;
        preflight?: UpdatePreflightResult;
      };

      if (!res.ok) {
        if (data.preflight) {
          setPreflight(data.preflight);
        }
        const msg = data.error || "Failed to start system update.";
        setErrorMessage(msg);
        notify.error(msg);
        return;
      }

      setShowLogModal(true);
      appendLog(
        "info",
        releaseMode === "source"
          ? "Pinned update queued through authenticated host bridge."
          : "Update request queued for root updater worker (mode 0640).",
      );
      setStatus({
        step: "queued",
        message: "Waiting for privileged root updater worker...",
        progress: 0,
      });
      setIsPolling(true);
      notify.success("Update request queued for root updater worker.");
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to start system update.";
      setErrorMessage(msg);
      notify.error(msg);
    } finally {
      setIsStartingUpdate(false);
    }
  }

  const updateAvailable = releaseMode === "source"
    ? /^[0-9a-f]{40}$/.test(sourceSha) && sourceSha !== currentSha
    : latestVersion !== "Unknown" &&
      latestVersion !== currentVersion &&
      Boolean(archiveUrl && checksumUrl);

  const canInstallUpdate =
    updateAvailable &&
    preflight.status === "ready" &&
    !isPolling &&
    !isStartingUpdate;

  const passedCount = preflight.checks.filter((c) => c.passed).length;

  return (
    <section className="space-y-3" aria-labelledby="system-update-title">
      <PageHeader
        id="system-update-title"
        title="System Update"
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowLogModal(true)}
            >
              <Icon glyph={Terminal} />
              Update Logs
            </Button>
            <Button
              type="button"
              id="btn-check-update"
              disabled={isCheckingRelease}
              onClick={() => void performReleaseCheck(true)}
            >
              <Icon
                glyph={RefreshCw}
                className={isCheckingRelease ? "animate-spin" : undefined}
              />
              {isCheckingRelease ? "Checking..." : "Check for Updates"}
            </Button>
          </>
        }
      />

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel className="min-w-0">
          <PanelHeader>
            <SectionTitle>Current Installation</SectionTitle>
            <span className="font-mono text-xs text-muted-foreground">
              {githubRepo}
            </span>
          </PanelHeader>
          <PanelBody className="space-y-2.5">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="border border-border bg-background p-2.5">
                <CaptionText className="block">Current Version</CaptionText>
                <strong
                  id="current-version"
                  className="mt-1 block font-mono text-sm font-medium tabular-nums text-foreground"
                >
                  {isDockerMode && currentSha ? currentSha.slice(0, 12) : currentVersion}
                </strong>
              </div>

              <div className="border border-border bg-background p-2.5">
                <CaptionText className="block">Update Channel</CaptionText>
                <strong className="mt-1 block text-sm font-medium text-foreground">
                  {isDockerMode ? "Verified source main" : "Stable"}
                </strong>
              </div>

              <div className="border border-border bg-background p-2.5">
                <CaptionText className="block">Update System</CaptionText>
                <strong className="mt-1 block text-sm font-medium text-foreground">
                  {isDockerMode ? "Pinned SHA / Guarded" : "Signed / Resumable"}
                </strong>
              </div>

              <div className="border border-border bg-background p-2.5">
                <CaptionText className="block">Status</CaptionText>
                <strong
                  id="last-checked"
                  className="mt-1 block font-mono text-sm font-medium tabular-nums text-foreground"
                >
                  {lastCheckedLabel}
                </strong>
              </div>
            </div>

            <div className="border border-border bg-background px-2.5 py-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">
              <span>{isDockerMode ? "Host Bridge:" : "Handoff Queue:"}</span>{" "}
              <code className="font-mono text-foreground">
                {isDockerMode ? "/run/readbox-updater/agent.sock" : `${runtimeDir}/update_request.json`}
              </code>{" "}
              <span>·</span> <span>{isDockerMode ? "HMAC-authenticated host bridge" : "Mode 0640 hard-link"}</span>
            </div>
          </PanelBody>
        </Panel>

        <Panel className="min-w-0">
          <PanelHeader>
            <SectionTitle>{isDockerMode ? "Verified Source Update" : "Latest Release"}</SectionTitle>
            <Badge
              id="update-availability-badge"
              variant={
                updateAvailable
                  ? "default"
                  : availabilityLabel === "Up to date"
                    ? "success"
                    : "outline"
              }
            >
              {availabilityLabel}
            </Badge>
          </PanelHeader>
          <PanelBody className="space-y-2.5">
            <div className="flex items-center justify-between border border-border bg-background px-2.5 py-2 text-xs">
              <span className="text-muted-foreground">Version</span>
              <div className="flex items-center gap-2 font-mono tabular-nums">
                <strong id="latest-version" className="font-medium text-foreground">
                  {latestVersion}
                </strong>
                {publishedAt ? (
                  <>
                    <span aria-hidden="true" className="text-muted-foreground">
                      ·
                    </span>
                    <span className="text-muted-foreground">
                      {publishedAt.slice(0, 10)}
                    </span>
                  </>
                ) : null}
              </div>
            </div>

            <pre
              id="release-notes"
              className="max-h-36 overflow-y-auto whitespace-pre-wrap border border-border bg-background p-2.5 font-mono text-xs leading-relaxed text-foreground"
            >
              {releaseNotes}
            </pre>

            {errorMessage ? (
              <AlertBanner id="update-error" variant="error">
                {errorMessage}
              </AlertBanner>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isCheckingRelease}
                onClick={() => void performReleaseCheck(false)}
              >
                <Icon
                  glyph={RefreshCw}
                  className={isCheckingRelease ? "animate-spin" : undefined}
                />
                Refresh Release Metadata
              </Button>

              {updateAvailable ? (
                <Button
                  type="button"
                  id="btn-start-update"
                  size="sm"
                  disabled={!canInstallUpdate}
                  onClick={() => {
                    setDoubleConfirmChecked(false);
                    setShowConfirmModal(true);
                  }}
                >
                  <Icon glyph={Download} />
                  Install Update
                </Button>
              ) : null}
            </div>
          </PanelBody>
        </Panel>
      </div>

      <Panel className="min-w-0">
        <PanelHeader>
          <SectionTitle>Installation State &amp; Host Preflight</SectionTitle>
          <div className="flex flex-wrap items-center gap-2.5">
            <span
              id="preflight-summary"
              className="font-mono text-xs font-medium tabular-nums text-foreground"
            >
              {isPolling
                ? "Installing"
                : preflight.status === "ready"
                  ? `Ready (${passedCount}/${preflight.checks.length})`
                  : `Blocked (${passedCount}/${preflight.checks.length} passed)`}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isCheckingPreflight}
              onClick={() => void refreshPreflight()}
            >
              <Icon
                glyph={RefreshCw}
                className={isCheckingPreflight ? "animate-spin" : undefined}
              />
              Recheck Preflight
            </Button>
          </div>
        </PanelHeader>
        <PanelBody className="space-y-3">
          <p
            id="preflight-results"
            className="text-xs text-muted-foreground [overflow-wrap:anywhere]"
          >
            {preflight.status === "ready"
              ? "Ready: the root updater worker and required runtime checks passed."
              : `Blocked: ${preflight.message || "Manual action is required before installation."}`}
          </p>

          {isPolling || (status.step && status.step !== "idle") ? (
            <div
              id="active-job-panel"
              className="border border-border bg-background p-3"
            >
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Active Job</span>
                <strong
                  id="active-job-id"
                  className="font-mono font-medium text-foreground"
                >
                  System Upgrade ({status.step})
                </strong>
              </div>
              <ProgressBar
                id="progress-bar"
                value={status.progress}
                max={100}
                label={`System upgrade progress (${status.step})`}
                className="mt-2"
              />
              <div className="mt-2 flex items-center justify-between font-mono text-xs tabular-nums text-muted-foreground">
                <span id="active-job-stage">{status.message}</span>
                <span id="active-job-percent">
                  {Math.max(0, status.progress)}%
                </span>
              </div>
            </div>
          ) : null}

          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>State</TableHead>
                <TableHead>Check</TableHead>
                <TableHead>Target / Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody id="preflight-checks">
              {preflight.checks.map((item: PreflightCheckItem) => (
                <TableRow key={item.name}>
                  <TableCell className="whitespace-nowrap font-medium">
                    {item.passed ? (
                      <span className="inline-flex items-center gap-1.5 text-success">
                        <Icon glyph={CheckCircle2} />
                        <span>Pass</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-warning">
                        <Icon glyph={XCircle} />
                        <span>Blocked</span>
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="font-medium text-foreground">
                    {item.name}
                  </TableCell>
                  <TableCell className="font-mono text-muted-foreground">
                    {item.detail}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </PanelBody>
      </Panel>

      <Dialog open={showConfirmModal} onOpenChange={setShowConfirmModal}>
        <DialogContent
          id="modal-update-available"
          aria-labelledby="modal-update-available-title"
          className="max-w-md"
        >
          <DialogTitle id="modal-update-available-title">
            Confirm System Update
          </DialogTitle>
          <DialogDescription>
            {releaseMode === "source" ? "Pinned source SHA " : "Version "}
            <strong
              id="modal-latest-version"
              className="font-mono text-foreground"
            >
              {latestVersion}
            </strong>{" "}
            is available. {releaseMode === "source"
              ? "The restricted host bridge verifies both GitHub main refs, creates an encrypted pre-update snapshot, and runs the guarded Docker Compose updater. No unsafe automatic database rollback."
              : "The privileged host updater verifies the release checksum and creates a pre-upgrade backup before deployment."}
          </DialogDescription>

          <Label className="flex cursor-pointer items-start gap-2 border border-border bg-background p-2.5 font-normal text-foreground">
            <Checkbox
              checked={doubleConfirmChecked}
              onChange={(e) => setDoubleConfirmChecked(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              I confirm that preflight checks are reviewed and authorize queuing
              the verified, pinned update request.
            </span>
          </Label>

          <DialogFooter>
            <Button
              type="button"
              id="btn-update-cancel"
              variant="outline"
              onClick={() => setShowConfirmModal(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              id="btn-update-confirm"
              disabled={!doubleConfirmChecked || !canInstallUpdate}
              onClick={() => void handleStartUpdate()}
            >
              <Icon glyph={Check} />
              Install Update
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showUpToDateModal} onOpenChange={setShowUpToDateModal}>
        <DialogContent
          id="modal-up-to-date"
          aria-labelledby="modal-up-to-date-title"
          className="max-w-sm text-center"
        >
          <div className="mx-auto flex size-9 items-center justify-center border border-success/40 bg-success-bg text-success">
            <Icon glyph={Check} className="size-4" />
          </div>
          <DialogTitle id="modal-up-to-date-title" className="pr-0">
            System is Up to Date
          </DialogTitle>
          <DialogDescription>
            You are already running the latest version (
            <span id="modal-current-version" className="font-mono">
              {releaseMode === "source"
                ? (currentSha || "Unknown").slice(0, 12)
                : currentVersion}
            </span>
            ).
          </DialogDescription>
          <DialogFooter className="sm:justify-center">
            <Button
              type="button"
              id="btn-up-to-date-ok"
              onClick={() => setShowUpToDateModal(false)}
            >
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showLogModal} onOpenChange={setShowLogModal}>
        <DialogContent
          id="readbox-update-log-modal"
          aria-labelledby="readbox-update-log-title"
          className="max-w-2xl"
        >
          <div>
            <DialogTitle id="readbox-update-log-title">
              System Update Stream
            </DialogTitle>
            <DialogDescription id="update-log-description" className="mt-0.5">
              Verified root updater worker event stream
            </DialogDescription>
          </div>

          <div
            id="update-log-viewport"
            role="log"
            aria-label="Update terminal log stream"
            className="max-h-64 min-h-40 overflow-y-auto border border-border bg-background p-3 font-mono text-xs"
          >
            {logs.length === 0 ? (
              <div id="update-log-empty" className="text-muted-foreground">
                Waiting for updater events... (Current step: {status.step} —{" "}
                {status.message})
              </div>
            ) : (
              <div className="space-y-1.5">
                {logs.map((entry) => (
                  <div
                    key={entry.id}
                    data-level={entry.level}
                    className="flex items-start gap-2"
                  >
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {entry.time}
                    </span>
                    <span className="shrink-0 uppercase text-foreground">
                      [{entry.level}]
                    </span>
                    <span className="text-foreground">{entry.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span id="update-log-stage" className="font-mono">
              Stage: {status.step}
            </span>
            <span>Closing this window does not cancel the update</span>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
