// ASCII DXF R12 writer (plan "DXF (primary)"). Structure: HEADER, TABLES (LTYPE CONTINUOUS + LAYER),
// ENTITIES, EOF. R12 has no handles. Coordinates in mm, Y up, sheet lower-left = (0, 0).
// Closed outlines are POLYLINE (70 = 1) + VERTEX + SEQEND, open engrave lines the same with 70 = 0, dowel holes CIRCLE.
// Bridged rings: the ring without its gaps is a set of open polylines on CUT, each gap an open polyline on BRIDGE (magenta).
// Labels are polylines, never TEXT entities.
import type { Vec2 } from "../types";
import { filterDrawing, num, polyline, type Drawing, type ExportLayers } from "./common";

export const DXF_LAYERS = [
  { name: "CUT", color: 1 },
  { name: "ENGRAVE", color: 5 },
  { name: "LABEL", color: 3 },
  { name: "BRIDGE", color: 6 },
  { name: "SHEET", color: 8 },
] as const;

export type DxfOptions = {
  /** draw the sheet border on layer SHEET (off by default) */
  sheetBorder?: boolean;
  /** layers to write (default: all but the sheet border). `layers.sheet` wins over `sheetBorder`. Excluded layers stay in the LAYER table, with no entities. */
  layers?: Partial<ExportLayers>;
};

export function writeDxf(src: Drawing, opts: DxfOptions = {}): string {
  const L = { cut: true, engrave: true, label: true, bridge: true, sheet: !!opts.sheetBorder, ...opts.layers };
  const d = filterDrawing(src, L);
  const out: string[] = [];
  const g = (code: number, value: string | number) => out.push(String(code).padStart(3, " "), typeof value === "number" ? num(value) : value);
  const gi = (code: number, value: number) => out.push(String(code).padStart(3, " "), String(value));

  // extents over everything that is drawn
  let minX = 0, minY = 0, maxX = d.width, maxY = d.height;
  if (!L.sheet) {
    minX = minY = Infinity;
    maxX = maxY = -Infinity;
    const grow = (p: Vec2) => {
      minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
    };
    for (const sh of d.cut) for (const r of sh) r.forEach(grow);
    for (const l of d.cutOpen ?? []) l.forEach(grow);
    for (const l of d.bridge ?? []) l.forEach(grow);
    for (const l of d.engrave) l.forEach(grow);
    for (const l of d.label) l.forEach(grow);
    for (const c of d.circles) {
      grow([c.c[0] - c.d / 2, c.c[1] - c.d / 2]);
      grow([c.c[0] + c.d / 2, c.c[1] + c.d / 2]);
    }
    if (minX > maxX) { minX = minY = 0; maxX = maxY = 0; }
  }

  // ---- HEADER ----
  out.push("  0", "SECTION", "  2", "HEADER");
  out.push("  9", "$ACADVER", "  1", "AC1009");
  out.push("  9", "$INSUNITS"); gi(70, 4);
  out.push("  9", "$MEASUREMENT"); gi(70, 1);
  out.push("  9", "$EXTMIN"); g(10, minX); g(20, minY); g(30, 0);
  out.push("  9", "$EXTMAX"); g(10, maxX); g(20, maxY); g(30, 0);
  out.push("  0", "ENDSEC");

  // ---- TABLES ----
  out.push("  0", "SECTION", "  2", "TABLES");
  out.push("  0", "TABLE", "  2", "LTYPE"); gi(70, 1);
  out.push("  0", "LTYPE", "  2", "CONTINUOUS"); gi(70, 0); out.push("  3", "Solid line"); gi(72, 65); gi(73, 0); g(40, 0);
  out.push("  0", "ENDTAB");
  out.push("  0", "TABLE", "  2", "LAYER"); gi(70, DXF_LAYERS.length);
  for (const l of DXF_LAYERS) {
    out.push("  0", "LAYER", "  2", l.name); gi(70, 0); gi(62, l.color); out.push("  6", "CONTINUOUS");
  }
  out.push("  0", "ENDTAB");
  out.push("  0", "ENDSEC");

  // ---- ENTITIES ----
  out.push("  0", "SECTION", "  2", "ENTITIES");
  const poly = (layer: string, pts: Vec2[], closed: boolean) => {
    if (pts.length < 2) return;
    out.push("  0", "POLYLINE", "  8", layer); gi(66, 1); gi(70, closed ? 1 : 0);
    g(10, 0); g(20, 0); g(30, 0);
    for (const [x, y] of pts) {
      out.push("  0", "VERTEX", "  8", layer); g(10, x); g(20, y); g(30, 0);
    }
    out.push("  0", "SEQEND", "  8", layer);
  };
  if (L.sheet)
    poly("SHEET", [[0, 0], [d.width, 0], [d.width, d.height], [0, d.height]], true);
  for (const sh of d.cut) for (const r of sh) poly("CUT", r, true);
  for (const l of d.cutOpen ?? []) poly("CUT", l, false);
  for (const l of d.bridge ?? []) poly("BRIDGE", l, false);
  for (const c of d.circles) {
    out.push("  0", "CIRCLE", "  8", "CUT"); g(10, c.c[0]); g(20, c.c[1]); g(30, 0); g(40, c.d / 2);
  }
  for (const l of d.engrave) {
    const { pts, closed } = polyline(l);
    poly("ENGRAVE", pts, closed);
  }
  for (const l of d.label) {
    const { pts, closed } = polyline(l);
    poly("LABEL", pts, closed);
  }
  out.push("  0", "ENDSEC");
  out.push("  0", "EOF");
  return out.join("\r\n") + "\r\n";
}
