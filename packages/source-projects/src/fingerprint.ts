import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export async function fingerprintDirectory(root: string): Promise<string> {
  const hash = createHash("sha256");

  async function visit(directory: string, relativeDirectory: string) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );

    for (const entry of entries) {
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      const absolutePath = join(directory, entry.name);
      const stats = await lstat(absolutePath);

      if (stats.isSymbolicLink()) {
        throw new Error(`Source project contains a symbolic link: ${relativePath}`);
      }

      if (stats.isDirectory()) {
        hash.update(`directory\0${relativePath}\0`);
        await visit(absolutePath, relativePath);
        continue;
      }

      if (stats.isFile()) {
        hash.update(`file\0${relativePath}\0`);
        hash.update(await readFile(absolutePath));
        hash.update("\0");
        continue;
      }

      throw new Error(`Source project contains an unsupported entry: ${relativePath}`);
    }
  }

  await visit(root, "");
  return hash.digest("hex");
}
