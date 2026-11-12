// Bootstrap: wires store <-> worker <-> UI.
import "./style.css";
import { Store } from "./state";
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
import { h } from "./ui/dom";
import { createHelp } from "./ui/help";
import type { ViewMode } from "./ui/viewport3d";
import type { Tab } from "./state";

const store = new Store();
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
tabBar.append(h("span", { class: "spacer" }), h("button", { type: "button", class: "help-btn", id: "help-btn", title: "Help and keyboard shortcuts (?)", onclick: () => help.toggle() }, "?"));
const btnModel = h("button", { type: "button", id: "view-model", class: "active", onclick: () => setViewMode("model") }, "Model");
const btnStack = h("button", { type: "button", id: "view-stack", disabled: true, title: "The sliced layers stacked (M)", onclick: () => setViewMode("stack") }, "Stacked result");
const viewToggle = h("div", { class: "view-toggle", id: "view-toggle", role: "group", "aria-label": "3D view" }, btnModel, btnStack);
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
  h("div", { class: "layout" }, panelEl, h("main", { class: "main" }, tabBar, h("div", { class: "stage" }, viewEl, layerEl, sheetsEl, fitBtn, viewToggle)), statusBar),
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

async function openFile(file: File) {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!["stl", "obj", "3mf"].includes(ext)) {
    store.setStatus(`Unsupported file type ".${ext}". Use STL, OBJ or 3MF.`, "error");
    return;
  }
  store.setStatus(`Loading ${file.name}…`);
  try {
    let buffer = await file.arrayBuffer();
    let kind: "stl" | "obj" | "soup" = ext === "3mf" ? "soup" : (ext as "stl" | "obj");
    if (ext === "3mf") {
      // 3MFLoader needs DOMParser (not in workers): parse here, send the triangles on.
      const soup = load3mfToSoup(buffer);
      buffer = soup.buffer as ArrayBuffer;
    }
    const r = await worker.load(buffer, kind);
    store.set({
      model: { fileName: file.name, mesh: { positions: r.positions, indices: r.indices, bbox: r.bbox }, stats: r.stats },
      result: null,
      layer: 0,
    });
    lastFitModel = null; // fit camera for the new model
    const s = r.stats;
    const problems: string[] = [];
    if (s.openEdges) problems.push(`${s.openEdges} open edges`);
    if (s.nonManifoldEdges) problems.push(`${s.nonManifoldEdges} non-manifold edges`);
    if (s.degenerateRemoved) problems.push(`${s.degenerateRemoved} degenerate triangles removed`);
    store.setStatus(
      problems.length ? `Loaded ${file.name}: mesh problems (${problems.join(", ")}); slicing will try to repair.` : `Loaded ${file.name}: ${s.triangles.toLocaleString()} triangles, closed mesh.`,
      problems.length ? "warn" : "info",
    );
  } catch (e) {
    store.setStatus(`Could not load ${file.name}: ${e instanceof Error ? e.message : String(e)}`, "error");
  }
}

const panel = createPanel(panelEl, store, {
  openFile,
  async exportZip() {
    const m = store.get().model;
    if (!m) throw new Error("No model loaded");
    const { formats, perLayerFiles, dpi, rasterStyle, rasterEngrave } = store.get().settings;
    const f = await worker.exportZip(m.fileName, { formats, perLayerFiles, dpi, rasterStyle, rasterEngrave });
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
  const key = model ? JSON.stringify([settings.axis, settings.rotationSteps, settings.scale, settings.targetSize]) : "";
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

// ---------- slicing runs: debounced, newest wins ----------
const DEBOUNCE_MS = 300;
let runTimer: ReturnType<typeof setTimeout> | undefined;
let runSeq = 0;
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

async function startRun() {
  const { model, settings } = store.get();
  if (!model) return;
  const seq = ++runSeq;
  showProgress("Starting", 0);
  try {
    const r = await worker.run(settings, (stage, f) => {
      if (seq === runSeq) showProgress(stage, f);
    });
    if (seq !== runSeq) return;
    const result = { layers: r.layers, parts: r.parts, placements: r.placements, sheets: r.sheets, warnings: r.warnings, info: r.info };
    showProgress(null);
    const layer = Math.min(store.get().layer, result.layers.length - 1);
    store.set({ result, layer });
    layerView.setResult(result, resetLayerView);
    sheetView.setResult(result, resetLayerView);
    resetLayerView = false;
  } catch (e) {
    if (e instanceof StaleJobError || seq !== runSeq) return;
    showProgress(null);
    store.setStatus(`Slicing failed: ${e instanceof Error ? e.message : String(e)}`, "error");
  }
}

let lastRunModel: object | null = null;
store.subscribe((state, changed) => {
  if (changed.has("model") && state.model !== lastRunModel) {
    lastRunModel = state.model;
    resetLayerView = true;
    layerView.setResult(null, true);
    sheetView.setResult(null, true);
    panel.setExportReady(false);
    warnings.set([]);
    runSummary.textContent = "";
    scheduleRun(true);
  } else if (changed.has("settings")) {
    scheduleRun(false);
  }
  if (changed.has("result")) {
    const r = state.result;
    warnings.set(r ? r.warnings : []);
    const text = r
      ? `${r.info.layerCount} layers · ${r.parts.length} parts · ${r.sheets.length} sheet${r.sheets.length === 1 ? "" : "s"} · ${materialUse(r.sheets).toFixed(0)} % material use`
      : "";
    runSummary.textContent = text;
    panel.setSummary(r ? text : "Load a model to slice it.");
    btnStack.disabled = !r;
    if (!r && viewMode === "stack") setViewMode("model");
    viewport.setStack(r ? r.layers : null);
    viewport.setHighlight(r ? state.layer : -1);
    panel.setExportReady(!!r && r.sheets.length > 0);
  }
});

store.subscribe(refresh);
refresh();

// ---------- keyboard shortcuts ----------
const TEXT_INPUT_TYPES = new Set(["text", "number", "search", "email", "url", "password", "tel"]);
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && help.open) {
    help.close();
    return;
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
