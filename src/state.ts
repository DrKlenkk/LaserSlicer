// Small observable store: settings (persisted) + model data (not persisted).
import type { Mesh, MeshStats, Settings } from "./core/types";

export const DEFAULT_SETTINGS: Settings = {
  axis: "+Z",
  rotationSteps: [0, 0, 0],
  scale: 1,
  targetSize: null,
  thickness: 4.0,
  sheetW: 600,
  sheetH: 400,
  kerf: 0.15,
  partSpacing: 3,
  sheetMargin: 5,
  mode: "oversize",
  samplesPerLayer: 3,
  roundHeightToLayers: false,
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
  formats: ["dxf"],
  dpi: 300,
  rasterStyle: "filled",
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

export type Listener = (state: AppState, changed: ReadonlySet<keyof AppState>) => void;

export class Store {
  private state: AppState = {
    settings: loadSettings(),
    model: null,
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

  resetSettings() {
    this.set({ settings: structuredClone(DEFAULT_SETTINGS) });
  }
}
