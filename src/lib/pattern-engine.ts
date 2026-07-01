export const CANVAS_SIZE = 1200;
const OVERSCAN_RATIO = 0.18;

export const LAYER_ORDER = ["bottom", "middle", "top"] as const;

export type LayerId = (typeof LAYER_ORDER)[number];

export type BoomerangLayerSettings = {
  id: LayerId;
  label: string;
  color: string;
  scale: number;
  chaos: number;
  opacity: number;
};

export type BoomerangSettings = {
  density: number;
  strokeWidth: number;
  blur: number;
  rotation: number;
  background: string;
  seed: number;
  layers: BoomerangLayerSettings[];
};

export type BoomerangElement = {
  id: string;
  path: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  blur: number;
  layerId: LayerId;
  layerLabel: string;
  layerIndex: number;
  zIndex: number;
};

export type DetectedVectorShape = {
  id: string;
  d: string;
  tone: "dark" | "light";
  transform?: string;
};

export type SeparatedLayerSvg = {
  layerId: LayerId;
  label: string;
  fileSuffix: string;
  svg: string;
};

export const DEFAULT_LAYERS: BoomerangLayerSettings[] = [
  {
    id: "bottom",
    label: "Spodná vrstva",
    color: "#00a8c8",
    scale: 1.80,
    chaos: 42,
    opacity: 0.70,
  },
  {
    id: "middle",
    label: "Stredná vrstva",
    color: "#cc3030",
    scale: 2.10,
    chaos: 52,
    opacity: 0.82,
  },
  {
    id: "top",
    label: "Vrchná vrstva",
    color: "#e8dfc4",
    scale: 2.40,
    chaos: 34,
    opacity: 0.32,
  },
];

export const DEFAULT_BOOMERANG_SETTINGS: BoomerangSettings = {
  density: 165,
  strokeWidth: 1.4,
  blur: 0,
  rotation: -18,
  background: "#080810",
  seed: 8248,
  layers: DEFAULT_LAYERS,
};

export const COLOR_PRESETS = [
  {
    name: "Neon Void",
    background: "#080810",
    layers: ["#00a8c8", "#cc3030", "#e8dfc4"],
  },
  {
    name: "Ebony Red",
    background: "#19120f",
    layers: ["#5bc092", "#c7352f", "#f1e7d0"],
  },
  {
    name: "Glacier",
    background: "#e7f3f1",
    layers: ["#f6c453", "#ef4f47", "#114b5f"],
  },
  {
    name: "Retro Jade",
    background: "#0f1917",
    layers: ["#e4563f", "#66bf95", "#d9f0dc"],
  },
];

export type Point = {
  x: number;
  y: number;
};

export type LayerOverride = {
  templates?: Point[][];
  count?: number;
};

export type LayerOverrides = Partial<Record<LayerId, LayerOverride>>;

type SampleBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function jitter(random: () => number, amount: number) {
  return (random() - 0.5) * amount;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function layerIndexFor(id: LayerId) {
  return LAYER_ORDER.indexOf(id);
}

function safeColor(color: string) {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "#000000";
}

function visualScaleFromSlider(scale: number) {
  const normalized = clamp(scale, 0, 3) / 3;
  return normalized <= 0 ? 0.04 : 0.1 + Math.pow(normalized, 0.86) * 0.58;
}

function escapeAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function layerSettingsFor(settings: BoomerangSettings, layerId: LayerId) {
  return (
    settings.layers.find((layer) => layer.id === layerId) ??
    DEFAULT_LAYERS.find((layer) => layer.id === layerId) ??
    DEFAULT_LAYERS[0]
  );
}

function layerAttributes(settings: BoomerangSettings, layerId: LayerId) {
  const layer = layerSettingsFor(settings, layerId);
  const label = escapeAttribute(layer.label);

  return `id="${layerId}-layer" data-layer="${layerId}" data-layer-label="${label}" inkscape:groupmode="layer" inkscape:label="${label}"`;
}

function blurFilterDef(blur: number) {
  return blur > 0
    ? `
  <defs>
    <filter id="line-blur" x="-35%" y="-35%" width="170%" height="170%" color-interpolation-filters="sRGB">
      <feGaussianBlur stdDeviation="${blur.toFixed(2)}" />
    </filter>
  </defs>`
    : "";
}

function svgDocument(
  settings: BoomerangSettings,
  filterDef: string,
  content: string,
  includeBackground: boolean,
) {
  const background = includeBackground
    ? `
  <rect width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" fill="${safeColor(
        settings.background,
      )}" />`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" viewBox="0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}">
  ${filterDef}${background}${content}
</svg>`;
}

function sampleBounds(layer: BoomerangLayerSettings): SampleBounds {
  const chaos = clamp(layer.chaos / 100, 0, 1);
  const visualScale = visualScaleFromSlider(layer.scale);
  const shapeReach = 178 * visualScale * (0.74 + chaos * 0.2);
  const overscan = clamp(CANVAS_SIZE * OVERSCAN_RATIO + shapeReach, 180, 340);

  return {
    minX: -overscan,
    maxX: CANVAS_SIZE + overscan,
    minY: -overscan,
    maxY: CANVAS_SIZE + overscan,
  };
}

// ─── Boomerang shape model ───────────────────────────────────────────────────
//
// Each shape is a closed 3-arc cubic Bezier loop with three anchor points:
//
//   tipL  (-spread, tipY)   ← left arm tip  (pointed corner)
//   apex  ( asymX, -height) ← top vertex / elbow
//   tipR  (+spread, tipY)   ← right arm tip (pointed corner)
//
// Three arcs connect them in order: tipL→apex (left arm), apex→tipR (right arm),
// tipR→tipL (base). All three arcs bow away from the V interior using the same
// right-hand-perpendicular formula, so bowing direction is consistent regardless
// of each arc's orientation.
//
// Template parameters:
//   spread  — half-width of the V (x distance from centre to tip)
//   height  — apex elevation above the tips baseline
//   armBow  — convexity of the left and right arms [0=straight, ~0.5=classic bend]
//   baseBow — downward sag of the closing base arc [0=flat, ~0.25=gentle arch]

export type BoomerangShape = {
  spread:  number;
  height:  number;
  armBow:  number;
  baseBow: number;
};

export const SHAPE_TEMPLATES: BoomerangShape[] = [
  { spread: 108, height: 75, armBow: 0.38, baseBow: 0.22 }, // classic balanced V
  { spread: 120, height: 52, armBow: 0.28, baseBow: 0.18 }, // wide shallow
  { spread:  95, height: 94, armBow: 0.44, baseBow: 0.28 }, // tall narrow
  { spread: 112, height: 68, armBow: 0.52, baseBow: 0.32 }, // strongly bowed arms
  { spread: 102, height: 82, armBow: 0.34, baseBow: 0.14 }, // subtle curve
];

// Returns Bezier control points for an arc from p0 to p1 that bows outward
// from the V interior. The right-hand perpendicular of the chord (dy,−dx)/|d|
// points away from the V centre for every arc in the template.
function bowedBezierControls(
  p0: Point, p1: Point, bow: number,
): { c1: Point; c2: Point } {
  const dx = p1.x - p0.x, dy = p1.y - p0.y;
  const L = Math.hypot(dx, dy);
  if (L < 0.001) return { c1: { ...p0 }, c2: { ...p1 } };
  const rx = dy / L, ry = -dx / L;       // right-hand unit perpendicular
  const offset = bow * L * 0.45;         // perpendicular offset ∝ chord length
  return {
    c1: { x: p0.x + dx / 3 + rx * offset, y: p0.y + dy / 3 + ry * offset },
    c2: { x: p1.x - dx / 3 + rx * offset, y: p1.y - dy / 3 + ry * offset },
  };
}

// Catmull-Rom closed spline for user-drawn custom templates (Point[][]).
function createCatmullRomPath(
  random: () => number,
  chaos: number,
  index: number,
  customTemplates: Point[][],
): string {
  const rawTemplate = customTemplates[index % customTemplates.length];
  const perturb = 0.04 + chaos * 0.10;
  const stretchX = 0.92 + random() * (0.16 + chaos * 0.16);
  const stretchY = 0.80 + random() * (0.14 + chaos * 0.12);

  const points = rawTemplate.map((pt) => ({
    x: pt.x * stretchX * (0.98 + random() * (0.04 + chaos * 0.06)) + jitter(random, 14 * perturb),
    y: pt.y * stretchY * (0.98 + random() * (0.04 + chaos * 0.06)) + jitter(random, 14 * perturb),
  }));

  const tension = 0.40 + random() * (0.06 + chaos * 0.06);
  const controls = points.map((point, i) => {
    const prev = points[(i - 1 + points.length) % points.length];
    const next = points[(i + 1) % points.length];
    return {
      in:  { x: point.x - (next.x - prev.x) * tension, y: point.y - (next.y - prev.y) * tension },
      out: { x: point.x + (next.x - prev.x) * tension, y: point.y + (next.y - prev.y) * tension },
    };
  });

  const commands = [`M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`];
  for (let i = 0; i < points.length; i++) {
    const ni = (i + 1) % points.length;
    commands.push(
      `C ${controls[i].out.x.toFixed(2)} ${controls[i].out.y.toFixed(2)} ${controls[ni].in.x.toFixed(2)} ${controls[ni].in.y.toFixed(2)} ${points[ni].x.toFixed(2)} ${points[ni].y.toFixed(2)}`
    );
  }
  commands.push("Z");
  return commands.join(" ");
}

function createClosedBoomerangPath(
  random: () => number,
  chaos: number,
  index: number,
  customTemplates?: Point[][],
): string {
  if (customTemplates && customTemplates.length > 0) {
    return createCatmullRomPath(random, chaos, index, customTemplates);
  }

  const tmpl = SHAPE_TEMPLATES[index % SHAPE_TEMPLATES.length];

  // Perturb template parameters for per-element variety
  const spread  = tmpl.spread  * (0.88 + random() * (0.24 + chaos * 0.18));
  const height  = tmpl.height  * (0.88 + random() * (0.24 + chaos * 0.18));
  const armBow  = tmpl.armBow  * (0.72 + random() * (0.56 + chaos * 0.38));
  const baseBow = tmpl.baseBow * (0.60 + random() * (0.80 + chaos * 0.46));
  // Slight apex asymmetry so no two boomerangs look identical
  const asymX = jitter(random, 8 + chaos * 14);
  const asymY = jitter(random, 4 + chaos * 8);

  const tipL: Point = { x: -spread, y: 10 };
  const apex: Point = { x: asymX,   y: -height + asymY };
  const tipR: Point = { x:  spread, y: 10 };

  const la = bowedBezierControls(tipL, apex, armBow);   // left arm
  const ra = bowedBezierControls(apex, tipR, armBow);   // right arm
  const ba = bowedBezierControls(tipR, tipL, baseBow);  // base arc

  const f = (n: number) => n.toFixed(2);
  return [
    `M ${f(tipL.x)} ${f(tipL.y)}`,
    `C ${f(la.c1.x)} ${f(la.c1.y)} ${f(la.c2.x)} ${f(la.c2.y)} ${f(apex.x)} ${f(apex.y)}`,
    `C ${f(ra.c1.x)} ${f(ra.c1.y)} ${f(ra.c2.x)} ${f(ra.c2.y)} ${f(tipR.x)} ${f(tipR.y)}`,
    `C ${f(ba.c1.x)} ${f(ba.c1.y)} ${f(ba.c2.x)} ${f(ba.c2.y)} ${f(tipL.x)} ${f(tipL.y)}`,
    "Z",
  ].join(" ");
}

function jitteredGridFallback(
  random: () => number,
  targetCount: number,
  minDistance: number,
  bounds: SampleBounds,
) {
  const columns = Math.ceil(Math.sqrt(targetCount * 1.18));
  const rows = Math.ceil(targetCount / columns);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const cellWidth = width / columns;
  const cellHeight = height / rows;
  const indexes = Array.from({ length: columns * rows }, (_, index) => index);
  const samples: Point[] = [];
  const relaxedDistance = minDistance * 0.72;

  for (let index = indexes.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [indexes[index], indexes[swapIndex]] = [indexes[swapIndex], indexes[index]];
  }

  for (const index of indexes) {
    if (samples.length >= targetCount) break;

    const col = index % columns;
    const row = Math.floor(index / columns);
    const candidate = {
      x: clamp(
        bounds.minX + (col + 0.5) * cellWidth + jitter(random, cellWidth * 0.54),
        bounds.minX,
        bounds.maxX,
      ),
      y: clamp(
        bounds.minY + (row + 0.5) * cellHeight + jitter(random, cellHeight * 0.54),
        bounds.minY,
        bounds.maxY,
      ),
    };
    const collides = samples.some(
      (sample) =>
        Math.hypot(sample.x - candidate.x, sample.y - candidate.y) <
        relaxedDistance,
    );

    if (!collides) samples.push(candidate);
  }

  return samples;
}

function sampleLayerPoints(
  random: () => number,
  targetCount: number,
  layer: BoomerangLayerSettings,
) {
  const densityRadius = Math.sqrt(
    (CANVAS_SIZE * CANVAS_SIZE) / Math.max(1, targetCount * 1.65),
  );
  const visualScale = visualScaleFromSlider(layer.scale);
  const minDistance = clamp(densityRadius * (0.54 + visualScale * 0.14), 24, 86);
  const bounds = sampleBounds(layer);
  const sampleArea =
    ((bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY)) /
    (CANVAS_SIZE * CANVAS_SIZE);
  const overscanCount = Math.round(targetCount * sampleArea);

  return jitteredGridFallback(
    random,
    overscanCount,
    minDistance,
    bounds,
  ).slice(0, overscanCount);
}

export function generateBoomerangElements(
  settings: BoomerangSettings,
  layerOverrides?: LayerOverrides,
): BoomerangElement[] {
  const elements: BoomerangElement[] = [];
  const defaultCount = Math.round(32 + settings.density * 0.78);
  const blur = (settings.blur / 100) * 12;

  settings.layers
    .slice()
    .sort((a, b) => layerIndexFor(a.id) - layerIndexFor(b.id))
    .forEach((layer, layerPosition) => {
      const override = layerOverrides?.[layer.id];
      const layerIndex = layerIndexFor(layer.id);
      const countForLayer = override?.count || defaultCount;
      const templates = override?.templates?.length ? override.templates : undefined;
      const random = mulberry32(settings.seed + layerIndex * 104729);
      const chaos = clamp(layer.chaos / 100, 0, 1);
      const visualScale = visualScaleFromSlider(layer.scale);
      const points = sampleLayerPoints(random, countForLayer, layer);

      points.forEach((point, index) => {
        const localScale =
          visualScale * (0.72 + random() * (0.16 + chaos * 0.34));
        const rotationJitter = jitter(random, 95 + chaos * 240);

        elements.push({
          id: `${layer.id}-boomerang-${index}`,
          path: createClosedBoomerangPath(
            random, chaos, index + layerIndex * 17, templates,
          ),
          x: point.x,
          y: point.y,
          scale: localScale,
          rotation: settings.rotation + random() * 360 + rotationJitter,
          stroke: safeColor(layer.color),
          strokeWidth: settings.strokeWidth * (0.72 + random() * (0.05 + chaos * 0.24)),
          opacity: clamp(layer.opacity, 0, 1),
          blur,
          layerId: layer.id,
          layerLabel: layer.label,
          layerIndex,
          zIndex: layerPosition + random() * 0.4,
        });
      });
    });

  return elements.sort((a, b) => a.layerIndex - b.layerIndex || a.zIndex - b.zIndex);
}

function parseScaleFactor(transform?: string): number {
  if (!transform) return 1;
  const m = /scale\(([^)]+)\)/.exec(transform);
  return m ? parseFloat(m[1]) : 1;
}

const PATH_COMMAND_TOKEN = /^[MLCQZ]$/;

// Recenters a traced SVG path (M/L/C/Q/Z, absolute coords) around its own
// centroid and scales it into canvas units, preserving the exact contour
// instead of substituting a synthetic template. Every command in imagetracerjs
// output emits coordinates strictly as (x, y) pairs, so a flat sequential
// pairing of all numeric tokens is sufficient to recenter correctly.
function recenterTracedPath(d: string, scaleFactor: number): { path: string; centroid: Point } {
  const tokens = d.match(/[MLCQZ]|-?\d+(?:\.\d+)?/g) ?? [];
  const coords: number[] = [];
  for (const token of tokens) {
    if (!PATH_COMMAND_TOKEN.test(token)) coords.push(parseFloat(token));
  }

  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (let i = 0; i + 1 < coords.length; i += 2) {
    sumX += coords[i];
    sumY += coords[i + 1];
    count += 1;
  }
  const cx = count > 0 ? sumX / count : 0;
  const cy = count > 0 ? sumY / count : 0;

  let path = "";
  let pending: number[] = [];
  for (const token of tokens) {
    if (PATH_COMMAND_TOKEN.test(token)) {
      path += (path ? " " : "") + token;
      continue;
    }
    pending.push(parseFloat(token));
    if (pending.length === 2) {
      const x = ((pending[0] - cx) * scaleFactor).toFixed(2);
      const y = ((pending[1] - cy) * scaleFactor).toFixed(2);
      path += ` ${x} ${y}`;
      pending = [];
    }
  }

  return { path, centroid: { x: cx * scaleFactor, y: cy * scaleFactor } };
}

export function generateBoomerangElementsFromTrace(
  settings: BoomerangSettings,
  detectedShapes: DetectedVectorShape[],
  layerOverrides?: LayerOverrides,
): BoomerangElement[] {
  const elements: BoomerangElement[] = [];
  const blur = (settings.blur / 100) * 12;

  const topLayer = layerSettingsFor(settings, "top");
  const topLayerIndex = layerIndexFor("top");
  const topChaos = clamp(topLayer.chaos / 100, 0, 1);
  const topVisualScale = visualScaleFromSlider(topLayer.scale);

  detectedShapes.forEach((shape, index) => {
    const sf = parseScaleFactor(shape.transform);
    // Use the shape's own traced contour (the black outline detected in the
    // uploaded image) instead of a synthetic template, so the generated
    // pattern follows the actual vector trajectory from the source photo.
    const { path, centroid } = recenterTracedPath(shape.d, sf);
    const r = mulberry32(settings.seed + index * 7919 + 312701);
    const localScale = topVisualScale * (0.72 + r() * (0.16 + topChaos * 0.34));
    const rotation = settings.rotation + r() * 360;
    const strokeWidth = settings.strokeWidth * (0.72 + r() * (0.05 + topChaos * 0.24));

    elements.push({
      id: `detected-top-${index}`,
      path,
      x: centroid.x,
      y: centroid.y,
      scale: localScale,
      rotation,
      stroke: safeColor(topLayer.color),
      strokeWidth,
      opacity: clamp(topLayer.opacity, 0, 1),
      blur,
      layerId: "top",
      layerLabel: topLayer.label,
      layerIndex: topLayerIndex,
      zIndex: 2 + r() * 0.4,
    });
  });

  const defaultCount = Math.round(32 + settings.density * 0.78);

  (["bottom", "middle"] as const).forEach((layerId) => {
    const override = layerOverrides?.[layerId];
    const layer = layerSettingsFor(settings, layerId);
    const layerIndex = layerIndexFor(layerId);
    const countForLayer = override?.count || defaultCount;
    const templates = override?.templates?.length ? override.templates : undefined;
    const random = mulberry32(settings.seed + layerIndex * 104729);
    const chaos = clamp(layer.chaos / 100, 0, 1);
    const visualScale = visualScaleFromSlider(layer.scale);
    const points = sampleLayerPoints(random, countForLayer, layer);

    points.forEach((point, ptIndex) => {
      const localScale = visualScale * (0.72 + random() * (0.16 + chaos * 0.34));
      const rotationJitter = jitter(random, 95 + chaos * 240);

      elements.push({
        id: `${layerId}-boomerang-${ptIndex}`,
        path: createClosedBoomerangPath(random, chaos, ptIndex + layerIndex * 17, templates),
        x: point.x,
        y: point.y,
        scale: localScale,
        rotation: settings.rotation + random() * 360 + rotationJitter,
        stroke: safeColor(layer.color),
        strokeWidth: settings.strokeWidth * (0.72 + random() * (0.05 + chaos * 0.24)),
        opacity: clamp(layer.opacity, 0, 1),
        blur,
        layerId,
        layerLabel: layer.label,
        layerIndex,
        zIndex: layerIndex + random() * 0.4,
      });
    });
  });

  return elements.sort((a, b) => a.layerIndex - b.layerIndex || a.zIndex - b.zIndex);
}

export function detectedShapeColor(
  settings: BoomerangSettings,
  shape: DetectedVectorShape,
  index: number,
) {
  const layer = detectedShapeLayer(settings, shape, index);

  return safeColor(layer?.color ?? settings.layers[0]?.color ?? "#000000");
}

function detectedShapeLayer(
  settings: BoomerangSettings,
  shape: DetectedVectorShape,
  index: number,
) {
  const toneOffset = shape.tone === "light" ? 2 : 1;
  return settings.layers[(index + toneOffset) % settings.layers.length];
}

function renderGeneratedElementMark(element: BoomerangElement, blur: number) {
  const transform = `translate(${element.x.toFixed(2)} ${element.y.toFixed(
    2,
  )}) rotate(${element.rotation.toFixed(2)}) scale(${element.scale.toFixed(
    3,
  )})`;
  const sw = (element.strokeWidth * 5).toFixed(1);
  const strokeAttrs = `stroke="${element.stroke}" stroke-width="${sw}" fill="none" stroke-linecap="round" stroke-linejoin="round"`;
  const blurMark =
    blur > 0
      ? `
    <path d="${element.path}" transform="${transform}" ${strokeAttrs} opacity="${(element.opacity * 0.62).toFixed(2)}" filter="url(#line-blur)" />`
      : "";

  return `${blurMark}
    <path d="${element.path}" transform="${transform}" ${strokeAttrs} opacity="${element.opacity.toFixed(2)}" />`;
}

function renderLayerGroup(
  settings: BoomerangSettings,
  layerId: LayerId,
  elements: BoomerangElement[],
  blur: number,
) {
  const layerMarks = elements
    .filter((element) => element.layerId === layerId)
    .map((element) => renderGeneratedElementMark(element, blur))
    .join("");

  return `
  <g ${layerAttributes(settings, layerId)}>${layerMarks}
  </g>`;
}

function renderLayerGroups(
  settings: BoomerangSettings,
  elements: BoomerangElement[],
  blur: number,
) {
  return LAYER_ORDER.map((layerId) =>
    renderLayerGroup(settings, layerId, elements, blur),
  ).join("");
}

export function createBoomerangSvg(
  settings: BoomerangSettings,
  detectedShapes: DetectedVectorShape[] = [],
  layerOverrides?: LayerOverrides,
) {
  const blur = (settings.blur / 100) * 12;
  const filterDef = blurFilterDef(blur);
  const elements =
    detectedShapes.length > 0
      ? generateBoomerangElementsFromTrace(settings, detectedShapes, layerOverrides)
      : generateBoomerangElements(settings, layerOverrides);
  const groups = renderLayerGroups(settings, elements, blur);

  return svgDocument(settings, filterDef, groups, true);
}

export function createBoomerangSvgAnimated(
  settings: BoomerangSettings,
  detectedShapes: DetectedVectorShape[] = [],
  layerOverrides?: LayerOverrides,
): string {
  const blur = (settings.blur / 100) * 12;
  const filterDef = blurFilterDef(blur);
  const elements =
    detectedShapes.length > 0
      ? generateBoomerangElementsFromTrace(settings, detectedShapes, layerOverrides)
      : generateBoomerangElements(settings, layerOverrides);

  const totalDuration = 3.0;
  const total = elements.length || 1;

  const layerContent = LAYER_ORDER.map((layerId) => {
    const layer = layerSettingsFor(settings, layerId);
    const label = escapeAttribute(layer.label);
    const layerElements = elements.filter((e) => e.layerId === layerId);
    const marks = layerElements.map((element) => {
      const globalIndex = elements.indexOf(element);
      const delay = ((globalIndex / total) * totalDuration).toFixed(2);
      const dur = (totalDuration * 0.5).toFixed(2);
      const transform = `translate(${element.x.toFixed(2)} ${element.y.toFixed(2)}) rotate(${element.rotation.toFixed(2)}) scale(${element.scale.toFixed(3)})`;
      const sw = (element.strokeWidth * 5).toFixed(1);
      const strokeAttrs = `stroke="${element.stroke}" stroke-width="${sw}" fill="none" stroke-linecap="round" stroke-linejoin="round"`;
      const blurMark = blur > 0
        ? `<path d="${element.path}" transform="${transform}" ${strokeAttrs} opacity="0" filter="url(#line-blur)"><animate attributeName="opacity" from="0" to="${(element.opacity * 0.62).toFixed(2)}" dur="${dur}s" begin="${delay}s" fill="freeze"/></path>`
        : "";
      return `${blurMark}<path d="${element.path}" transform="${transform}" ${strokeAttrs} opacity="0"><animate attributeName="opacity" from="0" to="${element.opacity.toFixed(2)}" dur="${dur}s" begin="${delay}s" fill="freeze"/></path>`;
    }).join("");
    return `<g id="${layerId}-layer" data-layer="${layerId}" inkscape:groupmode="layer" inkscape:label="${label}">${marks}</g>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" viewBox="0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}">
  ${filterDef}
  <rect width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" fill="${safeColor(settings.background)}" />
  ${layerContent}
</svg>`;
}

export function createSeparatedLayerSvgs(
  settings: BoomerangSettings,
  detectedShapes: DetectedVectorShape[] = [],
  layerOverrides?: LayerOverrides,
): SeparatedLayerSvg[] {
  const blur = (settings.blur / 100) * 12;
  const filterDef = blurFilterDef(blur);
  const elements =
    detectedShapes.length > 0
      ? generateBoomerangElementsFromTrace(settings, detectedShapes, layerOverrides)
      : generateBoomerangElements(settings, layerOverrides);

  return LAYER_ORDER.map((layerId) => {
    const layer = layerSettingsFor(settings, layerId);
    const layerContent = renderLayerGroup(settings, layerId, elements, blur);

    return {
      layerId,
      label: layer.label,
      fileSuffix: `${layerId}-layer`,
      svg: svgDocument(settings, filterDef, layerContent, false),
    };
  });
}
