"use client";

import { motion } from "framer-motion";
import {
  Download,
  FileImage,
  ImageUp,
  Layers3,
  PenTool,
  RefreshCw,
  Shuffle,
} from "lucide-react";
import { ChangeEvent, useMemo, useRef, useState } from "react";

import {
  CANVAS_SIZE,
  COLOR_PRESETS,
  DEFAULT_BOOMERANG_SETTINGS,
  BoomerangSettings,
  createBoomerangSvg,
  generateBoomerangElements,
} from "@/lib/boomerang";

type NumericControl = {
  key: keyof Pick<
    BoomerangSettings,
    "density" | "scale" | "chaos" | "strokeWidth" | "rotation"
  >;
  label: string;
  min: number;
  max: number;
  step: number;
  suffix?: string;
};

const numericControls: NumericControl[] = [
  { key: "density", label: "Hustota", min: 12, max: 120, step: 1 },
  { key: "scale", label: "Velkost", min: 0.45, max: 1.75, step: 0.01 },
  { key: "chaos", label: "Chaos", min: 0, max: 100, step: 1, suffix: "%" },
  { key: "strokeWidth", label: "Hrubka ciar", min: 2, max: 18, step: 0.5 },
  { key: "rotation", label: "Rotacia", min: -180, max: 180, step: 1 },
];

const referenceImages = [
  "/references/ebony-red-boomerang.avif",
  "/references/ebony-turquoise-boomerang.avif",
  "/references/glacier-boomerang.avif",
  "/references/red-glacier.avif",
];

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function BoomerangGenerator() {
  const [settings, setSettings] = useState<BoomerangSettings>(
    DEFAULT_BOOMERANG_SETTINGS,
  );
  const [assetName, setAssetName] = useState("default-boomerang");
  const [syncStatus, setSyncStatus] = useState("Ready");
  const svgRef = useRef<SVGSVGElement>(null);
  const elements = useMemo(
    () => generateBoomerangElements(settings),
    [settings],
  );

  function updateSetting<Key extends keyof BoomerangSettings>(
    key: Key,
    value: BoomerangSettings[Key],
  ) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  function applyPreset(preset: (typeof COLOR_PRESETS)[number]) {
    setSettings((current) => ({
      ...current,
      background: preset.background,
      primary: preset.primary,
      secondary: preset.secondary,
      accent: preset.accent,
    }));
  }

  function reseed() {
    setSettings((current) => ({
      ...current,
      seed: Math.floor(Math.random() * 100000),
    }));
    setSyncStatus("Ready");
  }

  function resetDefault() {
    setSettings(DEFAULT_BOOMERANG_SETTINGS);
    setAssetName("default-boomerang");
    setSyncStatus("Ready");
  }

  function exportSvg() {
    const svg = createBoomerangSvg(settings);
    downloadBlob(
      new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
      `${assetName || "vectorvisualgen-boomerang"}.svg`,
    );
  }

  async function exportPng() {
    const svg = createBoomerangSvg(settings);
    const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();

    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_SIZE * 2;
    canvas.height = CANVAS_SIZE * 2;
    const context = canvas.getContext("2d");
    if (!context) return;

    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, `${assetName || "boomerang"}-2400.png`);
    }, "image/png");
  }

  async function syncToFigma() {
    setSyncStatus("Syncing");
    try {
      const response = await fetch("/api/figma/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: assetName,
          svg: createBoomerangSvg(settings),
        }),
      });
      const result = (await response.json()) as { mode?: string };
      setSyncStatus(result.mode === "dry-run" ? "Dry run" : "Synced");
    } catch {
      setSyncStatus("Failed");
    }
  }

  function onUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setAssetName(file.name.replace(/\.[^/.]+$/, "") || "custom-drawing");
  }

  return (
    <main className="min-h-screen bg-[#e8ece8] text-[#191716]">
      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[390px_minmax(0,1fr)]">
        <aside className="border-b border-black/10 bg-white/62 px-5 py-5 backdrop-blur-xl lg:border-b-0 lg:border-r">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#6b675e]">
                VectorVisualGen
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-normal">
                Boomerang Studio
              </h1>
            </div>
            <button
              type="button"
              onClick={resetDefault}
              className="grid size-10 place-items-center rounded-full border border-black/10 bg-white text-[#2d2a25] shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              aria-label="Reset default pattern"
              title="Reset"
            >
              <RefreshCw size={18} />
            </button>
          </div>

          <section className="rounded-[28px] border border-white/75 bg-white/72 p-4 shadow-[0_20px_70px_rgba(31,35,28,0.12)]">
            <div className="mb-4 flex items-center gap-2">
              <Layers3 size={18} />
              <h2 className="text-sm font-semibold">Parametre</h2>
            </div>

            <div className="space-y-4">
              {numericControls.map((control) => (
                <label key={control.key} className="block">
                  <span className="mb-2 flex items-center justify-between text-sm">
                    <span className="font-medium">{control.label}</span>
                    <span className="font-mono text-xs text-[#6b675e]">
                      {settings[control.key]}
                      {control.suffix}
                    </span>
                  </span>
                  <input
                    type="range"
                    min={control.min}
                    max={control.max}
                    step={control.step}
                    value={settings[control.key]}
                    onChange={(event) =>
                      updateSetting(control.key, Number(event.target.value))
                    }
                    className="h-2 w-full cursor-pointer appearance-none rounded-full bg-[#d8ddd6] accent-[#0b8f8f]"
                  />
                </label>
              ))}
            </div>

            <button
              type="button"
              onClick={reseed}
              className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[#191716] px-4 text-sm font-semibold text-white shadow-lg shadow-black/15 transition hover:-translate-y-0.5 hover:bg-[#2b2722]"
            >
              <Shuffle size={16} />
              Novy seed
            </button>
          </section>

          <section className="mt-4 rounded-[28px] border border-white/75 bg-white/72 p-4 shadow-[0_20px_70px_rgba(31,35,28,0.1)]">
            <h2 className="mb-4 text-sm font-semibold">Farby</h2>
            <div className="grid grid-cols-2 gap-2">
              {COLOR_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className="rounded-2xl border border-black/10 bg-white p-2 text-left text-xs font-medium shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                >
                  <span className="mb-2 block">{preset.name}</span>
                  <span className="flex overflow-hidden rounded-full">
                    {[
                      preset.background,
                      preset.primary,
                      preset.secondary,
                      preset.accent,
                    ].map((color) => (
                      <span
                        key={color}
                        className="h-5 flex-1"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </span>
                </button>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              {(
                [
                  ["background", "Pozadie"],
                  ["primary", "Farba 1"],
                  ["secondary", "Farba 2"],
                  ["accent", "Farba 3"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="text-xs font-medium">
                  <span className="mb-1 block text-[#6b675e]">{label}</span>
                  <input
                    type="color"
                    value={settings[key]}
                    onChange={(event) => updateSetting(key, event.target.value)}
                    className="h-11 w-full cursor-pointer rounded-2xl border border-black/10 bg-white p-1"
                  />
                </label>
              ))}
            </div>
          </section>

          <section className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={exportSvg}
              className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-black/10 bg-white text-sm font-semibold shadow-sm transition hover:-translate-y-0.5"
            >
              <Download size={16} />
              SVG
            </button>
            <button
              type="button"
              onClick={exportPng}
              className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-black/10 bg-white text-sm font-semibold shadow-sm transition hover:-translate-y-0.5"
            >
              <FileImage size={16} />
              PNG
            </button>
            <label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-2xl border border-black/10 bg-white text-sm font-semibold shadow-sm transition hover:-translate-y-0.5">
              <ImageUp size={16} />
              Input
              <input
                type="file"
                accept="image/*"
                onChange={onUpload}
                className="sr-only"
              />
            </label>
            <button
              type="button"
              onClick={syncToFigma}
              className="flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#0b8f8f] text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5"
            >
              <PenTool size={16} />
              {syncStatus === "Syncing" ? "Sync" : "Figma"}
            </button>
          </section>

          <p className="mt-3 rounded-2xl border border-black/10 bg-white/55 px-3 py-2 font-mono text-xs text-[#6b675e]">
            Figma: {syncStatus}
          </p>
        </aside>

        <section className="relative overflow-hidden px-4 py-5 sm:px-8 lg:px-10">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_15%,rgba(255,255,255,0.75),transparent_32%),linear-gradient(135deg,#e8ece8,#d6ddd6_45%,#f2ede5)]" />
          <div className="relative mx-auto flex max-w-7xl flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.22em] text-[#6b675e]">
                  {assetName}
                </p>
                <h2 className="mt-1 text-3xl font-semibold tracking-normal sm:text-4xl">
                  Retro boomerang pattern
                </h2>
              </div>
              <div className="rounded-full border border-white/70 bg-white/65 px-4 py-2 font-mono text-xs shadow-sm backdrop-blur-xl">
                {CANVAS_SIZE} x {CANVAS_SIZE} SVG
              </div>
            </div>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, ease: "easeOut" }}
              className="overflow-hidden rounded-[32px] border border-white/70 bg-white/55 p-3 shadow-[0_24px_90px_rgba(31,35,28,0.2)] backdrop-blur-xl"
            >
              <svg
                ref={svgRef}
                viewBox={`0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}`}
                role="img"
                aria-label="Generated retro boomerang vector pattern"
                className="aspect-square w-full rounded-[24px]"
              >
                <rect
                  width={CANVAS_SIZE}
                  height={CANVAS_SIZE}
                  fill={settings.background}
                />
                <g>
                  {elements.map((element) => (
                    <motion.path
                      key={element.id}
                      d={element.path}
                      fill="none"
                      stroke={element.stroke}
                      strokeWidth={element.strokeWidth}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={element.opacity}
                      vectorEffect="non-scaling-stroke"
                      transform={`translate(${element.x} ${element.y}) rotate(${element.rotation}) scale(${element.scale})`}
                      initial={{ pathLength: 0, opacity: 0 }}
                      animate={{
                        pathLength: 1,
                        opacity: element.opacity,
                      }}
                      transition={{ duration: 0.45, ease: "easeOut" }}
                    />
                  ))}
                </g>
              </svg>
            </motion.div>

            <div className="grid gap-3 sm:grid-cols-4">
              {referenceImages.map((src) => (
                <div
                  key={src}
                  className="overflow-hidden rounded-3xl border border-white/70 bg-white/55 p-2 shadow-sm backdrop-blur-xl"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src}
                    alt=""
                    className="aspect-square w-full rounded-2xl object-cover"
                  />
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
