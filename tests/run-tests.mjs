import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testsRoot = join(repositoryRoot, "tests");

async function discoverTests(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await discoverTests(path)));
    } else if (/\.test\.(?:mjs|ts)$/.test(entry.name)) {
      files.push(relative(repositoryRoot, path));
    }
  }
  return files;
}

const requestedTests = process.argv.slice(2);
const testFiles =
  requestedTests.length > 0 ? requestedTests : await discoverTests(testsRoot);
testFiles.sort();

const tsxCli = fileURLToPath(import.meta.resolve("tsx/cli"));
const child = spawn(
  process.execPath,
  [tsxCli, "--test", "--test-concurrency=1", ...testFiles],
  { cwd: repositoryRoot, stdio: "inherit" },
);

child.once("error", (error) => {
  throw error;
});
child.once("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exitCode = code ?? 1;
  }
});
