// Colour legend for the trace colours of the Sheets and Layer tabs. A small collapsible box in a corner of the view.
// Names are the DXF layers, so the colours can be assigned to cut / engrave in LightBurn and similar software.
import { h } from "./dom";

export type LegendItem = { layer: string; text: string; color: () => string; dash?: boolean; fill?: boolean; thin?: boolean };

const KEY = "laserslicer.legend.collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(v: boolean) {
  try {
    localStorage.setItem(KEY, v ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/**
 * `items` give their colour lazily (the Sheets tab uses fixed light/dark colours, the Layer tab CSS variables).
 * Call `refresh()` after a theme change. The collapsed state is shared by all legends.
 */
export function createLegend(id: string, items: LegendItem[], note: string, extra: HTMLElement[] = []) {
  const swatches: [HTMLElement, LegendItem][] = [];
  const rows = items.map((it) => {
    const sw = h("span", { class: `lg-swatch${it.dash ? " dash" : ""}${it.fill ? " fill" : ""}${it.thin ? " thin" : ""}`, "aria-hidden": "true" });
    swatches.push([sw, it]);
    return h("li", {}, sw, h("span", { class: "lg-name" }, it.layer), h("span", { class: "lg-text" }, it.text));
  });
  const toggle = h("button", { type: "button", class: "lg-head", "aria-expanded": "true", title: "Show or hide the legend" }, "Legend");
  const body = h("div", { class: "lg-body" }, h("ul", {}, ...rows), ...extra, h("p", { class: "lg-note" }, note));
  const el = h("div", { class: "legend", id }, toggle, body);
  const apply = (collapsed: boolean) => {
    body.hidden = collapsed;
    el.classList.toggle("collapsed", collapsed);
    toggle.setAttribute("aria-expanded", String(!collapsed));
  };
  apply(readCollapsed());
  toggle.addEventListener("click", () => {
    const c = !body.hidden;
    apply(c);
    writeCollapsed(c);
    document.querySelectorAll(".legend").forEach((o) => o !== el && o.dispatchEvent(new CustomEvent("lg-sync", { detail: c })));
  });
  el.addEventListener("lg-sync", (e) => apply((e as CustomEvent<boolean>).detail));
  // pointer events on the legend must not pan the canvas underneath
  for (const t of ["pointerdown", "wheel", "dblclick"]) el.addEventListener(t, (e) => e.stopPropagation());
  const refresh = () => swatches.forEach(([sw, it]) => sw.style.setProperty("--c", it.color()));
  refresh();
  return { el, refresh };
}
