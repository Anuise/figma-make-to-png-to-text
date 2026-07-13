import assert from "node:assert/strict";
import test from "node:test";

import {
  claimNextAnalysisRunJob,
  completeAnalysisRunJob,
  createAnalysisRun,
  failAnalysisRunJob,
  getAnalysisRun,
  migrate,
} from "@analysis-tool/database";
import pg from "pg";

import { startPostgres } from "./helpers/postgres.mjs";

test("a stale claim cannot complete or fail a reclaimed job", async (context) => {
  const postgres = await startPostgres();
  const pool = new pg.Pool({ connectionString: postgres.databaseUrl });
  context.after(async () => {
    const errors = [];
    for (const cleanup of [() => pool.end(), () => postgres.stop()]) {
      try {
        await cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "Lease fencing test cleanup failed");
    }
  });

  await migrate(pool);
  const run = await createAnalysisRun(pool, "project-alpha");
  const firstClaim = await claimNextAnalysisRunJob(pool);
  assert.equal(firstClaim?.attempt, 1);

  await pool.query(
    "UPDATE jobs SET locked_at = now() - interval '31 seconds' WHERE id = $1",
    [firstClaim.id],
  );
  const secondClaim = await claimNextAnalysisRunJob(pool);
  assert.equal(secondClaim?.attempt, 2);

  const revision = {
    fingerprint: "a".repeat(64),
    snapshotPath: "/data/source-revisions/fenced-run",
    workingCopyPath: "/data/working-copies/fenced-run",
  };
  await assert.rejects(
    completeAnalysisRunJob(pool, firstClaim, revision),
    /claim is no longer current/,
  );
  assert.equal(
    await failAnalysisRunJob(pool, firstClaim, "stale worker failure"),
    false,
  );

  await completeAnalysisRunJob(pool, secondClaim, revision);
  const completed = await getAnalysisRun(pool, run.id);
  assert.equal(completed?.status, "ready");
  assert.equal(completed?.sourceRevision?.fingerprint, revision.fingerprint);
  assert.equal(await claimNextAnalysisRunJob(pool), null);
});
