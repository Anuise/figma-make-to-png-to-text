import assert from "node:assert/strict";
import test from "node:test";

import { NetworkGuard } from "@analysis-tool/explorer";

test("allows requests to localhost", () => {
  const guard = new NetworkGuard({ allowedHosts: ["localhost"] });
  assert.equal(guard.isAllowed("http://localhost:3000/"), true);
  assert.equal(guard.isAllowed("http://localhost:3000/dashboard"), true);
});

test("allows requests to 127.0.0.1", () => {
  const guard = new NetworkGuard({ allowedHosts: ["127.0.0.1"] });
  assert.equal(guard.isAllowed("http://127.0.0.1:5173/"), true);
});

test("blocks requests to external hosts by default", () => {
  const guard = new NetworkGuard({ allowedHosts: ["localhost"] });
  assert.equal(guard.isAllowed("https://api.example.com/data"), false);
  assert.equal(guard.isAllowed("https://fonts.googleapis.com/css"), false);
});

test("allows additional allowlisted hosts", () => {
  const guard = new NetworkGuard({ allowedHosts: ["localhost", "api.internal"] });
  assert.equal(guard.isAllowed("http://api.internal/v1/data"), true);
  assert.equal(guard.isAllowed("https://external.com/data"), false);
});

test("isDenied is the inverse of isAllowed", () => {
  const guard = new NetworkGuard({ allowedHosts: ["localhost"] });
  assert.equal(guard.isDenied("http://localhost/"), false);
  assert.equal(guard.isDenied("https://external.com/"), true);
});

test("handles invalid URLs by denying them", () => {
  const guard = new NetworkGuard({ allowedHosts: ["localhost"] });
  assert.equal(guard.isAllowed("not-a-url"), false);
});

test("empty allowedHosts blocks all URLs", () => {
  const guard = new NetworkGuard({ allowedHosts: [] });
  assert.equal(guard.isAllowed("http://localhost/"), false);
  assert.equal(guard.isAllowed("https://anywhere.com/"), false);
});
