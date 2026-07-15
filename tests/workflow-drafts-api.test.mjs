import assert from "node:assert/strict";
import test from "node:test";

import {
  createAnalysisRun,
  insertCandidateScreen,
  insertWorkflowDraft,
  migrate,
  updateCandidateScreenReview,
  upsertAiExportPolicy,
} from "@analysis-tool/database";
import pg from "pg";

import { startPostgres } from "./helpers/postgres.mjs";
import { startWebServer } from "./helpers/web-server.mjs";

test("generates, lists, and reviews workflow drafts through the HTTP API", async (context) => {
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
      throw new AggregateError(errors, "Workflow draft test cleanup failed");
    }
  });

  pool = new pg.Pool({ connectionString: postgres.databaseUrl });
  await migrate(pool);

  const run = await createAnalysisRun(pool, "project-alpha");

  server = await startWebServer({ DATABASE_URL: postgres.databaseUrl });

  const emptyGenerate = await fetch(
    `${server.url}/api/analysis-runs/${run.id}/workflow-drafts`,
    { method: "POST" },
  );
  assert.equal(emptyGenerate.status, 400);

  const screen = await insertCandidateScreen(pool, {
    analysisRunId: run.id,
    route: "/checkout",
    uiFingerprint: "fp-1",
    visibleStateHash: "hash-1",
    operationPath: [],
    screenshotPath: null,
    tracePath: null,
    incompleteReason: null,
  });
  await updateCandidateScreenReview(pool, screen.id, { reviewStatus: "confirmed" });

  const notAcked = await fetch(
    `${server.url}/api/analysis-runs/${run.id}/workflow-drafts`,
    { method: "POST" },
  );
  assert.equal(notAcked.status, 409);

  const ackResponse = await fetch(
    `${server.url}/api/analysis-runs/${run.id}/ai-export-policy`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ acknowledgeNotice: true }),
    },
  );
  assert.equal(ackResponse.status, 200);

  const generateResponse = await fetch(
    `${server.url}/api/analysis-runs/${run.id}/workflow-drafts`,
    { method: "POST" },
  );
  assert.equal(generateResponse.status, 201);
  const { job } = await generateResponse.json();
  assert.equal(job.status, "queued");
  assert.equal(job.analysisRunId, run.id);

  const draft = await insertWorkflowDraft(pool, {
    analysisRunId: run.id,
    workflowDraftJobId: job.id,
    userGoal: "Complete checkout",
    preconditions: ["Cart has at least one item"],
    steps: ["Open checkout", "Submit payment"],
    expectedResult: "Order confirmation shown",
    exceptions: ["Payment declined"],
    relatedScreenIds: [screen.id],
  });

  const secondGenerate = await fetch(
    `${server.url}/api/analysis-runs/${run.id}/workflow-drafts`,
    { method: "POST" },
  );
  assert.equal(secondGenerate.status, 400);

  const listResponse = await fetch(
    `${server.url}/api/analysis-runs/${run.id}/workflow-drafts`,
  );
  assert.equal(listResponse.status, 200);
  const { drafts } = await listResponse.json();
  assert.equal(drafts.length, 1);
  assert.deepEqual(drafts[0].relatedScreenIds, [screen.id]);
  assert.equal(drafts[0].reviewStatus, "pending");
  assert.equal(drafts[0].userGoal, "Complete checkout");

  const patchResponse = await fetch(
    `${server.url}/api/analysis-runs/${run.id}/workflow-drafts/${draft.id}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reviewStatus: "confirmed", draftTitle: "Checkout flow" }),
    },
  );
  assert.equal(patchResponse.status, 200);
  const patched = await patchResponse.json();
  assert.equal(patched.reviewStatus, "confirmed");
  assert.equal(patched.draftTitle, "Checkout flow");

  const batchResponse = await fetch(
    `${server.url}/api/analysis-runs/${run.id}/workflow-drafts/batch-review`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [draft.id], reviewStatus: "excluded" }),
    },
  );
  assert.equal(batchResponse.status, 200);
  const { drafts: batched } = await batchResponse.json();
  assert.equal(batched[0].reviewStatus, "excluded");

  const missingDraft = await fetch(
    `${server.url}/api/analysis-runs/${run.id}/workflow-drafts/00000000-0000-4000-8000-000000000000`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reviewStatus: "confirmed" }),
    },
  );
  assert.equal(missingDraft.status, 404);

  const invalidBatch = await fetch(
    `${server.url}/api/analysis-runs/${run.id}/workflow-drafts/batch-review`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [draft.id], reviewStatus: "merged" }),
    },
  );
  assert.equal(invalidBatch.status, 400);

  const run2 = await createAnalysisRun(pool, "project-alpha");
  const screen2 = await insertCandidateScreen(pool, {
    analysisRunId: run2.id,
    route: "/settings",
    uiFingerprint: "fp-2",
    visibleStateHash: "hash-2",
    operationPath: [],
    screenshotPath: null,
    tracePath: null,
    incompleteReason: null,
  });
  await updateCandidateScreenReview(pool, screen2.id, { reviewStatus: "confirmed" });
  await upsertAiExportPolicy(pool, run2.id, { dataExportAllowed: false });

  const prohibitedGenerate = await fetch(
    `${server.url}/api/analysis-runs/${run2.id}/workflow-drafts`,
    { method: "POST" },
  );
  assert.equal(prohibitedGenerate.status, 201);
  const { job: prohibitedJob } = await prohibitedGenerate.json();
  assert.equal(prohibitedJob.status, "awaiting-manual");

  await pool.end();
  pool = undefined;
  await postgres.stop();
  postgresStopped = true;

  const unavailableResponse = await fetch(
    `${server.url}/api/analysis-runs/${run.id}/workflow-drafts`,
  );
  assert.equal(unavailableResponse.status, 503);
});
