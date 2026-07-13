import { execFile } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const nextBin = join(repositoryRoot, "node_modules", "next", "dist", "bin", "next");

async function getUnusedPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = address.port;
  server.close();
  await once(server, "close");
  return port;
}

function stopProcessTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }

  if (process.platform === "win32") {
    return new Promise((resolveStop, rejectStop) => {
      execFile(
        "taskkill",
        ["/pid", String(child.pid), "/t", "/f"],
        (error, _stdout, stderr) => {
          if (
            error &&
            child.exitCode === null &&
            child.signalCode === null
          ) {
            rejectStop(
              new Error(`Failed to stop Next.js process tree: ${stderr}`),
            );
            return;
          }

          if (child.exitCode !== null || child.signalCode !== null) {
            resolveStop();
            return;
          }

          const timeout = setTimeout(() => {
            rejectStop(new Error("Next.js process tree did not stop in time"));
          }, 5_000);
          child.once("exit", () => {
            clearTimeout(timeout);
            resolveStop();
          });
        },
      );
    });
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") {
      throw error;
    }
  }
  return once(child, "exit").then(() => undefined);
}

async function waitForHealth(url, child, getOutput) {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Next.js exited before becoming ready:\n${getOutput()}`);
    }

    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {}

    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }

  throw new Error(`Next.js did not become ready:\n${getOutput()}`);
}

export async function startWebServer(environment = {}) {
  const port = await getUnusedPort();
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(
    process.execPath,
    [nextBin, "dev", "apps/web", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: repositoryRoot,
      detached: process.platform !== "win32",
      env: { ...process.env, ...environment },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });

  const stop = () => stopProcessTree(child);

  try {
    await waitForHealth(url, child, () => output);
    return { url, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
