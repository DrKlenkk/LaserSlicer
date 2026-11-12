// Shared by the vector writers: a flat drawing (sheet or single layer) in mm, Y up, origin lower-left.
import type { Part, Ring, Vec2 } from "../types";
import { applyPlacement } from "../nest";
import type { Placement } from "../types";

export type Drawing = {
  width: number;
  height: number;
  /** one entry per cut shape: [outer, ...holes] (closed rings, last point != first) */
  cut: Ring[][];
  /** dowel holes (cut layer) */
  circles: { c: Vec2; d: number }[];
  engrave: Vec2[][];
  label: Vec2[][];
};

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
  const d: Drawing = { width, height, cut: [], circles: [], engrave: [], label: [] };
  for (const p of parts) {
    d.cut.push([p.cut.outer, ...p.cut.holes]);
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
