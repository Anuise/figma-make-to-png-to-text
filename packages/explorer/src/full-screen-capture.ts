import type { Page } from "playwright";

export const VIEWPORT_WIDTH = 1440;
export const VIEWPORT_HEIGHT = 900;
export const MAX_CAPTURE_HEIGHT = 16_384;
export const SCROLL_STABILITY_WAIT_MS = 300;
export const CONTENT_STABLE_CHECKS = 3;
export const MAX_SCROLL_ITERATIONS = 20;

export type CaptureOptions = {
  screenshotPath: string;
};

export type CaptureResult = {
  screenshotPath: string;
  incompleteReason: string | null;
};

export async function fullScreenCapture(
  page: Page,
  options: CaptureOptions,
): Promise<CaptureResult> {
  let incompleteReason: string | null = null;

  const scrollResult = await scrollUntilStable(page);
  if (scrollResult === "scroll_limit_exceeded") {
    incompleteReason = "scroll_limit_exceeded";
  }

  const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  if (scrollHeight > MAX_CAPTURE_HEIGHT) {
    incompleteReason = "height_limit_exceeded";
  }

  await page.screenshot({
    path: options.screenshotPath,
    fullPage: incompleteReason === null,
    clip:
      incompleteReason !== null
        ? { x: 0, y: 0, width: VIEWPORT_WIDTH, height: Math.min(scrollHeight, MAX_CAPTURE_HEIGHT) }
        : undefined,
  });

  return { screenshotPath: options.screenshotPath, incompleteReason };
}

async function scrollUntilStable(page: Page): Promise<"stable" | "scroll_limit_exceeded"> {
  let previousHeight = -1;
  let stableCount = 0;
  let iterations = 0;

  while (stableCount < CONTENT_STABLE_CHECKS) {
    if (iterations >= MAX_SCROLL_ITERATIONS) {
      await page.evaluate(() => window.scrollTo(0, 0));
      return "scroll_limit_exceeded";
    }
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(SCROLL_STABILITY_WAIT_MS);
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    if (height === previousHeight) {
      stableCount++;
    } else {
      stableCount = 0;
      previousHeight = height;
    }
    iterations++;
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(SCROLL_STABILITY_WAIT_MS);
  return "stable";
}
