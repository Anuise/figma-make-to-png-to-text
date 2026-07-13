import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

export type ClaimedAnalysisRunJob = {
  id: string;
  analysisRunId: string;
  sourceRelativePath: string;
};

export type CompletedSourceRevision = {
  fingerprint: string;
  snapshotPath: string;
  workingCopyPath: string;
};

export async function enqueueAnalysisRunJob(
  client: PoolClient,
  analysisRunId: string,
): Promise<void> {
  await client.query(
    `
      INSERT INTO jobs (id, analysis_run_id, status)
      VALUES ($1, $2, 'queued')
    `,
    [randomUUID(), analysisRunId],
  );
}

export async function claimNextAnalysisRunJob(
  pool: Pool,
): Promise<ClaimedAnalysisRunJob | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{
      id: string;
      analysis_run_id: string;
      source_relative_path: string;
    }>(`
      WITH candidate AS (
        SELECT id
        FROM jobs
        WHERE
          status = 'queued'
          OR (
            status = 'processing'
            AND locked_at < now() - interval '30 seconds'
          )
        ORDER BY created_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE jobs AS job
      SET
        status = 'processing',
        attempts = attempts + 1,
        locked_at = now(),
        error_message = NULL,
        updated_at = now()
      FROM candidate, analysis_runs AS run
      WHERE job.id = candidate.id
        AND run.id = job.analysis_run_id
      RETURNING job.id, job.analysis_run_id, run.source_relative_path
    `);

    const row = result.rows[0];
    if (!row) {
      await client.query("COMMIT");
      return null;
    }

    await client.query(
      `
        UPDATE analysis_runs
        SET status = 'preparing', error_message = NULL, updated_at = now()
        WHERE id = $1
      `,
      [row.analysis_run_id],
    );
    await client.query("COMMIT");
    return {
      id: row.id,
      analysisRunId: row.analysis_run_id,
      sourceRelativePath: row.source_relative_path,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function completeAnalysisRunJob(
  pool: Pool,
  job: Pick<ClaimedAnalysisRunJob, "id" | "analysisRunId">,
  revision: CompletedSourceRevision,
): Promise<void> {
  const client = await pool.connect();
  const revisionId = randomUUID();
  try {
    await client.query("BEGIN");
    await client.query(
      `
        INSERT INTO source_revisions (
          id,
          analysis_run_id,
          fingerprint,
          snapshot_path,
          working_copy_path
        )
        VALUES ($1, $2, $3, $4, $5)
      `,
      [
        revisionId,
        job.analysisRunId,
        revision.fingerprint,
        revision.snapshotPath,
        revision.workingCopyPath,
      ],
    );
    const runResult = await client.query(
      `
        UPDATE analysis_runs
        SET
          source_revision_id = $1,
          status = 'ready',
          error_message = NULL,
          updated_at = now()
        WHERE id = $2 AND status = 'preparing'
      `,
      [revisionId, job.analysisRunId],
    );
    const jobResult = await client.query(
      `
        UPDATE jobs
        SET
          status = 'completed',
          locked_at = NULL,
          error_message = NULL,
          updated_at = now()
        WHERE id = $1 AND status = 'processing'
      `,
      [job.id],
    );
    if (runResult.rowCount !== 1 || jobResult.rowCount !== 1) {
      throw new Error("Claimed analysis job changed before completion");
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function failAnalysisRunJob(
  pool: Pool,
  job: Pick<ClaimedAnalysisRunJob, "id" | "analysisRunId">,
  message: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `
        UPDATE analysis_runs
        SET status = 'failed', error_message = $1, updated_at = now()
        WHERE id = $2
      `,
      [message, job.analysisRunId],
    );
    await client.query(
      `
        UPDATE jobs
        SET
          status = 'failed',
          locked_at = NULL,
          error_message = $1,
          updated_at = now()
        WHERE id = $2
      `,
      [message, job.id],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
