import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";

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
