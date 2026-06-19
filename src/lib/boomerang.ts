export type BoomerangSettings = {
  density: number;
  scale: number;
  chaos: number;
  strokeWidth: number;
  opacity: number;
  blur: number;
  rotation: number;
  background: string;
  primary: string;
  secondary: string;
  accent: string;
  seed: number;
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
  layer: number;
  zIndex: number;
};

export type DetectedVectorShape = {
  id: string;
  d: string;
  tone: "dark" | "light";
  transform?: string;
};

export const DEFAULT_BOOMERANG_SETTINGS: BoomerangSettings = {
  density: 110,
  scale: 0.82,
  chaos: 58,
  strokeWidth: 1.6,
  opacity: 35,
  blur: 0,
  rotation: -18,
  background: "#19120f",
  primary: "#f1e7d0",
  secondary: "#ea4d3a",
  accent: "#5bc092",
  seed: 8248,
};

export const COLOR_PRESETS = [
  {
    name: "Ebony Red",
    background: "#19120f",
    primary: "#f1e7d0",
    secondary: "#c7352f",
    accent: "#5bc092",
  },
  {
    name: "Ebony Turquoise",
    background: "#16110f",
    primary: "#f4e8cc",
    secondary: "#0d9b9b",
    accent: "#c7352f",
  },
  {
    name: "Glacier",
    background: "#e7f3f1",
    primary: "#114b5f",
    secondary: "#ef4f47",
    accent: "#f6c453",
  },
  {
    name: "Retro Jade",
    background: "#0f1917",
    primary: "#d9f0dc",
    secondary: "#66bf95",
    accent: "#e4563f",
  },
];

export const CANVAS_SIZE = 1200;
export const MAIN_LAYER_INDEX = 0;

type Point = {
  x: number;
  y: number;
};

type Bounds = {
  x: number;
  y: number;
  radius: number;
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
  const perturb = 0.1 + chaos * 0.12;
  const template = templates[index % templates.length];
  const points = template.map((point, pointIndex) => {
    const anchorWeight = pointIndex === 0 ? 0.5 : 1;

    return {
      x:
        point.x * (0.94 + random() * 0.16) +
        jitter(random, 32 * perturb) * anchorWeight,
      y:
        point.y * (0.9 + random() * 0.2) +
        jitter(random, 32 * perturb) * anchorWeight,
    };
  });
  const controls = points.map((point, pointIndex) => {
    const previous = points[(pointIndex - 1 + points.length) % points.length];
    const next = points[(pointIndex + 1) % points.length];
    const tension = 0.2 + random() * 0.08;

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

function boundsCollide(a: Bounds, b: Bounds, padding: number) {
  return Math.hypot(a.x - b.x, a.y - b.y) < a.radius + b.radius + padding;
}

function shuffledIndexes(length: number, random: () => number) {
  const indexes = Array.from({ length }, (_, index) => index);

  for (let index = indexes.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [indexes[index], indexes[swapIndex]] = [indexes[swapIndex], indexes[index]];
  }

  return indexes;
}

export function generateBoomerangElements(
  settings: BoomerangSettings,
): BoomerangElement[] {
  const random = mulberry32(settings.seed);
  const elements: BoomerangElement[] = [];
  const count = Math.round(130 + settings.density * 2.25);
  const layerCount = 3;
  const countPerLayer = Math.ceil(count / layerCount);
  const chaos = settings.chaos / 100;
  const palette = [settings.primary, settings.secondary, settings.accent];
  const blur = (settings.blur / 100) * 7.5;
  const placedByLayer: Bounds[][] = Array.from({ length: layerCount }, () => []);
  const columns = Math.ceil(Math.sqrt(countPerLayer * 1.08));
  const rows = Math.ceil(countPerLayer / columns);
  const cellX = CANVAS_SIZE / columns;
  const cellY = CANVAS_SIZE / rows;
  const baseRadius = 38 * settings.scale;
  const minPadding = Math.max(4, 13 - settings.density * 0.06);
  const mainLayerPaddingBoost = 1.12;

  for (let layer = 0; layer < layerCount; layer += 1) {
    const order = shuffledIndexes(columns * rows, random);
    const offsetX = (layer - 1) * cellX * 0.31;
    const offsetY = (layer === 1 ? -0.22 : layer * 0.17) * cellY;
    let accepted = 0;

    for (
      let orderIndex = 0;
      orderIndex < order.length && accepted < countPerLayer;
      orderIndex += 1
    ) {
      const index = layer * countPerLayer + accepted;
      const gridIndex = order[orderIndex];
      const col = gridIndex % columns;
      const row = Math.floor(gridIndex / columns);
      const rowOffset = row % 2 === 0 ? cellX * 0.18 : -cellX * 0.12;
      const scale = settings.scale * (0.3 + random() * 0.26 + chaos * 0.05);
      const radius = baseRadius * scale * (0.74 + random() * 0.28);
      const x =
        (((col + 0.5) * cellX +
          rowOffset +
          offsetX +
          jitter(random, cellX * (0.18 + chaos * 0.18))) %
          CANVAS_SIZE +
          CANVAS_SIZE) %
        CANVAS_SIZE;
      const y =
        (((row + 0.5) * cellY +
          offsetY +
          jitter(random, cellY * (0.18 + chaos * 0.18))) %
          CANVAS_SIZE +
          CANVAS_SIZE) %
        CANVAS_SIZE;
      const isMainLayer = layer === MAIN_LAYER_INDEX;
      const collisionRadius = isMainLayer
        ? radius * mainLayerPaddingBoost
        : radius;
      const layerPadding = isMainLayer
        ? minPadding * mainLayerPaddingBoost
        : minPadding;
      const bounds = { x, y, radius: collisionRadius };
      const collides = placedByLayer[layer].some((placed) =>
        boundsCollide(bounds, placed, layerPadding),
      );

      if (collides) continue;

      placedByLayer[layer].push(bounds);
      accepted += 1;

      elements.push({
        id: `boomerang-${index}`,
        path: createClosedBoomerangPath(random, chaos, index),
        x,
        y,
        scale,
        rotation: settings.rotation + random() * 360 + jitter(random, 80 * chaos),
        stroke: palette[layer],
        strokeWidth: settings.strokeWidth * (0.72 + random() * 0.34),
        opacity: 0.18 + (settings.opacity / 100) * 0.42,
        blur,
        layer,
        zIndex: random(),
      });
    }
  }

  return elements.sort((a, b) => a.zIndex - b.zIndex);
}

export function detectedShapeColor(
  settings: BoomerangSettings,
  shape: DetectedVectorShape,
  index: number,
) {
  if (shape.tone === "light") {
    return index % 2 === 0 ? settings.primary : settings.accent;
  }

  return index % 2 === 0 ? settings.secondary : settings.accent;
}

export function createBoomerangSvg(
  settings: BoomerangSettings,
  detectedShapes: DetectedVectorShape[] = [],
) {
  const blur = (settings.blur / 100) * 7.5;
  const filterDef =
    blur > 0
      ? `
  <defs>
    <filter id="line-blur" x="-12%" y="-12%" width="124%" height="124%" color-interpolation-filters="sRGB">
      <feGaussianBlur stdDeviation="${blur.toFixed(2)}" />
    </filter>
  </defs>`
      : "";

  if (detectedShapes.length > 0) {
    const overlayOpacity = (settings.opacity / 100) * 0.28;
    const marks = detectedShapes
      .map(
        (shape, index) => `
  ${
    blur > 0
      ? `<path d="${shape.d}"${
          shape.transform ? ` transform="${shape.transform}"` : ""
        } fill="${detectedShapeColor(
          settings,
          shape,
          index,
        )}" opacity="0.38" filter="url(#line-blur)" />`
      : ""
  }
  <path d="${shape.d}"${
    shape.transform ? ` transform="${shape.transform}"` : ""
  } fill="${detectedShapeColor(
    settings,
    shape,
    index,
  )}" opacity="1" />
  ${
    overlayOpacity > 0
      ? `<path d="${shape.d}"${
          shape.transform ? ` transform="${shape.transform}"` : ""
        } fill="${detectedShapeColor(
          settings,
          shape,
          index,
        )}" opacity="${overlayOpacity.toFixed(2)}" />`
      : ""
  }`,
      )
      .join("");

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" viewBox="0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}">
  ${filterDef}
  <rect width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" fill="${settings.background}" />
  <g>${marks}
  </g>
</svg>`;
  }

  const elements = generateBoomerangElements(settings);
  const blurredMarks =
    blur > 0
      ? elements
          .map(
            (element) => `
  <path d="${element.path}" transform="translate(${element.x.toFixed(
    2,
  )} ${element.y.toFixed(2)}) rotate(${element.rotation.toFixed(
    2,
  )}) scale(${element.scale.toFixed(3)})" fill="none" stroke="${
    element.stroke
  }" stroke-width="${element.strokeWidth.toFixed(
    2,
  )}" stroke-linecap="round" stroke-linejoin="round" opacity="0.4" filter="url(#line-blur)" vector-effect="non-scaling-stroke" />`,
          )
          .join("")
      : "";
  const overlayMarks =
    settings.opacity > 0
      ? elements
          .map(
            (element) => `
  <path d="${element.path}" transform="translate(${element.x.toFixed(
    2,
  )} ${element.y.toFixed(2)}) rotate(${element.rotation.toFixed(
    2,
  )}) scale(${element.scale.toFixed(3)})" fill="none" stroke="${
    element.stroke
  }" stroke-width="${element.strokeWidth.toFixed(
    2,
  )}" stroke-linecap="round" stroke-linejoin="round" opacity="${element.opacity.toFixed(
    2,
  )}" vector-effect="non-scaling-stroke" />`,
          )
          .join("")
      : "";
  const marks = elements
    .map(
      (element) => `
  <path d="${element.path}" transform="translate(${element.x.toFixed(
    2,
  )} ${element.y.toFixed(2)}) rotate(${element.rotation.toFixed(
    2,
  )}) scale(${element.scale.toFixed(3)})" fill="none" stroke="${
    element.stroke
  }" stroke-width="${element.strokeWidth.toFixed(
    2,
  )}" stroke-linecap="round" stroke-linejoin="round" opacity="1" vector-effect="non-scaling-stroke" />`,
    )
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" viewBox="0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}">
  ${filterDef}
  <rect width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" fill="${settings.background}" />
  <g>${blurredMarks}
  </g>
  <g>${marks}
  </g>
  <g>${overlayMarks}
  </g>
</svg>`;
}
