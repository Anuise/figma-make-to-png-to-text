import { execFile } from "node:child_process";
import { promisify } from "node:util";

import pg from "pg";

const execFileAsync = promisify(execFile);
const port = 54329;

async function runCompose(project, args) {
  return execFileAsync(
    "docker",
    ["compose", "--project-name", project, ...args],
    {
      env: { ...process.env, POSTGRES_PORT: String(port) },
      timeout: 30_000,
      windowsHide: true,
    },
  );
}

async function waitForPostgres(databaseUrl) {
  const deadline = Date.now() + 30_000;
  const pool = new pg.Pool({ connectionString: databaseUrl });

  try {
    while (Date.now() < deadline) {
      try {
        await pool.query("SELECT 1");
        return;
      } catch {}

      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  } finally {
    await pool.end();
  }

  throw new Error("PostgreSQL did not become ready within 30 seconds");
}

export async function startPostgres() {
  const project = `analysis-tool-test-${process.pid}-${Date.now()}`;
  const databaseUrl = `postgresql://analysis_tool:analysis_tool@127.0.0.1:${port}/analysis_tool`;

  await runCompose(project, ["up", "--detach", "postgres"]);
  try {
    await waitForPostgres(databaseUrl);
  } catch (error) {
    await runCompose(project, ["down", "--volumes", "--remove-orphans"]);
    throw error;
  }

  return {
    databaseUrl,
    stop: () =>
      runCompose(project, ["down", "--volumes", "--remove-orphans"]).then(
        () => undefined,
      ),
  };
}
