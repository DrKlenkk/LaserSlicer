// Bootstrap: wires store <-> worker <-> UI.
import { infoIcon } from "./ui/tooltip";
import "./style.css";
import { Store, parseProjectFile, type ProjectModel } from "./state";
import { WorkerClient, StaleJobError } from "./worker/client";
import { createPanel, type OrientInfo } from "./ui/panel";
import { Viewport3D } from "./ui/viewport3d";
import { LayerView2D } from "./ui/layerView2d";
import { SheetView } from "./ui/sheetView";
import { downloadBytes } from "./ui/exportDialog";
import { materialUse } from "./core/nest";
import { createWarnings } from "./ui/warnings";
import { orientMesh, type Oriented } from "./core/transform";
import { load3mfToSoup } from "./ui/load3mf";
import { read3mfUnit, THREEMF_UNIT_NAME, THREEMF_UNIT_PLURAL, type ImportUnit } from "./core/units";
import { h } from "./ui/dom";
import { createHelp } from "./ui/help";
import type { ViewMode } from "./ui/viewport3d";
import type { Tab } from "./state";
import { UpdateController, slicingKey, type RunAction } from "./updateController";
import { loadUiPrefs, saveUiPrefs } from "./uiPrefs";
import { SessionStore } from "./sessionStore";
import type { Settings } from "./core/types";
import { exportLayersOf } from "./core/export/common";
import { estimate, estimateLines, estimateSettingsOf, estimateSummary } from "./core/estimates";

const store = new Store();
const ctl = new UpdateController(loadUiPrefs().autoUpdate);
const app = document.getElementById("app")!;

// ---------- layout ----------
const panelEl = h("aside", { class: "panel", id: "panel" });
const viewEl = h("div", { class: "view-3d", id: "view-3d" });
const layerEl = h("div", { id: "view-layer", hidden: true });
const sheetsEl = h("div", { id: "view-sheets", hidden: true });
const fitBtn = h("button", { type: "button", class: "btn small floating", id: "fit-btn", title: "Frame the model" }, "Fit view");
const tabs: { id: Tab; label: string; el: HTMLElement }[] = [
  { id: "3d", label: "3D", el: viewEl },
  { id: "layer", label: "Layer", el: layerEl },
  { id: "sheets", label: "Sheets", el: sheetsEl },
];
const tabBar = h("div", { class: "tabs", role: "tablist" });
const help = createHelp();
const tabButtons = tabs.map((t) => {
  const b = h("button", { type: "button", role: "tab", id: `tab-${t.id}`, onclick: () => store.set({ tab: t.id }) }, t.label);
  tabBar.append(b);
  return b;
});
const autoCb = h("input", { type: "checkbox", id: "auto-update" });
autoCb.checked = ctl.auto;
const autoLabel = h("label", { class: "auto-update" }, autoCb, h("span", {}, "Auto-update preview"), infoIcon("autoUpdate"));
const updateNote = h("span", { class: "update-note", id: "update-note" }, "● settings changed");
const updateBtn = h("button", { type: "button", class: "btn primary", id: "update-preview", title: "Slice with the current settings (U)" }, "Update preview");
const updateWrap = h("div", { class: "update-wrap", id: "update-wrap", hidden: true }, updateNote, updateBtn);
const undoBtn = h("button", { type: "button", class: "help-btn", id: "undo-btn", title: "Undo the last settings change (Ctrl+Z)", "aria-label": "Undo", onclick: () => store.undo() }, "↶");
const redoBtn = h("button", { type: "button", class: "help-btn", id: "redo-btn", title: "Redo (Ctrl+Y or Ctrl+Shift+Z)", "aria-label": "Redo", onclick: () => store.redo() }, "↷");
function renderHistory() {
  undoBtn.disabled = !store.canUndo;
  redoBtn.disabled = !store.canRedo;
}
tabBar.append(h("span", { class: "spacer" }), undoBtn, redoBtn, autoLabel, h("button", { type: "button", class: "help-btn", id: "help-btn", title: "Help and keyboard shortcuts (?)", onclick: () => help.toggle() }, "?"));
const btnModel = h("button", { type: "button", id: "view-model", class: "active", onclick: () => setViewMode("model") }, "Model");
const btnStack = h("button", { type: "button", id: "view-stack", disabled: true, title: "The sliced layers stacked (M)", onclick: () => setViewMode("stack") }, "Stacked result");
const viewToggle = h("div", { class: "view-toggle", id: "view-toggle", role: "group", "aria-label": "3D view" }, btnModel, btnStack, infoIcon("viewToggle"));
const statusMsg = h("span", { class: "msg", id: "status-msg" }, "Starting…");
const workerBadge = h("span", { class: "badge", id: "worker-status" }, "Worker: starting…");
const progressBar = h("div", { class: "progress", id: "progress", hidden: true }, h("div", { class: "progress-fill", id: "progress-fill" }));
const progressText = h("span", { class: "progress-text", id: "progress-text", hidden: true });
const runSummary = h("span", { class: "run-summary", id: "run-summary" });
const warnings = createWarnings((w) => {
  if (w.layer !== undefined) {
    store.set({ layer: w.layer, tab: "layer" });
  }
});
const statusBar = h("footer", { class: "statusbar" }, progressBar, statusMsg, progressText, runSummary, warnings.button, workerBadge, warnings.panel);
const dropOverlay = h("div", { class: "drop-overlay", hidden: true }, "Drop model to load");

app.append(
  h("div", { class: "layout" }, panelEl, h("main", { class: "main" }, tabBar, h("div", { class: "stage" }, viewEl, layerEl, sheetsEl, fitBtn, viewToggle, updateWrap)), statusBar),
  dropOverlay,
  help.el,
);

// ---------- worker ----------
const worker = new WorkerClient((msg) => {
  workerBadge.textContent = `Worker error: ${msg}`;
  workerBadge.className = "badge err";
});
worker.ping().then(
  (ms) => {
    workerBadge.textContent = `Worker: ready (ping ${ms.toFixed(1)} ms)`;
    workerBadge.className = "badge ok";
    store.setStatus("Ready. Load an STL, OBJ or 3MF model.");
    void restoreSession();
  },
  (e: Error) => {
    workerBadge.textContent = `Worker: ${e.message}`;
    workerBadge.className = "badge err";
  },
);

// ---------- UI parts ----------
const viewport = new Viewport3D(viewEl);
fitBtn.addEventListener("click", () => viewport.fit());
const layerView = new LayerView2D(layerEl, (i) => store.set({ layer: i }));
const sheetView = new SheetView(sheetsEl, (layer) => store.set({ layer, tab: "layer" }));

let viewMode: ViewMode = "model";
function setViewMode(m: ViewMode) {
  if (m === "stack" && !store.get().result) return;
  viewMode = m;
  btnModel.classList.toggle("active", m === "model");
  btnStack.classList.toggle("active", m === "stack");
  viewport.setMode(m);
}

// ---------- loading models (file, project file, restored session) ----------
const session = new SessionStore();
/** Original bytes and name of the last model that loaded: embedded by "Save settings" and remembered for the next start.
 *  The worker gets a copy (a transferred buffer is detached), so this stays valid; it costs one copy of the file in memory. */
let lastSource: ProjectModel | null = null;

type LoadOpts = {
  /** project load: these settings (including their import unit) replace the current ones in the same store update as the model */
  settings?: Settings;
  /** session restore: leave all settings alone, even a 3MF's unit (the saved settings already hold the user's choice) */
  restored?: boolean;
};

/** Loads model bytes through the normal path. Throws on failure after the store has been left as it was. */
async function loadModelBytes(name: string, bytes: Uint8Array, opts: LoadOpts = {}): Promise<void> {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  try {
    let kind: "stl" | "obj" | "soup" = ext === "3mf" ? "soup" : (ext as "stl" | "obj");
    let declared: ImportUnit | null = null; // unit declared by a 3MF file
    let buffer: ArrayBuffer;
    if (ext === "3mf") {
      declared = read3mfUnit(bytes);
      // 3MFLoader needs DOMParser (not in workers): parse here, send the triangles on.
      const whole = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? (bytes.buffer as ArrayBuffer) : (bytes.slice().buffer as ArrayBuffer);
      let soup: Float32Array;
      try {
        soup = load3mfToSoup(whole);
      } catch (e) {
        throw new Error(e instanceof Error && /no triangles/.test(e.message) ? e.message : "This is not a valid 3MF file");
      }
      buffer = soup.buffer as ArrayBuffer;
    } else {
      buffer = bytes.slice().buffer as ArrayBuffer; // a copy: the worker takes ownership of what it gets
    }
    const r = await worker.load(buffer, kind);
    if (opts.restored && store.get().model) return; // the user loaded something while the restore was running
    // A 3MF file is authoritative about its unit: set it in the same update as the model (one orient, one run).
    // STL and OBJ keep whatever unit is set (it is a project setting). A project's own unit wins over the 3MF's, and a restore changes nothing.
    const unitChanged = !opts.settings && !opts.restored && declared !== null && declared !== store.get().settings.importUnit;
    lastSource = { name, bytes };
    store.set({
      model: { fileName: name, mesh: { positions: r.positions, indices: r.indices, bbox: r.bbox }, stats: r.stats },
      ...(opts.settings ? { settings: opts.settings } : unitChanged ? { settings: { ...store.get().settings, importUnit: declared! } } : {}),
      result: null,
      layer: 0,
    }, opts.settings ? "step" : "silent"); // a project is one undo step; a 3MF's unit rides along with the model (not a step)
    if (!opts.restored && loadUiPrefs().restoreSession) void session.save(name, bytes);
    const unitNote = unitChanged ? ` 3MF declares ${THREEMF_UNIT_PLURAL[declared!]} — import unit set to ${THREEMF_UNIT_NAME[declared!]}.` : "";
    lastFitModel = null; // fit camera for the new model
    const s = r.stats;
    const problems: string[] = [];
    if (s.openEdges) problems.push(`${s.openEdges} open edges`);
    if (s.nonManifoldEdges) problems.push(`${s.nonManifoldEdges} non-manifold edges`);
    if (s.degenerateRemoved) problems.push(`${s.degenerateRemoved} degenerate triangles removed`);
    const lead = opts.restored ? "Restored the last model. " : "";
    store.setStatus(
      lead + (problems.length ? `Loaded ${name}: mesh problems (${problems.join(", ")}); slicing will try to repair.` : `Loaded ${name}: ${s.triangles.toLocaleString()} triangles, closed mesh.`) + unitNote,
      problems.length ? "warn" : "info",
    );
  } catch (e) {
    if (ctl.auto && ctl.stale) scheduleRun(true); // the load cancelled a run in flight; the old model is still there
    throw e;
  }
}

async function openFile(file: File) {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!["stl", "obj", "3mf"].includes(ext)) {
    store.setStatus(`Unsupported file type ".${ext}". Use STL, OBJ or 3MF.`, "error");
    return;
  }
  store.setStatus(`Loading ${file.name}…`);
  try {
    await loadModelBytes(file.name, new Uint8Array(await file.arrayBuffer()));
  } catch (e) {
    store.setStatus(`Could not load ${file.name}: ${e instanceof Error ? e.message : String(e)}`, "error");
  }
}

/** Loads a project file's text. Resolves with a status sentence; throws one clear message and changes nothing on failure. */
async function loadProject(text: string, fileName: string): Promise<string> {
  const { settings, model } = parseProjectFile(text);
  if (!model) {
    store.replaceSettings(settings);
    return `Loaded settings from ${fileName}`;
  }
  store.setStatus(`Loading ${model.name} from ${fileName}…`);
  try {
    await loadModelBytes(model.name, model.bytes, { settings });
  } catch (e) {
    throw new Error(`The model stored in ${fileName} could not be loaded (${e instanceof Error ? e.message : String(e)}); the current model and settings were kept`);
  }
  return `Loaded ${model.name} and the settings from ${fileName}`;
}

/** At start-up: bring back the last model when the preference is on and a record exists. Failure is only a status note. */
async function restoreSession() {
  if (!loadUiPrefs().restoreSession) return;
  const rec = await session.load(); // null on any storage problem
  if (!rec || store.get().model) return;
  try {
    await loadModelBytes(rec.name, rec.bytes, { restored: true });
  } catch (e) {
    store.setStatus(`Could not restore ${rec.name} from the last session (${e instanceof Error ? e.message : String(e)}); it was forgotten.`, "warn");
    void session.clear();
  }
}

const panel = createPanel(panelEl, store, {
  openFile,
  loadProject,
  getModelSource: () => lastSource,
  setRestoreSession(on) {
    saveUiPrefs({ ...loadUiPrefs(), restoreSession: on });
    if (!on) void session.clear();
    else if (lastSource) void session.save(lastSource.name, lastSource.bytes);
  },
  async exportZip() {
    const m = store.get().model;
    if (!m) throw new Error("No model loaded");
    await ensureFresh(); // the ZIP is built from the last finished run, so it must match the current settings
    const st = store.get().settings; // read after the update: a click just before Download is included
    const { formats, perLayerFiles, dpi, rasterStyle, rasterEngrave } = st;
    const f = await worker.exportZip(m.fileName, { formats, perLayerFiles, dpi, rasterStyle, rasterEngrave, layers: exportLayersOf(st), estimate: estimateSettingsOf(st) });
    downloadBytes(f.name, f.mime, f.bytes);
    store.setStatus(`Saved ${f.name}`);
  },
});

// Drag & drop anywhere on the page.
let dragDepth = 0;
window.addEventListener("dragenter", (e) => {
  e.preventDefault();
  dragDepth++;
  dropOverlay.hidden = false;
});
window.addEventListener("dragleave", () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    dropOverlay.hidden = true;
  }
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropOverlay.hidden = true;
  const f = e.dataTransfer?.files?.[0];
  if (f) void openFile(f);
});

// ---------- derived: oriented model ----------
let oriented: Oriented | null = null;
let orientKey = "";
let lastFitModel: object | null = null;

function refresh() {
  const { model, settings, tab, status } = store.get();

  // tabs
  tabs.forEach((t, i) => {
    t.el.hidden = t.id !== tab;
    tabButtons[i].classList.toggle("active", t.id === tab);
    tabButtons[i].setAttribute("aria-selected", String(t.id === tab));
  });
  fitBtn.hidden = viewToggle.hidden = tab !== "3d";
  if (tab === "3d") viewport.activate();
  if (tab === "layer") layerView.activate();
  if (tab === "sheets") sheetView.activate();
  layerView.setLayer(store.get().layer);
  viewport.setHighlight(store.get().result ? store.get().layer : -1);

  // status
  statusMsg.textContent = status.text;
  statusMsg.className = `msg ${status.level}`;

  // orientation (memoised on the inputs that affect it)
  const key = model ? JSON.stringify([settings.axis, settings.rotationSteps, settings.importUnit, settings.scale, settings.targetSize]) : "";
  if (!model) {
    if (oriented) {
      oriented = null;
      orientKey = "";
      viewport.setMesh(null);
      panel.setInfo(null);
    }
    return;
  }
  const modelChanged = lastFitModel !== model;
  if (key !== orientKey || modelChanged) {
    orientKey = key;
    oriented = orientMesh(model.mesh, settings);
    viewport.setMesh(oriented.mesh, modelChanged);
    lastFitModel = model;
    const info: OrientInfo = { size: oriented.size, scale: oriented.scale };
    panel.setInfo(info);
    panel.setFileInfo(`${model.fileName} · ${model.stats.triangles.toLocaleString()} triangles`);
  }
}

// ---------- slicing runs: debounced, newest wins; manual mode only on request ----------
const DEBOUNCE_MS = 300;
let runTimer: ReturnType<typeof setTimeout> | undefined;
let runPromise: Promise<void> = Promise.resolve();
let resetLayerView = true;

function showProgress(stage: string | null, fraction = 0) {
  progressBar.hidden = progressText.hidden = stage === null;
  if (stage === null) return;
  (progressBar.firstElementChild as HTMLElement).style.width = `${Math.round(fraction * 100)}%`;
  progressText.textContent = `${stage} ${Math.round(fraction * 100)}%`;
}

function scheduleRun(immediate: boolean) {
  clearTimeout(runTimer);
  if (!store.get().model) return;
  runTimer = setTimeout(() => void startRun(), immediate ? 0 : DEBOUNCE_MS);
}

function act(a: RunAction) {
  if (a !== "none") scheduleRun(a === "immediate");
}

/** Slice now with the current settings (replaces a run in flight). Resolves when this run is over. */
function startRun(): Promise<void> {
  clearTimeout(runTimer);
  const { model, settings } = store.get();
  if (!model) return Promise.resolve();
  const seq = ctl.runStarted();
  showProgress("Starting", 0);
  const p = (async () => {
    try {
      const r = await worker.run(settings, (stage, f) => {
        if (ctl.isCurrent(seq)) showProgress(stage, f);
      });
      if (!ctl.isCurrent(seq)) return;
      const result = { layers: r.layers, parts: r.parts, placements: r.placements, sheets: r.sheets, warnings: r.warnings, info: r.info, measure: r.measure };
      showProgress(null);
      const layer = Math.min(store.get().layer, result.layers.length - 1);
      store.set({ result, layer });
      layerView.setResult(result, resetLayerView);
      sheetView.setResult(result, resetLayerView);
      resetLayerView = false;
      ctl.runFinished(seq);
    } catch (e) {
      if (!ctl.isCurrent(seq)) return; // superseded by a newer run or a new model
      showProgress(null);
      ctl.runFailed(seq);
      if (!(e instanceof StaleJobError)) store.setStatus(`Slicing failed: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  })();
  runPromise = p;
  return p;
}

/** Makes sure the shown result belongs to the current settings: runs now if stale, else waits for the run in flight. */
async function ensureFresh() {
  for (let i = 0; i < 4 && (ctl.stale || ctl.running); i++) {
    if (ctl.stale) {
      store.setStatus("Updating the preview before export…");
      await startRun();
    } else await runPromise;
  }
  if (ctl.stale || ctl.running || !store.get().result) throw new Error("Slicing did not finish; check the warnings and try again");
}

/** Summary line (top bar and export section) and the full estimate list. Recomputed on every settings change: the estimate
 *  settings never start a run, so the numbers follow them here, on the main thread, from the measurements of the last result. */
function renderSummaries() {
  const { result: r, settings } = store.get();
  if (!r) {
    runSummary.textContent = "";
    runSummary.title = "";
    panel.setSummary("Load a model to slice it.", []);
    return;
  }
  const e = estimate(r.measure, estimateSettingsOf(settings));
  const lines = estimateLines(r.measure, e);
  const base = `${r.info.layerCount} layers · ${r.parts.length} parts · ${r.sheets.length} sheet${r.sheets.length === 1 ? "" : "s"} · ${materialUse(r.sheets).toFixed(0)} % material use`;
  const full = `${base} · ${estimateSummary(r.measure, e)}`;
  runSummary.textContent = !ctl.auto && ctl.stale ? `${full} · outdated` : full;
  runSummary.title = lines.join("\n");
  panel.setSummary(full, lines);
}

function renderUpdate() {
  updateWrap.hidden = !ctl.showButton;
  updateBtn.disabled = ctl.running;
  updateBtn.textContent = ctl.running ? "Updating…" : "Update preview";
  updateBtn.setAttribute("aria-busy", String(ctl.running));
  updateNote.hidden = !ctl.stale;
  const r = store.get().result;
  updateNote.textContent = r ? "● settings changed" : "● not sliced yet";
  autoCb.checked = ctl.auto;
  renderSummaries();
  panel.setExportReady(!!r && r.sheets.length > 0 || (!ctl.auto && ctl.stale && !!store.get().model));
}
ctl.subscribe(renderUpdate);
updateBtn.addEventListener("click", () => void startRun());
autoCb.addEventListener("change", () => {
  saveUiPrefs({ ...loadUiPrefs(), autoUpdate: autoCb.checked });
  if (!autoCb.checked) clearTimeout(runTimer);
  act(ctl.setAuto(autoCb.checked));
});

let lastRunModel: object | null = null;
let lastSlicingKey = slicingKey(store.get().settings);
store.subscribe((state, changed) => {
  if (changed.has("model") && state.model !== lastRunModel) {
    lastRunModel = state.model;
    resetLayerView = true;
    layerView.setResult(null, true);
    sheetView.setResult(null, true);
    warnings.set([]);
    runSummary.textContent = "";
    runSummary.title = "";
    lastSlicingKey = slicingKey(state.settings);
    act(ctl.modelLoaded());
    renderUpdate();
  } else if (changed.has("settings")) {
    const k = slicingKey(state.settings);
    if (k !== lastSlicingKey) {
      lastSlicingKey = k;
      act(ctl.settingsChanged());
    }
    renderSummaries(); // estimate settings: numbers follow without a run
  }
  if (changed.has("result")) {
    const r = state.result;
    warnings.set(r ? r.warnings : []);
    btnStack.disabled = !r;
    if (!r && viewMode === "stack") setViewMode("model");
    viewport.setStack(r ? r.layers : null);
    viewport.setHighlight(r ? state.layer : -1);
    renderUpdate();
  }
});

store.subscribe(refresh);
refresh();
store.subscribe((_s, changed) => {
  if (changed.has("settings")) renderHistory();
});
renderHistory();

// ---------- keyboard shortcuts ----------
const TEXT_INPUT_TYPES = new Set(["text", "number", "search", "email", "url", "password", "tel"]);
/** Focus is somewhere the browser's own undo/typing must keep working (text-like inputs, select, textarea, editable). */
function typingTarget(t: HTMLElement | null): boolean {
  if (!t) return false;
  if (t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable) return true;
  return t.tagName === "INPUT" && TEXT_INPUT_TYPES.has((t as HTMLInputElement).type);
}
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && help.open) {
    help.close();
    return;
  }
  // Undo / redo of settings. Checkboxes, buttons and the layer slider do not use these keys themselves, so they are intercepted there.
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !typingTarget(e.target as HTMLElement | null)) {
    const k = e.key.toLowerCase();
    if (k === "z" || k === "y") {
      e.preventDefault();
      if (k === "y" || e.shiftKey) store.redo();
      else store.undo();
      return;
    }
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return; // leave browser shortcuts alone
  const t = e.target as HTMLElement | null;
  if (t) {
    if (t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
    if (t.tagName === "INPUT" && (TEXT_INPUT_TYPES.has((t as HTMLInputElement).type) || (t as HTMLInputElement).type === "range")) return; // the slider handles its own keys
  }
  const { result, layer } = store.get();
  const stepLayer = (d: number) => {
    if (!result) return;
    const n = Math.max(0, Math.min(result.layers.length - 1, layer + d));
    if (n !== layer) store.set({ layer: n });
  };
  switch (e.key) {
    case "1": store.set({ tab: "3d" }); break;
    case "2": store.set({ tab: "layer" }); break;
    case "3": store.set({ tab: "sheets" }); break;
    case "ArrowLeft": case "ArrowDown": stepLayer(-1); break;
    case "ArrowRight": case "ArrowUp": stepLayer(1); break;
    case "PageDown": stepLayer(-10); break;
    case "PageUp": stepLayer(10); break;
    case "Home": stepLayer(-1e9); break;
    case "End": stepLayer(1e9); break;
    case "m": case "M": if (store.get().tab === "3d") setViewMode(viewMode === "model" ? "stack" : "model"); break;
    case "f": case "F": if (store.get().tab === "3d") viewport.fit(); break;
    case "u": case "U": if (ctl.auto || !ctl.stale || ctl.running) return; void startRun(); break;
    case "?": help.toggle(); break;
    default: return;
  }
  e.preventDefault();
});

// ---------- last line of defence: never a silent failure or blank screen ----------
function reportUnexpected(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  store.setStatus(`Unexpected error: ${msg}`, "error");
}
window.addEventListener("error", (ev) => reportUnexpected(ev.error ?? ev.message));
window.addEventListener("unhandledrejection", (ev) => reportUnexpected(ev.reason));
