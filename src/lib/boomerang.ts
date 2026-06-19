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
  strokeWidth: 23,
  rotation: -18,
  background: "#19120f",
  primary: "#f1e7d0",
  secondary: "#c7352f",
  accent: "#0aa6a6",
  seed: 8248,
};

export const COLOR_PRESETS = [
  {
    name: "Ebony Red",
    background: "#19120f",
    primary: "#f1e7d0",
    secondary: "#c7352f",
    accent: "#111111",
  },
  {
    name: "Ebony Turquoise",
    background: "#16110f",
    primary: "#f4e8cc",
    secondary: "#0d9b9b",
    accent: "#101010",
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

const BOOMERANG_PATH =
  "M -86 34 C -66 -42 7 -103 72 -74 C 103 -60 107 -21 77 -11 C 35 3 -14 21 -35 68";

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

export function boomerangPath() {
  return BOOMERANG_PATH;
}

export function generateBoomerangElements(
  settings: BoomerangSettings,
): BoomerangElement[] {
  const random = mulberry32(settings.seed);
  const elements: BoomerangElement[] = [];
  const count = Math.round(28 + settings.density * 1.45);
  const columns = Math.max(5, Math.round(Math.sqrt(count) * 1.16));
  const rows = Math.ceil(count / columns);
  const cellX = CANVAS_SIZE / columns;
  const cellY = CANVAS_SIZE / rows;
  const chaos = settings.chaos / 100;
  const palette = [settings.primary, settings.secondary, settings.accent];

  for (let index = 0; index < count; index += 1) {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const offsetX = row % 2 === 0 ? cellX * 0.18 : -cellX * 0.14;
    const baseX = col * cellX + cellX / 2 + offsetX;
    const baseY = row * cellY + cellY / 2;
    const wave = Math.sin((row * 0.91 + col * 0.47) * Math.PI) * 15;
    const x = baseX + wave + jitter(random, cellX * 0.72 * chaos);
    const y = baseY + jitter(random, cellY * 0.78 * chaos);
    const rotationalStep = ((col * 37 + row * 23) % 360) - 180;
    const rotation =
      settings.rotation +
      rotationalStep * (0.24 + chaos * 0.56) +
      jitter(random, 92 * chaos);
    const scale =
      settings.scale *
      (0.72 + random() * 0.55 + (row % 3) * 0.035 + chaos * 0.14);
    const colorIndex = Math.abs(
      Math.round(col + row * 2 + random() * 2.4),
    ) % palette.length;

    elements.push({
      id: `boomerang-${index}`,
      x,
      y,
      scale,
      rotation,
      stroke: palette[colorIndex],
      strokeWidth: settings.strokeWidth * (0.82 + random() * 0.28),
      opacity: 0.9 + random() * 0.1,
    });
  }

  return elements;
}

export function createBoomerangSvg(settings: BoomerangSettings) {
  const elements = generateBoomerangElements(settings);
  const marks = elements
    .map(
      (element) => `
  <path d="${BOOMERANG_PATH}" transform="translate(${element.x.toFixed(
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
