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
    color: "#5bc092",
    scale: 0.74,
    chaos: 42,
    opacity: 0.58,
  },
  {
    id: "middle",
    label: "Stredná vrstva",
    color: "#ea4d3a",
    scale: 0.82,
    chaos: 55,
    opacity: 0.72,
  },
  {
    id: "top",
    label: "Vrchná vrstva",
    color: "#f1e7d0",
    scale: 0.9,
    chaos: 34,
    opacity: 0.94,
  },
];

export const DEFAULT_BOOMERANG_SETTINGS: BoomerangSettings = {
  density: 180,
  strokeWidth: 1.45,
  blur: 0,
  rotation: -18,
  background: "#19120f",
  seed: 8248,
  layers: DEFAULT_LAYERS,
};

export const COLOR_PRESETS = [
  {
    name: "Ebony Red",
    background: "#19120f",
    layers: ["#5bc092", "#c7352f", "#f1e7d0"],
  },
  {
    name: "Ebony Turquoise",
    background: "#16110f",
    layers: ["#c7352f", "#0d9b9b", "#f4e8cc"],
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

type Point = {
  x: number;
  y: number;
};

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
  const shapeReach = 128 * layer.scale * (0.58 + chaos * 0.38);
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
) {
  const templates: Point[][] = [
    [
      { x: -82, y: 18 },
      { x: -62, y: -58 },
      { x: 12, y: -82 },
      { x: 78, y: -36 },
      { x: 42, y: -10 },
      { x: -16, y: -26 },
      { x: -58, y: 30 },
    ],
    [
      { x: -78, y: -34 },
      { x: -40, y: -76 },
      { x: 34, y: -60 },
      { x: 82, y: 10 },
      { x: 28, y: 28 },
      { x: -28, y: 0 },
      { x: -68, y: 34 },
    ],
    [
      { x: -82, y: 4 },
      { x: -34, y: -88 },
      { x: 56, y: -58 },
      { x: 78, y: 42 },
      { x: 22, y: 18 },
      { x: -22, y: 4 },
      { x: -58, y: 34 },
    ],
    [
      { x: -72, y: 26 },
      { x: -54, y: -54 },
      { x: 32, y: -78 },
      { x: 80, y: -4 },
      { x: 36, y: 34 },
      { x: -18, y: -10 },
      { x: -58, y: 34 },
    ],
  ];
  const perturb = 0.08 + chaos * 0.24;
  const template = templates[index % templates.length];
  const points = template.map((point, pointIndex) => {
    const anchorWeight = pointIndex === 0 ? 0.55 : 1;

    return {
      x:
        point.x * (0.95 + random() * (0.08 + chaos * 0.18)) +
        jitter(random, 30 * perturb) * anchorWeight,
      y:
        point.y * (0.94 + random() * (0.09 + chaos * 0.18)) +
        jitter(random, 30 * perturb) * anchorWeight,
    };
  });
  const controls = points.map((point, pointIndex) => {
    const previous = points[(pointIndex - 1 + points.length) % points.length];
    const next = points[(pointIndex + 1) % points.length];
    const tension = 0.18 + random() * (0.06 + chaos * 0.1);

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
  const minDistance = clamp(densityRadius * (0.62 + layer.scale * 0.08), 28, 92);
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
): BoomerangElement[] {
  const elements: BoomerangElement[] = [];
  const countPerLayer = Math.round(32 + settings.density * 0.78);
  const blur = (settings.blur / 100) * 12;

  settings.layers
    .slice()
    .sort((a, b) => layerIndexFor(a.id) - layerIndexFor(b.id))
    .forEach((layer, layerPosition) => {
      const layerIndex = layerIndexFor(layer.id);
      const random = mulberry32(settings.seed + layerIndex * 104729);
      const chaos = clamp(layer.chaos / 100, 0, 1);
      const points = sampleLayerPoints(random, countPerLayer, layer);

      points.forEach((point, index) => {
        const localScale =
          layer.scale * (0.36 + random() * (0.12 + chaos * 0.28));
        const rotationJitter = jitter(random, 70 + chaos * 250);

        elements.push({
          id: `${layer.id}-boomerang-${index}`,
          path: createClosedBoomerangPath(random, chaos, index + layerIndex * 17),
          x: point.x,
          y: point.y,
          scale: localScale,
          rotation: settings.rotation + random() * 360 + rotationJitter,
          stroke: safeColor(layer.color),
          strokeWidth: settings.strokeWidth * (0.82 + random() * (0.05 + chaos * 0.3)),
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

function detectedShapeOpacity(
  settings: BoomerangSettings,
  shape: DetectedVectorShape,
  index: number,
) {
  const layer = detectedShapeLayer(settings, shape, index);

  return clamp(layer?.opacity ?? 1, 0, 1);
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

function renderDetectedShapeMark(
  settings: BoomerangSettings,
  shape: DetectedVectorShape,
  index: number,
  blur: number,
) {
  const fill = detectedShapeColor(settings, shape, index);
  const opacity = detectedShapeOpacity(settings, shape, index);
  const transform = shape.transform
    ? ` transform="${escapeAttribute(shape.transform)}"`
    : "";
  const blurMark =
    blur > 0
      ? `<path d="${shape.d}"${transform} fill="${fill}" opacity="${(
          opacity * 0.58
        ).toFixed(2)}" filter="url(#line-blur)" />`
      : "";

  return `
    ${blurMark}
    <path d="${shape.d}"${transform} fill="${fill}" opacity="${opacity.toFixed(
      2,
    )}" />`;
}

function renderLayerGroup(
  settings: BoomerangSettings,
  layerId: LayerId,
  elements: BoomerangElement[],
  detectedShapes: DetectedVectorShape[],
  blur: number,
) {
  const layerMarks =
    detectedShapes.length > 0
      ? detectedShapes
          .map((shape, index) =>
            detectedShapeLayer(settings, shape, index)?.id === layerId
              ? renderDetectedShapeMark(settings, shape, index, blur)
              : "",
          )
          .join("")
      : elements
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
  detectedShapes: DetectedVectorShape[],
  blur: number,
) {
  return LAYER_ORDER.map((layerId) =>
    renderLayerGroup(settings, layerId, elements, detectedShapes, blur),
  ).join("");
}

export function createBoomerangSvg(
  settings: BoomerangSettings,
  detectedShapes: DetectedVectorShape[] = [],
) {
  const blur = (settings.blur / 100) * 12;
  const filterDef = blurFilterDef(blur);
  const elements = detectedShapes.length > 0 ? [] : generateBoomerangElements(settings);
  const groups = renderLayerGroups(settings, elements, detectedShapes, blur);

  return svgDocument(settings, filterDef, groups, true);
}

export function createSeparatedLayerSvgs(
  settings: BoomerangSettings,
  detectedShapes: DetectedVectorShape[] = [],
): SeparatedLayerSvg[] {
  const blur = (settings.blur / 100) * 12;
  const filterDef = blurFilterDef(blur);
  const elements = detectedShapes.length > 0 ? [] : generateBoomerangElements(settings);

  return LAYER_ORDER.map((layerId) => {
    const layer = layerSettingsFor(settings, layerId);
    const layerContent = renderLayerGroup(
      settings,
      layerId,
      elements,
      detectedShapes,
      blur,
    );

    return {
      layerId,
      label: layer.label,
      fileSuffix: `${layerId}-layer`,
      svg: svgDocument(settings, filterDef, layerContent, false),
    };
  });
}
