export const MAX_FIGMA_JSON_BYTES = 1_500_000;
export const MAX_FIGMA_SVG_BYTES = 1_250_000;
export const MAX_FIGMA_GALLERY_ITEMS = 5;

export type FigmaSyncBody = {
  name?: string;
  svg: string;
  gallery?: FigmaGalleryItem[];
};

export type FigmaGalleryItem = {
  id?: string;
  name?: string;
  createdAt?: string;
  svg?: string;
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
  const gallery = parsed.gallery;

  if (name !== undefined && typeof name !== "string") {
    return { ok: false, error: "Name must be a string.", status: 400 };
  }

  if (typeof name === "string" && name.trim().length > 200) {
    return { ok: false, error: "Name must be 200 characters or fewer.", status: 400 };
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

  let normalizedGallery: FigmaGalleryItem[] | undefined;
  if (gallery !== undefined) {
    if (!Array.isArray(gallery)) {
      return { ok: false, error: "Gallery must be an array.", status: 400 };
    }

    if (gallery.length > MAX_FIGMA_GALLERY_ITEMS) {
      return {
        ok: false,
        error: `Gallery can sync at most ${MAX_FIGMA_GALLERY_ITEMS} items.`,
        status: 400,
      };
    }

    normalizedGallery = [];
    for (const [index, item] of gallery.entries()) {
      if (!isPlainObject(item)) {
        return {
          ok: false,
          error: `Gallery item ${index + 1} must be an object.`,
          status: 400,
        };
      }

      const itemSvg = item.svg;
      if (itemSvg !== undefined) {
        if (typeof itemSvg !== "string" || itemSvg.trim().length === 0) {
          return {
            ok: false,
            error: `Gallery item ${index + 1} SVG payload is invalid.`,
            status: 400,
          };
        }

        if (byteLength(itemSvg) > MAX_FIGMA_SVG_BYTES) {
          return {
            ok: false,
            error: `Gallery item ${index + 1} SVG payload is too large.`,
            status: 413,
          };
        }

        const normalizedItemSvg = itemSvg.trim().toLowerCase();
        if (
          !normalizedItemSvg.startsWith("<svg") ||
          !normalizedItemSvg.includes("</svg>")
        ) {
          return {
            ok: false,
            error: `Gallery item ${index + 1} must be a complete SVG.`,
            status: 400,
          };
        }

        if (/<\s*(script|foreignobject)\b/i.test(itemSvg)) {
          return {
            ok: false,
            error: `Gallery item ${index + 1} contains unsupported active content.`,
            status: 400,
          };
        }
      }

      normalizedGallery.push({
        id: typeof item.id === "string" ? item.id : undefined,
        name:
          typeof item.name === "string" && item.name.trim().length > 0
            ? item.name.trim()
            : `gallery-${index + 1}`,
        createdAt: typeof item.createdAt === "string" ? item.createdAt : undefined,
        svg: typeof itemSvg === "string" ? itemSvg : undefined,
      });
    }
  }

  return {
    ok: true,
    body: {
      name: name?.trim() || "vectorvisualgen-pattern",
      svg,
      gallery: normalizedGallery,
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
    gallery: {
      count: body.gallery?.length ?? 0,
      items:
        body.gallery?.map((item) => ({
          id: item.id ?? null,
          name: item.name ?? "gallery-item",
          createdAt: item.createdAt ?? null,
          bytes: item.svg ? byteLength(item.svg) : 0,
          svg: item.svg ?? null,
        })) ?? [],
    },
    target: {
      fileKey: target.fileKey ?? null,
      nodeId: target.nodeId ?? null,
    },
  };
}
