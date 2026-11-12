// Parameter panel: collapsible groups of inputs bound to Settings in the store.
import type { Axis, Dim, Settings } from "../core/types";
import type { Store } from "../state";
import { h } from "./dom";

export type OrientInfo = { size: [number, number, number]; scale: number };

export type PanelActions = { openFile(file: File): void };

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
  function numField(label: string, key: NumKey, opts: { step?: number; min?: number; unit?: string; hint?: string } = {}) {
    const input = h("input", { type: "number", step: opts.step ?? "any", min: opts.min, id: `f-${key}` });
    input.addEventListener("change", () => {
      const v = parseFloat(input.value);
      if (Number.isFinite(v) && (opts.min === undefined || v >= opts.min)) store.updateSettings({ [key]: v } as Partial<Settings>);
      else input.value = String(store.get().settings[key]);
    });
    syncers.push((s) => {
      if (document.activeElement !== input) input.value = String(s[key]);
    });
    return h("label", { class: "field" }, h("span", { class: "lbl" }, label), h("span", { class: "ctl" }, input, opts.unit ? h("span", { class: "unit" }, opts.unit) : null), opts.hint ? h("small", { class: "hint" }, opts.hint) : null);
  }

  function boolField(label: string, key: BoolKey, hint?: string) {
    const input = h("input", { type: "checkbox", id: `f-${key}` });
    input.addEventListener("change", () => store.updateSettings({ [key]: input.checked } as Partial<Settings>));
    syncers.push((s) => (input.checked = s[key]));
    return h("label", { class: "field check" }, input, h("span", { class: "lbl" }, label), hint ? h("small", { class: "hint" }, hint) : null);
  }

  function selectField<K extends "mode" | "dpi" | "rasterStyle">(label: string, key: K, options: [string, string][]) {
    const sel = h("select", { id: `f-${key}` }, ...options.map(([v, t]) => h("option", { value: v }, t)));
    sel.addEventListener("change", () => {
      const raw = sel.value;
      store.updateSettings({ [key]: key === "dpi" ? Number(raw) : raw } as Partial<Settings>);
    });
    syncers.push((s) => (sel.value = String(s[key])));
    return h("label", { class: "field" }, h("span", { class: "lbl" }, label), h("span", { class: "ctl" }, sel));
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
    h("label", { class: "field" }, h("span", { class: "lbl" }, "Scale"), h("span", { class: "ctl" }, scaleInput, h("span", { class: "unit" }, "%"))),
    h("label", { class: "field" }, h("span", { class: "lbl" }, "Target size along one axis"), h("span", { class: "ctl" }, dimSelect, targetInput, h("span", { class: "unit" }, "mm"))),
    h("div", { class: "rotrow" }, resetScale, h("small", { class: "hint" }, "Proportions stay locked. STL has no units; mm assumed.")),
    h("div", { class: "row-label" }, "Slicing axis (points up)"),
    axisRow,
    h("div", { class: "row-label" }, "Rotate"),
    rotRow,
    rotInfo,
  );

  // ---------- other groups (inputs bound to settings; pipeline arrives in later milestones) ----------
  const materialGroup = group(
    "Material",
    true,
    numField("Thickness", "thickness", { step: 0.05, min: 0.1, unit: "mm", hint: "Measure with calipers; nominal 4 mm is often 3.7–3.9 mm." }),
    h("div", { class: "grid2" }, numField("Sheet W", "sheetW", { min: 10, unit: "mm" }), numField("Sheet H", "sheetH", { min: 10, unit: "mm" })),
    numField("Kerf", "kerf", { step: 0.01, min: 0, unit: "mm" }),
    h("div", { class: "grid2" }, numField("Part spacing", "partSpacing", { min: 0, unit: "mm" }), numField("Sheet margin", "sheetMargin", { min: 0, unit: "mm" })),
  );
  const slicingGroup = group(
    "Slicing",
    false,
    selectField("Outline mode", "mode", [
      ["oversize", "Oversize (sand down)"],
      ["midplane", "Mid-plane"],
      ["undersize", "Undersize"],
    ]),
    h("small", { class: "hint" }, "Oversize: covers the model in each layer. Mid-plane: closest on average. Undersize: never sticks out."),
    numField("Samples per layer", "samplesPerLayer", { step: 1, min: 1 }),
    boolField("Round height to whole layers", "roundHeightToLayers"),
    numField("Simplify tolerance", "simplifyTol", { step: 0.01, min: 0, unit: "mm" }),
    numField("Min part area", "minPartArea", { min: 0, unit: "mm²" }),
    numField("Min feature (0 = off)", "minFeature", { min: 0, unit: "mm" }),
  );
  const hollowGroup = group(
    "Hollowing",
    false,
    boolField("Hollow inner layers", "hollowEnabled"),
    numField("Wall", "hollowWall", { min: 0, unit: "mm" }),
    numField("Solid cap layers", "solidCapLayers", { step: 1, min: 0 }),
  );
  const gluingGroup = group(
    "Gluing aids",
    false,
    boolField("Engrave next-layer outline", "engraveNextOutline"),
    boolField("Layer labels", "labels"),
    numField("Label height", "labelHeight", { min: 3, unit: "mm" }),
    boolField("Dowel holes", "dowels"),
    numField("Dowel diameter", "dowelDiameter", { min: 1, unit: "mm" }),
    numField("Dowel count", "dowelCount", { step: 1, min: 1 }),
  );

  const formatBoxes = (["dxf", "svg", "png", "jpg"] as const).map((f) => {
    const cb = h("input", { type: "checkbox", id: `fmt-${f}` });
    cb.addEventListener("change", () => {
      const cur = new Set(store.get().settings.formats);
      if (cb.checked) cur.add(f);
      else cur.delete(f);
      store.updateSettings({ formats: (["dxf", "svg", "png", "jpg"] as const).filter((x) => cur.has(x)) });
    });
    syncers.push((s) => (cb.checked = s.formats.includes(f)));
    return h("label", { class: "chip" }, cb, f.toUpperCase());
  });
  const summary = h("div", { class: "summary", id: "summary" }, "Load a model to slice it.");
  const exportGroup = group(
    "Export",
    false,
    h("div", { class: "chips" }, ...formatBoxes),
    selectField("DPI", "dpi", [["254", "254"], ["300", "300"], ["600", "600"], ["1000", "1000"]]),
    selectField("Raster style", "rasterStyle", [["filled", "Filled"], ["outline", "Outline"]]),
    boolField("One file per layer", "perLayerFiles"),
    summary,
    h("button", { type: "button", class: "btn primary", disabled: true }, "Download all (ZIP)"),
  );

  root.append(
    h("div", { class: "brand" }, h("span", { class: "logo" }, "▤"), h("span", {}, "Laser Slicer")),
    modelGroup,
    materialGroup,
    slicingGroup,
    hollowGroup,
    gluingGroup,
    exportGroup,
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
  sync();

  return {
    setInfo(i: OrientInfo | null) {
      info = i;
      infoSyncers.forEach((f) => f());
    },
    setFileInfo(text: string) {
      fileInfo.textContent = text;
    },
    setSummary(text: string) {
      summary.textContent = text;
    },
  };
}
