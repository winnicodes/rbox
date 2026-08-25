import assert from "node:assert/strict";
import { test } from "node:test";
import { isNewer } from "./version.ts";

test("a higher segment wins, wherever it sits", () => {
  assert.ok(isNewer("0.2.0", "0.1.0"));
  assert.ok(isNewer("1.0.0", "0.9.9"));
  assert.ok(isNewer("0.1.1", "0.1.0"));
  assert.ok(!isNewer("0.1.0", "0.2.0"));
});

test("the same version is not an update", () => {
  assert.ok(!isNewer("0.1.0", "0.1.0"));
  // The tag carries a v, the app version does not.
  assert.ok(!isNewer("v0.1.0", "0.1.0"));
});

test("segments compare as numbers, not as text", () => {
  // "10" sorts before "9" as a string — that would hide every tenth release.
  assert.ok(isNewer("0.10.0", "0.9.0"));
});

test("a missing segment counts as zero", () => {
  assert.ok(isNewer("0.2", "0.1.9"));
  assert.ok(!isNewer("0.1", "0.1.0"));
});

test("garbage never claims to be newer", () => {
  assert.ok(!isNewer("", "0.1.0"));
  assert.ok(!isNewer("not-a-version", "0.1.0"));
});
