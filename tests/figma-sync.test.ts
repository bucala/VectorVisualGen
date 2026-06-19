import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_FIGMA_JSON_BYTES,
  parseFigmaSyncBody,
} from "../src/lib/figma-sync.ts";

test("rejects invalid JSON without throwing", () => {
  const parsed = parseFigmaSyncBody("not-json");

  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.equal(parsed.status, 400);
    assert.equal(parsed.error, "Invalid JSON payload.");
  }
});

test("rejects missing and incomplete SVG payloads", () => {
  const missing = parseFigmaSyncBody("{}");
  const incomplete = parseFigmaSyncBody(JSON.stringify({ svg: "<svg>" }));

  assert.equal(missing.ok, false);
  assert.equal(incomplete.ok, false);
  if (!missing.ok) assert.equal(missing.status, 400);
  if (!incomplete.ok) assert.equal(incomplete.status, 400);
});

test("rejects oversized JSON payloads", () => {
  const parsed = parseFigmaSyncBody(" ".repeat(MAX_FIGMA_JSON_BYTES + 1));

  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.status, 413);
});

test("accepts a complete SVG bridge payload", () => {
  const parsed = parseFigmaSyncBody(
    JSON.stringify({ name: "audit", svg: "<svg><path /></svg>" }),
  );

  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.body.name, "audit");
    assert.equal(parsed.body.svg, "<svg><path /></svg>");
  }
});
