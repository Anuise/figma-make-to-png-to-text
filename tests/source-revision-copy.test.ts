import assert from "node:assert/strict";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { prepareSourceRevision } from "@analysis-tool/source-projects";

async function makeTreeWritable(path: string): Promise<void> {
  let stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  if (stats.isDirectory()) {
    for (const entry of await readdir(path)) {
      await makeTreeWritable(join(path, entry));
    }
    await chmod(path, 0o755);
  } else {
    await chmod(path, 0o644);
  }
}

test("reuses a verified orphan snapshot without overwriting it", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "analysis-copy-retry-"));
  const source = join(root, "source");
  const dataRoot = join(root, "data");
  await mkdir(source);
  await writeFile(join(source, "source.txt"), "version one\n");
  context.after(async () => {
    await makeTreeWritable(root);
    await rm(root, { recursive: true, force: true });
  });

  const first = await prepareSourceRevision({
    analysisRunId: "run-1",
    claimToken: "1",
    dataRoot,
    sourcePath: source,
  });
  await rm(first.workingCopyPath, { recursive: true, force: true });

  const retried = await prepareSourceRevision({
    analysisRunId: "run-1",
    claimToken: "2",
    dataRoot,
    sourcePath: source,
  });
  assert.deepEqual(retried, first);
  assert.equal(
    await readFile(join(retried.workingCopyPath, "source.txt"), "utf8"),
    "version one\n",
  );

  await writeFile(join(source, "source.txt"), "version two\n");
  await assert.rejects(
    prepareSourceRevision({
      analysisRunId: "run-1",
      claimToken: "3",
      dataRoot,
      sourcePath: source,
    }),
    /Existing source revision does not match/,
  );
  assert.equal(
    await readFile(join(first.snapshotPath, "source.txt"), "utf8"),
    "version one\n",
  );
});
