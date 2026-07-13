import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:net";
import { promisify } from "node:util";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function fetchWithTimeout(url, init) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function getUnusedPort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    const reject = (error) => rejectListen(error);
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolveListen();
    });
  });
  const address = server.address();
  assert.notEqual(typeof address, "string");
  const port = address.port;
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) {
        rejectClose(error);
      } else {
        resolveClose();
      }
    });
  });
  return port;
}

async function runCompose(project, environment, args, timeout = 180_000) {
  return execFileAsync(
    "docker",
    ["compose", "--project-name", project, ...args],
    {
      cwd: repositoryRoot,
      env: { ...process.env, ...environment, COMPOSE_ANSI: "never" },
      maxBuffer: 10 * 1024 * 1024,
      timeout,
      windowsHide: true,
    },
  );
}

async function getContainerState(project, environment, service) {
  const { stdout: containerId } = await runCompose(
    project,
    environment,
    ["ps", "--quiet", service],
    30_000,
  );
  if (!containerId.trim()) {
    return null;
  }

  const { stdout } = await execFileAsync(
    "docker",
    [
      "inspect",
      "--format",
      "{{json .State}}",
      containerId.trim(),
    ],
    { timeout: 30_000, windowsHide: true },
  );
  return JSON.parse(stdout);
}

async function waitForStack(project, environment, url) {
  const deadline = Date.now() + 90_000;
  let lastError = "stack did not report ready";

  while (Date.now() < deadline) {
    try {
      const [response, ...states] = await Promise.all([
        fetchWithTimeout(`${url}/api/health`),
        ...["postgres", "web", "worker"].map((service) =>
          getContainerState(project, environment, service),
        ),
      ]);
      if (
        response.ok &&
        states.every(
          (state) =>
            state?.Status === "running" && state.Health?.Status === "healthy",
        )
      ) {
        return;
      }
      lastError = JSON.stringify({ response: response.status, states });
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }

  throw new Error(`Compose stack did not become healthy: ${lastError}`);
}

async function waitForReadyRun(url, runId) {
  const deadline = Date.now() + 60_000;
  let lastRun;

  while (Date.now() < deadline) {
    const response = await fetchWithTimeout(`${url}/api/analysis-runs/${runId}`);
    assert.equal(response.status, 200);
    lastRun = await response.json();
    if (lastRun.status === "ready") {
      return lastRun;
    }
    if (lastRun.status === "failed") {
      throw new Error(lastRun.errorMessage || "Analysis run failed");
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }

  throw new Error(`Analysis run did not become ready: ${JSON.stringify(lastRun)}`);
}

test("preserves analysis runs and source revisions across Compose restart", async () => {
  const project = `analysis-tool-acceptance-${process.pid}-${Date.now()}`;
  const webPort = await getUnusedPort();
  let postgresPort = await getUnusedPort();
  while (postgresPort === webPort) {
    postgresPort = await getUnusedPort();
  }
  const url = `http://127.0.0.1:${webPort}`;
  const environment = {
    WEB_PORT: String(webPort),
    POSTGRES_PORT: String(postgresPort),
    SOURCE_PROJECTS_ROOT: resolve(repositoryRoot, "tests/fixtures/sources"),
  };
  let testError;

  try {
    await runCompose(project, environment, ["up", "--build", "--detach"]);
    await waitForStack(project, environment, url);

    const createResponse = await fetchWithTimeout(`${url}/api/analysis-runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceProject: "project-alpha" }),
    });
    assert.equal(createResponse.status, 201);
    const createdRun = await createResponse.json();
    const readyRun = await waitForReadyRun(url, createdRun.id);
    const persisted = {
      id: readyRun.id,
      status: readyRun.status,
      fingerprint: readyRun.sourceRevision.fingerprint,
      snapshotPath: readyRun.sourceRevision.snapshotPath,
      workingCopyPath: readyRun.sourceRevision.workingCopyPath,
    };

    await runCompose(project, environment, ["down"], 60_000);
    await runCompose(project, environment, ["up", "--detach"]);
    await waitForStack(project, environment, url);

    const response = await fetchWithTimeout(
      `${url}/api/analysis-runs/${persisted.id}`,
    );
    assert.equal(response.status, 200);
    const restoredRun = await response.json();
    assert.deepEqual(
      {
        id: restoredRun.id,
        status: restoredRun.status,
        fingerprint: restoredRun.sourceRevision.fingerprint,
        snapshotPath: restoredRun.sourceRevision.snapshotPath,
        workingCopyPath: restoredRun.sourceRevision.workingCopyPath,
      },
      persisted,
    );
  } catch (error) {
    testError = error;
  }

  let cleanupError;
  try {
    await runCompose(
      project,
      environment,
      ["down", "--volumes", "--remove-orphans"],
      60_000,
    );
  } catch (error) {
    cleanupError = error;
  }

  if (testError) {
    throw testError;
  }
  if (cleanupError) {
    throw cleanupError;
  }
});
