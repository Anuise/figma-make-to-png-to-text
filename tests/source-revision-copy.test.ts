import assert from "node:assert/strict";
import {
  access,
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
    claimAttempt: 1,
    dataRoot,
    sourcePath: source,
  });
  await rm(first.workingCopyPath, { recursive: true, force: true });

  const retried = await prepareSourceRevision({
    analysisRunId: "run-1",
    claimAttempt: 2,
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
      claimAttempt: 3,
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

test("an older attempt cannot delete a newer attempt temporary tree", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "analysis-copy-fencing-"));
  const source = join(root, "source");
  const dataRoot = join(root, "data");
  const snapshotsRoot = join(dataRoot, "source-revisions");
  const newerTemporary = join(snapshotsRoot, "run-2.attempt-2.tmp-active");
  await mkdir(source);
  await writeFile(join(source, "source.txt"), "stable source\n");
  await mkdir(newerTemporary, { recursive: true });
  await writeFile(join(newerTemporary, "marker.txt"), "active attempt\n");
  context.after(async () => {
    await makeTreeWritable(root);
    await rm(root, { recursive: true, force: true });
  });

  await prepareSourceRevision({
    analysisRunId: "run-2",
    claimAttempt: 1,
    dataRoot,
    sourcePath: source,
  });
  await access(join(newerTemporary, "marker.txt"));

  await prepareSourceRevision({
    analysisRunId: "run-2",
    claimAttempt: 3,
    dataRoot,
    sourcePath: source,
  });
  await assert.rejects(access(newerTemporary));
});
