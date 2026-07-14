import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { detectStartupContract } from "@analysis-tool/source-projects";

const BASE_PACKAGE_JSON = JSON.stringify({
  name: "test-project",
  private: true,
  scripts: { dev: "vite" },
});

async function makeProject(
  files: Record<string, string>,
): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "startup-contract-"));
  for (const [rel, content] of Object.entries(files)) {
    const parts = rel.split("/");
    if (parts.length > 1) {
      await mkdir(join(root, ...parts.slice(0, -1)), { recursive: true });
    }
    await writeFile(join(root, rel), content);
  }
  return { path: root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("detects npm from package-lock.json", async () => {
  const { path, cleanup } = await makeProject({
    "package.json": BASE_PACKAGE_JSON,
    "package-lock.json": '{"lockfileVersion":3,"packages":{}}',
  });
  try {
    const result = await detectStartupContract(path);
    assert.ok(result.ok);
    assert.equal(result.contract.packageManager, "npm");
    assert.deepEqual(result.contract.installArgs, ["ci"]);
    assert.equal(result.contract.startScript, "dev");
    assert.equal(result.contract.detectionSource, "auto");
  } finally {
    await cleanup();
  }
});

test("detects yarn from yarn.lock", async () => {
  const { path, cleanup } = await makeProject({
    "package.json": BASE_PACKAGE_JSON,
    "yarn.lock": "# yarn lockfile v1\n",
  });
  try {
    const result = await detectStartupContract(path);
    assert.ok(result.ok);
    assert.equal(result.contract.packageManager, "yarn");
    assert.deepEqual(result.contract.installArgs, ["install", "--frozen-lockfile"]);
  } finally {
    await cleanup();
  }
});

test("detects pnpm from pnpm-lock.yaml", async () => {
  const { path, cleanup } = await makeProject({
    "package.json": BASE_PACKAGE_JSON,
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
  });
  try {
    const result = await detectStartupContract(path);
    assert.ok(result.ok);
    assert.equal(result.contract.packageManager, "pnpm");
  } finally {
    await cleanup();
  }
});

test("detects bun from bun.lockb", async () => {
  const { path, cleanup } = await makeProject({
    "package.json": BASE_PACKAGE_JSON,
    "bun.lockb": "\x00",
  });
  try {
    const result = await detectStartupContract(path);
    assert.ok(result.ok);
    assert.equal(result.contract.packageManager, "bun");
  } finally {
    await cleanup();
  }
});

test("detects package manager from packageManager field when no lockfile", async () => {
  const { path, cleanup } = await makeProject({
    "package.json": JSON.stringify({
      name: "test",
      packageManager: "pnpm@9.0.0",
      scripts: { dev: "vite" },
    }),
  });
  try {
    const result = await detectStartupContract(path);
    assert.ok(result.ok);
    assert.equal(result.contract.packageManager, "pnpm");
    assert.deepEqual(result.contract.installArgs, ["install"]);
  } finally {
    await cleanup();
  }
});

test("lockfile takes priority over packageManager field", async () => {
  const { path, cleanup } = await makeProject({
    "package.json": JSON.stringify({
      name: "test",
      packageManager: "pnpm@9.0.0",
      scripts: { dev: "vite" },
    }),
    "package-lock.json": '{"lockfileVersion":3,"packages":{}}',
  });
  try {
    const result = await detectStartupContract(path);
    assert.ok(result.ok);
    assert.equal(result.contract.packageManager, "npm");
  } finally {
    await cleanup();
  }
});

test("ambiguous when multiple lockfiles found", async () => {
  const { path, cleanup } = await makeProject({
    "package.json": BASE_PACKAGE_JSON,
    "package-lock.json": '{"lockfileVersion":3,"packages":{}}',
    "yarn.lock": "# yarn lockfile v1\n",
  });
  try {
    const result = await detectStartupContract(path);
    assert.ok(!result.ok);
    assert.match(result.reason, /Multiple lockfiles/);
  } finally {
    await cleanup();
  }
});

test("defaults to npm with plain install when no lockfile and no packageManager field", async () => {
  const { path, cleanup } = await makeProject({
    "package.json": JSON.stringify({ name: "test", scripts: { dev: "vite" } }),
  });
  try {
    const result = await detectStartupContract(path);
    assert.ok(result.ok);
    assert.equal(result.contract.packageManager, "npm");
    assert.deepEqual(result.contract.installArgs, ["install"]);
    assert.equal(result.contract.detectionSource, "auto");
  } finally {
    await cleanup();
  }
});

test("ambiguous when no dev or start script", async () => {
  const { path, cleanup } = await makeProject({
    "package.json": JSON.stringify({
      name: "test",
      scripts: { build: "tsc" },
    }),
    "package-lock.json": '{"lockfileVersion":3,"packages":{}}',
  });
  try {
    const result = await detectStartupContract(path);
    assert.ok(!result.ok);
    assert.match(result.reason, /No "dev" or "start" script/);
  } finally {
    await cleanup();
  }
});

test("dev script preferred over start", async () => {
  const { path, cleanup } = await makeProject({
    "package.json": JSON.stringify({
      name: "test",
      scripts: { dev: "vite", start: "node server.js" },
    }),
    "package-lock.json": '{"lockfileVersion":3,"packages":{}}',
  });
  try {
    const result = await detectStartupContract(path);
    assert.ok(result.ok);
    assert.equal(result.contract.startScript, "dev");
  } finally {
    await cleanup();
  }
});

test("start script used when no dev script", async () => {
  const { path, cleanup } = await makeProject({
    "package.json": JSON.stringify({
      name: "test",
      scripts: { start: "node server.js" },
    }),
    "package-lock.json": '{"lockfileVersion":3,"packages":{}}',
  });
  try {
    const result = await detectStartupContract(path);
    assert.ok(result.ok);
    assert.equal(result.contract.startScript, "start");
  } finally {
    await cleanup();
  }
});

test("override package manager skips lockfile detection", async () => {
  const { path, cleanup } = await makeProject({
    "package.json": JSON.stringify({ name: "test", scripts: { dev: "vite" } }),
    "yarn.lock": "# yarn lockfile v1\n",
  });
  try {
    const result = await detectStartupContract(path, { packageManager: "npm" });
    assert.ok(result.ok);
    assert.equal(result.contract.packageManager, "npm");
    assert.equal(result.contract.detectionSource, "override");
    assert.deepEqual(result.contract.installArgs, ["install"]);
  } finally {
    await cleanup();
  }
});

test("override start script skips script detection", async () => {
  const { path, cleanup } = await makeProject({
    "package.json": JSON.stringify({
      name: "test",
      scripts: { dev: "vite" },
    }),
    "package-lock.json": '{"lockfileVersion":3,"packages":{}}',
  });
  try {
    const result = await detectStartupContract(path, { startScript: "serve" });
    assert.ok(result.ok);
    assert.equal(result.contract.startScript, "serve");
    assert.equal(result.contract.detectionSource, "override");
  } finally {
    await cleanup();
  }
});
