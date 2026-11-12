// Bootstrap: wires store <-> worker <-> UI.
import "./style.css";
import { Store } from "./state";
import { WorkerClient, StaleJobError } from "./worker/client";
import { createPanel, type OrientInfo } from "./ui/panel";
import { Viewport3D } from "./ui/viewport3d";
import { LayerView2D } from "./ui/layerView2d";
import { createWarnings } from "./ui/warnings";
import { orientMesh, type Oriented } from "./core/transform";
import { load3mfToSoup } from "./ui/load3mf";
import { h } from "./ui/dom";
import type { Tab } from "./state";

const store = new Store();
const app = document.getElementById("app")!;

// ---------- layout ----------
const panelEl = h("aside", { class: "panel", id: "panel" });
const viewEl = h("div", { class: "view-3d", id: "view-3d" });
const layerEl = h("div", { id: "view-layer", hidden: true });
const sheetsEl = h("div", { class: "placeholder", id: "view-sheets", hidden: true }, h("p", {}, "Sheets view: nested parts as they will be cut."), h("small", {}, "Coming in milestone M5."));
const fitBtn = h("button", { type: "button", class: "btn small floating", id: "fit-btn", title: "Frame the model" }, "Fit view");
const tabs: { id: Tab; label: string; el: HTMLElement }[] = [
  { id: "3d", label: "3D", el: viewEl },
  { id: "layer", label: "Layer", el: layerEl },
  { id: "sheets", label: "Sheets", el: sheetsEl },
];
const tabBar = h("div", { class: "tabs", role: "tablist" });
const tabButtons = tabs.map((t) => {
  const b = h("button", { type: "button", role: "tab", id: `tab-${t.id}`, onclick: () => store.set({ tab: t.id }) }, t.label);
  tabBar.append(b);
  return b;
});
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
  h("div", { class: "layout" }, panelEl, h("main", { class: "main" }, tabBar, h("div", { class: "stage" }, viewEl, layerEl, sheetsEl, fitBtn)), statusBar),
  dropOverlay,
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

const panel = createPanel(panelEl, store, { openFile });

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
  fitBtn.hidden = tab !== "3d";
  if (tab === "3d") viewport.activate();
  if (tab === "layer") layerView.activate();
  layerView.setLayer(store.get().layer);

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
    warnings.set([]);
    runSummary.textContent = "";
    scheduleRun(true);
  } else if (changed.has("settings")) {
    scheduleRun(false);
  }
  if (changed.has("result")) {
    const r = state.result;
    warnings.set(r ? r.warnings : []);
    const text = r ? `${r.info.layerCount} layers · ${r.parts.length} parts` : "";
    runSummary.textContent = text;
    panel.setSummary(r ? text : "Load a model to slice it.");
  }
});

store.subscribe(refresh);
refresh();
