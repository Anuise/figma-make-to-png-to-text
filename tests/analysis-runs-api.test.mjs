import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createAnalysisRun,
  listAnalysisRuns,
  migrate,
} from "@analysis-tool/database";
import pg from "pg";

import { startPostgres } from "./helpers/postgres.mjs";
import { startWebServer } from "./helpers/web-server.mjs";

test("persists a queued analysis run through the HTTP API", async (context) => {
  const postgres = await startPostgres();
  let pool;
  let root;
  let server;
  let postgresStopped = false;
  context.after(async () => {
    const errors = [];
    for (const cleanup of [
      () => server?.stop(),
      () => pool?.end(),
      () => (root ? rm(root, { recursive: true, force: true }) : undefined),
      () => (postgresStopped ? undefined : postgres.stop()),
    ]) {
      try {
        await cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "Analysis Run test cleanup failed");
    }
  });

  pool = new pg.Pool({ connectionString: postgres.databaseUrl });
  await migrate(pool);
  await migrate(pool);

  await pool.query(
    "ALTER TABLE jobs ADD CONSTRAINT reject_test_jobs CHECK (false)",
  );
  await assert.rejects(createAnalysisRun(pool, "project-alpha"));
  assert.deepEqual(await listAnalysisRuns(pool), []);
  await pool.query("ALTER TABLE jobs DROP CONSTRAINT reject_test_jobs");

  root = await mkdtemp(join(tmpdir(), "analysis-sources-"));
  await mkdir(join(root, "project-alpha"));

  server = await startWebServer({
    DATABASE_URL: postgres.databaseUrl,
    SOURCE_PROJECTS_ROOT: root,
  });

  const createdResponse = await fetch(`${server.url}/api/analysis-runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourceProject: "project-alpha" }),
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.equal(created.sourceRelativePath, "project-alpha");
  assert.equal(created.status, "queued");
  assert.equal(created.sourceRevision, null);

  const listedResponse = await fetch(`${server.url}/api/analysis-runs`);
  assert.equal(listedResponse.status, 200);
  assert.deepEqual((await listedResponse.json()).runs.map((run) => run.id), [
    created.id,
  ]);

  const detailResponse = await fetch(
    `${server.url}/api/analysis-runs/${created.id}`,
  );
  assert.equal(detailResponse.status, 200);
  assert.deepEqual(await detailResponse.json(), created);

  const missingResponse = await fetch(
    `${server.url}/api/analysis-runs/00000000-0000-4000-8000-000000000000`,
  );
  assert.equal(missingResponse.status, 404);
  assert.deepEqual(await missingResponse.json(), {
    error: "Analysis run not found",
  });

  const malformedIdResponse = await fetch(
    `${server.url}/api/analysis-runs/not-a-uuid`,
  );
  assert.equal(malformedIdResponse.status, 404);

  const invalidResponse = await fetch(`${server.url}/api/analysis-runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourceProject: "../outside" }),
  });
  assert.equal(invalidResponse.status, 400);

  const invalidJsonResponse = await fetch(`${server.url}/api/analysis-runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "not-json",
  });
  assert.equal(invalidJsonResponse.status, 400);

  await pool.end();
  pool = undefined;
  await postgres.stop();
  postgresStopped = true;

  for (const [url, init] of [
    [`${server.url}/api/analysis-runs`, undefined],
    [
      `${server.url}/api/analysis-runs`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceProject: "project-alpha" }),
      },
    ],
    [`${server.url}/api/analysis-runs/${created.id}`, undefined],
  ]) {
    const unavailableResponse = await fetch(url, init);
    assert.equal(unavailableResponse.status, 503);
  }
});
