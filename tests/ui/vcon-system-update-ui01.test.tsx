import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/config/env", () => ({
  env: { updateGithubRepo: "vibtools/ReadBox", updateRuntimeDir: "/run/readbox" },
}));
vi.mock("@/core/auth/route-guards", () => ({
  requireAdminUser: vi.fn(async () => ({ id: BigInt(1), isAdministrator: true })),
}));
vi.mock("@/core/updates/service", () => ({
  canonicalUpdateRepository: (repo: string) =>
    repo === "vibtools/ReadBox" ? "vibtoolshq/ReadBox" : repo,
  getCurrentSystemVersion: vi.fn(async () => "0.1.0"),
  readUpdateStatus: vi.fn(async () => ({
    step: "idle", progress: 0, message: "No active host update",
  })),
  runUpdatePreflight: vi.fn(async () => ({
    status: "ready",
    checks: [
      { name: "deployment runtime", passed: true, detail: "Docker Compose host bridge" },
      { name: "authenticated root host bridge", passed: true, detail: "Restricted Unix RPC" },
    ],
    currentSha: "90e87acc8fe8ca0b0c89ee620e0aed8eeceab064",
    message: "Host ready.",
  })),
}));

import AdminSystemUpdatePage from "@/app/(workspace)/vcon/system-update/page";
import { runUpdatePreflight } from "@/core/updates/service";

const currentSha = "90e87acc8fe8ca0b0c89ee620e0aed8eeceab064";

describe("AU-01/UI-01 admin update display-only fixes", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows the canonical Docker repository and the current host SHA in the up-to-date dialog", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/vcon/update/check")) {
        return new Response(JSON.stringify({
          ok: true, mode: "source", latest_version: currentSha.slice(0, 12),
          target_sha: currentSha, current_sha: currentSha,
          release_notes: "Verified source and mirror main: " + currentSha,
          archive_url: "", checksum_url: "",
        }), { status: 200 });
      }
      if (url.endsWith("/api/vcon/update/preflight")) {
        return new Response(JSON.stringify({
          status: "ready", checks: [
            { name: "deployment runtime", passed: true, detail: "Docker Compose host bridge" },
          ], currentSha, message: "Host ready.",
        }), { status: 200 });
      }
      throw new Error("Unexpected operation: " + url);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(await AdminSystemUpdatePage());

    expect(screen.getByText("vibtoolshq/ReadBox")).toBeInTheDocument();
    expect(screen.queryByText("vibtools/ReadBox")).not.toBeInTheDocument();
    expect(document.getElementById("current-version")).toHaveTextContent(currentSha.slice(0, 12));
    expect(screen.getByText("Verified source main")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Check for Updates" }));
    const dialog = await screen.findByRole("dialog", { name: "System is Up to Date" });
    expect(within(dialog).getByText(currentSha.slice(0, 12))).toBeInTheDocument();
    expect(within(dialog).queryByText("0.1.0")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.every(([input]) => !String(input).endsWith("/update/start"))).toBe(true);
  });

  it("preserves the legacy non-Docker repository and semantic-version dialog", async () => {
    vi.mocked(runUpdatePreflight).mockResolvedValueOnce({
      status: "ready", checks: [
        { name: "updater worker active", passed: true, detail: "readbox-updater.service" },
      ], message: "Systemd updater ready.",
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/vcon/update/check")) {
        return new Response(JSON.stringify({
          ok: true, latest_version: "0.1.0", release_notes: "No new release.",
          archive_url: "https://github.com/vibtools/ReadBox/releases/download/v0.1.0/source.zip",
          checksum_url: "https://github.com/vibtools/ReadBox/releases/download/v0.1.0/source.zip.sha256",
        }), { status: 200 });
      }
      if (url.endsWith("/api/vcon/update/preflight")) {
        return new Response(JSON.stringify({
          status: "ready", checks: [], message: "Systemd updater ready.",
        }), { status: 200 });
      }
      throw new Error("Unexpected operation: " + url);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(await AdminSystemUpdatePage());
    expect(screen.getByText("vibtools/ReadBox")).toBeInTheDocument();
    expect(screen.getByText("Stable")).toBeInTheDocument();
    expect(document.getElementById("current-version")).toHaveTextContent("0.1.0");

    await userEvent.setup().click(screen.getByRole("button", { name: "Check for Updates" }));
    const dialog = await screen.findByRole("dialog", { name: "System is Up to Date" });
    expect(within(dialog).getByText("0.1.0")).toBeInTheDocument();
    expect(within(dialog).queryByText(currentSha.slice(0, 12))).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.every(([input]) => !String(input).endsWith("/update/start"))).toBe(true);
  });
});
