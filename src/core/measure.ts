// Measure tool maths (Layer and Sheets views): snapping to polygon vertices and the distance text. Pure, no DOM.
// All lengths are millimetres: the app has no display-unit setting (the import unit only converts the model file).
import type { Vec2 } from "./types";

export type Measurement = { dx: number; dy: number; dist: number };

/** Distance and the signed differences from `a` to `b` (Y up, as in the files). */
export function measure(a: Vec2, b: Vec2): Measurement {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  return { dx, dy, dist: Math.hypot(dx, dy) };
}

/** Number text for the readout: 2 decimals, no "-0.00". */
function mm(v: number): string {
  const s = v.toFixed(2);
  return s === "-0.00" ? "0.00" : s;
}

/** "12.34 mm (dx 10.00, dy -7.20)" */
export function formatMeasure(m: Measurement): string {
  return `${mm(m.dist)} mm (dx ${mm(m.dx)}, dy ${mm(m.dy)})`;
}

/** The vertex nearest to `p` within `radius` (same unit as the points), or null. Scans every group once. */
export function nearestVertex(p: Vec2, groups: Iterable<readonly Vec2[]>, radius: number): Vec2 | null {
  let best: Vec2 | null = null;
  let bestD = radius * radius;
  for (const g of groups)
    for (const v of g) {
      const dx = v[0] - p[0], dy = v[1] - p[1];
      if (dx > radius || dx < -radius || dy > radius || dy < -radius) continue;
      const d = dx * dx + dy * dy;
      if (d <= bestD) {
        bestD = d;
        best = v;
      }
    }
  return best;
}

/** Snapping radius in world units for a pointer tolerance of `px` screen pixels at `scale` pixels per mm. */
export function snapRadius(px: number, scale: number): number {
  return scale > 0 ? px / scale : 0;
}

/** Number of the sheet a Sheets-view x coordinate belongs to (sheets of width `w` are `gap` apart). */
export function sheetAtX(x: number, w: number, gap: number): number {
  return Math.max(0, Math.floor(x / (w + gap)));
}
