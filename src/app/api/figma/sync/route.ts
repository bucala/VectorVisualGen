import { NextResponse } from "next/server";

import {
  createFigmaBridgePayload,
  MAX_FIGMA_JSON_BYTES,
  parseFigmaSyncBody,
} from "@/lib/figma-sync";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_CLEANUP_INTERVAL_MS = 5 * 60_000;
const rateLimits = new Map<string, { count: number; resetAt: number }>();
let lastCleanup = Date.now();

function clientKey(request: Request) {
  // S2: These headers can be spoofed when requests bypass a trusted proxy
  // (Cloudflare or equivalent). The rate limit is advisory in direct-access
  // deployments; the isAuthorized() token check is the primary security guard.
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "local"
  );
}

function rateLimit(request: Request) {
  const now = Date.now();
  const key = clientKey(request);

  // Periodic cleanup to prevent unbounded memory growth
  if (now - lastCleanup > RATE_LIMIT_CLEANUP_INTERVAL_MS) {
    for (const [k, v] of rateLimits) {
      if (v.resetAt <= now) rateLimits.delete(k);
    }
    lastCleanup = now;
  }

  const bucket = rateLimits.get(key);

  if (!bucket || bucket.resetAt <= now) {
    rateLimits.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return null;
  }

  bucket.count += 1;
  if (bucket.count > RATE_LIMIT_MAX) {
    return NextResponse.json(
      { ok: false, error: "Too many Figma bridge requests." },
      { status: 429 },
    );
  }

  return null;
}

function isAuthorized(request: Request) {
  const secret = process.env.FIGMA_SYNC_SECRET;
  if (!secret) return true;

  return request.headers.get("x-vectorvisualgen-token") === secret;
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  // S3: Requests without an Origin header (server-to-server, Figma plugin) skip
  // the CORS check by design — they are protected solely by isAuthorized() below.
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) {
        return NextResponse.json(
          { ok: false, error: "Cross-origin request rejected." },
          { status: 403 },
        );
      }
    } catch {
      return NextResponse.json(
        { ok: false, error: "Invalid request origin." },
        { status: 400 },
      );
    }
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_FIGMA_JSON_BYTES) {
    return NextResponse.json(
      { ok: false, error: "Payload is too large." },
      { status: 413 },
    );
  }

  const limited = rateLimit(request);
  if (limited) return limited;

  if (!isAuthorized(request)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized Figma bridge request." },
      { status: 401 },
    );
  }

  const parsed = parseFigmaSyncBody(await request.text());
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, error: parsed.error },
      { status: parsed.status },
    );
  }

  const fileKey = process.env.FIGMA_FILE_KEY;
  const nodeId = process.env.FIGMA_NODE_ID;
  const token = process.env.FIGMA_ACCESS_TOKEN;

  // Q1: Only include the bridge payload when credentials are not configured.
  // When fully configured, the Figma plugin reads from the API directly.
  if (!fileKey || !nodeId || !token) {
    const bridgePayload = createFigmaBridgePayload(parsed.body, {
      fileKey,
      nodeId,
    });
    return NextResponse.json({
      ok: true,
      mode: "bridge-ready",
      targetVerified: false,
      galleryCount: parsed.body.gallery?.length ?? 0,
      payload: bridgePayload,
    });
  }

  const figmaResponse = await fetch(
    `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(
      nodeId,
    )}`,
    {
      headers: {
        "X-Figma-Token": token,
      },
    },
  );

  if (!figmaResponse.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "Figma API request failed.",
        status: figmaResponse.status,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    mode: "sync-complete",
    targetVerified: true,
    galleryCount: parsed.body.gallery?.length ?? 0,
    // No payload returned here — credentials are fully configured
  });
}
