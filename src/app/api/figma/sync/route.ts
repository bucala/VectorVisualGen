import { NextResponse } from "next/server";

import {
  createFigmaBridgePayload,
  MAX_FIGMA_JSON_BYTES,
  parseFigmaSyncBody,
} from "@/lib/figma-sync";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;
const rateLimits = new Map<string, { count: number; resetAt: number }>();

function clientKey(request: Request) {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "local"
  );
}

function rateLimit(request: Request) {
  const now = Date.now();
  const key = clientKey(request);
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
  const bridgePayload = createFigmaBridgePayload(parsed.body, {
    fileKey,
    nodeId,
  });

  if (!fileKey || !nodeId || !token) {
    return NextResponse.json({
      ok: true,
      mode: "bridge-ready",
      targetVerified: false,
      payload: bridgePayload,
    });
  }

  const response = await fetch(
    `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(
      nodeId,
    )}`,
    {
      headers: {
        "X-Figma-Token": token,
      },
    },
  );

  if (!response.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "Figma API request failed.",
        status: response.status,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    mode: "bridge-ready",
    targetVerified: true,
    payload: bridgePayload,
  });
}
