// Shared by the vector writers: a flat drawing (sheet or single layer) in mm, Y up, origin lower-left.
import type { Part, Ring, Vec2 } from "../types";
import { applyPlacement } from "../nest";
import { cutPaths } from "../bridges";
import type { Placement } from "../types";

export type Drawing = {
  width: number;
  height: number;
  /** one entry per cut shape: [outer, ...holes] (closed rings, last point != first); rings that carry bridges are not in here but in `cutOpen` */
  cut: Ring[][];
  /** the complete closed shapes, bridged or not (for filled images); defaults to `cut` */
  fill?: Ring[][];
  /** open cut polylines of bridged rings (ring without its gaps), drawn on CUT */
  cutOpen?: Vec2[][];
  /** the gaps of bridged rings, drawn on BRIDGE (or left empty if that layer is not exported) */
  bridge?: Vec2[][];
  /** dowel holes (cut layer) */
  circles: { c: Vec2; d: number }[];
  engrave: Vec2[][];
  label: Vec2[][];
};

/** Which traces go into an exported file (the SHEET border is off by default). */
export type ExportLayers = { cut: boolean; engrave: boolean; label: boolean; bridge: boolean; sheet: boolean };
export const DEFAULT_EXPORT_LAYERS: ExportLayers = { cut: true, engrave: true, label: true, bridge: true, sheet: false };

/** The export layer flags of a settings object (missing flags take their defaults). */
export function exportLayersOf(s: { exportCut?: boolean; exportEngrave?: boolean; exportLabel?: boolean; exportBridge?: boolean; exportSheet?: boolean }): ExportLayers {
  return {
    cut: s.exportCut ?? DEFAULT_EXPORT_LAYERS.cut,
    engrave: s.exportEngrave ?? DEFAULT_EXPORT_LAYERS.engrave,
    label: s.exportLabel ?? DEFAULT_EXPORT_LAYERS.label,
    bridge: s.exportBridge ?? DEFAULT_EXPORT_LAYERS.bridge,
    sheet: s.exportSheet ?? DEFAULT_EXPORT_LAYERS.sheet,
  };
}

/** Copy of the drawing without the excluded layers (dowel holes belong to CUT). The sheet border is not part of a drawing. */
export function filterDrawing(d: Drawing, l: Pick<ExportLayers, "cut" | "engrave" | "label"> & Partial<Pick<ExportLayers, "bridge">>): Drawing {
  // Without BRIDGE the gaps are simply not drawn: the open CUT polylines stay open, which leaves uncut tabs.
  return {
    ...d,
    cut: l.cut ? d.cut : [],
    cutOpen: l.cut ? d.cutOpen : [],
    circles: l.cut ? d.circles : [],
    engrave: l.engrave ? d.engrave : [],
    label: l.label ? d.label : [],
    bridge: l.bridge ?? true ? d.bridge : [],
  };
}

/** A polyline is closed when its first and last point coincide (the repeated point is dropped). */
export function polyline(line: Vec2[]): { pts: Vec2[]; closed: boolean } {
  const n = line.length;
  if (n > 2 && line[0][0] === line[n - 1][0] && line[0][1] === line[n - 1][1]) return { pts: line.slice(0, n - 1), closed: true };
  return { pts: line, closed: false };
}

/** Number text for files: at most 4 decimals (0.1 micrometre), no exponent, always with a decimal point. */
export function num(n: number): string {
  let s = (Math.round(n * 1e4) / 1e4).toFixed(4);
  s = s.replace(/0+$/, "");
  if (s.endsWith(".")) s += "0";
  return s === "-0.0" ? "0.0" : s;
}

/** Parts already positioned in sheet coordinates -> drawing. */
export function drawingOf(parts: Part[], width: number, height: number): Drawing {
  const d: Drawing = { width, height, cut: [], fill: [], cutOpen: [], bridge: [], circles: [], engrave: [], label: [] };
  for (const p of parts) {
    const { closed, open, gaps } = cutPaths(p);
    d.fill!.push([p.cut.outer, ...p.cut.holes]);
    if (closed.length) d.cut.push(closed);
    d.cutOpen!.push(...open);
    d.bridge!.push(...gaps);
    d.circles.push(...p.holes);
    d.engrave.push(...p.engrave);
    d.label.push(...p.label);
  }
  return d;
}

/** Drawing of one sheet: every part placed with its placement. */
export function sheetDrawing(parts: Part[], placements: Placement[], sheetIndex: number, w: number, h: number): Drawing {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const placed: Part[] = [];
  for (const pl of placements) {
    if (pl.sheet !== sheetIndex) continue;
    const part = byId.get(pl.partId);
    if (part) placed.push(applyPlacement(part, pl));
  }
  return drawingOf(placed, w, h);
}

/** Drawing of the parts of one layer in model coordinates, moved so the lower-left corner is (0, 0). */
export function layerDrawing(parts: Part[]): Drawing {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of parts)
    for (const [x, y] of p.cut.outer) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  if (minX > maxX) return drawingOf([], 0, 0);
  const moved = parts.map((p) => applyPlacement(p, { x: -minX, y: -minY, angleDeg: 0 }));
  return drawingOf(moved, maxX - minX, maxY - minY);
}
