import { randomUUID } from "node:crypto";

import type { Pool } from "pg";

export type AuthStep =
  | { type: "navigate"; url: string }
  | { type: "fill"; selector: string; envVarRef: string }
  | { type: "click"; selector: string }
  | { type: "wait_for_selector"; selector: string };

export type ExplorationConfiguration = {
  id: string;
  analysisRunId: string;
  startupPackageManager: string | null;
  startupScript: string | null;
  envVarRefs: string[];
  authSteps: AuthStep[] | null;
  storageStateEnvVar: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

type ExplorationConfigRow = {
  id: string;
  analysis_run_id: string;
  startup_package_manager: string | null;
  startup_script: string | null;
  env_var_refs: string[];
  auth_steps: AuthStep[] | null;
  storage_state_env_var: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
};

function mapConfig(row: ExplorationConfigRow): ExplorationConfiguration {
  return {
    id: row.id,
    analysisRunId: row.analysis_run_id,
    startupPackageManager: row.startup_package_manager,
    startupScript: row.startup_script,
    envVarRefs: row.env_var_refs,
    authSteps: row.auth_steps ?? null,
    storageStateEnvVar: row.storage_state_env_var ?? null,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function getExplorationConfiguration(
  pool: Pool,
  analysisRunId: string,
): Promise<ExplorationConfiguration | null> {
  const result = await pool.query<ExplorationConfigRow>(
    `SELECT * FROM exploration_configurations WHERE analysis_run_id = $1`,
    [analysisRunId],
  );
  return result.rows[0] ? mapConfig(result.rows[0]) : null;
}

export async function upsertExplorationConfiguration(
  pool: Pool,
  analysisRunId: string,
  values: {
    startupPackageManager: string | null;
    startupScript: string | null;
    envVarRefs: string[];
    authSteps?: AuthStep[] | null;
    storageStateEnvVar?: string | null;
  },
): Promise<ExplorationConfiguration> {
  const id = randomUUID();
  const result = await pool.query<ExplorationConfigRow>(
    `
      INSERT INTO exploration_configurations (
        id, analysis_run_id, startup_package_manager, startup_script, env_var_refs,
        auth_steps, storage_state_env_var
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (analysis_run_id) DO UPDATE
        SET
          startup_package_manager = EXCLUDED.startup_package_manager,
          startup_script = EXCLUDED.startup_script,
          env_var_refs = EXCLUDED.env_var_refs,
          auth_steps = EXCLUDED.auth_steps,
          storage_state_env_var = EXCLUDED.storage_state_env_var,
          version = exploration_configurations.version + 1,
          updated_at = now()
      RETURNING *
    `,
    [
      id,
      analysisRunId,
      values.startupPackageManager,
      values.startupScript,
      values.envVarRefs,
      values.authSteps ? JSON.stringify(values.authSteps) : null,
      values.storageStateEnvVar ?? null,
    ],
  );
  return mapConfig(result.rows[0]);
}

export type StartupContractSnapshot = {
  id: string;
  analysisRunId: string;
  packageManager: string;
  installArgs: string[];
  startScript: string;
  detectionSource: "auto" | "override";
  createdAt: string;
};

type SnapshotRow = {
  id: string;
  analysis_run_id: string;
  package_manager: string;
  install_args: string[];
  start_script: string;
  detection_source: "auto" | "override";
  created_at: Date;
};

export async function saveStartupContractSnapshot(
  pool: Pool,
  snapshot: {
    analysisRunId: string;
    packageManager: string;
    installArgs: string[];
    startScript: string;
    detectionSource: "auto" | "override";
  },
): Promise<void> {
  await pool.query(
    `
      INSERT INTO startup_contract_snapshots (
        id, analysis_run_id, package_manager, install_args, start_script, detection_source
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (analysis_run_id) DO UPDATE
        SET
          package_manager = EXCLUDED.package_manager,
          install_args = EXCLUDED.install_args,
          start_script = EXCLUDED.start_script,
          detection_source = EXCLUDED.detection_source,
          created_at = now()
    `,
    [
      randomUUID(),
      snapshot.analysisRunId,
      snapshot.packageManager,
      snapshot.installArgs,
      snapshot.startScript,
      snapshot.detectionSource,
    ],
  );
}

export async function getStartupContractSnapshot(
  pool: Pool,
  analysisRunId: string,
): Promise<StartupContractSnapshot | null> {
  const result = await pool.query<SnapshotRow>(
    `SELECT * FROM startup_contract_snapshots WHERE analysis_run_id = $1`,
    [analysisRunId],
  );
  if (!result.rows[0]) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    analysisRunId: row.analysis_run_id,
    packageManager: row.package_manager,
    installArgs: row.install_args,
    startScript: row.start_script,
    detectionSource: row.detection_source,
    createdAt: row.created_at.toISOString(),
  };
}
