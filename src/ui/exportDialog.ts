// Export section of the panel: formats, per sheet / per layer, summary line and the ZIP download.
import type { Settings } from "../core/types";
import type { Store } from "../state";
import { h } from "./dom";

const FORMATS = ["dxf", "svg", "png", "jpg"] as const;
const RASTER_SOON = "Raster export arrives in milestone M7";

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
    const raster = f === "png" || f === "jpg";
    const cb = h("input", { type: "checkbox", id: `fmt-${f}`, disabled: raster, title: raster ? RASTER_SOON : undefined });
    cb.addEventListener("change", () => {
      const cur = new Set(store.get().settings.formats);
      if (cb.checked) cur.add(f);
      else cur.delete(f);
      store.updateSettings({ formats: FORMATS.filter((x) => cur.has(x)) });
    });
    syncers.push((s) => (cb.checked = !raster && s.formats.includes(f)));
    return h("label", { class: "chip" + (raster ? " disabled" : ""), title: raster ? RASTER_SOON : undefined }, cb, f.toUpperCase());
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
      button.disabled = !ready;
    }
  });
  let ready = false;

  const el = h(
    "div",
    { class: "export-section" },
    h("div", { class: "chips" }, ...chips),
    h("label", { class: "field" }, h("span", { class: "lbl" }, "Files"), h("span", { class: "ctl" }, mode)),
    h("small", { class: "hint" }, "DXF is the file to cut with (R12, mm, layers CUT red, ENGRAVE blue, LABEL green). SVG is a second vector option."),
    h("small", { class: "hint" }, "PNG and JPG (engraving and reference) are not suitable for cutting without tracing."),
    h("small", { class: "hint" }, "Cut every part face-up and stack bottom-up without flipping."),
    summary,
    button,
    status,
  );

  const sync = () => syncers.forEach((f) => f(store.get().settings));
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
      button.disabled = !v;
    },
  };
}
