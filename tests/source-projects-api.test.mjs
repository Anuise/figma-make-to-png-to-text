import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { startWebServer } from "./helpers/web-server.mjs";

test("lists only direct child source-project directories", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "analysis-sources-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "zeta-project"));
  await mkdir(join(root, "alpha-project"));
  await writeFile(join(root, "notes.txt"), "not a project");

  const server = await startWebServer({ SOURCE_PROJECTS_ROOT: root });
  context.after(() => server.stop());

  const response = await fetch(`${server.url}/api/source-projects`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    projects: [
      { name: "alpha-project", relativePath: "alpha-project" },
      { name: "zeta-project", relativePath: "zeta-project" },
    ],
  });
});
