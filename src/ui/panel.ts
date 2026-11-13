// Parameter panel: collapsible groups of inputs bound to Settings in the store.
import type { Axis, Dim, Settings } from "../core/types";
import { serializeProject, type ProjectModel, type Store } from "../state";
import { loadUiPrefs } from "../uiPrefs";
import { h } from "./dom";
import type { HelpKey } from "./helpText";
import { infoIcon } from "./tooltip";
import { createExportSection, downloadBytes } from "./exportDialog";
import { buildCalibrationZip } from "../core/calibration";
import { IMPORT_UNIT_OPTIONS } from "../core/units";
import { PresetStore, STARTER_PRESETS, applyPreset, matchesPreset, normalizeName, presetValuesOf } from "../presets";

export type OrientInfo = { size: [number, number, number]; scale: number };

export type PanelActions = {
  openFile(file: File): void;
  exportZip(): Promise<void>;
  /** Loads a project file's text (settings, and the model if it holds one); resolves with a status sentence, throws one clear message. */
  loadProject(text: string, fileName: string): Promise<string>;
  /** The original file of the loaded model, or null without a model. */
  getModelSource(): ProjectModel | null;
  setRestoreSession(on: boolean): void;
};

type NumKey = {
  [K in keyof Settings]: Settings[K] extends number ? K : never;
}[keyof Settings];
type BoolKey = {
  [K in keyof Settings]: Settings[K] extends boolean ? K : never;
}[keyof Settings];

const AXES: Axis[] = ["+X", "-X", "+Y", "-Y", "+Z", "-Z"];
const DIMS: Dim[] = ["x", "y", "z"];

export function createPanel(root: HTMLElement, store: Store, actions: PanelActions) {
  const syncers: ((s: Settings) => void)[] = [];
  let info: OrientInfo | null = null;
  let targetDim: Dim = "z";
  const infoSyncers: (() => void)[] = [];

  // ---------- field helpers ----------
  function numField(label: string, key: NumKey, opts: { step?: number; min?: number; max?: number; unit?: string; hint?: string; help?: HelpKey } = {}) {
    const input = h("input", { type: "number", step: opts.step ?? "any", min: opts.min, max: opts.max, id: `f-${key}` });
    input.addEventListener("change", () => {
      const v = parseFloat(input.value);
      if (Number.isFinite(v) && (opts.min === undefined || v >= opts.min) && (opts.max === undefined || v <= opts.max)) store.updateSettings({ [key]: v } as Partial<Settings>);
      else input.value = String(store.get().settings[key]);
    });
    syncers.push((s) => {
      if (document.activeElement !== input) input.value = String(s[key]);
    });
    return h("label", { class: "field" }, h("span", { class: "lbl" }, label, opts.help ? infoIcon(opts.help) : null), h("span", { class: "ctl" }, input, opts.unit ? h("span", { class: "unit" }, opts.unit) : null), opts.hint ? h("small", { class: "hint" }, opts.hint) : null);
  }

  function boolField(label: string, key: BoolKey, help?: HelpKey, hint?: string) {
    const input = h("input", { type: "checkbox", id: `f-${key}` });
    input.addEventListener("change", () => store.updateSettings({ [key]: input.checked } as Partial<Settings>));
    syncers.push((s) => (input.checked = s[key]));
    return h("label", { class: "field check" }, input, h("span", { class: "lbl" }, label, help ? infoIcon(help) : null), hint ? h("small", { class: "hint" }, hint) : null);
  }

  function selectField<K extends "mode" | "dpi" | "rasterStyle" | "importUnit">(label: string, key: K, options: [string, string][], help?: HelpKey) {
    const sel = h("select", { id: `f-${key}` }, ...options.map(([v, t]) => h("option", { value: v }, t)));
    sel.addEventListener("change", () => {
      const raw = sel.value;
      store.updateSettings({ [key]: key === "dpi" ? Number(raw) : raw } as Partial<Settings>);
    });
    syncers.push((s) => (sel.value = String(s[key])));
    return h("label", { class: "field" }, h("span", { class: "lbl" }, label, help ? infoIcon(help) : null), h("span", { class: "ctl" }, sel));
  }

  function group(title: string, open: boolean, ...body: (Node | null)[]) {
    return h("details", { class: "group", open }, h("summary", {}, title), h("div", { class: "group-body" }, ...body));
  }

  // ---------- Model group ----------
  const fileInput = h("input", { type: "file", accept: ".stl,.obj,.3mf", id: "file-input", hidden: true });
  fileInput.addEventListener("change", () => {
    const f = fileInput.files?.[0];
    if (f) actions.openFile(f);
    fileInput.value = "";
  });
  const dropZone = h(
    "div",
    { class: "dropzone", id: "dropzone", tabindex: 0 },
    h("strong", {}, "Drop a model here"),
    h("span", {}, "STL, OBJ or 3MF"),
    h("button", { type: "button", class: "btn", onclick: () => fileInput.click() }, "Choose file…"),
    fileInput,
  );
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("over");
  });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("over"));
  dropZone.addEventListener("drop", () => dropZone.classList.remove("over"));

  const fileInfo = h("div", { class: "fileinfo", id: "file-info" }, "No model loaded");
  const sizeReadout = h("div", { class: "size", id: "size-readout" }, "–");

  // scale % (shows effective scale)
  const scaleInput = h("input", { type: "number", step: "any", min: "0.001", id: "f-scalePct" });
  scaleInput.addEventListener("change", () => {
    const v = parseFloat(scaleInput.value);
    if (Number.isFinite(v) && v > 0) store.updateSettings({ scale: v / 100, targetSize: null });
    else infoSyncers.forEach((f) => f());
  });
  // target size along one dimension (proportions locked)
  const dimSelect = h("select", { id: "f-targetDim" }, ...DIMS.map((d) => h("option", { value: d }, d.toUpperCase())));
  dimSelect.value = targetDim;
  const targetInput = h("input", { type: "number", step: "any", min: "0.001", id: "f-targetSize" });
  dimSelect.addEventListener("change", () => {
    targetDim = dimSelect.value as Dim;
    const t = store.get().settings.targetSize;
    // Switching dimension keeps the current size; the new dimension becomes the one edited.
    if (t && info) store.updateSettings({ targetSize: { dim: targetDim, mm: info.size[DIMS.indexOf(targetDim)] } });
    else infoSyncers.forEach((f) => f());
  });
  targetInput.addEventListener("change", () => {
    const v = parseFloat(targetInput.value);
    if (Number.isFinite(v) && v > 0) store.updateSettings({ targetSize: { dim: targetDim, mm: v } });
    else infoSyncers.forEach((f) => f());
  });
  const resetScale = h("button", { type: "button", class: "btn small", onclick: () => store.updateSettings({ scale: 1, targetSize: null }) }, "Reset 100 %");

  infoSyncers.push(() => {
    if (document.activeElement !== scaleInput) scaleInput.value = info ? String(+(info.scale * 100).toFixed(3)) : String(+(store.get().settings.scale * 100).toFixed(3));
    if (document.activeElement !== targetInput) targetInput.value = info ? String(+info.size[DIMS.indexOf(targetDim)].toFixed(3)) : "";
    sizeReadout.textContent = info ? `${info.size.map((v) => v.toFixed(2)).join(" × ")} mm` : "–";
  });

  // axis selector + rotation buttons
  const axisButtons = new Map<Axis, HTMLButtonElement>();
  const axisRow = h("div", { class: "segmented", id: "axis-select", role: "group", "aria-label": "Slicing axis" });
  for (const a of AXES) {
    const b = h("button", { type: "button", "data-axis": a, onclick: () => store.updateSettings({ axis: a }) }, a);
    axisButtons.set(a, b);
    axisRow.append(b);
  }
  syncers.push((s) => axisButtons.forEach((b, a) => b.classList.toggle("active", a === s.axis)));

  const rotRow = h("div", { class: "rotrow" });
  DIMS.forEach((d, i) => {
    rotRow.append(
      h("button", {
        type: "button",
        class: "btn small",
        id: `rot-${d}`,
        title: `Rotate 90° about ${d.toUpperCase()}`,
        onclick: () => {
          const r = [...store.get().settings.rotationSteps] as [number, number, number];
          r[i] = (r[i] + 1) % 4;
          store.updateSettings({ rotationSteps: r });
        },
      }, `${d.toUpperCase()} 90°`),
    );
  });
  rotRow.append(h("button", { type: "button", class: "btn small ghost", id: "rot-reset", onclick: () => store.updateSettings({ rotationSteps: [0, 0, 0] }) }, "Reset"));
  const rotInfo = h("small", { class: "hint", id: "rot-info" });
  syncers.push((s) => (rotInfo.textContent = s.rotationSteps.some((n) => n) ? `Extra rotation: X ${s.rotationSteps[0] * 90}°, Y ${s.rotationSteps[1] * 90}°, Z ${s.rotationSteps[2] * 90}°` : "The selected axis points up; layers are cut perpendicular to it."));

  const modelGroup = group(
    "Model",
    true,
    dropZone,
    fileInfo,
    h("div", { class: "row-label" }, "Size (mm)"),
    sizeReadout,
    selectField("Import unit", "importUnit", [...IMPORT_UNIT_OPTIONS], "importUnit"),
    h("label", { class: "field" }, h("span", { class: "lbl" }, "Scale", infoIcon("scale")), h("span", { class: "ctl" }, scaleInput, h("span", { class: "unit" }, "%"))),
    h("label", { class: "field" }, h("span", { class: "lbl" }, "Target size along one axis", infoIcon("targetSize")), h("span", { class: "ctl" }, dimSelect, targetInput, h("span", { class: "unit" }, "mm"))),
    h("div", { class: "rotrow" }, resetScale, h("small", { class: "hint" }, "Proportions stay locked. Scale is on top of the import unit.")),
    h("div", { class: "row-label" }, "Slicing axis (points up)", infoIcon("axis")),
    axisRow,
    h("div", { class: "row-label" }, "Rotate", infoIcon("rotate")),
    rotRow,
    rotInfo,
  );

  // ---------- other groups (inputs bound to settings; pipeline arrives in later milestones) ----------
  const calibrationStatus = h("small", { class: "hint", id: "calibration-status", role: "status" });
  function downloadCalibration() {
    try {
      const { dowelDiameter, kerf } = store.get().settings;
      const z = buildCalibrationZip({ dowelDiameter, kerf });
      downloadBytes(z.name, "application/zip", z.bytes);
      calibrationStatus.textContent = `Saved ${z.name}: cut it from scrap, see README.txt inside.`;
    } catch (e) {
      calibrationStatus.textContent = `Calibration sheet failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  // ---------- material presets (browser storage, own key; applying one is a single undo step) ----------
  const presets = new PresetStore();
  const presetSel = h("select", { id: "preset-select", title: "Apply a saved set of material values" });
  const presetSave = h("button", { type: "button", class: "btn small", id: "preset-save", title: "Save the material values below under a name" }, "Save…");
  const presetDelete = h("button", { type: "button", class: "btn small", id: "preset-delete" }, "Delete");
  const presetNote = h("small", { class: "hint", id: "preset-note", role: "status" });
  function renderPresets() {
    presetSel.replaceChildren(
      h("option", { value: "" }, "Choose preset…"),
      h("optgroup", { label: "Starting points" }, ...STARTER_PRESETS.map((p) => h("option", { value: p.name }, p.name))),
      ...(presets.list().length ? [h("optgroup", { label: "My presets" }, ...presets.list().map((p) => h("option", { value: p.name }, p.name)))] : []),
    );
    syncPresets(store.get().settings);
  }
  function syncPresets(s: Settings) {
    // keep the selected preset while it still matches (two presets can hold the same values); else prefer my presets over starters
    const cur = presets.find(presetSel.value);
    const m = cur && matchesPreset(s, cur) ? cur : [...presets.list(), ...STARTER_PRESETS].find((p) => matchesPreset(s, p));
    presetSel.value = m ? m.name : "";
    const user = !!m && presets.isUser(m.name);
    presetDelete.disabled = !user;
    presetDelete.title = user ? `Delete the preset "${m!.name}"` : m ? "Starting points cannot be deleted" : "Select one of your presets to delete it";
  }
  syncers.push(syncPresets);
  presetSel.addEventListener("change", () => {
    const p = presets.find(presetSel.value);
    if (!p) return;
    store.updateSettings(applyPreset(store.get().settings, p), "step");
    const starter = !presets.isUser(p.name);
    presetNote.textContent = `Applied "${p.name}"${starter ? ". Starting points: check kerf and thickness with your own material and laser." : "."}`;
  });
  presetSave.addEventListener("click", () => {
    const sel = presets.find(presetSel.value);
    const name = normalizeName(window.prompt("Name for this material preset (the same name replaces that preset):", sel && presets.isUser(sel.name) ? sel.name : "") ?? "");
    if (!name) return;
    if (presets.exists(name) && !window.confirm(`Replace the preset "${name}"?`)) return;
    const err = presets.save(name, presetValuesOf(store.get().settings));
    if (err) {
      presetNote.textContent = err;
      return;
    }
    renderPresets();
    presetNote.textContent = presets.persisted ? `Saved the preset "${name}".` : `Saved the preset "${name}", but the browser would not store it: it is gone when the page closes.`;
  });
  presetDelete.addEventListener("click", () => {
    const name = presetSel.value;
    if (!presets.isUser(name) || !window.confirm(`Delete the preset "${name}"?`)) return;
    presets.delete(name);
    renderPresets();
    presetNote.textContent = `Deleted the preset "${name}".`;
  });

  const materialGroup = group(
    "Material",
    true,
    h("div", { class: "field" }, h("span", { class: "lbl" }, "Preset", infoIcon("presets")), h("span", { class: "ctl" }, presetSel)),
    h("div", { class: "rotrow" }, presetSave, presetDelete),
    presetNote,
    numField("Thickness", "thickness", { step: 0.05, min: 0.1, unit: "mm", hint: "Measure with calipers; nominal 4 mm is often 3.7–3.9 mm.", help: "thickness" }),
    h("div", { class: "grid2" }, numField("Sheet W", "sheetW", { min: 10, unit: "mm", help: "sheetSize" }), numField("Sheet H", "sheetH", { min: 10, unit: "mm" })),
    numField("Kerf", "kerf", { step: 0.01, min: 0, unit: "mm", help: "kerf" }),
    h("div", { class: "grid2" }, numField("Part spacing", "partSpacing", { min: 0, unit: "mm", help: "partSpacing" }), numField("Sheet margin", "sheetMargin", { min: 0, unit: "mm", help: "sheetMargin" })),
    numField("Density", "density", { step: 0.01, min: 0, unit: "g/cm³", hint: "0 = not set. Plywood is about 0.6–0.7. Only used for the weight estimate.", help: "density" }),
    h("div", { class: "grid2" }, numField("Cut speed", "cutSpeed", { min: 0, unit: "mm/s", help: "cutSpeed" }), numField("Engrave speed", "engraveSpeed", { min: 0, unit: "mm/s", help: "engraveSpeed" })),
    numField("Price per sheet", "pricePerSheet", { step: 0.01, min: 0, hint: "Any currency, 0 = not set. Cost = price x sheets used (a partly used sheet counts whole).", help: "pricePerSheet" }),
    h("div", { class: "rotrow" }, h("button", { type: "button", class: "btn small", id: "calibration-download", onclick: downloadCalibration }, "Download calibration sheet"), infoIcon("calibration")),
    calibrationStatus,
  );
  const bridgeGroup = group(
    "Holding bridges",
    false,
    boolField("Add holding bridges", "bridgesEnabled", "bridgesEnabled", "Short uncut tabs keep each part attached to the sheet until you break it out. Separate DXF layer BRIDGE."),
    numField("Bridges per outline", "bridgeCount", { step: 1, min: 1, max: 8, help: "bridgeCount" }),
    numField("Bridge width", "bridgeWidth", { step: 0.1, min: 0.1, unit: "mm", hint: "Material left after the kerf; the cut gap is this plus the kerf.", help: "bridgeWidth" }),
    numField("Min outline length", "bridgeMinLength", { min: 0, unit: "mm", help: "bridgeMinLength" }),
    boolField("Also bridge inner holes", "bridgeHoles", "bridgeHoles"),
    numField("Max spacing (0 = off)", "bridgeMaxSpacing", { min: 0, unit: "mm", help: "bridgeMaxSpacing" }),
  );
  const slicingGroup = group(
    "Slicing",
    false,
    selectField("Outline mode", "mode", [
      ["oversize", "Oversize (sand down)"],
      ["midplane", "Mid-plane"],
      ["undersize", "Undersize"],
    ], "mode"),
    h("small", { class: "hint" }, "Oversize: covers the model in each layer. Mid-plane: closest on average. Undersize: never sticks out."),
    numField("Samples per layer", "samplesPerLayer", { step: 1, min: 1, help: "samplesPerLayer" }),
    boolField("Round height to whole layers", "roundHeightToLayers", "roundHeightToLayers"),
    numField("Smooth outlines (0 = off)", "smoothRadius", { step: 0.1, min: 0, unit: "mm", help: "smoothRadius" }),
    numField("Simplify tolerance", "simplifyTol", { step: 0.01, min: 0, unit: "mm", help: "simplifyTol" }),
    numField("Min part area", "minPartArea", { min: 0, unit: "mm²", help: "minPartArea" }),
    numField("Min feature (0 = off)", "minFeature", { min: 0, unit: "mm", help: "minFeature" }),
  );
  const hollowGroup = group(
    "Hollowing",
    false,
    boolField("Hollow inner layers", "hollowEnabled", "hollowEnabled"),
    numField("Wall", "hollowWall", { min: 0, unit: "mm", help: "hollowWall" }),
    numField("Solid cap layers", "solidCapLayers", { step: 1, min: 0, help: "solidCapLayers" }),
  );
  const gluingGroup = group(
    "Gluing aids",
    false,
    boolField("Engrave next-layer outline", "engraveNextOutline", "engraveNextOutline"),
    boolField("Layer labels", "labels", "labels"),
    numField("Label height", "labelHeight", { min: 3, unit: "mm", hint: "Shrinks to fit (down to 3 mm); placed where the next layer will cover it.", help: "labelHeight" }),
    h("small", { class: "hint", id: "stack-note" }, "Cut face-up, stack bottom-up without flipping, align each part to the engraved line."),
    boolField("Dowel holes", "dowels", "dowels"),
    numField("Dowel diameter", "dowelDiameter", { min: 1, unit: "mm", help: "dowelDiameter" }),
    numField("Dowel count", "dowelCount", { step: 1, min: 1, help: "dowelCount" }),
  );

  const exportSection = createExportSection(store, actions.exportZip);
  const exportGroup = group("Export", false, exportSection.el);

  // ---------- Project (settings, optionally the model, as a .json file) ----------
  const projectStatus = h("small", { class: "hint", id: "project-status", role: "status" });
  const projectInput = h("input", { type: "file", accept: ".json,application/json", id: "project-input", hidden: true });
  projectInput.addEventListener("change", async () => {
    const f = projectInput.files?.[0];
    projectInput.value = "";
    if (!f) return;
    try {
      projectStatus.textContent = await actions.loadProject(await f.text(), f.name);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      projectStatus.textContent = msg;
      store.setStatus(msg, "error"); // the Project group may be collapsed
    }
  });
  const withModelCb = h("input", { type: "checkbox", id: "project-with-model" });
  const withModelLabel = h("label", { class: "field check" }, withModelCb, h("span", { class: "lbl" }, "Include the model in the project file", infoIcon("projectModel")));
  const restoreCb = h("input", { type: "checkbox", id: "restore-session" });
  restoreCb.checked = loadUiPrefs().restoreSession;
  restoreCb.addEventListener("change", () => actions.setRestoreSession(restoreCb.checked));
  const restoreLabel = h("label", { class: "field check" }, restoreCb, h("span", { class: "lbl" }, "Restore the last model when the page opens", infoIcon("restoreSession")));
  function syncProject() {
    const has = !!store.get().model && !!actions.getModelSource();
    withModelCb.disabled = !has;
    if (!has) withModelCb.checked = false;
    withModelLabel.title = has ? "" : "Load a model first";
  }
  store.subscribe((_s, changed) => {
    if (changed.has("model")) syncProject();
  });
  syncProject();
  const projectGroup = group(
    "Project",
    false,
    h("div", { class: "rotrow" },
      h("button", {
        type: "button", class: "btn small", id: "project-save",
        onclick: () => {
          const model = withModelCb.checked ? actions.getModelSource() : null;
          downloadBytes("laser-slicer-project.json", "application/json", new TextEncoder().encode(serializeProject(store.get().settings, model)));
          projectStatus.textContent = model ? `Saved laser-slicer-project.json with the model ${model.name}` : "Saved laser-slicer-project.json";
        },
      }, "Save settings…"),
      h("button", { type: "button", class: "btn small", id: "project-load", onclick: () => projectInput.click() }, "Load settings…"),
      projectInput),
    withModelLabel,
    h("small", { class: "hint" }, "Without the checkbox the file holds the settings only. With it, loading the file brings back the model too. The last settings are also remembered in this browser."),
    restoreLabel,
    projectStatus,
  );

  root.append(
    h("div", { class: "brand" }, h("span", { class: "logo" }, "▤"), h("span", {}, "Laser Slicer")),
    modelGroup,
    materialGroup,
    bridgeGroup,
    slicingGroup,
    hollowGroup,
    gluingGroup,
    exportGroup,
    projectGroup,
  );

  function sync() {
    const s = store.get().settings;
    syncers.forEach((f) => f(s));
    if (s.targetSize) {
      targetDim = s.targetSize.dim;
      dimSelect.value = targetDim;
    }
    infoSyncers.forEach((f) => f());
  }
  store.subscribe((_s, changed) => {
    if (changed.has("settings")) sync();
  });
  renderPresets();
  sync();

  return {
    setInfo(i: OrientInfo | null) {
      info = i;
      infoSyncers.forEach((f) => f());
    },
    setFileInfo(text: string) {
      fileInfo.textContent = text;
    },
    setSummary(text: string, details: string[] = []) {
      exportSection.setSummary(text, details);
    },
    setExportReady(v: boolean) {
      exportSection.setReady(v);
    },
  };
}
