// Export section of the panel: formats, per sheet / per layer, summary line and the ZIP download.
import type { Settings } from "../core/types";
import type { Store } from "../state";
import { h } from "./dom";
import { infoIcon } from "./tooltip";

const FORMATS = ["dxf", "svg", "png", "jpg"] as const;
const DPI_PRESETS = [254, 300, 600, 1000];

/** Save bytes through a Blob and a temporary link (works from file://). */
export function downloadBytes(name: string, mime: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function createExportSection(store: Store, onDownload: () => Promise<void>) {
  const syncers: ((s: Settings) => void)[] = [];

  const chips = FORMATS.map((f) => {
    const cb = h("input", { type: "checkbox", id: `fmt-${f}` });
    cb.addEventListener("change", () => {
      const cur = new Set(store.get().settings.formats);
      if (cb.checked) cur.add(f);
      else cur.delete(f);
      store.updateSettings({ formats: FORMATS.filter((x) => cur.has(x)) });
    });
    syncers.push((s) => (cb.checked = s.formats.includes(f)));
    return h("label", { class: "chip" }, cb, f.toUpperCase());
  });

  // Layers in the files (independent of the legend checkboxes, which only change the view).
  const LAYER_KEYS = [["exportCut", "CUT"], ["exportEngrave", "ENGRAVE"], ["exportLabel", "LABEL"], ["exportBridge", "BRIDGE"], ["exportSheet", "SHEET border"]] as const;
  const layerChips = LAYER_KEYS.map(([key, text]) => {
    const cb = h("input", { type: "checkbox", id: `lay-${key}` });
    cb.addEventListener("change", () => store.updateSettings({ [key]: cb.checked }));
    syncers.push((s) => (cb.checked = s[key]));
    return h("label", { class: "chip" }, cb, text);
  });
  const layerHint = h("small", { class: "hint warn", id: "layer-hint", role: "status" });

  // Raster options (shown only while PNG or JPG is selected).
  const dpiSel = h("select", { id: "f-dpi" }, ...DPI_PRESETS.map((d) => h("option", { value: String(d) }, `${d} DPI`)), h("option", { value: "custom" }, "Custom…"));
  const dpiCustom = h("input", { type: "number", id: "f-dpi-custom", min: 1, max: 4800, step: 1, value: 300 });
  const setDpi = (v: number) => {
    if (Number.isFinite(v) && v >= 1 && v <= 4800) store.updateSettings({ dpi: Math.round(v) });
  };
  let customMode = false; // "Custom…" stays selected even when the typed value equals a preset
  dpiSel.addEventListener("change", () => {
    customMode = dpiSel.value === "custom";
    if (customMode) {
      dpiCustom.hidden = false;
      setDpi(Number(dpiCustom.value));
    } else setDpi(Number(dpiSel.value));
    sync();
  });
  dpiCustom.addEventListener("input", () => setDpi(Number(dpiCustom.value)));
  const styleSel = h("select", { id: "f-rasterStyle" }, h("option", { value: "filled" }, "Filled (black parts)"), h("option", { value: "outline" }, "Outline (1 px lines)"));
  styleSel.addEventListener("change", () => store.updateSettings({ rasterStyle: styleSel.value as Settings["rasterStyle"] }));
  const engraveCb = h("input", { type: "checkbox", id: "f-rasterEngrave" });
  engraveCb.addEventListener("change", () => store.updateSettings({ rasterEngrave: engraveCb.checked }));
  const rasterBox = h(
    "div",
    { class: "raster-options", id: "raster-options" },
    h("label", { class: "field" }, h("span", { class: "lbl" }, "Resolution", infoIcon("dpi")), h("span", { class: "ctl" }, dpiSel, dpiCustom)),
    h("label", { class: "field" }, h("span", { class: "lbl" }, "Image style", infoIcon("rasterStyle")), h("span", { class: "ctl" }, styleSel)),
    h("label", { class: "field check" }, engraveCb, h("span", { class: "lbl" }, "Engrave lines and labels (grey)", infoIcon("rasterEngrave"))),
    h("small", { class: "hint" }, "PNG is better for sharp edges; JPG (quality 95) is smaller. The DPI is stored in the file so it imports at true size."),
    h("small", { class: "hint" }, "Raster images are not suitable for cutting without tracing."),
  );
  syncers.push((s) => {
    rasterBox.hidden = !(s.formats.includes("png") || s.formats.includes("jpg"));
    const preset = !customMode && DPI_PRESETS.includes(s.dpi);
    dpiSel.value = preset ? String(s.dpi) : "custom";
    dpiCustom.hidden = preset;
    if (!preset && document.activeElement !== dpiCustom) dpiCustom.value = String(s.dpi);
    styleSel.value = s.rasterStyle;
    engraveCb.checked = s.rasterEngrave;
  });

  const mode = h("select", { id: "f-perLayerFiles" }, h("option", { value: "sheet" }, "One file per sheet"), h("option", { value: "layer" }, "One file per layer"));
  mode.addEventListener("change", () => store.updateSettings({ perLayerFiles: mode.value === "layer" }));
  syncers.push((s) => (mode.value = s.perLayerFiles ? "layer" : "sheet"));

  const summary = h("div", { class: "summary", id: "summary" }, "Load a model to slice it.");
  const status = h("div", { class: "hint", id: "export-status", role: "status" });
  const button = h("button", { type: "button", class: "btn primary", id: "export-zip", disabled: true }, "Download all (ZIP)");
  button.addEventListener("click", async () => {
    button.disabled = true;
    status.textContent = "Building ZIP…";
    try {
      await onDownload();
      status.textContent = "";
    } catch (e) {
      status.textContent = `Export failed: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      updateButton();
    }
  });
  let ready = false;
  const updateButton = () => {
    const s = store.get().settings;
    const none = !(s.exportCut || s.exportEngrave || s.exportLabel || s.exportBridge || s.exportSheet);
    layerHint.hidden = !none && s.exportCut;
    layerHint.textContent = none ? "No layer selected: choose at least one to download." : "CUT is not included: the files will not cut the parts out.";
    button.disabled = !ready || none;
  };

  const el = h(
    "div",
    { class: "export-section" },
    h("div", { class: "row-label" }, "Formats", infoIcon("formats")),
    h("div", { class: "chips" }, ...chips),
    h("div", { class: "row-label" }, "Layers in the files", infoIcon("exportLayers")),
    h("div", { class: "chips", id: "export-layers" }, ...layerChips),
    layerHint,
    h("label", { class: "field" }, h("span", { class: "lbl" }, "Files", infoIcon("perLayerFiles")), h("span", { class: "ctl" }, mode)),
    h("small", { class: "hint" }, "DXF is the file to cut with (R12, mm, layers CUT red, ENGRAVE blue, LABEL green, BRIDGE magenta). SVG is a second vector option."),
    rasterBox,
    h("small", { class: "hint" }, "Cut every part face-up and stack bottom-up without flipping."),
    summary,
    button,
    status,
  );

  const sync = () => {
    syncers.forEach((f) => f(store.get().settings));
    updateButton();
  };
  store.subscribe((_s, changed) => {
    if (changed.has("settings")) sync();
  });
  sync();

  return {
    el,
    setSummary(text: string) {
      summary.textContent = text;
    },
    /** enable the button when a result exists */
    setReady(v: boolean) {
      ready = v;
      updateButton();
    },
  };
}
