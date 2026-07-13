import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";

export type PackageManager = "npm" | "yarn" | "pnpm" | "bun";

export type StartupContract = {
  packageManager: PackageManager;
  installArgs: string[];
  startScript: string;
  detectionSource: "auto" | "override";
};

export type StartupContractDetectionResult =
  | { ok: true; contract: StartupContract }
  | { ok: false; reason: string };

export type StartupContractOverride = {
  packageManager?: PackageManager;
  startScript?: string;
};

const LOCKFILES: Record<string, PackageManager> = {
  "package-lock.json": "npm",
  "yarn.lock": "yarn",
  "pnpm-lock.yaml": "pnpm",
  "bun.lockb": "bun",
};

const INSTALL_ARGS: Record<PackageManager, string[]> = {
  npm: ["ci"],
  yarn: ["install", "--frozen-lockfile"],
  pnpm: ["install", "--frozen-lockfile"],
  bun: ["install", "--frozen-lockfile"],
};

async function fileExists(path: string): Promise<boolean> {
  try {
    const stats = await lstat(path);
    return stats.isFile();
  } catch {
    return false;
  }
}

async function readPackageJson(
  workingCopyPath: string,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; reason: string }> {
  let raw: string;
  try {
    raw = await readFile(join(workingCopyPath, "package.json"), "utf8");
  } catch {
    return { ok: false, reason: "package.json not found" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "package.json is not valid JSON" };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, reason: "package.json root is not an object" };
  }

  return { ok: true, data: parsed as Record<string, unknown> };
}

async function detectPackageManager(
  workingCopyPath: string,
): Promise<{ ok: true; pm: PackageManager } | { ok: false; reason: string }> {
  const found: PackageManager[] = [];
  for (const [filename, pm] of Object.entries(LOCKFILES)) {
    if (await fileExists(join(workingCopyPath, filename))) {
      found.push(pm);
    }
  }

  if (found.length === 1) {
    return { ok: true, pm: found[0] };
  }

  if (found.length > 1) {
    return {
      ok: false,
      reason: `Multiple lockfiles found: ${found.join(", ")}`,
    };
  }

  const pkg = await readPackageJson(workingCopyPath);
  if (!pkg.ok) {
    return pkg;
  }

  const pmField = pkg.data.packageManager;
  if (typeof pmField === "string") {
    for (const pm of Object.keys(INSTALL_ARGS) as PackageManager[]) {
      if (pmField.startsWith(`${pm}@`) || pmField === pm) {
        return { ok: true, pm };
      }
    }
    return {
      ok: false,
      reason: `Unrecognised packageManager field: ${pmField}`,
    };
  }

  return { ok: false, reason: "No lockfile or packageManager field found" };
}

async function detectStartScript(
  workingCopyPath: string,
): Promise<{ ok: true; script: string } | { ok: false; reason: string }> {
  const pkg = await readPackageJson(workingCopyPath);
  if (!pkg.ok) {
    return pkg;
  }

  const scripts =
    typeof pkg.data.scripts === "object" && pkg.data.scripts !== null
      ? (pkg.data.scripts as Record<string, unknown>)
      : {};

  for (const candidate of ["dev", "start"]) {
    if (typeof scripts[candidate] === "string") {
      return { ok: true, script: candidate };
    }
  }

  return { ok: false, reason: 'No "dev" or "start" script found in package.json' };
}

export async function detectStartupContract(
  workingCopyPath: string,
  override?: StartupContractOverride,
): Promise<StartupContractDetectionResult> {
  const pmResult = override?.packageManager
    ? ({ ok: true, pm: override.packageManager } as const)
    : await detectPackageManager(workingCopyPath);

  if (!pmResult.ok) {
    return { ok: false, reason: pmResult.reason };
  }

  const scriptResult = override?.startScript
    ? ({ ok: true, script: override.startScript } as const)
    : await detectStartScript(workingCopyPath);

  if (!scriptResult.ok) {
    return { ok: false, reason: scriptResult.reason };
  }

  const isOverride = Boolean(override?.packageManager || override?.startScript);

  return {
    ok: true,
    contract: {
      packageManager: pmResult.pm,
      installArgs: INSTALL_ARGS[pmResult.pm],
      startScript: scriptResult.script,
      detectionSource: isOverride ? "override" : "auto",
    },
  };
}
