import { randomUUID } from "node:crypto";

import type { Pool } from "pg";

export type AiExportPolicy = {
  id: string;
  analysisRunId: string;
  dataExportAllowed: boolean;
  aiNoticeAcknowledgedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type AiExportPolicyRow = {
  id: string;
  analysis_run_id: string;
  data_export_allowed: boolean;
  ai_notice_acknowledged_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function mapAiExportPolicy(row: AiExportPolicyRow): AiExportPolicy {
  return {
    id: row.id,
    analysisRunId: row.analysis_run_id,
    dataExportAllowed: row.data_export_allowed,
    aiNoticeAcknowledgedAt: row.ai_notice_acknowledged_at
      ? row.ai_notice_acknowledged_at.toISOString()
      : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export const DEFAULT_AI_EXPORT_POLICY: Pick<
  AiExportPolicy,
  "dataExportAllowed" | "aiNoticeAcknowledgedAt"
> = {
  dataExportAllowed: true,
  aiNoticeAcknowledgedAt: null,
};

export async function getAiExportPolicy(
  pool: Pool,
  analysisRunId: string,
): Promise<AiExportPolicy | null> {
  const result = await pool.query<AiExportPolicyRow>(
    `SELECT * FROM ai_export_policies WHERE analysis_run_id = $1`,
    [analysisRunId],
  );
  return result.rows[0] ? mapAiExportPolicy(result.rows[0]) : null;
}

export type AiExportPolicyUpdate = {
  dataExportAllowed?: boolean;
  acknowledgeNotice?: boolean;
};

export async function upsertAiExportPolicy(
  pool: Pool,
  analysisRunId: string,
  update: AiExportPolicyUpdate,
): Promise<AiExportPolicy> {
  const id = randomUUID();
  const result = await pool.query<AiExportPolicyRow>(
    `
      INSERT INTO ai_export_policies (
        id, analysis_run_id, data_export_allowed, ai_notice_acknowledged_at
      )
      VALUES (
        $1, $2, COALESCE($3, true), CASE WHEN $4 THEN now() ELSE NULL END
      )
      ON CONFLICT (analysis_run_id) DO UPDATE
        SET
          data_export_allowed = COALESCE($3, ai_export_policies.data_export_allowed),
          ai_notice_acknowledged_at = CASE
            WHEN $4 THEN now()
            ELSE ai_export_policies.ai_notice_acknowledged_at
          END,
          updated_at = now()
      RETURNING *
    `,
    [
      id,
      analysisRunId,
      update.dataExportAllowed ?? null,
      update.acknowledgeNotice ?? false,
    ],
  );
  return mapAiExportPolicy(result.rows[0]);
}
