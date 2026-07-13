import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolveSourceProject } from "@analysis-tool/source-projects";

test("resolves only a direct child source-project directory", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "analysis-paths-"));
  const root = join(parent, "sources");
  const outside = join(parent, "outside");
  await mkdir(join(root, "project-alpha"), { recursive: true });
  await mkdir(join(root, "nested", "project"), { recursive: true });
  await mkdir(outside);
  await writeFile(join(root, "notes.txt"), "not a project");
  await symlink(
    outside,
    join(root, "escaped-project"),
    process.platform === "win32" ? "junction" : "dir",
  );
  context.after(() => rm(parent, { recursive: true, force: true }));

  assert.equal(
    await resolveSourceProject(root, "project-alpha"),
    await realpath(join(root, "project-alpha")),
  );

  for (const invalidPath of [
    "",
    ".",
    "..",
    "nested/project",
    "nested\\project",
    join(parent, "outside"),
    "notes.txt",
    "escaped-project",
  ]) {
    await assert.rejects(
      resolveSourceProject(root, invalidPath),
      /Invalid source project path/,
      invalidPath,
    );
  }
});
