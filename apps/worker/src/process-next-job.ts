import {
  claimNextAnalysisRunJob,
  completeAnalysisRunJob,
  failAnalysisRunJob,
  type ClaimedAnalysisRunJob,
} from "@analysis-tool/database";
import {
  cleanupPreparedRevision,
  prepareSourceRevision,
  resolveSourceProject,
  type PreparedSourceRevision,
} from "@analysis-tool/source-projects";
import type { Pool } from "pg";

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown worker error";
  return message.slice(0, 1_000);
}

async function markFailed(
  pool: Pool,
  job: ClaimedAnalysisRunJob,
  prepared: PreparedSourceRevision | undefined,
  error: unknown,
): Promise<void> {
  let failure = error;
  if (prepared) {
    try {
      await cleanupPreparedRevision(prepared);
    } catch (cleanupError) {
      failure = new AggregateError(
        [error, cleanupError],
        "Worker processing and cleanup both failed",
      );
    }
  }
  await failAnalysisRunJob(pool, job, errorMessage(failure));
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

  let prepared: PreparedSourceRevision | undefined;
  try {
    const sourcePath = await resolveSourceProject(
      options.sourceProjectsRoot,
      job.sourceRelativePath,
    );
    prepared = await prepareSourceRevision({
      analysisRunId: job.analysisRunId,
      dataRoot: options.dataRoot,
      sourcePath,
    });
    await completeAnalysisRunJob(options.pool, job, prepared);
  } catch (error) {
    await markFailed(options.pool, job, prepared, error);
  }

  return true;
}
