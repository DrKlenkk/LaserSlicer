// The ONLY module that talks to clipper2-js. Everything outside works in mm with the Shape/Ring
// types; here mm are converted to integer micrometres (SCALE = 1000) and back.
import { Clipper, Clipper64, ClipperOffset, ClipType, EndType, FillRule, JoinType, PathType } from "clipper2-js";
import type { Path64, Paths64 } from "clipper2-js";
import type { Ring, Shape, Vec2 } from "./types";

// clipper2-js 1.2.4 bug: ClipperOffset.offsetPolygon always passes the LAST vertex as the "previous"
// one (the C# original passes `ref k` and advances it, the port's `k = j` is a no-op on a local).
// Every offset of a polygon with more than 3 corners comes out mangled. Replace the method with a
// version that advances k. Documented in DECISIONS.md; covered by test/poly.test.ts.
type OffsetInternals = {
  offsetPoint(group: unknown, path: Path64, j: number, k: number): void;
  _groupDelta: number;
};
(ClipperOffset.prototype as unknown as Record<string, unknown>).offsetPolygon = function (
  this: OffsetInternals,
  group: { outPath: Path64; outPaths: Path64[] },
  path: Path64,
) {
  const area = Clipper.area(path);
  if (area < 0 !== this._groupDelta < 0) {
    const rect = Clipper.getBounds(path);
    const offsetMinDim = Math.abs(this._groupDelta) * 2;
    if (offsetMinDim > rect.width || offsetMinDim > rect.height) return; // collapses entirely
  }
  group.outPath = [];
  const cnt = path.length;
  for (let i = 0, k = cnt - 1; i < cnt; k = i, i++) this.offsetPoint(group, path, i, k);
  group.outPaths.push(group.outPath);
};

/** 1 integer unit = 1 micrometre. */
export const SCALE = 1000;

// ---------- area helpers (mm) ----------

/** Signed shoelace area, positive for counter-clockwise rings. */
export function ringArea(r: Ring): number {
  let a = 0;
  for (let i = 0, n = r.length; i < n; i++) {
    const p = r[i], q = r[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Area of a shape: outer minus holes (rings may have either orientation). */
export function shapeArea(s: Shape): number {
  let a = Math.abs(ringArea(s.outer));
  for (const h of s.holes) a -= Math.abs(ringArea(h));
  return a;
}

export function shapesArea(shapes: Shape[]): number {
  let a = 0;
  for (const s of shapes) a += shapeArea(s);
  return a;
}

// ---------- conversion ----------

function toPath(r: Ring): Path64 {
  const p: Path64 = [];
  for (const [x, y] of r) p.push({ x: Math.round(x * SCALE), y: Math.round(y * SCALE) });
  return p;
}

function toPaths(rings: Ring[]): Paths64 {
  return rings.map(toPath);
}

/** Shape outer/hole rings as paths, with explicit orientation (outer CCW, holes CW). */
function shapesToPaths(shapes: Shape[]): Paths64 {
  const out: Paths64 = [];
  for (const s of shapes) {
    out.push(toPath(orient(s.outer, true)));
    for (const h of s.holes) out.push(toPath(orient(h, false)));
  }
  return out;
}

function fromPath(p: Path64): Ring {
  const r: Ring = [];
  for (const { x, y } of p) {
    const last = r[r.length - 1];
    if (last && last[0] * SCALE === x && last[1] * SCALE === y) continue; // drop repeated points
    r.push([x / SCALE, y / SCALE]);
  }
  const f = r[0], l = r[r.length - 1];
  if (r.length > 1 && f[0] === l[0] && f[1] === l[1]) r.pop();
  return r;
}

function orient(r: Ring, ccw: boolean): Ring {
  return ringArea(r) > 0 === ccw ? r : r.slice().reverse();
}

/** Even-odd ray casting; the result for points exactly on the boundary is arbitrary. */
function pointInRing(pt: Vec2, ring: Ring): boolean {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Build the outer/hole nesting from a flat Clipper solution. (clipper2-js 1.2.4's PolyTree path is
 * broken: OutRec.bounds is never initialised and executePolyTree silently returns nothing, see
 * DECISIONS.md. Clipper's flat output is non-overlapping with outers positive and holes negative,
 * which is all the nesting needs.) Each hole belongs to the smallest outer that contains it;
 * an outer inside a hole simply starts its own shape.
 */
function pathsToShapes(paths: Paths64): Shape[] {
  type Item = { path: Path64; ring: Ring; area: number; minX: number; minY: number; maxX: number; maxY: number };
  const items: Item[] = [];
  for (const path of paths) {
    if (path.length < 3) continue;
    const ring = fromPath(path);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    items.push({ path, ring, area: ringArea(ring), minX, minY, maxX, maxY });
  }
  const outers = items.filter((i) => i.area > 0).sort((a, b) => a.area - b.area); // smallest first
  const shapes = new Map<Item, Shape>();
  for (const o of outers) shapes.set(o, { outer: o.ring, holes: [] });
  for (const h of items) {
    if (h.area >= 0) continue;
    // A hole can touch its outer at a vertex, so classify by majority vote of several hole vertices.
    const step = Math.max(1, Math.floor(h.ring.length / 8));
    for (const o of outers) {
      if (o.minX > h.minX || o.minY > h.minY || o.maxX < h.maxX || o.maxY < h.maxY) continue;
      let inside = 0, total = 0;
      for (let i = 0; i < h.ring.length; i += step, total++) if (pointInRing(h.ring[i], o.ring)) inside++;
      if (inside * 2 > total) {
        shapes.get(o)!.holes.push(h.ring);
        break;
      }
    }
  }
  return outers.map((o) => shapes.get(o)!);
}

function boolean(clipType: ClipType, fill: FillRule, subject: Paths64, clip: Paths64): Shape[] {
  if (subject.length === 0 && clipType !== ClipType.Union) return [];
  const c = new Clipper64();
  c.addPaths(subject, PathType.Subject);
  if (clip.length) c.addPaths(clip, PathType.Clip);
  const solution: Paths64 = [];
  c.execute(clipType, fill, solution);
  return pathsToShapes(solution);
}

// ---------- public operations ----------

/**
 * Union of arbitrary closed rings with the EvenOdd rule: nested rings alternate outer / hole. Tolerant of inverted normals and wrong winding in the source mesh.
 */
export function unionEvenOdd(rings: Ring[]): Shape[] {
  if (rings.length === 0) return [];
  return boolean(ClipType.Union, FillRule.EvenOdd, toPaths(rings), []);
}

/** Union of shape sets (shapes must be correctly oriented, which every function here guarantees). */
export function union(a: Shape[], b: Shape[] = []): Shape[] {
  if (a.length + b.length === 0) return [];
  return boolean(ClipType.Union, FillRule.NonZero, shapesToPaths(a), shapesToPaths(b));
}

export function intersect(a: Shape[], b: Shape[]): Shape[] {
  if (a.length === 0 || b.length === 0) return [];
  return boolean(ClipType.Intersection, FillRule.NonZero, shapesToPaths(a), shapesToPaths(b));
}

export function difference(a: Shape[], b: Shape[]): Shape[] {
  if (a.length === 0) return [];
  return boolean(ClipType.Difference, FillRule.NonZero, shapesToPaths(a), shapesToPaths(b));
}

export type JoinKind = "miter" | "round" | "square";
const JOIN: Record<JoinKind, JoinType> = { miter: JoinType.Miter, round: JoinType.Round, square: JoinType.Square };

/**
 * Offset all shapes by `delta` mm (positive grows: outer outlines move out, holes shrink).
 * The result is re-resolved through a NonZero union so it is a clean, correctly nested tree.
 */
export function offset(shapes: Shape[], delta: number, join: JoinKind = "miter", miterLimit = 2): Shape[] {
  if (shapes.length === 0) return [];
  const co = new ClipperOffset(miterLimit, 0.01 * SCALE);
  co.addPaths(shapesToPaths(shapes), JOIN[join], EndType.Polygon);
  const res: Paths64 = [];
  co.execute(delta * SCALE, res);
  if (res.length === 0) return [];
  return boolean(ClipType.Union, FillRule.NonZero, res, []);
}

export type SimplifyBias = "none" | "outside" | "inside";

/**
 * Side-constrained Ramer-Douglas-Peucker on a closed ring (material on the left of every edge, which
 * holds for outers CCW and holes CW). A vertex run is replaced by its chord only if every dropped vertex is
 * within `tol` of the chord and, for bias "outside", lies on the material side of it (the chord then never
 * cuts material away); for "inside" on the other side (the chord never adds material).
 * Doing this with Clipper unions of near-identical outlines is not an option: clipper2-js loses area on them.
 */
function simplifyRing(ring: Ring, tol: number, bias: SimplifyBias): Ring {
  const n = ring.length;
  if (n <= 3) return ring;
  const eps = 1e-6;
  // split a closed ring at vertex 0 and the vertex farthest from it
  let far = 0, fd = -1;
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > fd) { fd = d; far = i; }
  }
  const keep = new Uint8Array(n);
  keep[0] = keep[far] = 1;
  const stack: [number, number][] = [[0, far], [far, n]]; // chain i..j, j == n means back to vertex 0
  while (stack.length) {
    const [i, j] = stack.pop()!;
    if (j - i < 2) continue;
    const a = ring[i], b = ring[j % n];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1e-12;
    let best = -1, bestScore = -1;
    for (let k = i + 1; k < j; k++) {
      const p = ring[k];
      const d = (dx * (p[1] - a[1]) - dy * (p[0] - a[0])) / len; // signed: > 0 left (material side)
      const bad = Math.abs(d) > tol || (bias === "outside" && d < -eps) || (bias === "inside" && d > eps);
      if (bad && Math.abs(d) >= bestScore) { bestScore = Math.abs(d); best = k; }
    }
    if (best < 0) continue; // chord is acceptable for the whole chain
    keep[best] = 1;
    stack.push([i, best], [best, j]);
  }
  const out: Ring = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(ring[i]);
  return out;
}

/**
 * Reduce vertices (Ramer-Douglas-Peucker): no removed vertex is further than `tol` mm from the simplified
 * outline. `bias` "outside" / "inside" additionally guarantees the result never lies inside / outside the input.
 * (Clipper's SimplifyPaths drops noticeably more area on small round sections, about 1% vs 0.5% on a 4 mm
 * radius circle at 0.05 mm, so Clipper's RDP is used for bias "none".)
 */
export function simplify(shapes: Shape[], tol: number, bias: SimplifyBias = "none"): Shape[] {
  if (tol <= 0 || shapes.length === 0) return shapes;
  const eps = tol * SCALE;
  const ring = (r: Ring): Ring =>
    bias === "none" ? fromPath(Clipper.ramerDouglasPeucker(toPath(r), eps)) : simplifyRing(r, tol, bias);
  const out: Shape[] = [];
  for (const s of shapes) {
    const outer = ring(orient(s.outer, true));
    if (outer.length < 3) continue;
    const holes: Ring[] = [];
    for (const h of s.holes) {
      const p = ring(orient(h, false));
      if (p.length >= 3) holes.push(p);
    }
    out.push({ outer, holes });
  }
  // Simplifying can in rare cases create touching rings; resolve through one union.
  return union(out);
}

/** Bounding box of a set of shapes, or null if empty. */
export function shapesBounds(shapes: Shape[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of shapes)
    for (const [x, y] of s.outer) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  return minX <= maxX ? { minX, minY, maxX, maxY } : null;
}
