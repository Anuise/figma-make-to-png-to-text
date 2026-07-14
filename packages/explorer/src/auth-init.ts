import type { AuthStep } from "@analysis-tool/database";
import type { NetworkGuard } from "./network-guard.js";

export type { AuthStep };

export type AuthPage = {
  goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  fill(selector: string, value: string, opts?: { timeout?: number }): Promise<void>;
  click(selector: string, opts?: { timeout?: number }): Promise<void>;
  waitForSelector(selector: string, opts?: { timeout?: number }): Promise<unknown>;
};

export async function applyAuthSteps(
  page: AuthPage,
  steps: AuthStep[],
  networkGuard: NetworkGuard,
): Promise<void> {
  for (const step of steps) {
    switch (step.type) {
      case "navigate": {
        if (networkGuard.isDenied(step.url)) {
          throw new Error(`Auth step: navigate to ${step.url} blocked by network guard`);
        }
        await page.goto(step.url, { waitUntil: "networkidle", timeout: 30_000 });
        break;
      }
      case "fill": {
        const value = process.env[step.envVarRef] ?? "";
        await page.fill(step.selector, value, { timeout: 5_000 });
        break;
      }
      case "click": {
        await page.click(step.selector, { timeout: 5_000 });
        break;
      }
      case "wait_for_selector": {
        await page.waitForSelector(step.selector, { timeout: 10_000 });
        break;
      }
    }
  }
}

export function resolveStorageStatePath(envVarName: string): string | null {
  return process.env[envVarName] ?? null;
}
