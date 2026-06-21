import assert from "node:assert/strict";
import test from "node:test";

// image-tracing.ts relies on browser APIs (DOMParser, canvas, ImageTracer) so we
// test the pure-logic helpers that can run in Node without a DOM.

// --- Inline copies of pure functions from image-tracing.ts ---

type Rgb = { r: number; g: number; b: number };

function luminance(color: Rgb) {
  return color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
}

function colorDistance(a: Rgb, b: Rgb) {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

function dilate(mask: Uint8Array, width: number, height: number, radius: number) {
  const result = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let found = 0;
      for (let dy = -radius; dy <= radius && !found; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < width && mask[yy * width + xx]) { found = 1; break; }
        }
      }
      result[y * width + x] = found;
    }
  }
  return result;
}

function erode(mask: Uint8Array, width: number, height: number, radius: number) {
  const result = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let kept = 1;
      outer: for (let dy = -radius; dy <= radius; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) { kept = 0; break; }
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width || !mask[yy * width + xx]) { kept = 0; break outer; }
        }
      }
      result[y * width + x] = kept;
    }
  }
  return result;
}

function closeMask(mask: Uint8Array, w: number, h: number) {
  return erode(dilate(mask, w, h, 2), w, h, 1);
}

const MIN_COMPONENT_AREA = 12;

function removeSmallComponents(mask: Uint8Array, width: number) {
  const visited = new Uint8Array(mask.length);
  const cleaned = new Uint8Array(mask.length);
  let components = 0;
  for (let idx = 0; idx < mask.length; idx++) {
    if (!mask[idx] || visited[idx]) continue;
    const stack = [idx];
    const pixels: number[] = [];
    visited[idx] = 1;
    while (stack.length) {
      const cur = stack.pop()!;
      pixels.push(cur);
      const cx = cur % width;
      const cy = Math.floor(cur / width);
      for (const nb of [cur - 1, cur + 1, cur - width, cur + width]) {
        if (nb < 0 || nb >= mask.length || visited[nb]) continue;
        const nx = nb % width;
        const ny = Math.floor(nb / width);
        if (Math.abs(nx - cx) + Math.abs(ny - cy) !== 1) continue;
        if (mask[nb]) { visited[nb] = 1; stack.push(nb); }
      }
    }
    if (pixels.length >= MIN_COMPONENT_AREA) {
      components++;
      pixels.forEach((p) => { cleaned[p] = 1; });
    }
  }
  return { cleaned, components };
}

// SVG sanitization logic (same regex as extractDetectedShapes guard)
function containsUnsafeSvgContent(svg: string) {
  return /<\s*(script|foreignobject)\b/i.test(svg);
}

// --- Tests ---

test("luminance formula weights green highest", () => {
  const red = luminance({ r: 255, g: 0, b: 0 });
  const green = luminance({ r: 0, g: 255, b: 0 });
  const blue = luminance({ r: 0, g: 0, b: 255 });
  assert.ok(green > red, "green luminance should exceed red");
  assert.ok(red > blue, "red luminance should exceed blue");
  assert.ok(Math.abs(green - 0.7152 * 255) < 0.01, "green weight should be ~0.7152");
});

test("colorDistance returns 0 for identical colors", () => {
  const c = { r: 100, g: 150, b: 200 };
  assert.equal(colorDistance(c, c), 0);
});

test("colorDistance is symmetric", () => {
  const a = { r: 50, g: 100, b: 200 };
  const b = { r: 200, g: 80, b: 10 };
  assert.equal(colorDistance(a, b), colorDistance(b, a));
});

test("dilate expands single pixel into neighborhood", () => {
  const w = 5;
  const h = 5;
  const mask = new Uint8Array(w * h);
  mask[2 * w + 2] = 1; // centre pixel
  const result = dilate(mask, w, h, 1);
  // All 4 direct neighbours should now be set
  assert.equal(result[1 * w + 2], 1, "top neighbour");
  assert.equal(result[3 * w + 2], 1, "bottom neighbour");
  assert.equal(result[2 * w + 1], 1, "left neighbour");
  assert.equal(result[2 * w + 3], 1, "right neighbour");
  assert.equal(result[2 * w + 2], 1, "center still set");
});

test("erode removes isolated pixel", () => {
  const w = 5;
  const h = 5;
  const mask = new Uint8Array(w * h);
  mask[2 * w + 2] = 1; // single isolated pixel
  const result = erode(mask, w, h, 1);
  // An isolated pixel cannot satisfy the erosion kernel
  assert.equal(result[2 * w + 2], 0, "isolated pixel should be eroded away");
});

test("closeMask (dilate then erode) fills small gaps", () => {
  const w = 10;
  const h = 5;
  const mask = new Uint8Array(w * h);
  // Two pixels separated by one gap at y=2, x=2 and x=4
  mask[2 * w + 2] = 1;
  mask[2 * w + 4] = 1;
  const closed = closeMask(mask, w, h);
  // After close, the gap pixel at x=3 should be filled
  assert.equal(closed[2 * w + 3], 1, "gap should be closed");
});

test("removeSmallComponents discards blobs below minimum area", () => {
  const w = 20;
  const h = 10;
  const mask = new Uint8Array(w * h);
  // Large component: 4×4 block at top-left
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) mask[y * w + x] = 1;
  // Tiny component: 2 pixels (below MIN_COMPONENT_AREA=12)
  mask[5 * w + 15] = 1;
  mask[5 * w + 16] = 1;

  const { cleaned, components } = removeSmallComponents(mask, w);
  assert.equal(components, 1, "only 1 component should survive");
  assert.equal(cleaned[0], 1, "large component pixel should be retained");
  assert.equal(cleaned[5 * w + 15], 0, "small component pixel should be discarded");
  assert.equal(cleaned[5 * w + 16], 0, "small component pixel should be discarded");
});

test("removeSmallComponents counts surviving components correctly", () => {
  const w = 30;
  const h = 5;
  const mask = new Uint8Array(w * h);
  // Three large separated blobs (4 pixels each, spaced apart)
  for (let i = 0; i < 3; i++) {
    const baseX = i * 10;
    for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) mask[r * w + baseX + c] = 1;
    // 2x2 block = 4 pixels — below MIN_COMPONENT_AREA (12), won't count
  }
  const { components } = removeSmallComponents(mask, w);
  assert.equal(components, 0, "4-pixel blobs are below MIN_COMPONENT_AREA of 12");
});

test("SVG sanitization blocks <script> tags", () => {
  assert.equal(containsUnsafeSvgContent("<svg><script>alert(1)</script></svg>"), true);
  assert.equal(containsUnsafeSvgContent("<svg><SCRIPT>evil()</SCRIPT></svg>"), true);
  assert.equal(containsUnsafeSvgContent("<svg><path d='M0 0'/></svg>"), false);
});

test("SVG sanitization blocks <foreignObject> tags", () => {
  assert.equal(containsUnsafeSvgContent("<svg><foreignObject><body/></foreignObject></svg>"), true);
  assert.equal(containsUnsafeSvgContent("<svg><ForeignObject/></svg>"), true);
  assert.equal(containsUnsafeSvgContent("<svg><g id='fg'/></svg>"), false);
});

test("SVG sanitization allows normal SVG content", () => {
  const safe = "<svg xmlns='http://www.w3.org/2000/svg'><circle cx='50' cy='50' r='40'/><rect width='100' height='100'/></svg>";
  assert.equal(containsUnsafeSvgContent(safe), false);
});
