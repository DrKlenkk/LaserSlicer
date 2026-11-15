// SVG writer (plan "SVG"): 1 user unit = 1 mm, Y flipped (y_svg = height - y), groups CUT / ENGRAVE / LABEL / BRIDGE (+ CUT_INNER when inner cuts have their own layer).
// Every ring is its own stroke-only path (no evenodd subpaths, so inner rings can come first and can move to CUT_INNER).
// Group and path order is the cutting order (export/order.ts, same as the DXF): ENGRAVE, LABEL, inner cuts (holes, dowel circles; with CUT_INNER these are in that
// group), outer outlines, BRIDGE, then the SHEET border. Paths inside a group follow a nearest-neighbour path from the sheet origin.
import type { Vec2 } from "../types";
import { filterDrawing, num, type Drawing, type ExportLayers } from "./common";
import { cuttingSequence, type Entity } from "./order";

export const SVG_COLORS = { CUT: "#ff0000", ENGRAVE: "#0000ff", LABEL: "#00a000", BRIDGE: "#d000d0", SHEET: "#808080", CUT_INNER: "#ff8000" } as const;

/** Excluded layers get no group at all; the SHEET border (a rectangle) is only written when `layers.sheet` is set. */
export function writeSvg(src: Drawing, layers: Partial<ExportLayers> = {}): string {
  const L = { cut: true, engrave: true, label: true, bridge: true, sheet: false, innerLayer: false, ...layers };
  const d = filterDrawing(src, L);
  const pt = (p: Vec2) => `${num(p[0])} ${num(d.height - p[1])}`;
  const sub = (pts: Vec2[], closed: boolean) =>
    pts.length < 2 ? "" : `M${pts.map(pt).join(" L")}${closed ? " Z" : ""}`;
  const w = num(d.width), h = num(d.height);
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">`);
  const group = (id: keyof typeof SVG_COLORS, body: string[]) =>
    out.push(`<g id="${id}" stroke="${SVG_COLORS[id]}" fill="none" stroke-width="0.1">`, ...body, "</g>");

  const seq = cuttingSequence(d);
  const paths = (ents: Entity[]) =>
    ents.map((e) => (e.k === "circle" ? `<circle cx="${num(e.c[0])}" cy="${num(d.height - e.c[1])}" r="${num(e.d / 2)}"/>` : `<path d="${sub(e.pts, e.k === "closed")}"/>`));
  if (L.engrave) group("ENGRAVE", paths(seq.engrave));
  if (L.label) group("LABEL", paths(seq.label));
  if (L.cut) {
    if (L.innerLayer) {
      if (seq.inner.length) group("CUT_INNER", paths(seq.inner));
      group("CUT", paths(seq.outer));
    } else group("CUT", [...paths(seq.inner), ...paths(seq.outer)]);
  }
  if (L.bridge && seq.bridge.length) group("BRIDGE", paths(seq.bridge));
  if (L.sheet) group("SHEET", [`<rect x="0" y="0" width="${w}" height="${h}"/>`]);
  out.push("</svg>");
  return out.join("\n") + "\n";
}
