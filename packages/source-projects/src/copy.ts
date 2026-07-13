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

async function removeStaleTemporarySiblings(
  finalPath: string,
  currentAttempt: number,
): Promise<void> {
  const parent = dirname(finalPath);
  const escapedName = basename(finalPath).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const temporaryPattern = new RegExp(
    `^${escapedName}\\.attempt-(\\d+)\\.tmp-`,
  );
  if (!(await pathExists(parent))) {
    return;
  }

  const removals = (await readdir(parent))
    .filter((entry) => {
      const match = temporaryPattern.exec(entry);
      return match ? Number(match[1]) < currentAttempt : false;
    })
    .map((entry) => removeTree(join(parent, entry)));
  const results = await Promise.allSettled(removals);
  const errors = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (errors.length > 0) {
    throw new AggregateError(errors, "Failed to clean abandoned temporary paths");
  }
}

async function verifyFingerprint(
  path: string,
  expected: string,
  label: string,
): Promise<void> {
  const actual = await fingerprintDirectory(path);
  if (actual !== expected) {
    throw new Error(`${label} does not match the source fingerprint`);
  }
}

async function publishOrReuse(
  temporaryPath: string,
  finalPath: string,
  expectedFingerprint: string,
  label: string,
): Promise<void> {
  try {
    await rename(temporaryPath, finalPath);
    return;
  } catch (error) {
    if (!(await pathExists(finalPath))) {
      throw error;
    }
  }

  await removeTree(temporaryPath);
  await verifyFingerprint(finalPath, expectedFingerprint, label);
}

async function cleanTemporaryPaths(
  paths: string[],
  processingError: unknown,
): Promise<never> {
  const results = await Promise.allSettled(paths.map(removeTree));
  const cleanupErrors = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      [processingError, ...cleanupErrors],
      "Source revision preparation and temporary cleanup failed",
    );
  }
  throw processingError;
}

export async function prepareSourceRevision(options: {
  analysisRunId: string;
  claimAttempt: number;
  dataRoot: string;
  sourcePath: string;
}): Promise<PreparedSourceRevision> {
  if (!Number.isSafeInteger(options.claimAttempt) || options.claimAttempt < 1) {
    throw new Error("Source revision claim attempt must be a positive integer");
  }

  const snapshotsRoot = join(options.dataRoot, "source-revisions");
  const workingCopiesRoot = join(options.dataRoot, "working-copies");
  const snapshotPath = join(snapshotsRoot, options.analysisRunId);
  const workingCopyPath = join(workingCopiesRoot, options.analysisRunId);
  const temporarySnapshot = `${snapshotPath}.attempt-${options.claimAttempt}.tmp-${randomUUID()}`;
  const temporaryWorkingCopy = `${workingCopyPath}.attempt-${options.claimAttempt}.tmp-${randomUUID()}`;

  await mkdir(snapshotsRoot, { recursive: true });
  await mkdir(workingCopiesRoot, { recursive: true });
  await removeStaleTemporarySiblings(snapshotPath, options.claimAttempt);
  await removeStaleTemporarySiblings(workingCopyPath, options.claimAttempt);

  try {
    const sourceFingerprint = await fingerprintDirectory(options.sourcePath);

    if (await pathExists(snapshotPath)) {
      await verifyFingerprint(
        snapshotPath,
        sourceFingerprint,
        "Existing source revision",
      );
    } else {
      await cp(options.sourcePath, temporarySnapshot, {
        recursive: true,
        dereference: false,
        errorOnExist: true,
        force: false,
      });
      await verifyFingerprint(
        temporarySnapshot,
        sourceFingerprint,
        "Copied source revision",
      );
      await setTreeMode(temporarySnapshot, 0o555, 0o444);
      await publishOrReuse(
        temporarySnapshot,
        snapshotPath,
        sourceFingerprint,
        "Published source revision",
      );
    }

    if (await pathExists(workingCopyPath)) {
      await verifyFingerprint(
        workingCopyPath,
        sourceFingerprint,
        "Existing working copy",
      );
    } else {
      await cp(snapshotPath, temporaryWorkingCopy, {
        recursive: true,
        dereference: false,
        errorOnExist: true,
        force: false,
      });
      await setTreeMode(temporaryWorkingCopy, 0o755, 0o644);
      await verifyFingerprint(
        temporaryWorkingCopy,
        sourceFingerprint,
        "Copied working copy",
      );
      await publishOrReuse(
        temporaryWorkingCopy,
        workingCopyPath,
        sourceFingerprint,
        "Published working copy",
      );
    }

    return {
      fingerprint: sourceFingerprint,
      snapshotPath,
      workingCopyPath,
    };
  } catch (error) {
    return cleanTemporaryPaths(
      [temporarySnapshot, temporaryWorkingCopy],
      error,
    );
  }
}
