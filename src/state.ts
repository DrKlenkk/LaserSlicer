// Small observable store: settings (persisted) + model data (not persisted).
import type { Mesh, MeshStats, Settings } from "./core/types";
import type { RunResult } from "./core/pipeline";
import { IMPORT_UNITS } from "./core/units";

export const DEFAULT_SETTINGS: Settings = {
  axis: "+Z",
  rotationSteps: [0, 0, 0],
  importUnit: "mm",
  scale: 1,
  targetSize: null,
  thickness: 4.0,
  sheetW: 600,
  sheetH: 400,
  kerf: 0.15,
  partSpacing: 3,
  sheetMargin: 5,
  density: 0.65,
  cutSpeed: 0,
  engraveSpeed: 0,
  pricePerSheet: 0,
  mode: "oversize",
  samplesPerLayer: 3,
  roundHeightToLayers: false,
  smoothRadius: 0,
  simplifyTol: 0.05,
  minPartArea: 4,
  minFeature: 0,
  hollowEnabled: false,
  hollowWall: 15,
  solidCapLayers: 1,
  engraveNextOutline: true,
  labels: true,
  labelHeight: 6,
  dowels: false,
  dowelDiameter: 6,
  dowelCount: 2,
  bridgesEnabled: false,
  bridgeCount: 2,
  bridgeWidth: 0.5,
  bridgeMinLength: 40,
  bridgeHoles: false,
  bridgeMaxSpacing: 0,
  formats: ["dxf"],
  dpi: 300,
  rasterStyle: "filled",
  rasterEngrave: true,
  exportCut: true,
  exportEngrave: true,
  exportLabel: true,
  exportBridge: true,
  exportSheet: false,
  exportInnerLayer: false,
  perLayerFiles: false,
};

export type Model = {
  fileName: string;
  /** welded, unoriented mesh as returned by the worker */
  mesh: Mesh;
  stats: MeshStats;
};

export type Tab = "3d" | "layer" | "sheets";

export type AppState = {
  settings: Settings;
  model: Model | null;
  /** latest slicing result for the current model and settings (not persisted) */
  result: RunResult | null;
  /** layer selected in the Layer tab */
  layer: number;
  tab: Tab;
  /** transient status text and level for the status bar */
  status: { text: string; level: "info" | "warn" | "error" };
};

const STORAGE_KEY = "laserslicer.settings.v1";

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings>;
      // Merge over defaults so settings added in later versions get their default.
      return { ...structuredClone(DEFAULT_SETTINGS), ...parsed };
    }
  } catch {
    /* storage unavailable (file:// in some browsers) or corrupt: use defaults */
  }
  return structuredClone(DEFAULT_SETTINGS);
}

function saveSettings(s: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

// ---------- project file (settings only; the model is not stored) ----------

export const PROJECT_FORMAT = "laser-slicer-project";

export function serializeProject(s: Settings): string {
  return JSON.stringify({ format: PROJECT_FORMAT, version: 1, settings: s }, null, 2) + "\n";
}

const POSITIVE = ["thickness", "sheetW", "sheetH", "scale", "labelHeight", "dowelDiameter", "bridgeWidth"] as const;
const NON_NEGATIVE = ["kerf", "partSpacing", "sheetMargin", "smoothRadius", "simplifyTol", "minPartArea", "minFeature", "hollowWall", "solidCapLayers", "bridgeMinLength", "bridgeMaxSpacing", "density", "cutSpeed", "engraveSpeed", "pricePerSheet"] as const;
const INTEGERS = ["samplesPerLayer", "solidCapLayers", "dowelCount", "bridgeCount"] as const;
const ENUMS: Record<string, readonly string[]> = {
  axis: ["+X", "-X", "+Y", "-Y", "+Z", "-Z"],
  mode: ["oversize", "midplane", "undersize"],
  rasterStyle: ["filled", "outline"],
  importUnit: IMPORT_UNITS,
};

/**
 * Parses a project file into complete, validated settings (keys missing from the file keep their default, unknown keys
 * are ignored). Throws an Error with one clear sentence when the file is not a project or a value is unusable.
 */
export function parseProject(text: string): Settings {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This is not a valid project file (it is not JSON)");
  }
  const obj = data as { format?: unknown; settings?: unknown } | null;
  if (!obj || typeof obj !== "object" || obj.format !== PROJECT_FORMAT || typeof obj.settings !== "object" || obj.settings === null)
    throw new Error("This is not a Laser Slicer project file");
  const src = obj.settings as Record<string, unknown>;
  const out = structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>;
  const bad = (k: string): never => {
    throw new Error(`Project file has an invalid value for "${k}"`);
  };
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    if (!(k in src)) continue;
    const v = src[k];
    const def = (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[k];
    if (k in ENUMS) {
      if (typeof v !== "string" || !ENUMS[k].includes(v)) bad(k);
    } else if (k === "formats") {
      if (!Array.isArray(v) || v.some((f) => !["dxf", "svg", "png", "jpg"].includes(f as string))) bad(k);
    } else if (k === "rotationSteps") {
      if (!Array.isArray(v) || v.length !== 3 || v.some((n) => !Number.isInteger(n))) bad(k);
      src[k] = (v as number[]).map((n) => ((n % 4) + 4) % 4);
    } else if (k === "targetSize") {
      const t = v as { dim?: unknown; mm?: unknown } | null;
      if (t !== null && !(typeof t === "object" && ["x", "y", "z"].includes(t.dim as string) && typeof t.mm === "number" && t.mm > 0 && Number.isFinite(t.mm))) bad(k);
    } else if (typeof def === "number") {
      if (typeof v !== "number" || !Number.isFinite(v)) bad(k);
      if ((POSITIVE as readonly string[]).includes(k) && !((v as number) > 0)) bad(k);
      if ((NON_NEGATIVE as readonly string[]).includes(k) && (v as number) < 0) bad(k);
      if ((INTEGERS as readonly string[]).includes(k) && !Number.isInteger(v)) bad(k);
      if (k === "samplesPerLayer" && (v as number) < 1) bad(k);
      if (k === "dowelCount" && (v as number) < 1) bad(k);
      if (k === "bridgeCount" && ((v as number) < 1 || (v as number) > 8)) bad(k);
      if (k === "dpi" && ((v as number) < 1 || (v as number) > 4800)) bad(k);
    } else if (typeof v !== typeof def) bad(k);
    out[k] = src[k];
  }
  return out as unknown as Settings;
}

export type Listener = (state: AppState, changed: ReadonlySet<keyof AppState>) => void;

export class Store {
  private state: AppState = {
    settings: loadSettings(),
    model: null,
    result: null,
    layer: 0,
    tab: "3d",
    status: { text: "Starting…", level: "info" },
  };
  private listeners = new Set<Listener>();

  get(): AppState {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(changed: Set<keyof AppState>) {
    for (const l of this.listeners) l(this.state, changed);
  }

  set(patch: Partial<AppState>) {
    this.state = { ...this.state, ...patch };
    if (patch.settings) saveSettings(this.state.settings);
    this.emit(new Set(Object.keys(patch) as (keyof AppState)[]));
  }

  updateSettings(patch: Partial<Settings>) {
    this.set({ settings: { ...this.state.settings, ...patch } });
  }

  setStatus(text: string, level: AppState["status"]["level"] = "info") {
    this.set({ status: { text, level } });
  }

  /** Replace all settings (project load). */
  replaceSettings(s: Settings) {
    this.set({ settings: s });
  }

  resetSettings() {
    this.set({ settings: structuredClone(DEFAULT_SETTINGS) });
  }
}
