"use client";

import { motion } from "framer-motion";
import {
  Clipboard,
  ClipboardCheck,
  Download,
  FileImage,
  HelpCircle,
  ImageUp,
  Layers3,
  PenTool,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Save,
  ScanLine,
  Shuffle,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  ChangeEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  CANVAS_SIZE,
  COLOR_PRESETS,
  DEFAULT_BOOMERANG_SETTINGS,
  LAYER_ORDER,
  LayerId,
  BoomerangSettings,
  LayerOverrides,
  Point,
  createBoomerangSvg,
  createBoomerangSvgAnimated,
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

type PngScale = 1 | 2 | 4;
type ExportFormat = "square" | "a4l" | "a3l" | "16:9";

const EXPORT_FORMATS: Record<ExportFormat, { label: string; w: number; h: number }> = {
  square: { label: "Štvorec", w: CANVAS_SIZE, h: CANVAS_SIZE },
  a4l:    { label: "A4 na šírku", w: 1414, h: 1000 },
  a3l:    { label: "A3 na šírku", w: 2000, h: 1414 },
  "16:9": { label: "16:9",        w: 1920, h: 1080 },
};

// Minimal ZIP builder (stored/uncompressed, no external library needed)
const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32zip(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = ((CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)) >>> 0);
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZip(files: { name: string; data: Uint8Array }[]): Blob {
  const enc = new TextEncoder();
  const u16 = (n: number): number[] => [n & 0xff, (n >>> 8) & 0xff];
  const u32 = (n: number): number[] => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
  const ua = (d: Uint8Array): number[] => Array.from(d);

  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const file of files) {
    const name = enc.encode(file.name);
    const crc = crc32zip(file.data);
    const sz = file.data.length;
    const local = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      ...u32(crc), ...u32(sz), ...u32(sz), ...u16(name.length), 0, 0, ...ua(name),
    ]);
    const central = new Uint8Array([
      0x50, 0x4b, 0x01, 0x02, 20, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      ...u32(crc), ...u32(sz), ...u32(sz),
      ...u16(name.length), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      ...u32(localOffset), ...ua(name),
    ]);
    localParts.push(local, file.data);
    centralParts.push(central);
    localOffset += local.length + sz;
  }

  const centralStart = localOffset;
  const centralSize = centralParts.reduce((s, p) => s + p.length, 0);
  const n = files.length;
  const endRecord = new Uint8Array([
    0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0,
    ...u16(n), ...u16(n), ...u32(centralSize), ...u32(centralStart), 0, 0,
  ]);

  return new Blob([...localParts, ...centralParts, endRecord], { type: "application/zip" });
}

const numericControls: NumericControl[] = [
  { key: "density", label: "Hustota", min: 24, max: 260, step: 1 },
  { key: "strokeWidth", label: "Hrúbka ramien", min: 0.5, max: 3, step: 0.1 },
  { key: "blur", label: "Rozmazanie", min: 0, max: 100, step: 1, suffix: "%" },
  { key: "rotation", label: "Rotácia", min: -180, max: 180, step: 1 },
];

const MAX_GALLERY_ITEMS = 12;
const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;
const GALLERY_STORAGE_KEY = "vectorvisualgen.gallery.v1";
const SETTINGS_STORAGE_KEY = "vectorvisualgen.settings.v1";

const KEYBOARD_SHORTCUTS = [
  { keys: "Ctrl+Z", action: "Späť (Undo)" },
  { keys: "Ctrl+Shift+Z", action: "Vpred (Redo)" },
  { keys: "Ctrl+Y", action: "Vpred (Redo)" },
];

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

function buildRandomSettings(current: BoomerangSettings): BoomerangSettings {
  const baseHue = Math.random() * 360;
  const bgL = 4 + Math.random() * 8;
  const background = hslToHex(baseHue, 20 + Math.random() * 30, bgL);
  const hues = [
    baseHue,
    (baseHue + 150 + Math.random() * 60) % 360,
    (baseHue + 30 + Math.random() * 40) % 360,
  ];
  return {
    ...current,
    seed: crypto.getRandomValues(new Uint32Array(1))[0] % 100000,
    density: Math.round(80 + Math.random() * 160),
    strokeWidth: parseFloat((0.6 + Math.random() * 2.0).toFixed(1)),
    blur: Math.random() < 0.3 ? Math.round(Math.random() * 60) : 0,
    rotation: Math.round(-60 + Math.random() * 120),
    background,
    layers: current.layers.map((layer, index) => ({
      ...layer,
      color: hslToHex(hues[index], 55 + Math.random() * 35, 45 + Math.random() * 30),
      scale: parseFloat((0.8 + Math.random() * 2.0).toFixed(2)),
      chaos: Math.round(Math.random() * 80),
      opacity: parseFloat((0.3 + Math.random() * 0.65).toFixed(2)),
    })),
  };
}

function hashStringToSeed(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash | 0;
  }
  return Math.abs(hash) % 100000;
}

function encodeSettingsToUrl(settings: BoomerangSettings): string {
  try {
    return btoa(JSON.stringify(settings));
  } catch {
    return "";
  }
}

function decodeSettingsFromUrl(encoded: string): BoomerangSettings | null {
  try {
    const decoded = JSON.parse(atob(encoded)) as Partial<BoomerangSettings>;
    if (decoded && typeof decoded.density === "number" && Array.isArray(decoded.layers)) {
      return { ...DEFAULT_BOOMERANG_SETTINGS, ...decoded };
    }
    return null;
  } catch {
    return null;
  }
}

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
  const [detectedTrace, setDetectedTrace] = useState<ImageTraceResult | null>(null);
  const [traceStatus, setTraceStatus] = useState("No input");
  const [figmaStatus, setFigmaStatus] = useState("Ready");
  const [galleryStatus, setGalleryStatus] = useState("Ready");
  const [exportStatus, setExportStatus] = useState("Ready");
  const [isExporting, setIsExporting] = useState(false);
  const [savedGallery, setSavedGallery] = useState<SavedGalleryItem[]>([]);
  const [galleryHydrated, setGalleryHydrated] = useState(false);
  const [layerCustomData, setLayerCustomData] = useState<
    Record<LayerId, { shapes: Point[][]; count: number }>
  >({ bottom: { shapes: [], count: 0 }, middle: { shapes: [], count: 0 }, top: { shapes: [], count: 0 } });
  const [activeSketchLayer, setActiveSketchLayer] = useState<LayerId>("bottom");
  const [pngScale, setPngScale] = useState<PngScale>(2);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("square");
  const [seedWord, setSeedWord] = useState("");
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const undoStack = useRef<BoomerangSettings[]>([]);
  const redoStack = useRef<BoomerangSettings[]>([]);
  const figmaInFlight = useRef(false);
  const [settingsHydrated, setSettingsHydrated] = useState(false);

  const layerOverrides = useMemo<LayerOverrides>(() => {
    const out: LayerOverrides = {};
    for (const id of LAYER_ORDER) {
      const d = layerCustomData[id];
      if (d.shapes.length > 0 || d.count > 0) {
        out[id] = {
          templates: d.shapes.length > 0 ? d.shapes : undefined,
          count: d.count > 0 ? d.count : undefined,
        };
      }
    }
    return out;
  }, [layerCustomData]);

  const elements = useMemo(
    () =>
      detectedTrace
        ? generateBoomerangElementsFromTrace(settings, detectedTrace.shapes, layerOverrides)
        : generateBoomerangElements(settings, layerOverrides),
    [detectedTrace, settings, layerOverrides],
  );
  const blurRadius = (settings.blur / 100) * 12;

  // Gallery hydration
  useEffect(() => {
    window.queueMicrotask(() => {
      try {
        const stored = window.localStorage.getItem(GALLERY_STORAGE_KEY);
        if (!stored) { setGalleryHydrated(true); return; }
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
      window.localStorage.setItem(GALLERY_STORAGE_KEY, JSON.stringify(savedGallery));
    } catch (error) {
      console.error("Failed to save gallery:", error);
    }
  }, [galleryHydrated, savedGallery]);

  // Settings hydration: URL params take priority over localStorage
  useEffect(() => {
    window.queueMicrotask(() => {
      try {
        const params = new URLSearchParams(window.location.search);
        const urlEncoded = params.get("s");
        if (urlEncoded) {
          const urlSettings = decodeSettingsFromUrl(urlEncoded);
          if (urlSettings) {
            setSettings(urlSettings);
            setSettingsHydrated(true);
            return;
          }
        }
        const stored = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as Partial<BoomerangSettings>;
          if (
            parsed &&
            typeof parsed.density === "number" &&
            Array.isArray(parsed.layers) &&
            parsed.layers.length === 3
          ) {
            setSettings({ ...DEFAULT_BOOMERANG_SETTINGS, ...parsed });
          }
        }
      } catch {}
      setSettingsHydrated(true);
    });
  }, []);

  useEffect(() => {
    if (!settingsHydrated) return;
    try {
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch (error) {
      console.error("Failed to auto-save settings:", error);
    }
  }, [settingsHydrated, settings]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;
      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        const prev = undoStack.current.pop();
        if (prev) {
          setSettings((cur) => {
            redoStack.current = [...redoStack.current, cur].slice(-20);
            return prev;
          });
        }
      } else if (e.key === "y" || (e.key === "z" && e.shiftKey)) {
        e.preventDefault();
        const next = redoStack.current.pop();
        if (next) {
          setSettings((cur) => {
            undoStack.current = [...undoStack.current, cur].slice(-20);
            return next;
          });
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  function withHistory(updater: (prev: BoomerangSettings) => BoomerangSettings) {
    setSettings((prev) => {
      undoStack.current = [...undoStack.current, prev].slice(-20);
      redoStack.current = [];
      return updater(prev);
    });
  }

  function undo() {
    const prev = undoStack.current.pop();
    if (prev) {
      setSettings((cur) => {
        redoStack.current = [...redoStack.current, cur].slice(-20);
        return prev;
      });
    }
  }

  function redo() {
    const next = redoStack.current.pop();
    if (next) {
      setSettings((cur) => {
        undoStack.current = [...undoStack.current, cur].slice(-20);
        return next;
      });
    }
  }

  function updateSetting<Key extends keyof BoomerangSettings>(
    key: Key,
    value: BoomerangSettings[Key],
  ) {
    withHistory((current) => ({ ...current, [key]: value }));
  }

  function updateLayer<Key extends "color" | "scale" | "chaos" | "opacity">(
    layerId: LayerId,
    key: Key,
    value: BoomerangSettings["layers"][number][Key],
  ) {
    withHistory((current) => ({
      ...current,
      layers: current.layers.map((layer) =>
        layer.id === layerId ? { ...layer, [key]: value } : layer,
      ),
    }));
  }

  function applyPreset(preset: (typeof COLOR_PRESETS)[number]) {
    withHistory((current) => ({
      ...current,
      background: preset.background,
      layers: current.layers.map((layer, index) => ({
        ...layer,
        color: preset.layers[index] ?? layer.color,
      })),
    }));
  }

  function randomizeDesign() {
    withHistory(buildRandomSettings);
    setFigmaStatus("Ready");
    setExportStatus("Ready");
  }

  function resetDefault() {
    withHistory(() => DEFAULT_BOOMERANG_SETTINGS);
    setAssetName("default-boomerang");
    setDetectedTrace(null);
    setTraceStatus("No input");
    setFigmaStatus("Ready");
    setGalleryStatus("Ready");
    setExportStatus("Ready");
    undoStack.current = [];
    redoStack.current = [];
  }

  function applySeedWord() {
    if (!seedWord.trim()) return;
    withHistory((prev) => ({ ...prev, seed: hashStringToSeed(seedWord.trim()) }));
  }

  function copyShareUrl() {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("s", encodeSettingsToUrl(settings));
      navigator.clipboard.writeText(url.toString()).then(() => {
        setUrlCopied(true);
        setTimeout(() => setUrlCopied(false), 2000);
      });
    } catch (error) {
      console.error("Failed to copy URL:", error);
    }
  }

  function exportSvg() {
    try {
      const svg = createBoomerangSvg(settings, detectedTrace?.shapes, layerOverrides);
      downloadBlob(
        new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
        `${assetName || "vectorvisualgen-boomerang"}.svg`,
      );
      setExportStatus("SVG ready");
    } catch (error) {
      console.error("SVG export failed:", error);
      setExportStatus("SVG failed");
    }
  }

  function exportLayerSvgs() {
    try {
      const layers = createSeparatedLayerSvgs(settings, detectedTrace?.shapes, layerOverrides);
      const baseName = assetName || "vectorvisualgen-boomerang";
      layers.forEach((layer) => {
        downloadBlob(
          new Blob([layer.svg], { type: "image/svg+xml;charset=utf-8" }),
          `${baseName}-${layer.fileSuffix}.svg`,
        );
      });
      setExportStatus(`${layers.length} layer SVGs ready`);
    } catch (error) {
      console.error("Layer SVG export failed:", error);
      setExportStatus("Export failed");
    }
  }

  function exportAnimatedSvg() {
    try {
      const svg = createBoomerangSvgAnimated(settings, detectedTrace?.shapes, layerOverrides);
      downloadBlob(
        new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
        `${assetName || "vectorvisualgen-boomerang"}-animated.svg`,
      );
      setExportStatus("Animated SVG ready");
    } catch (error) {
      console.error("Animated SVG export failed:", error);
      setExportStatus("Animated SVG failed");
    }
  }

  async function exportZip() {
    if (isExporting) return;
    setIsExporting(true);
    setExportStatus("Preparing ZIP…");
    try {
      const enc = new TextEncoder();
      const baseName = assetName || "vectorvisualgen-boomerang";
      const mainSvg = createBoomerangSvg(settings, detectedTrace?.shapes, layerOverrides);
      const layers = createSeparatedLayerSvgs(settings, detectedTrace?.shapes, layerOverrides);
      const files = [
        { name: `${baseName}.svg`, data: enc.encode(mainSvg) },
        ...layers.map((l) => ({ name: `${baseName}-${l.fileSuffix}.svg`, data: enc.encode(l.svg) })),
      ];
      downloadBlob(buildZip(files), `${baseName}.zip`);
      setExportStatus(`ZIP (${files.length} SVGs) ready`);
    } catch (error) {
      console.error("ZIP export failed:", error);
      setExportStatus("ZIP failed");
    } finally {
      setIsExporting(false);
    }
  }

  async function renderCurrentPatternCanvas(scale: number = 1, fmt: ExportFormat = "square") {
    const svg = createBoomerangSvg(settings, detectedTrace?.shapes, layerOverrides);
    const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();

    const f = EXPORT_FORMATS[fmt];
    const targetW = Math.round(f.w * scale);
    const targetH = Math.round(f.h * scale);
    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const context = canvas.getContext("2d");
    if (!context) {
      URL.revokeObjectURL(url);
      throw new Error("Canvas context is unavailable.");
    }

    // Fill background, then letterbox the square SVG pattern into the target dimensions
    context.fillStyle = settings.background;
    context.fillRect(0, 0, targetW, targetH);
    const fitRatio = Math.min(targetW / CANVAS_SIZE, targetH / CANVAS_SIZE);
    const drawW = CANVAS_SIZE * fitRatio;
    const drawH = CANVAS_SIZE * fitRatio;
    context.drawImage(image, (targetW - drawW) / 2, (targetH - drawH) / 2, drawW, drawH);
    URL.revokeObjectURL(url);
    return canvas;
  }

  async function exportPng() {
    if (isExporting) return;
    setIsExporting(true);
    setExportStatus("Exporting PNG…");
    try {
      const canvas = await renderCurrentPatternCanvas(pngScale, exportFormat);
      const pxW = canvas.width;
      const pxH = canvas.height;
      await new Promise<void>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error("Canvas produced null blob."));
            return;
          }
          const suffix = exportFormat !== "square" ? `-${exportFormat}` : "";
          downloadBlob(blob, `${assetName || "boomerang"}${suffix}-${pxW}x${pxH}.png`);
          resolve();
        }, "image/png");
      });
      setExportStatus(`PNG ${pxW}×${pxH}px ready`);
    } catch (error) {
      console.error("PNG export failed:", error);
      setExportStatus("PNG failed");
    } finally {
      setIsExporting(false);
    }
  }

  async function saveToGallery() {
    try {
      const svg = createBoomerangSvg(settings, detectedTrace?.shapes, layerOverrides);
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
    } catch (error) {
      console.error("Gallery save failed:", error);
      setGalleryStatus("Gallery failed");
    }
  }

  async function syncToFigma() {
    if (figmaInFlight.current) return;
    figmaInFlight.current = true;
    setFigmaStatus("Preparing");
    try {
      const response = await fetch("/api/figma/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: assetName,
          svg: createBoomerangSvg(settings, detectedTrace?.shapes, layerOverrides),
          gallery: savedGallery.slice(0, MAX_FIGMA_GALLERY_ITEMS).map((item) => ({
            id: item.id,
            name: item.name,
            createdAt: item.createdAt,
            svg: item.svg, // include SVG so Figma bridge has complete content
          })),
        }),
      });

      // Q2: validate response shape before accessing fields
      let result: unknown;
      try {
        result = await response.json();
      } catch {
        setFigmaStatus("Invalid response");
        return;
      }

      if (
        typeof result !== "object" ||
        result === null ||
        !("ok" in result)
      ) {
        setFigmaStatus("Bad response");
        return;
      }

      const r = result as { ok?: boolean; mode?: string; targetVerified?: boolean; galleryCount?: number; error?: string };

      if (!response.ok || !r.ok) {
        setFigmaStatus(typeof r.error === "string" ? r.error : "Failed");
        return;
      }

      const galleryLabel =
        typeof r.galleryCount === "number"
          ? ` / ${r.galleryCount} gallery`
          : "";
      setFigmaStatus(
        `${r.targetVerified ? "Bridge target ok" : "Bridge ready"}${galleryLabel}`,
      );
    } catch (error) {
      console.error("Figma sync failed:", error);
      setFigmaStatus("Failed");
    } finally {
      figmaInFlight.current = false;
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
    } catch (error) {
      console.error("Image tracing failed:", error);
      setDetectedTrace(null);
      setTraceStatus("Failed");
    } finally {
      event.target.value = "";
    }
  }

  return (
    <main className="min-h-screen bg-[#e8ece8] text-[#191716]">
      {/* Keyboard shortcuts modal */}
      {showShortcuts && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setShowShortcuts(false)}
        >
          <div
            className="w-72 rounded-3xl border border-white/70 bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-semibold">Klávesové skratky</h3>
              <button
                type="button"
                onClick={() => setShowShortcuts(false)}
                className="grid size-7 place-items-center rounded-full border border-black/10 text-[#6b675e] hover:bg-[#f0f0ee]"
              >
                <X size={14} />
              </button>
            </div>
            <ul className="space-y-2">
              {KEYBOARD_SHORTCUTS.map((s) => (
                <li key={s.keys} className="flex items-center justify-between gap-3 text-sm">
                  <kbd className="rounded-lg border border-black/10 bg-[#f4f4f2] px-2 py-0.5 font-mono text-xs">
                    {s.keys}
                  </kbd>
                  <span className="text-[#6b675e]">{s.action}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

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
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowShortcuts(true)}
                className="grid size-8 place-items-center rounded-full border border-black/10 bg-white text-[#6b675e] shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                aria-label="Keyboard shortcuts"
                title="Klávesové skratky"
              >
                <HelpCircle size={15} />
              </button>
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

            {/* Seed from word */}
            <div className="mt-4">
              <label className="block text-sm font-medium mb-1.5">Seed zo slova</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="napr. studio, neon…"
                  value={seedWord}
                  onChange={(e) => setSeedWord(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applySeedWord()}
                  className="flex-1 rounded-xl border border-black/10 bg-white px-3 py-1.5 text-sm outline-none focus:border-[#0b8f8f] focus:ring-1 focus:ring-[#0b8f8f]"
                />
                <button
                  type="button"
                  onClick={applySeedWord}
                  disabled={!seedWord.trim()}
                  className="flex items-center gap-1 rounded-xl border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold shadow-sm transition hover:-translate-y-0.5 disabled:opacity-40"
                  title="Aplikovať seed"
                >
                  <Sparkles size={12} />
                </button>
              </div>
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
                    {[preset.background, ...preset.layers].map((color) => (
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
                [["background", "Pozadie"]] as const
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
                            ? Math.round((1 - (layer[key] as number)) * 100)
                            : layer[key]}
                          {key === "opacity" ? "%" : suffix}
                        </span>
                      </span>
                      <input
                        type="range"
                        min={min}
                        max={max}
                        step={step}
                        value={key === "opacity" ? 1 - (layer[key] as number) : layer[key]}
                        onChange={(event) =>
                          updateLayer(
                            layer.id,
                            key,
                            key === "opacity"
                              ? 1 - Number(event.target.value)
                              : Number(event.target.value),
                          )
                        }
                        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-[#d8ddd6] accent-[#0b8f8f]"
                      />
                    </label>
                  ))}
                </section>
              ))}
            </div>
          </section>

          {/* Export section */}
          <section className="mt-4 space-y-2">
            {/* PNG scale selector */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-[#6b675e]">Mierka:</span>
              <div className="flex gap-1">
                {([1, 2, 4] as PngScale[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setPngScale(s)}
                    className={`rounded-lg border px-2 py-1 text-xs font-semibold transition ${
                      pngScale === s
                        ? "border-[#0b8f8f] bg-[#0b8f8f] text-white"
                        : "border-black/10 bg-white text-[#6b675e] hover:border-[#0b8f8f]"
                    }`}
                  >
                    {s}×
                  </button>
                ))}
              </div>
            </div>
            {/* Canvas format selector */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-[#6b675e]">Formát:</span>
              <div className="flex gap-1 flex-wrap">
                {(Object.entries(EXPORT_FORMATS) as [ExportFormat, { label: string; w: number; h: number }][]).map(([fmt, f]) => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => setExportFormat(fmt)}
                    className={`rounded-lg border px-2 py-1 text-xs font-semibold transition ${
                      exportFormat === fmt
                        ? "border-[#0b8f8f] bg-[#0b8f8f] text-white"
                        : "border-black/10 bg-white text-[#6b675e] hover:border-[#0b8f8f]"
                    }`}
                    title={`${f.w}×${f.h}px`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={exportSvg}
                disabled={isExporting}
                className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-black/10 bg-white text-sm font-semibold shadow-sm transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download size={16} />
                SVG
              </button>
              <button
                type="button"
                onClick={exportLayerSvgs}
                disabled={isExporting}
                className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-black/10 bg-white text-sm font-semibold shadow-sm transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Layers3 size={16} />
                Vrstvy
              </button>
              <button
                type="button"
                onClick={exportPng}
                disabled={isExporting}
                className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-black/10 bg-white text-sm font-semibold shadow-sm transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FileImage size={16} />
                PNG
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={exportAnimatedSvg}
                disabled={isExporting}
                className="flex h-9 items-center justify-center gap-1.5 rounded-2xl border border-black/10 bg-white text-xs font-semibold shadow-sm transition hover:-translate-y-0.5 disabled:opacity-50"
              >
                <Sparkles size={13} />
                Animated SVG
              </button>
              <button
                type="button"
                onClick={exportZip}
                disabled={isExporting}
                className="flex h-9 items-center justify-center gap-1.5 rounded-2xl border border-black/10 bg-white text-xs font-semibold shadow-sm transition hover:-translate-y-0.5 disabled:opacity-50"
              >
                <Download size={13} />
                ZIP
              </button>
            </div>
          </section>

          <p className="mt-3 rounded-2xl border border-black/10 bg-white/55 px-3 py-2 font-mono text-xs text-[#6b675e]">
            Figma: {figmaStatus}
          </p>

          <p className="mt-2 rounded-2xl border border-black/10 bg-white/55 px-3 py-2 font-mono text-xs text-[#6b675e]">
            Galéria: {galleryStatus} / Export: {exportStatus}
          </p>

          {/* Image detection */}
          <section className="mt-4 rounded-[28px] border border-white/75 bg-white/72 p-4 shadow-[0_20px_70px_rgba(31,35,28,0.1)]">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <ScanLine size={17} />
                <h2 className="text-sm font-semibold">Detekcia obrazu</h2>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-[#6b675e]">{traceStatus}</span>
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
                  alt={`Detekovaný obraz: ${detectedTrace.shapes.length} ciest, ${Math.round(detectedTrace.coverage * 100)}% pokrytie`}
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
                Žiadny raster
              </div>
            )}
          </section>

          {/* Custom shapes */}
          <section className="mt-4 rounded-[28px] border border-white/75 bg-white/72 p-4 shadow-[0_20px_70px_rgba(31,35,28,0.1)]">
            <div className="mb-3 flex items-center gap-2">
              <PenTool size={17} />
              <h2 className="text-sm font-semibold">Vlastné tvary</h2>
            </div>

            <div className="mb-3 flex gap-1">
              {settings.layers.map((layer) => {
                const active = activeSketchLayer === layer.id;
                const hasShapes = layerCustomData[layer.id].shapes.length > 0;
                return (
                  <button
                    key={layer.id}
                    type="button"
                    onClick={() => setActiveSketchLayer(layer.id)}
                    className={`relative flex-1 rounded-xl border px-2 py-1.5 text-xs font-semibold transition hover:-translate-y-0.5 ${active ? "bg-white shadow-sm" : "bg-white/40 text-[#6b675e]"}`}
                    style={{
                      borderColor: active ? layer.color : "transparent",
                      boxShadow: active ? `0 0 0 1.5px ${layer.color}` : undefined,
                    }}
                  >
                    {layer.label.split(" ")[0]}
                    {hasShapes && (
                      <span
                        className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] font-bold text-white"
                        style={{ background: layer.color }}
                      >
                        {layerCustomData[layer.id].shapes.length}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <ShapeSketchPad
              key={activeSketchLayer}
              initialShapes={layerCustomData[activeSketchLayer].shapes}
              onChange={(shapes) =>
                setLayerCustomData((prev) => ({
                  ...prev,
                  [activeSketchLayer]: { ...prev[activeSketchLayer], shapes },
                }))
              }
            />

            <label className="mt-3 block">
              <span className="mb-2 flex items-center justify-between text-sm">
                <span className="font-medium">Počet tvarov</span>
                <span className="font-mono text-xs text-[#6b675e]">
                  {layerCustomData[activeSketchLayer].count === 0
                    ? "auto"
                    : layerCustomData[activeSketchLayer].count}
                </span>
              </span>
              <input
                type="range"
                min={0}
                max={300}
                step={1}
                value={layerCustomData[activeSketchLayer].count}
                onChange={(e) =>
                  setLayerCustomData((prev) => ({
                    ...prev,
                    [activeSketchLayer]: {
                      ...prev[activeSketchLayer],
                      count: Number(e.target.value),
                    },
                  }))
                }
                className="h-2 w-full cursor-pointer appearance-none rounded-full bg-[#d8ddd6] accent-[#0b8f8f]"
              />
            </label>
            <p className="mt-1.5 text-[11px] text-[#6b675e]">
              0 = automaticky podľa hustoty
            </p>
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
                  {detectedTrace ? "Detected vector pattern" : "Retro boomerang pattern"}
                </h2>
              </div>
              <div className="rounded-full border border-white/70 bg-white/65 px-4 py-2 font-mono text-xs shadow-sm backdrop-blur-xl">
                {CANVAS_SIZE} × {CANVAS_SIZE} SVG
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
                          fill={element.stroke}
                          opacity={element.opacity * 0.62}
                          filter="url(#line-blur-preview)"
                          transform={`translate(${element.x.toFixed(2)} ${element.y.toFixed(2)}) rotate(${element.rotation.toFixed(2)}) scale(${element.scale.toFixed(3)})`}
                        />
                      ) : null}
                      <motion.path
                        d={element.path}
                        fill={element.stroke}
                        opacity={element.opacity}
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

            {/* Canvas action row */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              {/* Undo / Redo */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={undo}
                  className="flex h-9 items-center gap-1.5 rounded-2xl border border-black/10 bg-white px-3 text-xs font-semibold text-[#6b675e] shadow-sm transition hover:-translate-y-0.5"
                  title="Späť (Ctrl+Z)"
                  aria-label="Undo"
                >
                  <RotateCcw size={13} />
                  Späť
                </button>
                <button
                  type="button"
                  onClick={redo}
                  className="flex h-9 items-center gap-1.5 rounded-2xl border border-black/10 bg-white px-3 text-xs font-semibold text-[#6b675e] shadow-sm transition hover:-translate-y-0.5"
                  title="Vpred (Ctrl+Shift+Z)"
                  aria-label="Redo"
                >
                  <RotateCw size={13} />
                  Vpred
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Share URL */}
                <button
                  type="button"
                  onClick={copyShareUrl}
                  className="flex h-9 items-center gap-1.5 rounded-2xl border border-black/10 bg-white px-3 text-xs font-semibold text-[#6b675e] shadow-sm transition hover:-translate-y-0.5"
                  title="Kopírovať link"
                >
                  {urlCopied ? <ClipboardCheck size={13} /> : <Clipboard size={13} />}
                  {urlCopied ? "Skopírované!" : "Zdieľať"}
                </button>

                <button
                  type="button"
                  onClick={syncToFigma}
                  disabled={figmaStatus === "Preparing"}
                  className="flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#0b8f8f] px-5 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <PenTool size={16} />
                  {figmaStatus === "Preparing" ? "Sync..." : "Figma"}
                </button>
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
            </div>

            {/* Gallery */}
            <section className="rounded-[28px] border border-white/70 bg-white/45 p-4 shadow-sm backdrop-blur-xl">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold tracking-normal">Galéria</h2>
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
                        alt={item.name}
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
