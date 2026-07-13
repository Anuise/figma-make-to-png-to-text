import { randomUUID } from "node:crypto";

import type { Pool } from "pg";

export type CandidateScreen = {
  id: string;
  analysisRunId: string;
  route: string;
  uiFingerprint: string;
  visibleStateHash: string;
  operationPath: string[];
  screenshotPath: string | null;
  tracePath: string | null;
  incompleteReason: string | null;
  createdAt: string;
};

type CandidateScreenRow = {
  id: string;
  analysis_run_id: string;
  route: string;
  ui_fingerprint: string;
  visible_state_hash: string;
  operation_path: string[];
  screenshot_path: string | null;
  trace_path: string | null;
  incomplete_reason: string | null;
  created_at: Date;
};

function mapCandidateScreen(row: CandidateScreenRow): CandidateScreen {
  return {
    id: row.id,
    analysisRunId: row.analysis_run_id,
    route: row.route,
    uiFingerprint: row.ui_fingerprint,
    visibleStateHash: row.visible_state_hash,
    operationPath: row.operation_path,
    screenshotPath: row.screenshot_path,
    tracePath: row.trace_path,
    incompleteReason: row.incomplete_reason,
    createdAt: row.created_at.toISOString(),
  };
}

export async function insertCandidateScreen(
  pool: Pool,
  data: {
    analysisRunId: string;
    route: string;
    uiFingerprint: string;
    visibleStateHash: string;
    operationPath: string[];
    screenshotPath: string | null;
    tracePath: string | null;
    incompleteReason: string | null;
  },
): Promise<CandidateScreen> {
  const id = randomUUID();
  const result = await pool.query<CandidateScreenRow>(
    `
      INSERT INTO candidate_screens (
        id, analysis_run_id, route, ui_fingerprint, visible_state_hash,
        operation_path, screenshot_path, trace_path, incomplete_reason
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `,
    [
      id,
      data.analysisRunId,
      data.route,
      data.uiFingerprint,
      data.visibleStateHash,
      data.operationPath,
      data.screenshotPath,
      data.tracePath,
      data.incompleteReason,
    ],
  );
  return mapCandidateScreen(result.rows[0]);
}

export async function listCandidateScreens(
  pool: Pool,
  analysisRunId: string,
): Promise<CandidateScreen[]> {
  const result = await pool.query<CandidateScreenRow>(
    `SELECT * FROM candidate_screens WHERE analysis_run_id = $1 ORDER BY created_at`,
    [analysisRunId],
  );
  return result.rows.map(mapCandidateScreen);
}

export type ExplorationCheckpoint = {
  id: string;
  analysisRunId: string;
  exhaustedLimit: "interactions" | "screens" | "time" | "error";
  pendingBranches: string[];
  createdAt: string;
};

type CheckpointRow = {
  id: string;
  analysis_run_id: string;
  exhausted_limit: "interactions" | "screens" | "time" | "error";
  pending_branches: string[];
  created_at: Date;
};

function mapCheckpoint(row: CheckpointRow): ExplorationCheckpoint {
  return {
    id: row.id,
    analysisRunId: row.analysis_run_id,
    exhaustedLimit: row.exhausted_limit,
    pendingBranches: row.pending_branches,
    createdAt: row.created_at.toISOString(),
  };
}

export async function upsertExplorationCheckpoint(
  pool: Pool,
  data: {
    analysisRunId: string;
    exhaustedLimit: "interactions" | "screens" | "time" | "error";
    pendingBranches: string[];
  },
): Promise<ExplorationCheckpoint> {
  const id = randomUUID();
  const result = await pool.query<CheckpointRow>(
    `
      INSERT INTO exploration_checkpoints (
        id, analysis_run_id, exhausted_limit, pending_branches
      )
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (analysis_run_id) DO UPDATE
        SET
          exhausted_limit = EXCLUDED.exhausted_limit,
          pending_branches = EXCLUDED.pending_branches,
          created_at = now()
      RETURNING *
    `,
    [id, data.analysisRunId, data.exhaustedLimit, JSON.stringify(data.pendingBranches)],
  );
  return mapCheckpoint(result.rows[0]);
}

export async function getExplorationCheckpoint(
  pool: Pool,
  analysisRunId: string,
): Promise<ExplorationCheckpoint | null> {
  const result = await pool.query<CheckpointRow>(
    `SELECT * FROM exploration_checkpoints WHERE analysis_run_id = $1`,
    [analysisRunId],
  );
  return result.rows[0] ? mapCheckpoint(result.rows[0]) : null;
}
