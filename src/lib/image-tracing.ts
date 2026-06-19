import ImageTracer from "imagetracerjs";

import { CANVAS_SIZE, DetectedVectorShape } from "@/lib/boomerang";

const TRACE_SIZE = 768;
const MIN_COMPONENT_AREA = 12;
const MAX_SOURCE_PIXELS = 12_000_000;

type Rgb = {
  r: number;
  g: number;
  b: number;
};

export type ImageTraceResult = {
  shapes: DetectedVectorShape[];
  previewUrl: string;
  sourceWidth: number;
  sourceHeight: number;
  coverage: number;
  components: number;
};

function luminance(color: Rgb) {
  return color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
}

function colorDistance(a: Rgb, b: Rgb) {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image could not be loaded."));
    };
    image.src = url;
  });
}

function fitImageToSquare(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
) {
  const scale = Math.min(TRACE_SIZE / image.width, TRACE_SIZE / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  const x = (TRACE_SIZE - width) / 2;
  const y = (TRACE_SIZE - height) / 2;

  context.clearRect(0, 0, TRACE_SIZE, TRACE_SIZE);
  context.drawImage(image, x, y, width, height);
}

function estimateBackground(imageData: ImageData): Rgb {
  const { data, width, height } = imageData;
  const samples: Rgb[] = [];
  const sampleSize = Math.max(12, Math.round(Math.min(width, height) * 0.045));
  const corners = [
    [0, 0],
    [width - sampleSize, 0],
    [0, height - sampleSize],
    [width - sampleSize, height - sampleSize],
  ];

  corners.forEach(([startX, startY]) => {
    for (let y = startY; y < startY + sampleSize; y += 2) {
      for (let x = startX; x < startX + sampleSize; x += 2) {
        const offset = (y * width + x) * 4;
        samples.push({
          r: data[offset],
          g: data[offset + 1],
          b: data[offset + 2],
        });
      }
    }
  });

  return samples.reduce(
    (sum, color) => ({
      r: sum.r + color.r / samples.length,
      g: sum.g + color.g / samples.length,
      b: sum.b + color.b / samples.length,
    }),
    { r: 0, g: 0, b: 0 },
  );
}

function dilate(mask: Uint8Array, width: number, height: number, radius: number) {
  const result = new Uint8Array(mask.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let found = 0;

      for (let dy = -radius; dy <= radius && found === 0; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;

        for (let dx = -radius; dx <= radius; dx += 1) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;

          if (mask[yy * width + xx]) {
            found = 1;
            break;
          }
        }
      }

      result[y * width + x] = found;
    }
  }

  return result;
}

function erode(mask: Uint8Array, width: number, height: number, radius: number) {
  const result = new Uint8Array(mask.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let kept = 1;

      for (let dy = -radius; dy <= radius && kept === 1; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) {
          kept = 0;
          break;
        }

        for (let dx = -radius; dx <= radius; dx += 1) {
          const xx = x + dx;
          if (xx < 0 || xx >= width || !mask[yy * width + xx]) {
            kept = 0;
            break;
          }
        }
      }

      result[y * width + x] = kept;
    }
  }

  return result;
}

function closeMask(mask: Uint8Array, width: number, height: number) {
  return erode(dilate(mask, width, height, 2), width, height, 1);
}

function removeSmallComponents(mask: Uint8Array, width: number) {
  const visited = new Uint8Array(mask.length);
  const cleaned = new Uint8Array(mask.length);
  let components = 0;

  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index] || visited[index]) continue;

    const stack = [index];
    const pixels: number[] = [];
    visited[index] = 1;

    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) continue;

      pixels.push(current);
      const x = current % width;
      const y = Math.floor(current / width);
      const neighbors = [
        current - 1,
        current + 1,
        current - width,
        current + width,
      ];

      neighbors.forEach((neighbor) => {
        if (neighbor < 0 || neighbor >= mask.length || visited[neighbor]) {
          return;
        }

        const nx = neighbor % width;
        const ny = Math.floor(neighbor / width);
        if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) return;

        if (mask[neighbor]) {
          visited[neighbor] = 1;
          stack.push(neighbor);
        }
      });
    }

    if (pixels.length >= MIN_COMPONENT_AREA) {
      components += 1;
      pixels.forEach((pixel) => {
        cleaned[pixel] = 1;
      });
    }
  }

  return { cleaned, components };
}

function createToneMasks(imageData: ImageData) {
  const { data, width, height } = imageData;
  const background = estimateBackground(imageData);
  const backgroundLuma = luminance(background);
  const dark = new Uint8Array(width * height);
  const light = new Uint8Array(width * height);

  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    const color = {
      r: data[offset],
      g: data[offset + 1],
      b: data[offset + 2],
    };
    const luma = luminance(color);
    const distance = colorDistance(color, background);

    if (distance < 28) continue;

    if (luma < Math.min(110, backgroundLuma - 38)) {
      dark[index] = 1;
    } else if (luma > Math.max(150, backgroundLuma + 34)) {
      light[index] = 1;
    }
  }

  return { background, dark, light };
}

function createCleanedImageData(
  background: Rgb,
  darkMask: Uint8Array,
  lightMask: Uint8Array,
  width: number,
  height: number,
) {
  const cleaned = new ImageData(width, height);
  let activePixels = 0;

  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    const isDark = darkMask[index] === 1;
    const isLight = lightMask[index] === 1;

    if (isDark || isLight) activePixels += 1;

    cleaned.data[offset] = isDark ? 8 : isLight ? 248 : background.r;
    cleaned.data[offset + 1] = isDark ? 8 : isLight ? 248 : background.g;
    cleaned.data[offset + 2] = isDark ? 8 : isLight ? 248 : background.b;
    cleaned.data[offset + 3] = 255;
  }

  return {
    imageData: cleaned,
    coverage: activePixels / (width * height),
  };
}

function extractDetectedShapes(svg: string, background: Rgb) {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  const paths = Array.from(document.querySelectorAll("path"));
  const backgroundColor = `rgb(${Math.round(background.r)},${Math.round(
    background.g,
  )},${Math.round(background.b)})`;

  return paths
    .map((path, index) => {
      const d = path.getAttribute("d") ?? "";
      const fill = (path.getAttribute("fill") ?? "").replaceAll(" ", "");
      const tone: DetectedVectorShape["tone"] =
        fill.includes("248") || fill.toLowerCase() === "#f8f8f8"
          ? "light"
          : "dark";
      const isBackground =
        fill === backgroundColor.replaceAll(" ", "") ||
        fill.toLowerCase() === "#ffffff" ||
        fill.includes(`${Math.round(background.r)},${Math.round(background.g)}`);

      return {
        id: `detected-${index}`,
        d,
        tone,
        transform: `scale(${(CANVAS_SIZE / TRACE_SIZE).toFixed(6)})`,
        isBackground,
      };
    })
    .filter((shape) => shape.d.length > 0 && !shape.isBackground)
    .slice(0, 420)
    .map(({ id, d, tone, transform }) => ({ id, d, tone, transform }));
}

export async function traceImageFile(file: File): Promise<ImageTraceResult> {
  const image = await loadImage(file);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (sourceWidth * sourceHeight > MAX_SOURCE_PIXELS) {
    throw new Error("Image dimensions are too large.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = TRACE_SIZE;
  canvas.height = TRACE_SIZE;
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    throw new Error("Canvas 2D context is unavailable.");
  }

  fitImageToSquare(context, image);

  const sourceData = context.getImageData(0, 0, TRACE_SIZE, TRACE_SIZE);
  const { background, dark, light } = createToneMasks(sourceData);
  const darkComponents = removeSmallComponents(
    closeMask(dark, TRACE_SIZE, TRACE_SIZE),
    TRACE_SIZE,
  );
  const lightComponents = removeSmallComponents(
    closeMask(light, TRACE_SIZE, TRACE_SIZE),
    TRACE_SIZE,
  );
  const { imageData, coverage } = createCleanedImageData(
    background,
    darkComponents.cleaned,
    lightComponents.cleaned,
    TRACE_SIZE,
    TRACE_SIZE,
  );
  context.putImageData(imageData, 0, 0);

  const svg = ImageTracer.imagedataToSVG(imageData, {
    ltres: 0.6,
    qtres: 0.45,
    pathomit: 9,
    rightangleenhance: false,
    colorsampling: 0,
    numberofcolors: 3,
    mincolorratio: 0,
    colorquantcycles: 1,
    scale: CANVAS_SIZE / TRACE_SIZE,
    roundcoords: 2,
    linefilter: true,
    strokewidth: 0,
    pal: [
      {
        r: Math.round(background.r),
        g: Math.round(background.g),
        b: Math.round(background.b),
        a: 255,
      },
      { r: 8, g: 8, b: 8, a: 255 },
      { r: 248, g: 248, b: 248, a: 255 },
    ],
  });

  return {
    shapes: extractDetectedShapes(svg, background),
    previewUrl: canvas.toDataURL("image/png"),
    sourceWidth,
    sourceHeight,
    coverage,
    components: darkComponents.components + lightComponents.components,
  };
}
