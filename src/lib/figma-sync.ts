export const MAX_FIGMA_JSON_BYTES = 1_500_000;
export const MAX_FIGMA_SVG_BYTES = 1_250_000;

export type FigmaSyncBody = {
  name?: string;
  svg: string;
};

export type ParsedFigmaSyncBody =
  | { ok: true; body: FigmaSyncBody }
  | { ok: false; error: string; status: number };

function byteLength(value: string) {
  return new TextEncoder().encode(value).length;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseFigmaSyncBody(raw: string): ParsedFigmaSyncBody {
  if (byteLength(raw) > MAX_FIGMA_JSON_BYTES) {
    return { ok: false, error: "Payload is too large.", status: 413 };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Invalid JSON payload.", status: 400 };
  }

  if (!isPlainObject(parsed)) {
    return { ok: false, error: "JSON body must be an object.", status: 400 };
  }

  const name = parsed.name;
  const svg = parsed.svg;

  if (name !== undefined && typeof name !== "string") {
    return { ok: false, error: "Name must be a string.", status: 400 };
  }

  if (typeof svg !== "string" || svg.trim().length === 0) {
    return { ok: false, error: "Missing SVG payload.", status: 400 };
  }

  if (byteLength(svg) > MAX_FIGMA_SVG_BYTES) {
    return { ok: false, error: "SVG payload is too large.", status: 413 };
  }

  const normalizedSvg = svg.trim().toLowerCase();
  if (!normalizedSvg.startsWith("<svg") || !normalizedSvg.includes("</svg>")) {
    return { ok: false, error: "Payload must be a complete SVG.", status: 400 };
  }

  if (/<\s*(script|foreignobject)\b/i.test(svg)) {
    return {
      ok: false,
      error: "SVG contains unsupported active content.",
      status: 400,
    };
  }

  return {
    ok: true,
    body: {
      name: name?.trim() || "vectorvisualgen-pattern",
      svg,
    },
  };
}

export function createFigmaBridgePayload(
  body: FigmaSyncBody,
  target: { fileKey?: string; nodeId?: string },
) {
  return {
    version: 1,
    source: "VectorVisualGen",
    name: body.name ?? "vectorvisualgen-pattern",
    bytes: byteLength(body.svg),
    svg: body.svg,
    target: {
      fileKey: target.fileKey ?? null,
      nodeId: target.nodeId ?? null,
    },
  };
}
