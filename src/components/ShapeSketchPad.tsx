"use client";

import { Pencil, Trash2, X } from "lucide-react";
import { PointerEvent, useEffect, useRef, useState } from "react";

import { type Point } from "@/lib/boomerang";

const PAD_W = 560;
const PAD_H = 360;
const MAX_SHAPES = 6;
const RDP_EPSILON = 10;
const MIN_POINTS = 4;

function perpendicularDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(dx * (a.y - p.y) - (a.x - p.x) * dy) / len;
}

function rdpSimplify(points: Point[], epsilon: number): Point[] {
  if (points.length <= 2) return points;
  let maxDist = 0;
  let maxIndex = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], points[0], points[points.length - 1]);
    if (d > maxDist) {
      maxDist = d;
      maxIndex = i;
    }
  }
  if (maxDist > epsilon) {
    const left = rdpSimplify(points.slice(0, maxIndex + 1), epsilon);
    const right = rdpSimplify(points.slice(maxIndex), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [points[0], points[points.length - 1]];
}

function normalizeToTemplateSpace(points: Point[]): Point[] {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const halfW = (maxX - minX) / 2 || 1;
  const halfH = (maxY - minY) / 2 || 1;
  const scale = Math.min(110 / halfW, 65 / halfH);
  return points.map((p) => ({
    x: (p.x - cx) * scale,
    y: (p.y - cy) * scale,
  }));
}

function shapePreviewPath(points: Point[]): string {
  if (points.length < 2) return "";
  const cmds = [`M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`];
  for (let i = 1; i < points.length; i++) {
    cmds.push(`L ${points[i].x.toFixed(1)} ${points[i].y.toFixed(1)}`);
  }
  cmds.push("Z");
  return cmds.join(" ");
}

type Props = {
  onChange: (templates: Point[][]) => void;
};

export function ShapeSketchPad({ onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [shapes, setShapes] = useState<Point[][]>([]);
  const drawing = useRef(false);
  const stroke = useRef<Point[]>([]);

  function redrawCanvas(activeStroke: Point[]) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, PAD_W, PAD_H);

    ctx.fillStyle = "#c8cec6";
    for (let x = 20; x < PAD_W; x += 28) {
      for (let y = 20; y < PAD_H; y += 28) {
        ctx.beginPath();
        ctx.arc(x, y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (activeStroke.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = "#0b8f8f";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.moveTo(activeStroke[0].x, activeStroke[0].y);
      for (const pt of activeStroke.slice(1)) ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
    }
  }

  useEffect(() => { redrawCanvas([]); }, []);

  function getPos(e: PointerEvent<HTMLCanvasElement>): Point {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (PAD_W / rect.width),
      y: (e.clientY - rect.top) * (PAD_H / rect.height),
    };
  }

  function onPointerDown(e: PointerEvent<HTMLCanvasElement>) {
    if (shapes.length >= MAX_SHAPES) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    stroke.current = [getPos(e)];
    redrawCanvas(stroke.current);
  }

  function onPointerMove(e: PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const pos = getPos(e);
    const last = stroke.current[stroke.current.length - 1];
    if (Math.hypot(pos.x - last.x, pos.y - last.y) > 2) {
      stroke.current.push(pos);
      redrawCanvas(stroke.current);
    }
  }

  function onPointerUp() {
    if (!drawing.current) return;
    drawing.current = false;
    const raw = stroke.current;
    stroke.current = [];

    const simplified = rdpSimplify(raw, RDP_EPSILON);
    if (simplified.length < MIN_POINTS) {
      redrawCanvas([]);
      return;
    }

    const normalized = normalizeToTemplateSpace(simplified);
    setShapes((prev) => {
      const next = [...prev, normalized];
      onChange(next);
      return next;
    });
    redrawCanvas([]);
  }

  function removeShape(i: number) {
    setShapes((prev) => {
      const next = prev.filter((_, idx) => idx !== i);
      onChange(next);
      return next;
    });
  }

  function clearAll() {
    setShapes([]);
    onChange([]);
    redrawCanvas([]);
  }

  const full = shapes.length >= MAX_SHAPES;

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-2xl border border-black/10 bg-[#f6f7f4]">
        <canvas
          ref={canvasRef}
          width={PAD_W}
          height={PAD_H}
          className={`block w-full select-none touch-none ${full ? "cursor-not-allowed opacity-40" : "cursor-crosshair"}`}
          style={{ aspectRatio: `${PAD_W}/${PAD_H}` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        />
        {shapes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="flex items-center gap-2 rounded-xl bg-white/85 px-3 py-1.5 text-xs text-[#6b675e] shadow-sm">
              <Pencil size={12} />
              Nakresli tvar prstom alebo myšou
            </div>
          </div>
        )}
        {full && (
          <div className="pointer-events-none absolute bottom-2 right-2">
            <span className="rounded-lg bg-white/85 px-2 py-1 text-[11px] text-[#6b675e] shadow-sm">
              Max {MAX_SHAPES}
            </span>
          </div>
        )}
      </div>

      {shapes.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {shapes.map((shape, i) => (
            <button
              key={i}
              type="button"
              title="Odstrániť tvar"
              onClick={() => removeShape(i)}
              className="group relative flex h-12 w-12 items-center justify-center rounded-xl border border-black/10 bg-white shadow-sm transition hover:border-red-300 hover:bg-red-50"
            >
              <svg
                viewBox="-130 -80 260 160"
                className="h-9 w-9 opacity-70 transition group-hover:opacity-25"
              >
                <path
                  d={shapePreviewPath(shape)}
                  fill="none"
                  stroke="#191716"
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <X
                size={10}
                className="absolute right-0.5 top-0.5 text-red-500 opacity-0 transition group-hover:opacity-80"
              />
            </button>
          ))}
          <button
            type="button"
            onClick={clearAll}
            className="flex h-12 items-center justify-center gap-1.5 rounded-xl border border-black/10 bg-white px-3 text-xs font-semibold text-[#6b675e] shadow-sm transition hover:-translate-y-0.5"
          >
            <Trash2 size={12} />
            Vymazať
          </button>
        </div>
      )}
    </div>
  );
}
