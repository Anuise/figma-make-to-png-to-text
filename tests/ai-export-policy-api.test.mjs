import assert from "node:assert/strict";
import test from "node:test";

import { createAnalysisRun, migrate } from "@analysis-tool/database";
import pg from "pg";

import { startPostgres } from "./helpers/postgres.mjs";
import { startWebServer } from "./helpers/web-server.mjs";

test("reads and updates the AI export policy through the HTTP API", async (context) => {
  const postgres = await startPostgres();
  let pool;
  let server;
  let postgresStopped = false;
  context.after(async () => {
    const errors = [];
    for (const cleanup of [
      () => server?.stop(),
      () => pool?.end(),
      () => (postgresStopped ? undefined : postgres.stop()),
    ]) {
      try {
        await cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "AI export policy test cleanup failed");
    }
  });

  pool = new pg.Pool({ connectionString: postgres.databaseUrl });
  await migrate(pool);
  const run = await createAnalysisRun(pool, "project-alpha");

  server = await startWebServer({ DATABASE_URL: postgres.databaseUrl });

  const defaultResponse = await fetch(
    `${server.url}/api/analysis-runs/${run.id}/ai-export-policy`,
  );
  assert.equal(defaultResponse.status, 200);
  const { policy: defaultPolicy } = await defaultResponse.json();
  assert.equal(defaultPolicy.dataExportAllowed, true);
  assert.equal(defaultPolicy.aiNoticeAcknowledgedAt, null);

  const toggleResponse = await fetch(
    `${server.url}/api/analysis-runs/${run.id}/ai-export-policy`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataExportAllowed: false }),
    },
  );
  assert.equal(toggleResponse.status, 200);
  const { policy: toggled } = await toggleResponse.json();
  assert.equal(toggled.dataExportAllowed, false);
  assert.equal(toggled.aiNoticeAcknowledgedAt, null);

  const ackResponse = await fetch(
    `${server.url}/api/analysis-runs/${run.id}/ai-export-policy`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ acknowledgeNotice: true }),
    },
  );
  assert.equal(ackResponse.status, 200);
  const { policy: acked } = await ackResponse.json();
  assert.equal(acked.dataExportAllowed, false);
  assert.ok(acked.aiNoticeAcknowledgedAt);

  const invalidResponse = await fetch(
    `${server.url}/api/analysis-runs/${run.id}/ai-export-policy`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataExportAllowed: "nope" }),
    },
  );
  assert.equal(invalidResponse.status, 400);

  const malformedIdResponse = await fetch(
    `${server.url}/api/analysis-runs/not-a-uuid/ai-export-policy`,
  );
  assert.equal(malformedIdResponse.status, 404);

  await pool.end();
  pool = undefined;
  await postgres.stop();
  postgresStopped = true;

  const unavailableResponse = await fetch(
    `${server.url}/api/analysis-runs/${run.id}/ai-export-policy`,
  );
  assert.equal(unavailableResponse.status, 503);
});
