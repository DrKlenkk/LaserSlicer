// SVG writer (plan "SVG"): 1 user unit = 1 mm, Y flipped (y_svg = height - y), groups CUT / ENGRAVE / LABEL / BRIDGE (+ CUT_INNER when inner cuts have their own layer).
// Every ring is its own stroke-only path (no evenodd subpaths, so inner rings can come first and can move to CUT_INNER). Order: inner rings, dowel circles, outer outlines;
// with CUT_INNER the first two are in that group, which comes first in the file.
import type { Vec2 } from "../types";
import { filterDrawing, num, polyline, splitCut, type Drawing, type ExportLayers } from "./common";

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

  // Inner rings and dowel circles first, then the outer outlines (the order a cutter that follows the file will use).
  const cut = splitCut(d);
  const inner = [
    ...cut.innerClosed.map((r) => `<path d="${sub(r, true)}"/>`),
    ...cut.innerOpen.map((l) => `<path d="${sub(l, false)}"/>`),
    ...d.circles.map((c) => `<circle cx="${num(c.c[0])}" cy="${num(d.height - c.c[1])}" r="${num(c.d / 2)}"/>`),
  ];
  const outer = [
    ...cut.outerClosed.map((r) => `<path d="${sub(r, true)}"/>`),
    ...cut.outerOpen.map((l) => `<path d="${sub(l, false)}"/>`),
  ];
  if (L.cut) {
    if (L.innerLayer) {
      if (inner.length) group("CUT_INNER", inner);
      group("CUT", outer);
    } else group("CUT", [...inner, ...outer]);
  }

  const lines = (ls: Vec2[][]) =>
    ls.map((l) => {
      const { pts, closed } = polyline(l);
      return `<path d="${sub(pts, closed)}"/>`;
    });
  if (L.engrave) group("ENGRAVE", lines(d.engrave));
  if (L.label) group("LABEL", lines(d.label));
  if (L.bridge && (d.bridge ?? []).length) group("BRIDGE", lines(d.bridge ?? []));
  if (L.sheet) group("SHEET", [`<rect x="0" y="0" width="${w}" height="${h}"/>`]);
  out.push("</svg>");
  return out.join("\n") + "\n";
}
