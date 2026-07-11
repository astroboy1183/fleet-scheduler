// Schema guard for the SCHEDULE table — a malformed entry dispatches
// nothing and alerts nobody, so the shape is enforced in CI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SCHEDULE } from "../worker.js";

test("every entry has a valid UTC hh:mm", () => {
  for (const e of SCHEDULE) {
    assert.match(e.utc, /^([01]\d|2[0-3]):[0-5]\d$/, JSON.stringify(e));
  }
});

test("every entry names a repo and a .yml workflow", () => {
  for (const e of SCHEDULE) {
    assert.ok(e.repo && !e.repo.includes("/"), JSON.stringify(e));
    assert.match(e.workflow, /\.yml$/, JSON.stringify(e));
  }
});

test("dow, when present, is a valid UTC weekday", () => {
  for (const e of SCHEDULE) {
    if (e.dow !== undefined) {
      assert.ok(Number.isInteger(e.dow) && e.dow >= 0 && e.dow <= 6);
    }
  }
});

test("no duplicate (utc, repo) pairs — one dispatch per agent per minute", () => {
  const seen = new Set();
  for (const e of SCHEDULE) {
    const key = `${e.utc} ${e.repo} ${e.dow ?? ""}`;
    assert.ok(!seen.has(key), `duplicate: ${key}`);
    seen.add(key);
  }
});
