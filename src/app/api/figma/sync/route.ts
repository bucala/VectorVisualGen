import { NextResponse } from "next/server";

type FigmaSyncBody = {
  name?: string;
  svg?: string;
};

export async function POST(request: Request) {
  const body = (await request.json()) as FigmaSyncBody;

  if (!body.svg) {
    return NextResponse.json(
      { ok: false, error: "Missing SVG payload." },
      { status: 400 },
    );
  }

  const fileKey = process.env.FIGMA_FILE_KEY;
  const nodeId = process.env.FIGMA_NODE_ID;
  const token = process.env.FIGMA_ACCESS_TOKEN;

  if (!fileKey || !nodeId || !token) {
    return NextResponse.json({
      ok: true,
      mode: "dry-run",
      name: body.name ?? "vectorvisualgen-pattern",
      bytes: body.svg.length,
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
    mode: "figma-connected",
    name: body.name ?? "vectorvisualgen-pattern",
    bytes: body.svg.length,
  });
}
