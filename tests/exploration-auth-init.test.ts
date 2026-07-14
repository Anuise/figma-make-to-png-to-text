import assert from "node:assert/strict";
import test from "node:test";

import { applyAuthSteps, resolveStorageStatePath, type AuthPage } from "@analysis-tool/explorer";
import { NetworkGuard } from "@analysis-tool/explorer";

function makePage(): AuthPage & { calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = {
    goto: [],
    fill: [],
    click: [],
    waitForSelector: [],
  };
  return {
    calls,
    goto: async (url: string, opts?: unknown) => {
      calls.goto.push([url, opts]);
    },
    fill: async (selector: string, value: string, opts?: unknown) => {
      calls.fill.push([selector, value, opts]);
    },
    click: async (selector: string, opts?: unknown) => {
      calls.click.push([selector, opts]);
    },
    waitForSelector: async (selector: string, opts?: unknown) => {
      calls.waitForSelector.push([selector, opts]);
    },
  };
}

test("applyAuthSteps: navigate step navigates to the given URL", async () => {
  const guard = new NetworkGuard({ allowedHosts: ["localhost"] });
  const page = makePage();

  await applyAuthSteps(page, [{ type: "navigate", url: "http://localhost:3000/login" }], guard);

  assert.equal(page.calls.goto.length, 1);
  assert.equal(page.calls.goto[0]![0], "http://localhost:3000/login");
});

test("applyAuthSteps: navigate to blocked host throws without calling goto", async () => {
  const guard = new NetworkGuard({ allowedHosts: ["localhost"] });
  const page = makePage();

  await assert.rejects(
    () =>
      applyAuthSteps(
        page,
        [{ type: "navigate", url: "https://external.com/login" }],
        guard,
      ),
    /blocked by network guard/,
  );
  assert.equal(page.calls.goto.length, 0);
});

test("applyAuthSteps: fill step reads value from env var", async (t) => {
  process.env.TEST_AUTH_EMAIL = "user@example.com";
  t.after(() => {
    delete process.env.TEST_AUTH_EMAIL;
  });

  const guard = new NetworkGuard({ allowedHosts: ["localhost"] });
  const page = makePage();

  await applyAuthSteps(
    page,
    [{ type: "fill", selector: "input[name=email]", envVarRef: "TEST_AUTH_EMAIL" }],
    guard,
  );

  assert.equal(page.calls.fill.length, 1);
  assert.equal(page.calls.fill[0]![0], "input[name=email]");
  assert.equal(page.calls.fill[0]![1], "user@example.com");
});

test("applyAuthSteps: fill step uses empty string when env var is not set", async () => {
  delete process.env.TEST_AUTH_MISSING_VAR;
  const guard = new NetworkGuard({ allowedHosts: ["localhost"] });
  const page = makePage();

  await applyAuthSteps(
    page,
    [{ type: "fill", selector: "input[name=pass]", envVarRef: "TEST_AUTH_MISSING_VAR" }],
    guard,
  );

  assert.equal(page.calls.fill[0]![1], "");
});

test("applyAuthSteps: click step calls page.click", async () => {
  const guard = new NetworkGuard({ allowedHosts: ["localhost"] });
  const page = makePage();

  await applyAuthSteps(page, [{ type: "click", selector: "button[type=submit]" }], guard);

  assert.equal(page.calls.click.length, 1);
  assert.equal(page.calls.click[0]![0], "button[type=submit]");
});

test("applyAuthSteps: wait_for_selector step calls page.waitForSelector", async () => {
  const guard = new NetworkGuard({ allowedHosts: ["localhost"] });
  const page = makePage();

  await applyAuthSteps(page, [{ type: "wait_for_selector", selector: ".dashboard" }], guard);

  assert.equal(page.calls.waitForSelector.length, 1);
  assert.equal(page.calls.waitForSelector[0]![0], ".dashboard");
});

test("applyAuthSteps: executes multiple steps in order", async (t) => {
  process.env.TEST_AUTH_PASS = "secret";
  t.after(() => {
    delete process.env.TEST_AUTH_PASS;
  });

  const order: string[] = [];
  const tracingPage: AuthPage = {
    goto: async (url) => {
      order.push(`goto:${url}`);
    },
    fill: async (sel, val) => {
      order.push(`fill:${sel}:${val}`);
    },
    click: async (sel) => {
      order.push(`click:${sel}`);
    },
    waitForSelector: async (sel) => {
      order.push(`wait:${sel}`);
    },
  };

  const guard = new NetworkGuard({ allowedHosts: ["localhost"] });
  await applyAuthSteps(
    tracingPage,
    [
      { type: "navigate", url: "http://localhost:3000/login" },
      { type: "fill", selector: "input[name=password]", envVarRef: "TEST_AUTH_PASS" },
      { type: "click", selector: "button[type=submit]" },
      { type: "wait_for_selector", selector: ".dashboard" },
    ],
    guard,
  );

  assert.deepEqual(order, [
    "goto:http://localhost:3000/login",
    "fill:input[name=password]:secret",
    "click:button[type=submit]",
    "wait:.dashboard",
  ]);
});

test("resolveStorageStatePath: returns path from env var", (t) => {
  process.env.TEST_STORAGE_STATE_PATH = "/tmp/playwright-state.json";
  t.after(() => {
    delete process.env.TEST_STORAGE_STATE_PATH;
  });

  assert.equal(resolveStorageStatePath("TEST_STORAGE_STATE_PATH"), "/tmp/playwright-state.json");
});

test("resolveStorageStatePath: returns null when env var is not set", () => {
  delete process.env.TEST_STORAGE_STATE_MISSING;
  assert.equal(resolveStorageStatePath("TEST_STORAGE_STATE_MISSING"), null);
});
