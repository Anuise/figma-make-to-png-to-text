import assert from "node:assert/strict";
import test from "node:test";

import { ExplorationBudget } from "@analysis-tool/explorer";

test("not exhausted when all counters below limits", () => {
  const budget = new ExplorationBudget({
    maxInteractions: 10,
    maxCandidateScreens: 5,
    maxDurationMs: 60_000,
    startedAt: Date.now(),
  });
  assert.equal(budget.isExhausted(), false);
  assert.equal(budget.getExhaustedReason(), null);
});

test("exhausted when interactions reach max", () => {
  const budget = new ExplorationBudget({
    maxInteractions: 3,
    maxCandidateScreens: 100,
    maxDurationMs: 60_000,
    startedAt: Date.now(),
  });
  budget.recordInteraction();
  budget.recordInteraction();
  budget.recordInteraction();
  assert.equal(budget.isExhausted(), true);
  assert.equal(budget.getExhaustedReason(), "interactions");
});

test("exhausted when screens reach max", () => {
  const budget = new ExplorationBudget({
    maxInteractions: 100,
    maxCandidateScreens: 2,
    maxDurationMs: 60_000,
    startedAt: Date.now(),
  });
  budget.recordScreen();
  budget.recordScreen();
  assert.equal(budget.isExhausted(), true);
  assert.equal(budget.getExhaustedReason(), "screens");
});

test("exhausted when time budget elapses", () => {
  const budget = new ExplorationBudget({
    maxInteractions: 100,
    maxCandidateScreens: 100,
    maxDurationMs: 0,
    startedAt: Date.now() - 1,
  });
  assert.equal(budget.isExhausted(), true);
  assert.equal(budget.getExhaustedReason(), "time");
});

test("interactions exhaustion takes priority over screens", () => {
  const budget = new ExplorationBudget({
    maxInteractions: 1,
    maxCandidateScreens: 1,
    maxDurationMs: 60_000,
    startedAt: Date.now(),
  });
  budget.recordInteraction();
  budget.recordScreen();
  assert.equal(budget.getExhaustedReason(), "interactions");
});

test("checkpoint pending branches are returned correctly", () => {
  const budget = new ExplorationBudget({
    maxInteractions: 1,
    maxCandidateScreens: 100,
    maxDurationMs: 60_000,
    startedAt: Date.now(),
  });
  budget.addPendingBranch("/settings");
  budget.addPendingBranch("/profile");
  budget.recordInteraction();

  assert.equal(budget.isExhausted(), true);
  assert.deepEqual(budget.pendingBranches, ["/settings", "/profile"]);
});

test("draining pending branches when processed", () => {
  const budget = new ExplorationBudget({
    maxInteractions: 100,
    maxCandidateScreens: 100,
    maxDurationMs: 60_000,
    startedAt: Date.now(),
  });
  budget.addPendingBranch("/a");
  budget.addPendingBranch("/b");
  budget.removePendingBranch("/a");
  assert.deepEqual(budget.pendingBranches, ["/b"]);
});
