"use client";

import { motion } from "framer-motion";
import {
  Download,
  FileImage,
  ImageUp,
  Layers3,
  PenTool,
  RefreshCw,
  Save,
  ScanLine,
  Shuffle,
  Trash2,
} from "lucide-react";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

import {
  CANVAS_SIZE,
  COLOR_PRESETS,
  DEFAULT_BOOMERANG_SETTINGS,
  LayerId,
  BoomerangSettings,
  Point,
  createBoomerangSvg,
  createSeparatedLayerSvgs,
  generateBoomerangElements,
  generateBoomerangElementsFromTrace,
} from "@/lib/boomerang";
import { MAX_FIGMA_GALLERY_ITEMS } from "@/lib/figma-sync";
import { ImageTraceResult, traceImageFile } from "@/lib/image-tracing";
import { ShapeSketchPad } from "@/components/ShapeSketchPad";

type NumericControl = {
  key: keyof Pick<
    BoomerangSettings,
    "density" | "strokeWidth" | "blur" | "rotation"
  >;
  label: string;
  min: number;
  max: number;
  step: number;
  suffix?: string;
};

type SavedGalleryItem = {
  id: string;
  name: string;
  dataUrl: string;
  svg: string;
  createdAt: string;
};

const numericControls: NumericControl[] = [
  { key: "density", label: "Hustota", min: 24, max: 260, step: 1 },
  { key: "strokeWidth", label: "Hrubka ciar", min: 0.5, max: 3, step: 0.1 },
  { key: "blur", label: "Rozmazanie", min: 0, max: 100, step: 1, suffix: "%" },
  { key: "rotation", label: "Rotacia", min: -180, max: 180, step: 1 },
];

const MAX_GALLERY_ITEMS = 12;
const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;
const GALLERY_STORAGE_KEY = "vectorvisualgen.gallery.v1";

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

function downloadDataUrl(dataUrl: string, fileName: string) {
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function BoomerangGenerator() {
  const [settings, setSettings] = useState<BoomerangSettings>(
    DEFAULT_BOOMERANG_SETTINGS,
  );
  const [assetName, setAssetName] = useState("default-boomerang");
  const [detectedTrace, setDetectedTrace] = useState<ImageTraceResult | null>(
    null,
  );
  const [traceStatus, setTraceStatus] = useState("No input");
  const [figmaStatus, setFigmaStatus] = useState("Ready");
  const [galleryStatus, setGalleryStatus] = useState("Ready");
  const [exportStatus, setExportStatus] = useState("Ready");
  const [savedGallery, setSavedGallery] = useState<SavedGalleryItem[]>([]);
  const [galleryHydrated, setGalleryHydrated] = useState(false);
  const [customTemplates, setCustomTemplates] = useState<Point[][]>([]);
  const svgRef = useRef<SVGSVGElement>(null);
  const activeTemplates = customTemplates.length > 0 ? customTemplates : undefined;
  const elements = useMemo(
    () =>
      detectedTrace
        ? generateBoomerangElementsFromTrace(settings, detectedTrace.shapes, activeTemplates)
        : generateBoomerangElements(settings, activeTemplates),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [detectedTrace, settings, customTemplates],
  );
  const blurRadius = (settings.blur / 100) * 12;

  useEffect(() => {
    window.queueMicrotask(() => {
      try {
        const stored = window.localStorage.getItem(GALLERY_STORAGE_KEY);
        if (!stored) {
          setGalleryHydrated(true);
          return;
        }

        const parsed = JSON.parse(stored) as SavedGalleryItem[];
        const validItems = Array.isArray(parsed)
          ? parsed.filter(
              (item) =>
                typeof item.id === "string" &&
                typeof item.name === "string" &&
                typeof item.dataUrl === "string" &&
                typeof item.svg === "string" &&
                typeof item.createdAt === "string",
            )
          : [];

        setSavedGallery(validItems.slice(0, MAX_GALLERY_ITEMS));
        if (validItems.length > 0) setGalleryStatus(`${validItems.length} loaded`);
      } catch {
        setGalleryStatus("Gallery restore failed");
      } finally {
        setGalleryHydrated(true);
      }
    });
  }, []);

  useEffect(() => {
    if (!galleryHydrated) return;

    try {
      window.localStorage.setItem(
        GALLERY_STORAGE_KEY,
        JSON.stringify(savedGallery),
      );
    } catch {}
  }, [galleryHydrated, savedGallery]);

  function updateSetting<Key extends keyof BoomerangSettings>(
    key: Key,
    value: BoomerangSettings[Key],
  ) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  function updateLayer<Key extends "color" | "scale" | "chaos" | "opacity">(
    layerId: LayerId,
    key: Key,
    value: BoomerangSettings["layers"][number][Key],
  ) {
    setSettings((current) => ({
      ...current,
      layers: current.layers.map((layer) =>
        layer.id === layerId ? { ...layer, [key]: value } : layer,
      ),
    }));
  }

  function applyPreset(preset: (typeof COLOR_PRESETS)[number]) {
    setSettings((current) => ({
      ...current,
      background: preset.background,
      layers: current.layers.map((layer, index) => ({
        ...layer,
        color: preset.layers[index] ?? layer.color,
      })),
    }));
  }

  function hslToHex(h: number, s: number, l: number) {
    const sl = s / 100;
    const ll = l / 100;
    const a = sl * Math.min(ll, 1 - ll);
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      const color = ll - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * color).toString(16).padStart(2, "0");
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  }

  function randomizeDesign() {
    const baseHue = Math.random() * 360;
    const bgL = 4 + Math.random() * 8;
    const background = hslToHex(baseHue, 20 + Math.random() * 30, bgL);
    const hues = [
      baseHue,
      (baseHue + 150 + Math.random() * 60) % 360,
      (baseHue + 30 + Math.random() * 40) % 360,
    ];

    setSettings((current) => ({
      ...current,
      seed: Math.floor(Math.random() * 100000),
      density: Math.round(80 + Math.random() * 160),
      strokeWidth: parseFloat((0.6 + Math.random() * 2.0).toFixed(1)),
      blur: Math.random() < 0.3 ? Math.round(Math.random() * 60) : 0,
      rotation: Math.round(-60 + Math.random() * 120),
      background,
      layers: current.layers.map((layer, index) => ({
        ...layer,
        color: hslToHex(
          hues[index],
          55 + Math.random() * 35,
          45 + Math.random() * 30,
        ),
        scale: parseFloat((0.8 + Math.random() * 2.0).toFixed(2)),
        chaos: Math.round(Math.random() * 80),
        opacity: parseFloat((0.3 + Math.random() * 0.65).toFixed(2)),
      })),
    }));
    setFigmaStatus("Ready");
    setExportStatus("Ready");
  }

  function resetDefault() {
    setSettings(DEFAULT_BOOMERANG_SETTINGS);
    setAssetName("default-boomerang");
    setDetectedTrace(null);
    setTraceStatus("No input");
    setFigmaStatus("Ready");
    setGalleryStatus("Ready");
    setExportStatus("Ready");
  }

  function exportSvg() {
    try {
      const svg = createBoomerangSvg(settings, detectedTrace?.shapes, activeTemplates);
      downloadBlob(
        new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
        `${assetName || "vectorvisualgen-boomerang"}.svg`,
      );
      setExportStatus("SVG ready");
    } catch {
      setExportStatus("SVG failed");
    }
  }

  function exportLayerSvgs() {
    try {
      const layers = createSeparatedLayerSvgs(settings, detectedTrace?.shapes, activeTemplates);
      const baseName = assetName || "vectorvisualgen-boomerang";

      layers.forEach((layer) => {
        downloadBlob(
          new Blob([layer.svg], { type: "image/svg+xml;charset=utf-8" }),
          `${baseName}-${layer.fileSuffix}.svg`,
        );
      });
      setExportStatus(`${layers.length} layer SVGs ready`);
    } catch {
      setExportStatus("Export failed");
    }
  }

  async function renderCurrentPatternCanvas(scale = 1) {
    const svg = createBoomerangSvg(settings, detectedTrace?.shapes, activeTemplates);
    const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();

    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_SIZE * scale;
    canvas.height = CANVAS_SIZE * scale;
    const context = canvas.getContext("2d");
    if (!context) {
      URL.revokeObjectURL(url);
      throw new Error("Canvas context is unavailable.");
    }

    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    return canvas;
  }

  async function exportPng() {
    try {
      const canvas = await renderCurrentPatternCanvas(2);

      canvas.toBlob((blob) => {
        if (blob) downloadBlob(blob, `${assetName || "boomerang"}-2400.png`);
      }, "image/png");
    } catch {
      setExportStatus("PNG failed");
    }
  }

  async function saveToGallery() {
    try {
      const svg = createBoomerangSvg(settings, detectedTrace?.shapes, activeTemplates);
      const canvas = await renderCurrentPatternCanvas();
      const dataUrl = canvas.toDataURL("image/png");
      const createdAt = new Date().toISOString();

      setSavedGallery((current) => [
        {
          id: crypto.randomUUID(),
          name: `${assetName || "boomerang"}-${current.length + 1}`,
          dataUrl,
          svg,
          createdAt,
        },
        ...current,
      ].slice(0, MAX_GALLERY_ITEMS));
      setGalleryStatus("Saved");
    } catch {
      setGalleryStatus("Gallery failed");
    }
  }

  async function syncToFigma() {
    setFigmaStatus("Preparing");
    try {
      const response = await fetch("/api/figma/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: assetName,
          svg: createBoomerangSvg(settings, detectedTrace?.shapes, activeTemplates),
          gallery: savedGallery.slice(0, MAX_FIGMA_GALLERY_ITEMS).map((item) => ({
            id: item.id,
            name: item.name,
            createdAt: item.createdAt,
            svg: item.svg,
          })),
        }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        mode?: string;
        targetVerified?: boolean;
        galleryCount?: number;
        error?: string;
      };

      if (!response.ok || !result.ok) {
        setFigmaStatus(result.error ?? "Failed");
        return;
      }

      const galleryLabel =
        result.galleryCount !== undefined
          ? ` / ${result.galleryCount} gallery`
          : "";
      setFigmaStatus(
        `${result.targetVerified ? "Bridge target ok" : "Bridge ready"}${galleryLabel}`,
      );
    } catch {
      setFigmaStatus("Failed");
    }
  }

  async function onUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setTraceStatus("Unsupported");
      event.target.value = "";
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setTraceStatus("Max 6 MB");
      event.target.value = "";
      return;
    }
    setAssetName(file.name.replace(/\.[^/.]+$/, "") || "custom-drawing");
    setTraceStatus("Detecting");
    setFigmaStatus("Ready");

    try {
      const result = await traceImageFile(file);
      setDetectedTrace(result);
      setTraceStatus(`${result.shapes.length} paths`);
    } catch {
      setDetectedTrace(null);
      setTraceStatus("Failed");
    } finally {
      event.target.value = "";
    }
  }

  return (
    <main className="min-h-screen bg-[#e8ece8] text-[#191716]">
      <div className="flex min-h-screen flex-col-reverse lg:flex-row">
        <aside className="border-t border-black/10 bg-white/62 px-5 py-5 backdrop-blur-xl lg:w-[390px] lg:shrink-0 lg:border-r lg:border-t-0">
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

          </section>

          <section className="mt-4 rounded-[28px] border border-white/75 bg-white/72 p-4 shadow-[0_20px_70px_rgba(31,35,28,0.1)]">
            <h2 className="mb-4 text-sm font-semibold">Vrstvy</h2>
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
                      ...preset.layers,
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

            <div className="mt-4 space-y-3">
              {settings.layers.map((layer) => (
                <section
                  key={layer.id}
                  className="rounded-2xl border border-black/10 bg-white/70 p-3"
                >
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold">{layer.label}</h3>
                    <input
                      aria-label={`${layer.label} farba`}
                      type="color"
                      value={layer.color}
                      onChange={(event) =>
                        updateLayer(layer.id, "color", event.target.value)
                      }
                      className="h-9 w-14 cursor-pointer rounded-xl border border-black/10 bg-white p-1"
                    />
                  </div>

                  {(
                    [
                      ["scale", "Veľkosť", 0, 3, 0.01, ""],
                      ["chaos", "Chaos", 0, 100, 1, "%"],
                      ["opacity", "Priehľadnosť", 0, 1, 0.01, ""],
                    ] as const
                  ).map(([key, label, min, max, step, suffix]) => (
                    <label key={key} className="mt-3 block">
                      <span className="mb-2 flex items-center justify-between text-sm">
                        <span className="font-medium">{label}</span>
                        <span className="font-mono text-xs text-[#6b675e]">
                          {key === "opacity"
                            ? Math.round(layer[key] * 100)
                            : layer[key]}
                          {key === "opacity" ? "%" : suffix}
                        </span>
                      </span>
                      <input
                        type="range"
                        min={min}
                        max={max}
                        step={step}
                        value={layer[key]}
                        onChange={(event) =>
                          updateLayer(layer.id, key, Number(event.target.value))
                        }
                        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-[#d8ddd6] accent-[#0b8f8f]"
                      />
                    </label>
                  ))}
                </section>
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
              onClick={exportLayerSvgs}
              className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-black/10 bg-white text-sm font-semibold shadow-sm transition hover:-translate-y-0.5"
            >
              <Layers3 size={16} />
              Vrstvy
            </button>
            <button
              type="button"
              onClick={exportPng}
              className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-black/10 bg-white text-sm font-semibold shadow-sm transition hover:-translate-y-0.5"
            >
              <FileImage size={16} />
              PNG
            </button>
            <button
              type="button"
              onClick={syncToFigma}
              className="flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#0b8f8f] text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5"
            >
              <PenTool size={16} />
              {figmaStatus === "Preparing" ? "Sync" : "Figma"}
            </button>
          </section>

          <p className="mt-3 rounded-2xl border border-black/10 bg-white/55 px-3 py-2 font-mono text-xs text-[#6b675e]">
            Figma: {figmaStatus}
          </p>

          <p className="mt-2 rounded-2xl border border-black/10 bg-white/55 px-3 py-2 font-mono text-xs text-[#6b675e]">
            Galéria: {galleryStatus} / Export: {exportStatus}
          </p>

          <section className="mt-4 rounded-[28px] border border-white/75 bg-white/72 p-4 shadow-[0_20px_70px_rgba(31,35,28,0.1)]">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <ScanLine size={17} />
                <h2 className="text-sm font-semibold">Detekcia obrazu</h2>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-[#6b675e]">
                  {traceStatus}
                </span>
                <label className="flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-black/10 bg-white px-3 text-xs font-semibold shadow-sm transition hover:-translate-y-0.5">
                  <ImageUp size={13} />
                  Input
                  <input
                    type="file"
                    accept="image/*"
                    onChange={onUpload}
                    className="sr-only"
                  />
                </label>
              </div>
            </div>

            {detectedTrace ? (
              <div className="space-y-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={detectedTrace.previewUrl}
                  alt=""
                  className="aspect-square w-full rounded-2xl border border-black/10 object-cover"
                />
                <div className="grid grid-cols-3 gap-2 font-mono text-[11px] text-[#6b675e]">
                  <span className="rounded-xl bg-white/70 px-2 py-1">
                    {detectedTrace.sourceWidth}x{detectedTrace.sourceHeight}
                  </span>
                  <span className="rounded-xl bg-white/70 px-2 py-1">
                    {Math.round(detectedTrace.coverage * 100)}%
                  </span>
                  <span className="rounded-xl bg-white/70 px-2 py-1">
                    {detectedTrace.components} comp
                  </span>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-black/15 bg-white/45 px-3 py-4 text-center text-xs text-[#6b675e]">
                Ziadny raster
              </div>
            )}
          </section>

          <section className="mt-4 rounded-[28px] border border-white/75 bg-white/72 p-4 shadow-[0_20px_70px_rgba(31,35,28,0.1)]">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <PenTool size={17} />
                <h2 className="text-sm font-semibold">Vlastné tvary</h2>
              </div>
              {customTemplates.length > 0 && (
                <span className="rounded-full bg-[#0b8f8f]/12 px-2 py-0.5 font-mono text-[11px] text-[#0b8f8f]">
                  {customTemplates.length} aktívnych
                </span>
              )}
            </div>
            <p className="mb-3 text-xs text-[#6b675e]">
              Nakresli tvary — aplikácia ich použije ako vzory pre generovanie patternu namiesto predvolených.
            </p>
            <ShapeSketchPad onChange={setCustomTemplates} />
          </section>
        </aside>

        <section className="relative min-w-0 flex-1 overflow-hidden px-4 py-5 sm:px-8 lg:px-10">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_15%,rgba(255,255,255,0.75),transparent_32%),linear-gradient(135deg,#e8ece8,#d6ddd6_45%,#f2ede5)]" />
          <div className="relative mx-auto flex w-full min-w-0 max-w-7xl flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-xs uppercase tracking-[0.22em] text-[#6b675e]">
                  {assetName}
                </p>
                <h2 className="mt-1 max-w-full text-3xl font-semibold tracking-normal sm:text-4xl">
                  {detectedTrace
                    ? "Detected vector pattern"
                    : "Retro boomerang pattern"}
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
              className="w-full min-w-0 max-w-full overflow-hidden rounded-[32px] border border-white/70 bg-white/55 p-3 shadow-[0_24px_90px_rgba(31,35,28,0.2)] backdrop-blur-xl"
            >
              <svg
                ref={svgRef}
                viewBox={`0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}`}
                role="img"
                aria-label="Generated retro boomerang vector pattern"
                className="block aspect-square w-full min-w-0 max-w-full rounded-[24px]"
              >
                <rect
                  width={CANVAS_SIZE}
                  height={CANVAS_SIZE}
                  fill={settings.background}
                />
                {blurRadius > 0 ? (
                  <defs>
                    <filter
                      id="line-blur-preview"
                      x="-35%"
                      y="-35%"
                      width="170%"
                      height="170%"
                      colorInterpolationFilters="sRGB"
                    >
                      <feGaussianBlur stdDeviation={blurRadius} />
                    </filter>
                  </defs>
                ) : null}
                <g>
                  {elements.map((element) => (
                    <g key={element.id}>
                      {element.blur > 0 ? (
                        <path
                          d={element.path}
                          fill="none"
                          stroke={element.stroke}
                          strokeWidth={Number(
                            (element.strokeWidth + element.blur * 1.15).toFixed(2),
                          )}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          opacity={element.opacity * 0.62}
                          filter="url(#line-blur-preview)"
                          vectorEffect="non-scaling-stroke"
                          transform={`translate(${element.x.toFixed(2)} ${element.y.toFixed(2)}) rotate(${element.rotation.toFixed(2)}) scale(${element.scale.toFixed(3)})`}
                        />
                      ) : null}
                      <motion.path
                        d={element.path}
                        fill="none"
                        stroke={element.stroke}
                        strokeWidth={Number(element.strokeWidth.toFixed(2))}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity={element.opacity}
                        vectorEffect="non-scaling-stroke"
                        transform={`translate(${element.x.toFixed(2)} ${element.y.toFixed(2)}) rotate(${element.rotation.toFixed(2)}) scale(${element.scale.toFixed(3)})`}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: element.opacity }}
                        transition={{ duration: 0.18, ease: "easeOut" }}
                      />
                    </g>
                  ))}
                </g>
              </svg>
            </motion.div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={randomizeDesign}
                className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-black/10 bg-white px-5 text-sm font-semibold shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <Shuffle size={16} />
                Náhodný design
              </button>
              <button
                type="button"
                onClick={saveToGallery}
                className="flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#191716] px-5 text-sm font-semibold text-white shadow-lg shadow-black/15 transition hover:-translate-y-0.5 hover:bg-[#2b2722]"
              >
                <Save size={16} />
                Uložiť do galérie
              </button>
            </div>

            <section className="rounded-[28px] border border-white/70 bg-white/45 p-4 shadow-sm backdrop-blur-xl">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold tracking-normal">
                  Galéria
                </h2>
                {savedGallery.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSavedGallery([]);
                      setGalleryStatus("Cleared");
                    }}
                    className="flex h-9 items-center justify-center gap-2 rounded-2xl border border-black/10 bg-white px-3 text-xs font-semibold shadow-sm transition hover:-translate-y-0.5"
                  >
                    <Trash2 size={14} />
                    Vyčistiť
                  </button>
                ) : null}
              </div>

              {savedGallery.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {savedGallery.map((item) => (
                    <article
                      key={item.id}
                      className="overflow-hidden rounded-3xl border border-white/70 bg-white/65 p-2 shadow-sm"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.dataUrl}
                        alt=""
                        className="aspect-square w-full rounded-2xl object-cover"
                      />
                      <div className="mt-2 flex items-center justify-between gap-2 px-1">
                        <span className="truncate font-mono text-[11px] text-[#6b675e]">
                          {item.name}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            downloadDataUrl(item.dataUrl, `${item.name}.png`)
                          }
                          className="grid size-8 shrink-0 place-items-center rounded-full border border-black/10 bg-white shadow-sm transition hover:-translate-y-0.5"
                          aria-label="Download saved pattern"
                          title="Download"
                        >
                          <Download size={14} />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-black/15 bg-white/45 px-3 py-5 text-center text-xs text-[#6b675e]">
                  Žiadne uložené vzory
                </div>
              )}
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}
