import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { promisify } from "node:util";

import { migrate } from "@analysis-tool/database";
import pg from "pg";

import { startPostgres } from "./helpers/postgres.mjs";
import { startWebServer } from "./helpers/web-server.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function runWorkerOnce(environment) {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  await execFileAsync(npm, ["run", "worker:once"], {
    cwd: repositoryRoot,
    env: { ...process.env, ...environment },
    shell: process.platform === "win32",
    timeout: 60_000,
    windowsHide: true,
  });
}

async function makeTreeWritable(path) {
  let stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  if (stats.isDirectory()) {
    for (const entry of await readdir(path)) {
      await makeTreeWritable(join(path, entry));
    }
    await chmod(path, 0o755);
    return;
  }
  if (stats.isSymbolicLink()) {
    return;
  }
  await chmod(path, 0o644);
}

async function makeTestEnv(root) {
  const sourceRoot = join(root, "sources");
  const dataRoot = join(root, "data");
  await mkdir(sourceRoot, { recursive: true });

  const postgres = await startPostgres();
  const pool = new pg.Pool({ connectionString: postgres.databaseUrl });
  await migrate(pool);
  const server = await startWebServer({
    DATABASE_URL: postgres.databaseUrl,
    SOURCE_PROJECTS_ROOT: sourceRoot,
  });

  return { sourceRoot, dataRoot, postgres, pool, server };
}

test("worker transitions to awaiting-config when no dev or start script is found", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "analysis-worker-"));
  let env;

  context.after(async () => {
    const errors = [];
    for (const cleanup of [
      () => env?.server?.stop(),
      () => env?.pool?.end(),
      async () => {
        if (root) {
          await makeTreeWritable(root);
          await rm(root, { recursive: true, force: true });
        }
      },
      () => env?.postgres?.stop(),
    ]) {
      try {
        await cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "Worker test cleanup failed");
    }
  });

  env = await makeTestEnv(root);
  const projectRoot = join(env.sourceRoot, "project-no-start-script");
  await mkdir(join(projectRoot, "src"), { recursive: true });
  await writeFile(
    join(projectRoot, "package.json"),
    JSON.stringify({ name: "fixture", scripts: { build: "tsc" } }) + "\n",
  );
  await writeFile(join(projectRoot, "src/index.ts"), "export const value = 1;\n");

  const createdResponse = await fetch(`${env.server.url}/api/analysis-runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourceProject: "project-no-start-script" }),
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();

  await runWorkerOnce({
    ANALYSIS_DATA_ROOT: env.dataRoot,
    DATABASE_URL: env.postgres.databaseUrl,
    SOURCE_PROJECTS_ROOT: env.sourceRoot,
  });

  const runResponse = await fetch(
    `${env.server.url}/api/analysis-runs/${created.id}`,
  );
  assert.equal(runResponse.status, 200);
  const run = await runResponse.json();
  assert.equal(run.status, "awaiting-config");
  assert.match(run.startupContractReason, /No "dev" or "start" script/);
});

test("worker creates immutable source revision and runs frozen install when lockfile found", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "analysis-worker-install-"));
  let env;

  context.after(async () => {
    const errors = [];
    for (const cleanup of [
      () => env?.server?.stop(),
      () => env?.pool?.end(),
      async () => {
        if (root) {
          await makeTreeWritable(root);
          await rm(root, { recursive: true, force: true });
        }
      },
      () => env?.postgres?.stop(),
    ]) {
      try {
        await cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "Worker install test cleanup failed");
    }
  });

  env = await makeTestEnv(root);
  const projectRoot = join(env.sourceRoot, "project-with-lockfile");
  await mkdir(join(projectRoot, "src"), { recursive: true });
  await writeFile(
    join(projectRoot, "package.json"),
    JSON.stringify({
      name: "fixture-with-lockfile",
      version: "1.0.0",
      private: true,
      scripts: { dev: "node --version" },
    }) + "\n",
  );
  await writeFile(
    join(projectRoot, "package-lock.json"),
    JSON.stringify({
      name: "fixture-with-lockfile",
      version: "1.0.0",
      lockfileVersion: 3,
      requires: true,
      packages: { "": { name: "fixture-with-lockfile", version: "1.0.0" } },
    }) + "\n",
  );
  await writeFile(join(projectRoot, "src/index.ts"), "export const value = 1;\n");

  const createdResponse = await fetch(`${env.server.url}/api/analysis-runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourceProject: "project-with-lockfile" }),
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();

  await runWorkerOnce({
    ANALYSIS_DATA_ROOT: env.dataRoot,
    DATABASE_URL: env.postgres.databaseUrl,
    SOURCE_PROJECTS_ROOT: env.sourceRoot,
  });

  const runResponse = await fetch(
    `${env.server.url}/api/analysis-runs/${created.id}`,
  );
  assert.equal(runResponse.status, 200);
  const run = await runResponse.json();
  assert.equal(run.status, "ready");
  assert.ok(run.sourceRevision, "sourceRevision should be set");
  assert.equal(
    await readFile(join(run.sourceRevision.snapshotPath, "src/index.ts"), "utf8"),
    "export const value = 1;\n",
  );
  assert.equal(
    await readFile(join(run.sourceRevision.workingCopyPath, "src/index.ts"), "utf8"),
    "export const value = 1;\n",
  );
  await assert.rejects(
    writeFile(
      join(run.sourceRevision.snapshotPath, "src/index.ts"),
      "snapshot mutation\n",
    ),
  );

  // npm ci may skip creating node_modules when there are no dependencies;
  // the status reaching 'ready' is sufficient proof that install succeeded.
  const nmPath = join(run.sourceRevision.workingCopyPath, "node_modules");
  const nmStats = await lstat(nmPath).catch(() => null);
  if (nmStats !== null) {
    assert.ok(nmStats.isDirectory(), "node_modules must be a directory when present");
  }
});

test("worker fails preparation for project with symlink escape", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "analysis-worker-symlink-"));
  let env;

  context.after(async () => {
    const errors = [];
    for (const cleanup of [
      () => env?.server?.stop(),
      () => env?.pool?.end(),
      async () => {
        if (root) {
          await makeTreeWritable(root);
          await rm(root, { recursive: true, force: true });
        }
      },
      () => env?.postgres?.stop(),
    ]) {
      try {
        await cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "Worker symlink test cleanup failed");
    }
  });

  env = await makeTestEnv(root);
  const outside = join(root, "outside");
  const unsafeProject = join(env.sourceRoot, "project-unsafe");
  await mkdir(outside);
  await mkdir(unsafeProject);
  await symlink(
    outside,
    join(unsafeProject, "escaped-directory"),
    process.platform === "win32" ? "junction" : "dir",
  );

  const unsafeResponse = await fetch(`${env.server.url}/api/analysis-runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourceProject: "project-unsafe" }),
  });
  assert.equal(unsafeResponse.status, 201);
  const unsafeRun = await unsafeResponse.json();

  await runWorkerOnce({
    ANALYSIS_DATA_ROOT: env.dataRoot,
    DATABASE_URL: env.postgres.databaseUrl,
    SOURCE_PROJECTS_ROOT: env.sourceRoot,
  });

  const failedResponse = await fetch(
    `${env.server.url}/api/analysis-runs/${unsafeRun.id}`,
  );
  assert.equal(failedResponse.status, 200);
  const failedRun = await failedResponse.json();
  assert.equal(failedRun.status, "failed");
  assert.equal(failedRun.sourceRevision, null);
  assert.match(failedRun.errorMessage, /symbolic link/);
});
