import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { fingerprintDirectory } from "@analysis-tool/source-projects";

test("fingerprints records in global normalized path order", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "analysis-fingerprint-"));
  const source = join(parent, "source");
  await mkdir(join(source, "a"), { recursive: true });
  await writeFile(join(source, "a", "z.txt"), "z\n");
  await writeFile(join(source, "a-1.txt"), "one\n");
  context.after(() => rm(parent, { recursive: true, force: true }));

  assert.equal(
    await fingerprintDirectory(source),
    "4c4f4ec7ada1c5585eabc20e31f97e8bff0cc4b42f708ae2715592ccca84fb7a",
  );

  const linkedRoot = join(parent, "linked-source");
  await symlink(
    source,
    linkedRoot,
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(
    fingerprintDirectory(linkedRoot),
    /root must be a directory, not a symbolic link/,
  );
});
