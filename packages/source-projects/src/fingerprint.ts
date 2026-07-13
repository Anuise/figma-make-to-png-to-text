import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

type FingerprintRecord =
  | { path: string; type: "directory" }
  | { content: Buffer; path: string; type: "file" };

function comparePaths(left: FingerprintRecord, right: FingerprintRecord): number {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

export async function fingerprintDirectory(root: string): Promise<string> {
  const rootStats = await lstat(root);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error("Source project root must be a directory, not a symbolic link");
  }

  const records: FingerprintRecord[] = [];

  async function collect(directory: string, relativeDirectory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      const absolutePath = join(directory, entry.name);
      const stats = await lstat(absolutePath);

      if (stats.isSymbolicLink()) {
        throw new Error(`Source project contains a symbolic link: ${relativePath}`);
      }

      if (stats.isDirectory()) {
        records.push({ path: relativePath, type: "directory" });
        await collect(absolutePath, relativePath);
        continue;
      }

      if (stats.isFile()) {
        records.push({
          content: await readFile(absolutePath),
          path: relativePath,
          type: "file",
        });
        continue;
      }

      throw new Error(`Source project contains an unsupported entry: ${relativePath}`);
    }
  }

  await collect(root, "");
  records.sort(comparePaths);

  const hash = createHash("sha256");
  for (const record of records) {
    hash.update(`${record.type}\0${record.path}\0`);
    if (record.type === "file") {
      hash.update(record.content);
      hash.update("\0");
    }
  }
  return hash.digest("hex");
}
