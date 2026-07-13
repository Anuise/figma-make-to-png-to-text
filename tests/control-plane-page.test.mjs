import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { migrate } from "@analysis-tool/database";
import pg from "pg";

import { startPostgres } from "./helpers/postgres.mjs";
import { startWebServer } from "./helpers/web-server.mjs";

test("renders the source preparation control plane", async (context) => {
  let postgres;
  let pool;
  let root;
  let server;

  context.after(async () => {
    try {
      await server?.stop();
    } finally {
      try {
        await pool?.end();
      } finally {
        try {
          if (root) {
            await rm(root, { recursive: true, force: true });
          }
        } finally {
          await postgres?.stop();
        }
      }
    }
  });

  postgres = await startPostgres();
  pool = new pg.Pool({ connectionString: postgres.databaseUrl });
  root = await mkdtemp(join(tmpdir(), "analysis-sources-"));
  await migrate(pool);
  await mkdir(join(root, "project-alpha"));
  server = await startWebServer({
    DATABASE_URL: postgres.databaseUrl,
    SOURCE_PROJECTS_ROOT: root,
  });

  const response = await fetch(server.url);
  assert.equal(response.status, 200);
  const html = await response.text();

  assert.match(html, /Source preparation ledger/);
  assert.match(html, /Choose a source project/);
  assert.match(html, /Create analysis run/);
  assert.match(html, /No analysis runs yet/);
});
