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

function createClosedBoomerangPath(
  random: () => number,
  chaos: number,
  index: number,
  customTemplates?: Point[][],
) {
  const builtInTemplates: Point[][] = [
    // Classic symmetric boomerang: outer arc (tip→arm→bend→arm→tip) then inner arc
    [
      { x: -110, y: 10 },
      { x: -70, y: -46 },
      { x: -4, y: -28 },
      { x: 70, y: -46 },
      { x: 110, y: 10 },
      { x: 86, y: 34 },
      { x: 46, y: 12 },
      { x: -2, y: 4 },
      { x: -44, y: 12 },
      { x: -88, y: 34 },
    ],
    // Asymmetric: slightly offset bend
    [
      { x: -106, y: 14 },
      { x: -68, y: -50 },
      { x: -4, y: -32 },
      { x: 64, y: -52 },
      { x: 112, y: 6 },
      { x: 88, y: 30 },
      { x: 46, y: 10 },
      { x: -6, y: 2 },
      { x: -48, y: 14 },
      { x: -86, y: 38 },
    ],
    // Tighter bend — more acute V angle
    [
      { x: -108, y: 6 },
      { x: -60, y: -54 },
      { x: 0, y: -18 },
      { x: 60, y: -54 },
      { x: 108, y: 6 },
      { x: 84, y: 30 },
      { x: 42, y: 6 },
      { x: 0, y: 10 },
      { x: -40, y: 8 },
      { x: -84, y: 32 },
    ],
    // Organic: one arm curves higher
    [
      { x: -112, y: 4 },
      { x: -74, y: -56 },
      { x: -8, y: -38 },
      { x: 60, y: -44 },
      { x: 110, y: 14 },
      { x: 84, y: 38 },
      { x: 40, y: 18 },
      { x: -10, y: 6 },
      { x: -52, y: 16 },
      { x: -90, y: 36 },
    ],
    // Wide/flat boomerang
    [
      { x: -110, y: 16 },
      { x: -64, y: -42 },
      { x: 2, y: -22 },
      { x: 66, y: -42 },
      { x: 110, y: 16 },
      { x: 88, y: 40 },
      { x: 52, y: 22 },
      { x: 0, y: 12 },
      { x: -50, y: 20 },
      { x: -90, y: 40 },
    ],
  ];
  const templates = customTemplates && customTemplates.length > 0 ? customTemplates : builtInTemplates;
  const template = templates[index % templates.length];
  const perturb = 0.04 + chaos * 0.12;
  const stretchX = 0.92 + random() * (0.18 + chaos * 0.18);
  const stretchY = 0.78 + random() * (0.18 + chaos * 0.14);
  const points = template.map((point, pointIndex) => {
    const anchorWeight = pointIndex === 0 ? 0.55 : 1;

    return {
      x:
        point.x * stretchX * (0.98 + random() * (0.04 + chaos * 0.07)) +
        jitter(random, 18 * perturb) * anchorWeight,
      y:
        point.y *
          stretchY *
          (0.98 + random() * (0.04 + chaos * 0.08)) +
        jitter(random, 18 * perturb) * anchorWeight,
    };
  });
  const controls = points.map((point, pointIndex) => {
    const previous = points[(pointIndex - 1 + points.length) % points.length];
    const next = points[(pointIndex + 1) % points.length];
    const tension = 0.20 + random() * (0.06 + chaos * 0.06);

    return {
      in: {
        x: point.x - (next.x - previous.x) * tension,
        y: point.y - (next.y - previous.y) * tension,
      },
      out: {
        x: point.x + (next.x - previous.x) * tension,
        y: point.y + (next.y - previous.y) * tension,
      },
    };
  });
  const commands = [`M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`];

  for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
    const nextIndex = (pointIndex + 1) % points.length;
    const currentControl = controls[pointIndex].out;
    const nextControl = controls[nextIndex].in;
    const next = points[nextIndex];

    commands.push(
      `C ${currentControl.x.toFixed(2)} ${currentControl.y.toFixed(
        2,
      )} ${nextControl.x.toFixed(2)} ${nextControl.y.toFixed(
        2,
      )} ${next.x.toFixed(2)} ${next.y.toFixed(2)}`,
    );
  }

  commands.push("Z");
  return commands.join(" ");
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
          path: createClosedBoomerangPath(random, chaos, index + layerIndex * 17, templates),
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

function extractShapeCentroid(d: string, scaleFactor: number): Point {
  const coords: number[] = [];
  for (const m of d.matchAll(/(-?\d+(?:\.\d+)?)/g)) {
    coords.push(parseFloat(m[1]));
  }
  if (coords.length < 2) return { x: CANVAS_SIZE / 2, y: CANVAS_SIZE / 2 };
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (let i = 0; i + 1 < coords.length; i += 2) {
    sumX += coords[i];
    sumY += coords[i + 1];
    count += 1;
  }
  return { x: (sumX / count) * scaleFactor, y: (sumY / count) * scaleFactor };
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
  const topTemplates = layerOverrides?.top?.templates?.length ? layerOverrides.top.templates : undefined;

  detectedShapes.forEach((shape, index) => {
    const sf = parseScaleFactor(shape.transform);
    const centroid = extractShapeCentroid(shape.d, sf);
    const r = mulberry32(settings.seed + index * 7919 + 312701);
    const path = createClosedBoomerangPath(r, topChaos, index, topTemplates);
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
  const blurMark =
    blur > 0
      ? `
    <path d="${element.path}" transform="${transform}" fill="none" stroke="${
          element.stroke
        }" stroke-width="${(element.strokeWidth + blur * 1.15).toFixed(
          2,
        )}" stroke-linecap="round" stroke-linejoin="round" opacity="${(
          element.opacity * 0.62
        ).toFixed(2)}" filter="url(#line-blur)" vector-effect="non-scaling-stroke" />`
      : "";

  return `${blurMark}
    <path d="${element.path}" transform="${transform}" fill="none" stroke="${
      element.stroke
    }" stroke-width="${element.strokeWidth.toFixed(
      2,
    )}" stroke-linecap="round" stroke-linejoin="round" opacity="${element.opacity.toFixed(
      2,
    )}" vector-effect="non-scaling-stroke" />`;
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
