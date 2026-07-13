import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  awaitConfigAnalysisRunJob,
  claimNextAnalysisRunJob,
  completeAnalysisRunJob,
  failAnalysisRunJob,
  getAnalysisRun,
  getExplorationConfiguration,
  saveStartupContractSnapshot,
  type ClaimedAnalysisRunJob,
} from "@analysis-tool/database";
import {
  detectStartupContract,
  prepareSourceRevision,
  resolveSourceProject,
  type PackageManager,
  type PreparedSourceRevision,
  type StartupContract,
} from "@analysis-tool/source-projects";
import type { Pool } from "pg";

const execFileAsync = promisify(execFile);

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown worker error";
  return message.slice(0, 1_000);
}

async function markFailedIfOwned(
  pool: Pool,
  job: ClaimedAnalysisRunJob,
  error: unknown,
): Promise<void> {
  await failAnalysisRunJob(pool, job, errorMessage(error));
}

async function completionWasCommitted(
  pool: Pool,
  job: ClaimedAnalysisRunJob,
  prepared: PreparedSourceRevision,
): Promise<boolean> {
  const run = await getAnalysisRun(pool, job.analysisRunId);
  return (
    run?.status === "ready" &&
    run.sourceRevision?.fingerprint === prepared.fingerprint &&
    run.sourceRevision.snapshotPath === prepared.snapshotPath &&
    run.sourceRevision.workingCopyPath === prepared.workingCopyPath
  );
}

function packageManagerBinary(pm: PackageManager): string {
  if (process.platform === "win32") {
    return `${pm}.cmd`;
  }
  return pm;
}

async function runFrozenInstall(
  workingCopyPath: string,
  contract: StartupContract,
): Promise<void> {
  await execFileAsync(
    packageManagerBinary(contract.packageManager),
    contract.installArgs,
    {
      cwd: workingCopyPath,
      timeout: 300_000,
      windowsHide: true,
      shell: process.platform === "win32",
    },
  );
}

async function resolveStartupContract(
  pool: Pool,
  job: ClaimedAnalysisRunJob,
  workingCopyPath: string,
): Promise<StartupContract | { needsConfig: true; reason: string }> {
  const config = await getExplorationConfiguration(pool, job.analysisRunId);
  const override =
    config?.startupPackageManager || config?.startupScript
      ? {
          packageManager: (config.startupPackageManager as PackageManager) ?? undefined,
          startScript: config.startupScript ?? undefined,
        }
      : undefined;

  const detection = await detectStartupContract(workingCopyPath, override);
  if (!detection.ok) {
    return { needsConfig: true, reason: detection.reason };
  }
  return detection.contract;
}

export async function processNextJob(options: {
  dataRoot: string;
  pool: Pool;
  sourceProjectsRoot: string;
}): Promise<boolean> {
  const job = await claimNextAnalysisRunJob(options.pool);
  if (!job) {
    return false;
  }

  let prepared: PreparedSourceRevision;
  try {
    const sourcePath = await resolveSourceProject(
      options.sourceProjectsRoot,
      job.sourceRelativePath,
    );
    prepared = await prepareSourceRevision({
      analysisRunId: job.analysisRunId,
      claimAttempt: job.attempt,
      dataRoot: options.dataRoot,
      sourcePath,
    });
  } catch (error) {
    await markFailedIfOwned(options.pool, job, error);
    return true;
  }

  let contract: StartupContract;
  try {
    const result = await resolveStartupContract(
      options.pool,
      job,
      prepared.workingCopyPath,
    );
    if ("needsConfig" in result) {
      await awaitConfigAnalysisRunJob(options.pool, job, result.reason);
      return true;
    }
    contract = result;
  } catch (error) {
    await markFailedIfOwned(options.pool, job, error);
    return true;
  }

  try {
    await runFrozenInstall(prepared.workingCopyPath, contract);
  } catch (error) {
    const reason = `Install failed (${contract.packageManager} ${contract.installArgs.join(" ")}): ${errorMessage(error)}`;
    const recorded = await awaitConfigAnalysisRunJob(options.pool, job, reason);
    if (!recorded) {
      await markFailedIfOwned(options.pool, job, error);
    }
    return true;
  }

  try {
    await saveStartupContractSnapshot(options.pool, {
      analysisRunId: job.analysisRunId,
      packageManager: contract.packageManager,
      installArgs: contract.installArgs,
      startScript: contract.startScript,
      detectionSource: contract.detectionSource,
    });
    await completeAnalysisRunJob(options.pool, job, prepared);
  } catch (completionError) {
    let committed: boolean;
    try {
      committed = await completionWasCommitted(options.pool, job, prepared);
    } catch (verificationError) {
      throw new AggregateError(
        [completionError, verificationError],
        "Could not determine whether source revision completion committed",
      );
    }

    if (!committed) {
      await markFailedIfOwned(options.pool, job, completionError);
    }
  }

  return true;
}
