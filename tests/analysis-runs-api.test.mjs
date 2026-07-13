import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { migrate } from "@analysis-tool/database";
import pg from "pg";

import { startPostgres } from "./helpers/postgres.mjs";
import { startWebServer } from "./helpers/web-server.mjs";

test("persists a queued analysis run through the HTTP API", async (context) => {
  const postgres = await startPostgres();
  let pool;
  let root;
  let server;
  context.after(async () => {
    await server?.stop();
    await pool?.end();
    if (root) {
      await rm(root, { recursive: true, force: true });
    }
    await postgres.stop();
  });

  pool = new pg.Pool({ connectionString: postgres.databaseUrl });
  await migrate(pool);

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

  const invalidResponse = await fetch(`${server.url}/api/analysis-runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourceProject: "../outside" }),
  });
  assert.equal(invalidResponse.status, 400);
});
