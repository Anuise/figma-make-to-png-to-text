import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { Pool } from "pg";
import { chromium } from "playwright";

import {
  insertCandidateScreen,
  upsertExplorationCheckpoint,
  type AuthStep,
} from "@analysis-tool/database";

import { launchApp } from "./app-launcher.js";
import { applyAuthSteps, resolveStorageStatePath } from "./auth-init.js";
import { ExplorationBudget } from "./budget.js";
import { isProhibitedInteraction } from "./interaction-guard.js";
import { NetworkGuard } from "./network-guard.js";
import { fullScreenCapture, VIEWPORT_HEIGHT, VIEWPORT_WIDTH } from "./full-screen-capture.js";

const DEFAULT_ALLOWED_HOSTS = ["localhost", "127.0.0.1"];

export type ExplorerOptions = {
  analysisRunId: string;
  workingCopyPath: string;
  startScript: string;
  packageManager: string;
  screenshotsDir: string;
  tracesDir: string;
  allowedHosts?: string[];
  maxInteractions?: number;
  maxCandidateScreens?: number;
  maxDurationMs?: number;
  authSteps?: AuthStep[] | null;
  storageStateEnvVar?: string | null;
  pool: Pool;
};

export type ExplorationResult = {
  candidateScreensFound: number;
  exhaustedLimit: "interactions" | "screens" | "time" | "error" | null;
  pendingBranches: string[];
};

function dedupKey(
  pathname: string,
  uiHash: string,
  visibleStateHash: string,
  operationPath: string[],
): string {
  return `${pathname}\0${uiHash}\0${visibleStateHash}\0${operationPath.join("\0")}`;
}

export async function runExploration(options: ExplorerOptions): Promise<ExplorationResult> {
  const {
    analysisRunId,
    workingCopyPath,
    startScript,
    packageManager,
    screenshotsDir,
    tracesDir,
    pool,
    allowedHosts = DEFAULT_ALLOWED_HOSTS,
    maxInteractions = 100,
    maxCandidateScreens = 50,
    maxDurationMs = 300_000,
    authSteps = null,
    storageStateEnvVar = null,
  } = options;

  await mkdir(screenshotsDir, { recursive: true });
  await mkdir(tracesDir, { recursive: true });

  let app: Awaited<ReturnType<typeof launchApp>> | null = null;

  try {
    app = await launchApp({ workingCopyPath, startScript, packageManager });
  } catch {
    await upsertExplorationCheckpoint(pool, {
      analysisRunId,
      exhaustedLimit: "error",
      pendingBranches: [],
    });
    return { candidateScreensFound: 0, exhaustedLimit: "error", pendingBranches: [] };
  }

  const networkGuard = new NetworkGuard({
    allowedHosts: [...new Set([...allowedHosts, ...DEFAULT_ALLOWED_HOSTS])],
  });

  const seenScreens = new Set<string>();
  const budget = new ExplorationBudget({
    maxInteractions,
    maxCandidateScreens,
    maxDurationMs,
    startedAt: Date.now(),
  });

  let candidateScreensFound = 0;

  const storageStatePath = storageStateEnvVar ? resolveStorageStatePath(storageStateEnvVar) : null;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
    ...(storageStatePath ? { storageState: storageStatePath } : {}),
  });

  try {
    const page = await context.newPage();

    await context.route("**/*", (networkRoute) => {
      if (networkGuard.isDenied(networkRoute.request().url())) {
        networkRoute.abort("blockedbyclient").catch(() => {});
      } else {
        networkRoute.continue().catch(() => {});
      }
    });

    if (authSteps && authSteps.length > 0) {
      await applyAuthSteps(page, authSteps, networkGuard);
    }

    const toVisit: string[] = [app.baseUrl];
    const visited = new Set<string>();
    const unexploredRoutes = new Set<string>();

    while (toVisit.length > 0 && !budget.isExhausted()) {
      const url = toVisit.shift()!;
      if (visited.has(url)) continue;
      visited.add(url);

      const intendedPathname = new URL(url).pathname;

      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
      } catch {
        continue;
      }

      const pathname = new URL(page.url()).pathname;

      if (pathname !== intendedPathname && !unexploredRoutes.has(intendedPathname)) {
        unexploredRoutes.add(intendedPathname);
        await insertCandidateScreen(pool, {
          analysisRunId,
          route: intendedPathname,
          uiFingerprint: "",
          visibleStateHash: "",
          operationPath: [],
          screenshotPath: null,
          tracePath: null,
          incompleteReason: `unexplored: redirected to ${pathname}`,
        });
      }
      const uiHash = await computeUiHash(page);
      const visibleStateHash = await computeVisibleStateHash(page);
      const operationPath: string[] = [];
      const key = dedupKey(pathname, uiHash, visibleStateHash, operationPath);

      if (!seenScreens.has(key)) {
        seenScreens.add(key);

        const screenshotPath = join(
          screenshotsDir,
          `${sanitizeFilename(pathname)}-${candidateScreensFound}.png`,
        );
        const tracePath = join(
          tracesDir,
          `${sanitizeFilename(pathname)}-${candidateScreensFound}.zip`,
        );

        await context.tracing.start({ screenshots: true, snapshots: true });
        const captureResult = await fullScreenCapture(page, { screenshotPath });
        await context.tracing.stop({ path: tracePath });

        await insertCandidateScreen(pool, {
          analysisRunId,
          route: pathname,
          uiFingerprint: uiHash,
          visibleStateHash,
          operationPath,
          screenshotPath: captureResult.screenshotPath,
          tracePath,
          incompleteReason: captureResult.incompleteReason,
        });

        candidateScreensFound++;
        budget.recordScreen();
      }

      if (budget.isExhausted()) break;

      const links = await collectSafeLinks(page, app.baseUrl);
      for (const link of links) {
        if (!visited.has(link)) {
          toVisit.push(link);
        }
      }

      const clickables = await collectSafeClickables(page);
      for (let i = 0; i < clickables.length; i++) {
        const el = clickables[i];

        if (budget.isExhausted()) {
          for (const remaining of clickables.slice(i)) {
            const text = (await remaining.textContent().catch(() => null))?.trim().slice(0, 50);
            if (text) budget.addPendingBranch(`click:${pathname}:${text}`);
          }
          break;
        }

        try {
          const preClickUrl = page.url();
          await el.click({ timeout: 5_000 });
          budget.recordInteraction();

          const postClickPathname = new URL(page.url()).pathname;
          const postClickUiHash = await computeUiHash(page);
          const postClickVisibleStateHash = await computeVisibleStateHash(page);
          const elText = (await el.textContent()) ?? "";
          const clickOperationPath = [...operationPath, `click:${elText.trim().slice(0, 50)}`];
          const clickKey = dedupKey(
            postClickPathname,
            postClickUiHash,
            postClickVisibleStateHash,
            clickOperationPath,
          );

          if (!seenScreens.has(clickKey)) {
            seenScreens.add(clickKey);

            const clickScreenshotPath = join(
              screenshotsDir,
              `${sanitizeFilename(postClickPathname)}-${candidateScreensFound}.png`,
            );
            const clickTracePath = join(
              tracesDir,
              `${sanitizeFilename(postClickPathname)}-${candidateScreensFound}.zip`,
            );

            await context.tracing.start({ screenshots: true, snapshots: true });
            const clickCaptureResult = await fullScreenCapture(page, {
              screenshotPath: clickScreenshotPath,
            });
            await context.tracing.stop({ path: clickTracePath });

            await insertCandidateScreen(pool, {
              analysisRunId,
              route: postClickPathname,
              uiFingerprint: postClickUiHash,
              visibleStateHash: postClickVisibleStateHash,
              operationPath: clickOperationPath,
              screenshotPath: clickCaptureResult.screenshotPath,
              tracePath: clickTracePath,
              incompleteReason: clickCaptureResult.incompleteReason,
            });

            candidateScreensFound++;
            budget.recordScreen();
          }

          if (page.url() !== preClickUrl) {
            await page.goBack({ timeout: 5_000 }).catch(() => page.goto(url).catch(() => {}));
          }
        } catch {
          // 忽略個別互動失敗
        }
      }
    }

    for (const u of toVisit) {
      if (!visited.has(u)) budget.addPendingBranch(u);
    }
  } finally {
    await context.close();
    await browser.close();
    app.stop();
  }

  const exhaustedReason = budget.getExhaustedReason();
  const pendingBranches = budget.pendingBranches;

  if (exhaustedReason !== null) {
    await upsertExplorationCheckpoint(pool, {
      analysisRunId,
      exhaustedLimit: exhaustedReason,
      pendingBranches,
    });
  }

  return { candidateScreensFound, exhaustedLimit: exhaustedReason, pendingBranches };
}

async function computeUiHash(page: import("playwright").Page): Promise<string> {
  const structure = await page.evaluate(() => {
    function collectStructure(el: Element, depth: number): string {
      if (depth > 5) return "";
      const tag = el.tagName.toLowerCase();
      const id = el.id ? `#${el.id}` : "";
      const role = el.getAttribute("role") ?? "";
      const children = Array.from(el.children)
        .map((c) => collectStructure(c, depth + 1))
        .join("");
      return `<${tag}${id}${role ? ` role="${role}"` : ""}>${children}</${tag}>`;
    }
    return collectStructure(document.body, 0);
  });
  return createHash("sha256").update(structure).digest("hex").slice(0, 16);
}

async function computeVisibleStateHash(page: import("playwright").Page): Promise<string> {
  const text = await page.evaluate(() => document.body.innerText.trim().slice(0, 4096));
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

async function collectSafeLinks(
  page: import("playwright").Page,
  baseUrl: string,
): Promise<string[]> {
  const base = new URL(baseUrl);
  const hrefs = await page.evaluate(() =>
    Array.from(document.querySelectorAll("a[href]")).map(
      (a) => (a as HTMLAnchorElement).href,
    ),
  );
  return hrefs.filter((href) => {
    try {
      const u = new URL(href);
      return u.hostname === base.hostname && u.port === base.port;
    } catch {
      return false;
    }
  });
}

async function collectSafeClickables(page: import("playwright").Page) {
  const elements = await page
    .locator("button, [role='button'], [role='tab'], [role='menuitem'], input[type='submit']")
    .all();
  const safe = [];
  for (const el of elements) {
    const text = (await el.textContent()) ?? "";
    const tagName = await el.evaluate((e: Element) => e.tagName.toLowerCase());
    const type =
      (await el.evaluate((e: Element) => (e as HTMLElement).getAttribute("type"))) ?? undefined;
    if (!isProhibitedInteraction({ tagName, text, type })) {
      safe.push(el);
    }
  }
  return safe;
}

function sanitizeFilename(pathname: string): string {
  return pathname.replace(/[^a-zA-Z0-9-]/g, "_").replace(/_{2,}/g, "_").slice(0, 40);
}
