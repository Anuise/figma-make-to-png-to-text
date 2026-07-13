import {
  claimNextAnalysisRunJob,
  completeAnalysisRunJob,
  failAnalysisRunJob,
  getAnalysisRun,
  type ClaimedAnalysisRunJob,
} from "@analysis-tool/database";
import {
  prepareSourceRevision,
  resolveSourceProject,
  type PreparedSourceRevision,
} from "@analysis-tool/source-projects";
import type { Pool } from "pg";

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
      claimToken: String(job.attempt),
      dataRoot: options.dataRoot,
      sourcePath,
    });
  } catch (error) {
    await markFailedIfOwned(options.pool, job, error);
    return true;
  }

  try {
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
