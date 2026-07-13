import assert from "node:assert/strict";
import test from "node:test";

import { isProhibitedInteraction } from "@analysis-tool/explorer";

test("blocks delete button", () => {
  assert.equal(isProhibitedInteraction({ tagName: "button", text: "Delete account" }), true);
  assert.equal(isProhibitedInteraction({ tagName: "button", text: "刪除" }), true);
  assert.equal(isProhibitedInteraction({ tagName: "a", text: "Remove item" }), true);
});

test("blocks payment actions", () => {
  assert.equal(isProhibitedInteraction({ tagName: "button", text: "Pay now" }), true);
  assert.equal(isProhibitedInteraction({ tagName: "button", text: "Checkout" }), true);
  assert.equal(isProhibitedInteraction({ tagName: "button", text: "付款" }), true);
  assert.equal(isProhibitedInteraction({ tagName: "button", text: "Purchase plan" }), true);
});

test("blocks publish actions", () => {
  assert.equal(isProhibitedInteraction({ tagName: "button", text: "Publish" }), true);
  assert.equal(isProhibitedInteraction({ tagName: "button", text: "發布" }), true);
});

test("blocks send actions", () => {
  assert.equal(isProhibitedInteraction({ tagName: "button", text: "Send message" }), true);
  assert.equal(isProhibitedInteraction({ tagName: "button", text: "寄送" }), true);
});

test("blocks logout actions", () => {
  assert.equal(isProhibitedInteraction({ tagName: "button", text: "Log out" }), true);
  assert.equal(isProhibitedInteraction({ tagName: "button", text: "Logout" }), true);
  assert.equal(isProhibitedInteraction({ tagName: "button", text: "Sign out" }), true);
  assert.equal(isProhibitedInteraction({ tagName: "button", text: "登出" }), true);
});

test("blocks upload actions", () => {
  assert.equal(isProhibitedInteraction({ tagName: "button", text: "Upload file" }), true);
  assert.equal(isProhibitedInteraction({ tagName: "input", text: "", type: "file" }), true);
  assert.equal(isProhibitedInteraction({ tagName: "button", text: "上傳" }), true);
});

test("allows safe navigation", () => {
  assert.equal(isProhibitedInteraction({ tagName: "a", text: "Dashboard" }), false);
  assert.equal(isProhibitedInteraction({ tagName: "button", text: "Submit" }), false);
  assert.equal(isProhibitedInteraction({ tagName: "button", text: "Save" }), false);
  assert.equal(isProhibitedInteraction({ tagName: "button", text: "Next" }), false);
  assert.equal(isProhibitedInteraction({ tagName: "button", text: "Cancel" }), false);
});

test("allows form text inputs", () => {
  assert.equal(isProhibitedInteraction({ tagName: "input", text: "", type: "text" }), false);
  assert.equal(isProhibitedInteraction({ tagName: "input", text: "", type: "email" }), false);
  assert.equal(isProhibitedInteraction({ tagName: "input", text: "", type: "search" }), false);
});
