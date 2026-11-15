// Measure tool maths (Layer and Sheets views): snapping (corners, circle centres, edge midpoints, nearest edge point),
// circle detection, axis constraint and the readout texts. Pure, no DOM.
// All lengths are millimetres: the app has no display-unit setting (the import unit only converts the model file).
import type { Vec2 } from "./types";

export type Measurement = { dx: number; dy: number; dist: number };
export type Circle = { c: Vec2; r: number };
export type SnapType = "corner" | "centre" | "midpoint" | "edge";
/** A snap target: the point, its kind, and the circle when the target belongs to a (near-)circular ring. */
export type Snap = { p: Vec2; type: SnapType; circle?: Circle };

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

/** Angle of the vector in degrees, Y up, counter-clockwise from +X, in (-180, 180]. */
export function angleDeg(m: Measurement): number {
  if (m.dx === 0 && m.dy === 0) return 0;
  const a = (Math.atan2(m.dy, m.dx) * 180) / Math.PI;
  return a === -180 ? 180 : a;
}

function deg(m: Measurement): string {
  const s = angleDeg(m).toFixed(1);
  return `${s === "-0.0" ? "0.0" : s}\u00b0`;
}

/** "12.34 mm (dx 10.00, dy -7.20, 35.8\u00b0)" */
export function formatMeasure(m: Measurement): string {
  return `${mm(m.dist)} mm (dx ${mm(m.dx)}, dy ${mm(m.dy)}, ${deg(m)})`;
}

/** Second line of the on-canvas label: "dx 10.00  dy -7.20  35.8\u00b0". */
export function formatDelta(m: Measurement): string {
  return `dx ${mm(m.dx)}  dy ${mm(m.dy)}  ${deg(m)}`;
}

/** "\u00d8 6.00 mm" */
export function formatDiameter(c: Circle): string {
  return `\u00d8 ${mm(c.r * 2)} mm`;
}

/** Constrains `p` to the horizontal or vertical line through `a`, whichever is closer to the pointer. */
export function constrainAxis(a: Vec2, p: Vec2): Vec2 {
  return Math.abs(p[0] - a[0]) >= Math.abs(p[1] - a[1]) ? [p[0], a[1]] : [a[0], p[1]];
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

/** Number of the sheet a Sheets-view x coordinate belongs to; `origins` are the left edges of the sheets (the gap belongs to the sheet on its left). */
export function sheetAtX(x: number, origins: readonly number[]): number {
  let n = 0;
  for (let i = 0; i < origins.length; i++) if (x >= origins[i]) n = i;
  return n;
}

/** Smallest vertex count for a ring to count as a circle (a coarse polygon is a polygon: the user wants its corners). */
export const MIN_CIRCLE_VERTICES = 16;

/**
 * Circle through the vertices of `ring` (least-squares fit) if the ring is approximately circular: at least 16 vertices,
 * all within 2 % of the radius (+ 0.01 mm) of the fitted circle, and no angular gap of 60 degrees or more between
 * neighbouring vertices (so a D shape or a rounded slot is not a circle). Otherwise null.
 */
export function fitCircle(ring: readonly Vec2[]): Circle | null {
  const n = ring.length;
  if (n < MIN_CIRCLE_VERTICES) return null;
  let mx = 0, my = 0;
  for (const [x, y] of ring) { mx += x; my += y; }
  mx /= n; my /= n;
  // Kasa fit on coordinates centred at the mean: minimise sum (u^2 + v^2 + D u + E v + F)^2.
  let suu = 0, suv = 0, svv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const [x, y] of ring) {
    const u = x - mx, v = y - my;
    suu += u * u; suv += u * v; svv += v * v;
    suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (!(Math.abs(det) > 1e-12)) return null;
  const b1 = 0.5 * (suuu + suvv), b2 = 0.5 * (svvv + svuu);
  const uc = (b1 * svv - b2 * suv) / det, vc = (suu * b2 - suv * b1) / det;
  const cx = mx + uc, cy = my + vc;
  let r = 0;
  const radii: number[] = [];
  const angles: number[] = [];
  for (const [x, y] of ring) {
    const d = Math.hypot(x - cx, y - cy);
    radii.push(d);
    r += d;
    angles.push(Math.atan2(y - cy, x - cx));
  }
  r /= n;
  if (!(r > 0)) return null;
  const tol = 0.02 * r + 0.01;
  for (const d of radii) if (Math.abs(d - r) > tol) return null;
  angles.sort((a, b) => a - b);
  let gap = angles[0] + 2 * Math.PI - angles[n - 1];
  for (let i = 1; i < n; i++) gap = Math.max(gap, angles[i] - angles[i - 1]);
  if (gap >= Math.PI / 3) return null;
  return { c: [cx, cy], r };
}

type RingInfo = { minX: number; minY: number; maxX: number; maxY: number; circle: Circle | null };
const ringCache = new WeakMap<readonly Vec2[], RingInfo>();

function ringInfo(ring: readonly Vec2[]): RingInfo {
  let i = ringCache.get(ring);
  if (!i) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    i = { minX, minY, maxX, maxY, circle: fitCircle(ring) };
    ringCache.set(ring, i);
  }
  return i;
}

/** Cached `fitCircle` (rings are treated as immutable). */
export function ringCircle(ring: readonly Vec2[]): Circle | null {
  return ringInfo(ring).circle;
}

/** Nearest point to `p` on the segment `a`-`b`. */
export function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const ex = b[0] - a[0], ey = b[1] - a[1];
  const l2 = ex * ex + ey * ey;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / l2)) : 0;
  return [a[0] + t * ex, a[1] + t * ey];
}

/**
 * The snap target for the pointer `p` within `radius`, in priority order: corner (vertex), centre of a circular ring or of a
 * listed circle (`circles`: analytic circles such as dowel holes), edge midpoint, nearest point on an edge. Within one kind
 * the nearest wins. The vertices and midpoints of circular rings are not offered (a 64-gon has no corners worth measuring),
 * their edges and centre are. Rings are closed implicitly.
 */
export function findSnap(p: Vec2, rings: Iterable<readonly Vec2[]>, radius: number, circles: readonly Circle[] = []): Snap | null {
  if (!(radius > 0)) return null;
  const r2 = radius * radius;
  let corner: Snap | null = null, cornerD = r2;
  let centre: Snap | null = null, centreD = r2;
  let mid: Snap | null = null, midD = r2;
  let edge: Snap | null = null, edgeD = r2;
  const d2 = (q: Vec2) => (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
  const tryCentre = (c: Circle) => {
    const d = d2(c.c);
    if (d <= centreD) { centreD = d; centre = { p: c.c, type: "centre", circle: c }; }
  };
  const tryEdge = (q: Vec2, circle?: Circle) => {
    const d = d2(q);
    if (d <= edgeD) { edgeD = d; edge = { p: q, type: "edge", circle }; }
  };
  for (const c of circles) {
    const dc = Math.hypot(p[0] - c.c[0], p[1] - c.c[1]);
    tryCentre(c);
    if (Math.abs(dc - c.r) <= radius && dc > 0) tryEdge([c.c[0] + ((p[0] - c.c[0]) * c.r) / dc, c.c[1] + ((p[1] - c.c[1]) * c.r) / dc], c);
  }
  for (const ring of rings) {
    const n = ring.length;
    if (n === 0) continue;
    const info = ringInfo(ring);
    if (p[0] < info.minX - radius || p[0] > info.maxX + radius || p[1] < info.minY - radius || p[1] > info.maxY + radius) continue;
    const circle = info.circle;
    if (circle) tryCentre(circle);
    for (let i = 0; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n];
      if (!circle) {
        const d = d2(a);
        if (d <= cornerD) { cornerD = d; corner = { p: a, type: "corner" }; }
        const m: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const dm = d2(m);
        if (dm <= midD) { midD = dm; mid = { p: m, type: "midpoint" }; }
      }
      if (n < 2 || Math.min(a[0], b[0]) - radius > p[0] || Math.max(a[0], b[0]) + radius < p[0] || Math.min(a[1], b[1]) - radius > p[1] || Math.max(a[1], b[1]) + radius < p[1]) continue;
      tryEdge(closestOnSegment(p, a, b), circle ?? undefined);
    }
  }
  return corner ?? centre ?? mid ?? edge;
}
