import assert from "node:assert/strict";
import test from "node:test";

import {
  createBoomerangSvg,
  DEFAULT_BOOMERANG_SETTINGS,
  generateBoomerangElements,
  LAYER_ORDER,
} from "../src/lib/boomerang.ts";

test("generates exactly three explicit layers in bottom-to-top order", () => {
  const elements = generateBoomerangElements(DEFAULT_BOOMERANG_SETTINGS);
  const layerIds = Array.from(new Set(elements.map((element) => element.layerId)));

  assert.deepEqual(layerIds, [...LAYER_ORDER]);
  assert.equal(DEFAULT_BOOMERANG_SETTINGS.layers.length, 3);
});

test("keeps same-layer boomerangs evenly separated", () => {
  const elements = generateBoomerangElements(DEFAULT_BOOMERANG_SETTINGS);

  for (const layerId of LAYER_ORDER) {
    const layerElements = elements.filter((element) => element.layerId === layerId);
    assert.ok(layerElements.length > 60, `${layerId} should have visible coverage`);

    let minDistance = Number.POSITIVE_INFINITY;
    for (let a = 0; a < layerElements.length; a += 1) {
      for (let b = a + 1; b < layerElements.length; b += 1) {
        minDistance = Math.min(
          minDistance,
          Math.hypot(
            layerElements[a].x - layerElements[b].x,
            layerElements[a].y - layerElements[b].y,
          ),
        );
      }
    }

    assert.ok(
      minDistance > 42,
      `${layerId} minimum distance was ${minDistance.toFixed(2)}`,
    );
  }
});

test("exports generated SVG with three layer groups", () => {
  const svg = createBoomerangSvg(DEFAULT_BOOMERANG_SETTINGS);

  assert.match(svg, /data-layer="bottom"/);
  assert.match(svg, /data-layer="middle"/);
  assert.match(svg, /data-layer="top"/);
  assert.equal((svg.match(/data-layer="/g) ?? []).length, 3);
});

test("overscans oversized contours past the canvas edges", () => {
  const settings = {
    ...DEFAULT_BOOMERANG_SETTINGS,
    density: 240,
    layers: DEFAULT_BOOMERANG_SETTINGS.layers.map((layer) => ({
      ...layer,
      scale: 1.65,
      chaos: 100,
    })),
  };
  const elements = generateBoomerangElements(settings);
  const overscanned = elements.filter(
    (element) =>
      element.x < 0 ||
      element.y < 0 ||
      element.x > 1200 ||
      element.y > 1200,
  );

  elements.forEach((element) => {
    assert.match(element.path, /Z$/);
  });
  assert.ok(overscanned.length > 40, "expected visible pattern overscan");
});

test("exports a stronger blur layer when blur is enabled", () => {
  const settings = {
    ...DEFAULT_BOOMERANG_SETTINGS,
    blur: 80,
  };
  const svg = createBoomerangSvg(settings);

  assert.match(svg, /filter id="line-blur"/);
  assert.match(svg, /x="-35%"/);
  assert.match(svg, /filter="url\(#line-blur\)"/);
});
