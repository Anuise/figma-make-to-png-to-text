import { lstat, readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

export type SourceProject = {
  name: string;
  relativePath: string;
};

export async function listSourceProjects(
  root: string,
): Promise<SourceProject[]> {
  const rootRealPath = await realpath(root);
  const entries = await readdir(rootRealPath, { withFileTypes: true });
  const projects: SourceProject[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const candidateRealPath = await realpath(join(rootRealPath, entry.name));
    if (dirname(candidateRealPath) === rootRealPath) {
      projects.push({ name: entry.name, relativePath: entry.name });
    }
  }

  return projects.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
}

export async function resolveSourceProject(
  root: string,
  relativePath: string,
): Promise<string> {
  if (
    !relativePath ||
    isAbsolute(relativePath) ||
    relativePath.includes("/") ||
    relativePath.includes("\\") ||
    relativePath === "." ||
    relativePath === ".."
  ) {
    throw new Error("Invalid source project path");
  }

  const rootRealPath = await realpath(root);
  const candidatePath = join(rootRealPath, relativePath);
  const candidateStat = await lstat(candidatePath);

  if (!candidateStat.isDirectory() || candidateStat.isSymbolicLink()) {
    throw new Error("Invalid source project path");
  }

  const candidateRealPath = await realpath(candidatePath);
  if (dirname(candidateRealPath) !== rootRealPath) {
    throw new Error("Invalid source project path");
  }

  return candidateRealPath;
}
