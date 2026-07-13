import { randomUUID } from "node:crypto";

import type { Pool } from "pg";

import { enqueueAnalysisRunJob } from "./jobs.js";

export type AnalysisRunStatus = "queued" | "preparing" | "ready" | "failed";

export type SourceRevision = {
  id: string;
  fingerprint: string;
  snapshotPath: string;
  workingCopyPath: string;
  createdAt: string;
};

export type AnalysisRun = {
  id: string;
  sourceRelativePath: string;
  status: AnalysisRunStatus;
  errorMessage: string | null;
  sourceRevision: SourceRevision | null;
  createdAt: string;
  updatedAt: string;
};

type AnalysisRunRow = {
  id: string;
  source_relative_path: string;
  status: AnalysisRunStatus;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
  revision_id: string | null;
  fingerprint: string | null;
  snapshot_path: string | null;
  working_copy_path: string | null;
  revision_created_at: Date | null;
};

const analysisRunSelect = `
  SELECT
    runs.id,
    runs.source_relative_path,
    runs.status,
    runs.error_message,
    runs.created_at,
    runs.updated_at,
    revisions.id AS revision_id,
    revisions.fingerprint,
    revisions.snapshot_path,
    revisions.working_copy_path,
    revisions.created_at AS revision_created_at
  FROM analysis_runs AS runs
  LEFT JOIN source_revisions AS revisions
    ON revisions.id = runs.source_revision_id
`;

function mapAnalysisRun(row: AnalysisRunRow): AnalysisRun {
  const sourceRevision =
    row.revision_id &&
    row.fingerprint &&
    row.snapshot_path &&
    row.working_copy_path &&
    row.revision_created_at
      ? {
          id: row.revision_id,
          fingerprint: row.fingerprint.trim(),
          snapshotPath: row.snapshot_path,
          workingCopyPath: row.working_copy_path,
          createdAt: row.revision_created_at.toISOString(),
        }
      : null;

  return {
    id: row.id,
    sourceRelativePath: row.source_relative_path,
    status: row.status,
    errorMessage: row.error_message,
    sourceRevision,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function createAnalysisRun(
  pool: Pool,
  sourceRelativePath: string,
): Promise<AnalysisRun> {
  const client = await pool.connect();
  const id = randomUUID();

  try {
    await client.query("BEGIN");
    const result = await client.query<AnalysisRunRow>(
      `
        INSERT INTO analysis_runs (
          id,
          source_relative_path,
          status
        )
        VALUES ($1, $2, 'queued')
        RETURNING
          id,
          source_relative_path,
          status,
          error_message,
          created_at,
          updated_at,
          NULL::uuid AS revision_id,
          NULL::char(64) AS fingerprint,
          NULL::text AS snapshot_path,
          NULL::text AS working_copy_path,
          NULL::timestamptz AS revision_created_at
      `,
      [id, sourceRelativePath],
    );
    await enqueueAnalysisRunJob(client, id);
    await client.query("COMMIT");
    return mapAnalysisRun(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listAnalysisRuns(pool: Pool): Promise<AnalysisRun[]> {
  const result = await pool.query<AnalysisRunRow>(
    `${analysisRunSelect} ORDER BY runs.created_at DESC, runs.id DESC`,
  );
  return result.rows.map(mapAnalysisRun);
}

export async function getAnalysisRun(
  pool: Pool,
  id: string,
): Promise<AnalysisRun | null> {
  const result = await pool.query<AnalysisRunRow>(
    `${analysisRunSelect} WHERE runs.id = $1`,
    [id],
  );
  return result.rows[0] ? mapAnalysisRun(result.rows[0]) : null;
}
