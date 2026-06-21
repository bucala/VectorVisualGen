import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_FIGMA_GALLERY_ITEMS,
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

test("accepts gallery SVG payloads for the Figma bridge", () => {
  const parsed = parseFigmaSyncBody(
    JSON.stringify({
      name: "gallery",
      svg: "<svg><path /></svg>",
      gallery: [
        {
          id: "saved-1",
          name: "Saved 1",
          createdAt: "2026-06-20T00:00:00.000Z",
          svg: "<svg><path /></svg>",
        },
      ],
    }),
  );

  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.body.gallery?.length, 1);
    assert.equal(parsed.body.gallery?.[0].name, "Saved 1");
  }
});

test("rejects name longer than 200 characters", () => {
  const parsed = parseFigmaSyncBody(
    JSON.stringify({ name: "a".repeat(201), svg: "<svg><path /></svg>" }),
  );

  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.status, 400);
});

test("rejects oversized Figma gallery batches", () => {
  const parsed = parseFigmaSyncBody(
    JSON.stringify({
      svg: "<svg><path /></svg>",
      gallery: Array.from({ length: MAX_FIGMA_GALLERY_ITEMS + 1 }, () => ({
        svg: "<svg><path /></svg>",
      })),
    }),
  );

  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.status, 400);
});

test("accepts gallery items without svg field (metadata-only sync)", () => {
  const parsed = parseFigmaSyncBody(
    JSON.stringify({
      name: "meta-only",
      svg: "<svg><path /></svg>",
      gallery: [
        { id: "item-1", name: "Pattern 1", createdAt: "2026-06-21T00:00:00.000Z" },
        { id: "item-2", name: "Pattern 2" },
        { name: "Pattern 3", createdAt: "2026-06-20T00:00:00.000Z" },
      ],
    }),
  );

  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.body.gallery?.length, 3);
    assert.equal(parsed.body.gallery?.[0].svg, undefined);
    assert.equal(parsed.body.gallery?.[1].svg, undefined);
    assert.equal(parsed.body.gallery?.[0].name, "Pattern 1");
    assert.equal(parsed.body.gallery?.[0].id, "item-1");
  }
});
