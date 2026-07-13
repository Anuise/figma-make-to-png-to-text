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
    timeout: 30_000,
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

test("worker creates an immutable source revision and writable working copy", async (context) => {
  const postgres = await startPostgres();
  let pool;
  let root;
  let server;

  context.after(async () => {
    const errors = [];
    for (const cleanup of [
      () => server?.stop(),
      () => pool?.end(),
      async () => {
        if (root) {
          await makeTreeWritable(root);
          await rm(root, { recursive: true, force: true });
        }
      },
      () => postgres.stop(),
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

  root = await mkdtemp(join(tmpdir(), "analysis-worker-"));
  const sourceRoot = join(root, "sources");
  const dataRoot = join(root, "data");
  const projectRoot = join(sourceRoot, "project-alpha");
  await mkdir(join(projectRoot, "src"), { recursive: true });
  await writeFile(join(projectRoot, "package.json"), '{"name":"fixture"}\n');
  await writeFile(
    join(projectRoot, "src/index.ts"),
    "export const value = 1;\n",
  );

  pool = new pg.Pool({ connectionString: postgres.databaseUrl });
  await migrate(pool);
  server = await startWebServer({
    DATABASE_URL: postgres.databaseUrl,
    SOURCE_PROJECTS_ROOT: sourceRoot,
  });

  const createdResponse = await fetch(`${server.url}/api/analysis-runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourceProject: "project-alpha" }),
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();

  await runWorkerOnce({
    ANALYSIS_DATA_ROOT: dataRoot,
    DATABASE_URL: postgres.databaseUrl,
    SOURCE_PROJECTS_ROOT: sourceRoot,
  });

  const runResponse = await fetch(
    `${server.url}/api/analysis-runs/${created.id}`,
  );
  assert.equal(runResponse.status, 200);
  const run = await runResponse.json();
  assert.equal(run.status, "ready");
  assert.equal(
    run.sourceRevision.fingerprint,
    "f4f6dc32d7c67eb14d53774d2b653596f0a80236d670c82875e4ef52e259fdf8",
  );
  assert.equal(
    await readFile(join(run.sourceRevision.snapshotPath, "src/index.ts"), "utf8"),
    "export const value = 1;\n",
  );
  assert.equal(
    await readFile(
      join(run.sourceRevision.workingCopyPath, "src/index.ts"),
      "utf8",
    ),
    "export const value = 1;\n",
  );

  await writeFile(
    join(run.sourceRevision.workingCopyPath, "src/index.ts"),
    "changed in working copy\n",
  );
  assert.equal(
    await readFile(join(projectRoot, "src/index.ts"), "utf8"),
    "export const value = 1;\n",
  );
  assert.equal(
    await readFile(join(run.sourceRevision.snapshotPath, "src/index.ts"), "utf8"),
    "export const value = 1;\n",
  );
  await assert.rejects(
    writeFile(
      join(run.sourceRevision.snapshotPath, "src/index.ts"),
      "snapshot mutation\n",
    ),
  );

  const outside = join(root, "outside");
  const unsafeProject = join(sourceRoot, "project-beta");
  await mkdir(outside);
  await mkdir(unsafeProject);
  await symlink(
    outside,
    join(unsafeProject, "escaped-directory"),
    process.platform === "win32" ? "junction" : "dir",
  );

  const unsafeResponse = await fetch(`${server.url}/api/analysis-runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourceProject: "project-beta" }),
  });
  assert.equal(unsafeResponse.status, 201);
  const unsafeRun = await unsafeResponse.json();

  await runWorkerOnce({
    ANALYSIS_DATA_ROOT: dataRoot,
    DATABASE_URL: postgres.databaseUrl,
    SOURCE_PROJECTS_ROOT: sourceRoot,
  });

  const failedResponse = await fetch(
    `${server.url}/api/analysis-runs/${unsafeRun.id}`,
  );
  assert.equal(failedResponse.status, 200);
  const failedRun = await failedResponse.json();
  assert.equal(failedRun.status, "failed");
  assert.equal(failedRun.sourceRevision, null);
  assert.match(failedRun.errorMessage, /symbolic link/);
});
