export type BoomerangSettings = {
  density: number;
  scale: number;
  chaos: number;
  strokeWidth: number;
  opacity: number;
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

export type DetectedVectorShape = {
  id: string;
  d: string;
  tone: "dark" | "light";
  transform?: string;
};

export const DEFAULT_BOOMERANG_SETTINGS: BoomerangSettings = {
  density: 72,
  scale: 1,
  chaos: 58,
  strokeWidth: 4,
  opacity: 62,
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

function cubicBezierTangent(points: Point[], t: number): Point {
  const mt = 1 - t;

  return {
    x:
      3 * mt * mt * (points[1].x - points[0].x) +
      6 * mt * t * (points[2].x - points[1].x) +
      3 * t * t * (points[3].x - points[2].x),
    y:
      3 * mt * mt * (points[1].y - points[0].y) +
      6 * mt * t * (points[2].y - points[1].y) +
      3 * t * t * (points[3].y - points[2].y),
  };
}

function chaikinClosed(points: Point[], iterations = 2) {
  let current = points;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const next: Point[] = [];

    current.forEach((point, index) => {
      const following = current[(index + 1) % current.length];

      next.push({
        x: point.x * 0.78 + following.x * 0.22,
        y: point.y * 0.78 + following.y * 0.22,
      });
      next.push({
        x: point.x * 0.22 + following.x * 0.78,
        y: point.y * 0.22 + following.y * 0.78,
      });
    });

    current = next;
  }

  return current;
}

function smoothClosedPath(points: Point[]) {
  const smoothed = chaikinClosed(points, 3);
  const smoothestIndex = smoothed.reduce((bestIndex, point, index) => {
    const previous = smoothed[(index - 1 + smoothed.length) % smoothed.length];
    const next = smoothed[(index + 1) % smoothed.length];
    const incoming = { x: point.x - previous.x, y: point.y - previous.y };
    const outgoing = { x: next.x - point.x, y: next.y - point.y };
    const incomingLength = Math.hypot(incoming.x, incoming.y) || 1;
    const outgoingLength = Math.hypot(outgoing.x, outgoing.y) || 1;
    const smoothness =
      (incoming.x * outgoing.x + incoming.y * outgoing.y) /
      (incomingLength * outgoingLength);
    const best = smoothed[bestIndex];
    const bestPrevious =
      smoothed[(bestIndex - 1 + smoothed.length) % smoothed.length];
    const bestNext = smoothed[(bestIndex + 1) % smoothed.length];
    const bestIncoming = {
      x: best.x - bestPrevious.x,
      y: best.y - bestPrevious.y,
    };
    const bestOutgoing = {
      x: bestNext.x - best.x,
      y: bestNext.y - best.y,
    };
    const bestIncomingLength =
      Math.hypot(bestIncoming.x, bestIncoming.y) || 1;
    const bestOutgoingLength =
      Math.hypot(bestOutgoing.x, bestOutgoing.y) || 1;
    const bestSmoothness =
      (bestIncoming.x * bestOutgoing.x + bestIncoming.y * bestOutgoing.y) /
      (bestIncomingLength * bestOutgoingLength);

    return smoothness > bestSmoothness ? index : bestIndex;
  }, 0);
  const smoothPoints = [
    ...smoothed.slice(smoothestIndex),
    ...smoothed.slice(0, smoothestIndex),
  ];
  const commands: string[] = [];

  smoothPoints.forEach((point, index) => {
    const previous =
      smoothPoints[(index - 1 + smoothPoints.length) % smoothPoints.length];
    const current = point;
    const next = smoothPoints[(index + 1) % smoothPoints.length];
    const nextNext = smoothPoints[(index + 2) % smoothPoints.length];

    if (index === 0) {
      commands.push(`M ${current.x.toFixed(2)} ${current.y.toFixed(2)}`);
    }

    const controlOne = {
      x: current.x + (next.x - previous.x) / 13,
      y: current.y + (next.y - previous.y) / 13,
    };
    const controlTwo = {
      x: next.x - (nextNext.x - current.x) / 13,
      y: next.y - (nextNext.y - current.y) / 13,
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
  const families: Point[][] = [
    [
      { x: -124, y: 34 },
      { x: -76, y: -92 },
      { x: 42, y: -102 },
      { x: 118, y: -18 },
    ],
    [
      { x: -112, y: -48 },
      { x: -92, y: 58 },
      { x: 28, y: 106 },
      { x: 120, y: 16 },
    ],
    [
      { x: -128, y: 4 },
      { x: -58, y: -116 },
      { x: 62, y: -72 },
      { x: 104, y: 52 },
    ],
    [
      { x: -114, y: 64 },
      { x: -38, y: -76 },
      { x: 76, y: -94 },
      { x: 116, y: 22 },
    ],
    [
      { x: -118, y: -18 },
      { x: -76, y: 96 },
      { x: 42, y: 82 },
      { x: 116, y: -36 },
    ],
    [
      { x: -126, y: 42 },
      { x: -24, y: -108 },
      { x: 76, y: -42 },
      { x: 108, y: 70 },
    ],
  ];
  const family = families[index % families.length];
  const localChaos = 0.16 + chaos * 0.26;
  const lengthScale = 0.88 + random() * 0.28;
  const heightScale = 0.78 + random() * 0.34;
  const controlPoints = family.map((point, pointIndex) => ({
    x:
      point.x * lengthScale +
      jitter(random, pointIndex === 0 || pointIndex === 3 ? 10 : 22) *
        localChaos,
    y:
      point.y * heightScale +
      jitter(random, pointIndex === 0 || pointIndex === 3 ? 10 : 24) *
        localChaos,
  }));
  const sampleCount = 18;
  const bodyWidth = 20 + random() * 15 + chaos * 7;
  const phase = random() * Math.PI * 2;
  const waveAmount = 2.4 + chaos * 5.2;
  const leftBias = 0.9 + random() * 0.22;
  const rightBias = 0.9 + random() * 0.22;
  const pinchCenter = 0.28 + random() * 0.44;
  const pinchAmount = 0.04 + random() * 0.1 + chaos * 0.04;
  const left: Point[] = [];
  const right: Point[] = [];
  const spine: Array<{
    center: Point;
    normal: Point;
    tangent: Point;
    width: number;
  }> = [];

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const t = sampleIndex / (sampleCount - 1);
    const center = cubicBezier(controlPoints, t);
    const tangent = cubicBezierTangent(controlPoints, t);
    const tangentLength = Math.hypot(tangent.x, tangent.y) || 1;
    const normal = {
      x: -tangent.y / tangentLength,
      y: tangent.x / tangentLength,
    };
    const tangentUnit = {
      x: tangent.x / tangentLength,
      y: tangent.y / tangentLength,
    };
    const smoothWave =
      Math.sin(t * Math.PI * 2 + phase) * waveAmount +
      Math.sin(t * Math.PI * 3 - phase * 0.35) * waveAmount * 0.28;
    const capRoundness = 0.78 + Math.sin(t * Math.PI) * 0.26;
    const pinch =
      1 -
      pinchAmount * Math.exp(-Math.pow((t - pinchCenter) / 0.2, 2));
    const width =
      bodyWidth *
      capRoundness *
      pinch *
      (1 + Math.sin(t * Math.PI * 2 + phase * 0.5) * 0.055);
    const warpedCenter = {
      x: center.x + normal.x * smoothWave,
      y: center.y + normal.y * smoothWave,
    };

    spine.push({
      center: warpedCenter,
      normal,
      tangent: tangentUnit,
      width,
    });
    left.push({
      x: warpedCenter.x + normal.x * width * leftBias,
      y: warpedCenter.y + normal.y * width * leftBias,
    });
    right.push({
      x: warpedCenter.x - normal.x * width * rightBias,
      y: warpedCenter.y - normal.y * width * rightBias,
    });
  }

  const capSteps = 5;
  const first = spine[0];
  const last = spine[spine.length - 1];
  const endWidth = last.width * (leftBias + rightBias) * 0.5;
  const startWidth = first.width * (leftBias + rightBias) * 0.5;
  const endCap = Array.from({ length: capSteps - 1 }, (_, stepIndex) => {
    const phi = ((stepIndex + 1) / capSteps) * Math.PI;

    return {
      x:
        last.center.x +
        last.normal.x * Math.cos(phi) * endWidth +
        last.tangent.x * Math.sin(phi) * endWidth,
      y:
        last.center.y +
        last.normal.y * Math.cos(phi) * endWidth +
        last.tangent.y * Math.sin(phi) * endWidth,
    };
  });
  const startCap = Array.from({ length: capSteps - 1 }, (_, stepIndex) => {
    const phi = ((stepIndex + 1) / capSteps) * Math.PI;

    return {
      x:
        first.center.x -
        first.normal.x * Math.cos(phi) * startWidth -
        first.tangent.x * Math.sin(phi) * startWidth,
      y:
        first.center.y -
        first.normal.y * Math.cos(phi) * startWidth -
        first.tangent.y * Math.sin(phi) * startWidth,
    };
  });

  return smoothClosedPath([...left, ...endCap, ...right.reverse(), ...startCap]);
}

export function generateBoomerangElements(
  settings: BoomerangSettings,
): BoomerangElement[] {
  const random = mulberry32(settings.seed);
  const elements: BoomerangElement[] = [];
  const count = Math.round(24 + settings.density * 0.55);
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
        random() * 0.26 +
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
      opacity: Math.min(
        1,
        (settings.opacity / 100) *
          (0.82 + layer * 0.08 + random() * 0.08),
      ),
    });
  }

  return elements;
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
  if (detectedShapes.length > 0) {
    const opacity = Math.min(1, Math.max(0.1, settings.opacity / 100));
    const marks = detectedShapes
      .map(
        (shape, index) => `
  <path d="${shape.d}"${
    shape.transform ? ` transform="${shape.transform}"` : ""
  } fill="${detectedShapeColor(
    settings,
    shape,
    index,
  )}" opacity="${opacity.toFixed(2)}" />`,
      )
      .join("");

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" viewBox="0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}">
  <rect width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" fill="${settings.background}" />
  <g>${marks}
  </g>
</svg>`;
  }

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
