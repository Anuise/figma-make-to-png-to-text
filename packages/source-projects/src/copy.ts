import { randomUUID } from "node:crypto";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { fingerprintDirectory } from "./fingerprint.js";

export type PreparedSourceRevision = {
  fingerprint: string;
  snapshotPath: string;
  workingCopyPath: string;
};

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function setTreeMode(
  path: string,
  directoryMode: number,
  fileMode: number,
): Promise<void> {
  const stats = await lstat(path);
  if (stats.isDirectory()) {
    for (const entry of await readdir(path)) {
      await setTreeMode(join(path, entry), directoryMode, fileMode);
    }
    await chmod(path, directoryMode);
    return;
  }
  await chmod(path, fileMode);
}

async function removeTree(path: string): Promise<void> {
  if (!(await pathExists(path))) {
    return;
  }
  await setTreeMode(path, 0o755, 0o644).catch(() => undefined);
  await rm(path, { recursive: true, force: true });
}

async function removeTemporarySiblings(finalPath: string): Promise<void> {
  const parent = dirname(finalPath);
  const prefix = `${basename(finalPath)}.tmp-`;
  if (!(await pathExists(parent))) {
    return;
  }

  for (const entry of await readdir(parent)) {
    if (entry.startsWith(prefix)) {
      await removeTree(join(parent, entry));
    }
  }
}

export async function cleanupPreparedRevision(
  prepared: Pick<PreparedSourceRevision, "snapshotPath" | "workingCopyPath">,
): Promise<void> {
  const results = await Promise.allSettled([
    removeTree(prepared.workingCopyPath),
    removeTree(prepared.snapshotPath),
  ]);
  const errors = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (errors.length > 0) {
    throw new AggregateError(errors, "Failed to clean prepared source revision");
  }
}

export async function prepareSourceRevision(options: {
  analysisRunId: string;
  dataRoot: string;
  sourcePath: string;
}): Promise<PreparedSourceRevision> {
  const snapshotsRoot = join(options.dataRoot, "source-revisions");
  const workingCopiesRoot = join(options.dataRoot, "working-copies");
  const snapshotPath = join(snapshotsRoot, options.analysisRunId);
  const workingCopyPath = join(workingCopiesRoot, options.analysisRunId);
  const temporarySnapshot = `${snapshotPath}.tmp-${randomUUID()}`;
  const temporaryWorkingCopy = `${workingCopyPath}.tmp-${randomUUID()}`;

  await mkdir(snapshotsRoot, { recursive: true });
  await mkdir(workingCopiesRoot, { recursive: true });
  await removeTemporarySiblings(snapshotPath);
  await removeTemporarySiblings(workingCopyPath);

  try {
    const sourceFingerprint = await fingerprintDirectory(options.sourcePath);

    if (await pathExists(snapshotPath)) {
      const existingFingerprint = await fingerprintDirectory(snapshotPath);
      if (existingFingerprint !== sourceFingerprint) {
        await cleanupPreparedRevision({ snapshotPath, workingCopyPath });
      }
    }

    if (!(await pathExists(snapshotPath))) {
      await cp(options.sourcePath, temporarySnapshot, {
        recursive: true,
        dereference: false,
        errorOnExist: true,
        force: false,
      });
      const copiedFingerprint = await fingerprintDirectory(temporarySnapshot);
      if (copiedFingerprint !== sourceFingerprint) {
        throw new Error("Source project changed while its revision was copied");
      }
      await setTreeMode(temporarySnapshot, 0o555, 0o444);
      await rename(temporarySnapshot, snapshotPath);
    }

    await removeTree(workingCopyPath);
    await cp(snapshotPath, temporaryWorkingCopy, {
      recursive: true,
      dereference: false,
      errorOnExist: true,
      force: false,
    });
    await setTreeMode(temporaryWorkingCopy, 0o755, 0o644);
    await rename(temporaryWorkingCopy, workingCopyPath);

    return {
      fingerprint: sourceFingerprint,
      snapshotPath,
      workingCopyPath,
    };
  } catch (error) {
    await removeTree(temporarySnapshot);
    await removeTree(temporaryWorkingCopy);
    await cleanupPreparedRevision({ snapshotPath, workingCopyPath });
    throw error;
  }
}
