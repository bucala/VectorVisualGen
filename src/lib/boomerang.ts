export type BoomerangSettings = {
  density: number;
  scale: number;
  chaos: number;
  strokeWidth: number;
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
};

export const DEFAULT_BOOMERANG_SETTINGS: BoomerangSettings = {
  density: 72,
  scale: 1,
  chaos: 58,
  strokeWidth: 6,
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

type Point = {
  x: number;
  y: number;
};

const BOOMERANG_SKELETONS: Point[][] = [
  [
    { x: -105, y: 34 },
    { x: -60, y: -62 },
    { x: 34, y: -96 },
    { x: 105, y: -28 },
  ],
  [
    { x: -92, y: -70 },
    { x: -35, y: -110 },
    { x: 20, y: 38 },
    { x: 96, y: 72 },
  ],
  [
    { x: -108, y: 48 },
    { x: -62, y: -88 },
    { x: 46, y: -64 },
    { x: 82, y: 68 },
  ],
  [
    { x: -112, y: -12 },
    { x: -24, y: -98 },
    { x: 98, y: -52 },
    { x: 58, y: 82 },
  ],
  [
    { x: -90, y: 74 },
    { x: -22, y: -82 },
    { x: 70, y: -102 },
    { x: 104, y: 24 },
  ],
  [
    { x: -88, y: -58 },
    { x: -74, y: 42 },
    { x: 24, y: 88 },
    { x: 108, y: -34 },
  ],
];

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

function cubicBezier(points: Point[], t: number): Point {
  const mt = 1 - t;
  return {
    x:
      mt * mt * mt * points[0].x +
      3 * mt * mt * t * points[1].x +
      3 * mt * t * t * points[2].x +
      t * t * t * points[3].x,
    y:
      mt * mt * mt * points[0].y +
      3 * mt * mt * t * points[1].y +
      3 * mt * t * t * points[2].y +
      t * t * t * points[3].y,
  };
}

function smoothClosedPath(points: Point[]) {
  const commands: string[] = [];

  points.forEach((point, index) => {
    const previous = points[(index - 1 + points.length) % points.length];
    const current = point;
    const next = points[(index + 1) % points.length];
    const nextNext = points[(index + 2) % points.length];

    if (index === 0) {
      commands.push(`M ${current.x.toFixed(2)} ${current.y.toFixed(2)}`);
    }

    const controlOne = {
      x: current.x + (next.x - previous.x) / 6,
      y: current.y + (next.y - previous.y) / 6,
    };
    const controlTwo = {
      x: next.x - (nextNext.x - current.x) / 6,
      y: next.y - (nextNext.y - current.y) / 6,
    };

    commands.push(
      `C ${controlOne.x.toFixed(2)} ${controlOne.y.toFixed(
        2,
      )} ${controlTwo.x.toFixed(2)} ${controlTwo.y.toFixed(
        2,
      )} ${next.x.toFixed(2)} ${next.y.toFixed(2)}`,
    );
  });

  commands.push("Z");
  return commands.join(" ");
}

function createClosedBoomerangPath(
  random: () => number,
  chaos: number,
  index: number,
) {
  const skeleton =
    BOOMERANG_SKELETONS[index % BOOMERANG_SKELETONS.length] ??
    BOOMERANG_SKELETONS[0];
  const localChaos = 0.35 + chaos * 0.55;
  const bend = jitter(random, 18 * localChaos);
  const pinched = random() > 0.58;
  const bodyWidth = 20 + random() * 18 + chaos * 8;
  const lengthScale = 0.82 + random() * 0.52;
  const heightScale = 0.72 + random() * 0.66;
  const samples = 8;

  const spine = Array.from({ length: samples }, (_, sampleIndex) => {
    const t = sampleIndex / (samples - 1);
    const base = cubicBezier(skeleton, t);
    const wave = Math.sin(t * Math.PI * (1.35 + random() * 0.75));

    return {
      x: base.x * lengthScale + jitter(random, 7 * localChaos),
      y:
        base.y * heightScale +
        wave * bend +
        jitter(random, 6 * localChaos),
    };
  });

  const left: Point[] = [];
  const right: Point[] = [];

  spine.forEach((point, sampleIndex) => {
    const previous = spine[Math.max(0, sampleIndex - 1)];
    const next = spine[Math.min(spine.length - 1, sampleIndex + 1)];
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    const length = Math.hypot(dx, dy) || 1;
    const normal = { x: -dy / length, y: dx / length };
    const t = sampleIndex / (spine.length - 1);
    const taper = Math.sin(t * Math.PI);
    const asymmetricPinch = pinched && t > 0.34 && t < 0.68 ? 0.68 : 1;
    const width =
      (bodyWidth * (0.5 + taper * (0.86 + chaos * 0.18)) + 4) *
      asymmetricPinch;
    const wobble = Math.sin((index + sampleIndex) * 1.7) * 2.6 * localChaos;
    const rightBias = 0.82 + Math.cos((index + sampleIndex) * 0.93) * 0.14;

    left.push({
      x: point.x + normal.x * (width + wobble),
      y: point.y + normal.y * (width + wobble),
    });
    right.unshift({
      x: point.x - normal.x * (width * rightBias - wobble),
      y: point.y - normal.y * (width * rightBias - wobble),
    });
  });

  return smoothClosedPath([...left, ...right]);
}

export function generateBoomerangElements(
  settings: BoomerangSettings,
): BoomerangElement[] {
  const random = mulberry32(settings.seed);
  const elements: BoomerangElement[] = [];
  const count = Math.round(20 + settings.density * 0.7);
  const columns = Math.max(6, Math.round(Math.sqrt(count) * 1.05));
  const rows = Math.ceil(count / columns);
  const cellX = CANVAS_SIZE / columns;
  const cellY = CANVAS_SIZE / rows;
  const chaos = settings.chaos / 100;
  const palette = [settings.primary, settings.secondary, settings.accent];

  for (let index = 0; index < count; index += 1) {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const layer = index % 3;
    const offsetX = row % 2 === 0 ? cellX * 0.28 : -cellX * 0.2;
    const baseX = col * cellX + cellX / 2 + offsetX;
    const baseY = row * cellY + cellY / 2 + (layer - 1) * cellY * 0.08;
    const wave = Math.sin((row * 0.73 + col * 0.41) * Math.PI) * cellX * 0.12;
    const x = baseX + wave + jitter(random, cellX * (0.48 + chaos * 0.7));
    const y = baseY + jitter(random, cellY * (0.5 + chaos * 0.78));
    const rotationalStep = ((col * 47 + row * 31 + layer * 53) % 360) - 180;
    const rotation =
      settings.rotation +
      rotationalStep * (0.38 + chaos * 0.62) +
      jitter(random, 118 * chaos);
    const scale =
      settings.scale *
      (0.34 +
        random() * 0.32 +
        layer * 0.08 +
        (row % 2) * 0.035 +
        chaos * 0.08);
    const colorIndex = Math.abs(
      Math.round(col + row * 2 + random() * 2.4),
    ) % palette.length;

    elements.push({
      id: `boomerang-${index}`,
      path: createClosedBoomerangPath(random, chaos, index),
      x,
      y,
      scale,
      rotation,
      stroke: palette[colorIndex],
      strokeWidth: settings.strokeWidth * (0.72 + random() * 0.38),
      opacity: 0.58 + layer * 0.12 + random() * 0.12,
    });
  }

  return elements;
}

export function createBoomerangSvg(settings: BoomerangSettings) {
  const elements = generateBoomerangElements(settings);
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
  )}" stroke-linecap="round" stroke-linejoin="round" opacity="${element.opacity.toFixed(
    2,
  )}" vector-effect="non-scaling-stroke" />`,
    )
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" viewBox="0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}">
  <rect width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" fill="${settings.background}" />
  <g>${marks}
  </g>
</svg>`;
}
