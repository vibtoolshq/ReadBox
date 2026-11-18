import { SystemUpdateConsole } from "@/components/vcon/system-update-console";
import { env } from "@/config/env";
import { requireAdminUser } from "@/core/auth/route-guards";
import {
  canonicalUpdateRepository,
  getCurrentSystemVersion,
  readUpdateStatus,
  runUpdatePreflight,
} from "@/core/updates/service";

export const dynamic = "force-dynamic";

export default async function AdminSystemUpdatePage() {
  await requireAdminUser();

  const [currentVersion, initialPreflight, initialStatus] = await Promise.all([
    getCurrentSystemVersion(),
    runUpdatePreflight(),
    readUpdateStatus(),
  ]);

  const isDockerMode = initialPreflight.checks.some(
    (check) => check.name === "deployment runtime" && /Docker|Container/.test(check.detail),
  );

  return (
    <SystemUpdateConsole
      currentVersion={currentVersion}
      githubRepo={isDockerMode ? canonicalUpdateRepository(env.updateGithubRepo) : env.updateGithubRepo}
      runtimeDir={env.updateRuntimeDir}
      initialPreflight={initialPreflight}
      initialStatus={initialStatus}
    />
  );
}
