import assert from "node:assert/strict";
import test from "node:test";

import { ScreenDeduplicator } from "@analysis-tool/explorer";

test("same route and fingerprints is a duplicate", () => {
  const dedup = new ScreenDeduplicator();
  const screen = {
    route: "/dashboard",
    uiHash: "abc123",
    visibleStateHash: "def456",
    operationPath: [],
  };
  dedup.register(screen);
  assert.equal(dedup.isDuplicate(screen), true);
});

test("same route and ui hash but different visible state is not a duplicate", () => {
  const dedup = new ScreenDeduplicator();
  dedup.register({ route: "/dashboard", uiHash: "abc", visibleStateHash: "state1", operationPath: [] });
  assert.equal(
    dedup.isDuplicate({ route: "/dashboard", uiHash: "abc", visibleStateHash: "state2", operationPath: [] }),
    false,
  );
});

test("different route is not a duplicate even with same fingerprints", () => {
  const dedup = new ScreenDeduplicator();
  dedup.register({ route: "/home", uiHash: "abc", visibleStateHash: "xyz", operationPath: [] });
  assert.equal(
    dedup.isDuplicate({ route: "/settings", uiHash: "abc", visibleStateHash: "xyz", operationPath: [] }),
    false,
  );
});

test("different operation paths on same screen are not duplicates", () => {
  const dedup = new ScreenDeduplicator();
  dedup.register({ route: "/items", uiHash: "hash1", visibleStateHash: "vs1", operationPath: ["click #menu"] });
  assert.equal(
    dedup.isDuplicate({ route: "/items", uiHash: "hash1", visibleStateHash: "vs1", operationPath: ["click #nav"] }),
    false,
  );
});

test("same operation path on same screen is a duplicate", () => {
  const dedup = new ScreenDeduplicator();
  dedup.register({ route: "/items", uiHash: "hash1", visibleStateHash: "vs1", operationPath: ["click #menu"] });
  assert.equal(
    dedup.isDuplicate({ route: "/items", uiHash: "hash1", visibleStateHash: "vs1", operationPath: ["click #menu"] }),
    true,
  );
});

test("registering and querying multiple screens", () => {
  const dedup = new ScreenDeduplicator();
  const screenA = { route: "/a", uiHash: "h1", visibleStateHash: "v1", operationPath: [] };
  const screenB = { route: "/b", uiHash: "h2", visibleStateHash: "v2", operationPath: [] };
  dedup.register(screenA);
  dedup.register(screenB);
  assert.equal(dedup.isDuplicate(screenA), true);
  assert.equal(dedup.isDuplicate(screenB), true);
  assert.equal(
    dedup.isDuplicate({ route: "/c", uiHash: "h3", visibleStateHash: "v3", operationPath: [] }),
    false,
  );
});

test("size returns number of registered unique screens", () => {
  const dedup = new ScreenDeduplicator();
  assert.equal(dedup.size, 0);
  dedup.register({ route: "/a", uiHash: "h1", visibleStateHash: "v1", operationPath: [] });
  assert.equal(dedup.size, 1);
  dedup.register({ route: "/a", uiHash: "h1", visibleStateHash: "v1", operationPath: [] });
  assert.equal(dedup.size, 1);
  dedup.register({ route: "/b", uiHash: "h2", visibleStateHash: "v2", operationPath: [] });
  assert.equal(dedup.size, 2);
});
