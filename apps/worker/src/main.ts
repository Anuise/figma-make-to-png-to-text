import { setTimeout } from "node:timers/promises";

import { getPool, migrate } from "@analysis-tool/database";

import { processNextJob } from "./process-next-job.js";

const once = process.argv.includes("--once");
const pool = getPool();
const sourceProjectsRoot = process.env.SOURCE_PROJECTS_ROOT;
const dataRoot = process.env.ANALYSIS_DATA_ROOT;

if (!sourceProjectsRoot || !dataRoot) {
  throw new Error("SOURCE_PROJECTS_ROOT and ANALYSIS_DATA_ROOT are required");
}

try {
  await migrate(pool);
  do {
    const processed = await processNextJob({
      dataRoot,
      pool,
      sourceProjectsRoot,
    });
    if (!processed && !once) {
      await setTimeout(1_000);
    }
  } while (!once);
} finally {
  await pool.end();
}
