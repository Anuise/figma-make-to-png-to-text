import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";

const APP_READY_TIMEOUT_MS = 60_000;
const APP_READY_POLL_INTERVAL_MS = 500;

export type AppLauncherOptions = {
  workingCopyPath: string;
  startScript: string;
  packageManager: string;
};

export type RunningApp = {
  port: number;
  baseUrl: string;
  stop: () => void;
};

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close(() => reject(new Error("Could not get port")));
        return;
      }
      const { port } = addr;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHttp(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok || response.status < 500) return true;
    } catch {
      // 繼續等待
    }
    await new Promise((r) => setTimeout(r, APP_READY_POLL_INTERVAL_MS));
  }
  return false;
}

export async function launchApp(options: AppLauncherOptions): Promise<RunningApp> {
  const port = await findFreePort();
  const pm =
    process.platform === "win32" ? `${options.packageManager}.cmd` : options.packageManager;

  const child: ChildProcess = spawn(pm, ["run", options.startScript], {
    cwd: options.workingCopyPath,
    env: { ...process.env, PORT: String(port), VITE_PORT: String(port) },
    shell: process.platform === "win32",
    stdio: "ignore",
    windowsHide: true,
  });

  const baseUrl = `http://localhost:${port}`;

  const ready = await waitForHttp(baseUrl, APP_READY_TIMEOUT_MS);
  if (!ready) {
    child.kill();
    throw new Error(
      `App did not become ready within ${APP_READY_TIMEOUT_MS}ms at ${baseUrl}`,
    );
  }

  return {
    port,
    baseUrl,
    stop: () => {
      child.kill();
    },
  };
}
