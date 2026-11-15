// Engrave-line filter: keeps only the runs of a ring that lie inside a part, i.e. away from the part's own boundary.
// Plain geometry (no clipper): a uniform grid over the boundary segments answers "is this point within tol of the boundary".
import type { Ring, Shape, Vec2 } from "./types";

/** An engrave line closer than this (mm) to the part's own cut edge is not useful: it only chars the cut edge. */
export const EDGE_TOL = 0.2;
/** Runs shorter than this (mm) are dropped (specks). */
export const MIN_RUN = 1;
/** Sample spacing (mm) along long edges when testing them against the boundary. */
const SAMPLE_STEP = 1;
const MAX_SAMPLES = 4096;

/** Spatial grid over boundary segments, for `near(x, y)` within `tol`. */
export class BoundaryIndex {
  private cells = new Map<number, number[]>();
  private segs: number[] = []; // x0 y0 x1 y1 ...
  private cell: number;
  private minX = Infinity;
  private minY = Infinity;
  private nx = 1;
  constructor(shape: Shape, private tol: number) {
    let maxX = -Infinity, maxY = -Infinity, len = 0;
    for (const r of [shape.outer, ...shape.holes])
      for (let i = 0; i < r.length; i++) {
        const a = r[i], b = r[(i + 1) % r.length];
        this.segs.push(a[0], a[1], b[0], b[1]);
        this.minX = Math.min(this.minX, a[0]); this.minY = Math.min(this.minY, a[1]);
        maxX = Math.max(maxX, a[0]); maxY = Math.max(maxY, a[1]);
        len += Math.hypot(b[0] - a[0], b[1] - a[1]);
      }
    const n = this.segs.length / 4;
    const w = Math.max(maxX - this.minX, 1e-9), h = Math.max(maxY - this.minY, 1e-9);
    this.cell = Math.max(tol * 4, (len / Math.max(n, 1)) * 2, Math.max(w, h) / 512);
    this.nx = Math.floor(w / this.cell) + 3;
    for (let s = 0; s < n; s++) {
      const [x0, y0, x1, y1] = [this.segs[4 * s], this.segs[4 * s + 1], this.segs[4 * s + 2], this.segs[4 * s + 3]];
      const cx0 = this.cx(Math.min(x0, x1) - tol), cx1 = this.cx(Math.max(x0, x1) + tol);
      const cy0 = this.cy(Math.min(y0, y1) - tol), cy1 = this.cy(Math.max(y0, y1) + tol);
      for (let cy = cy0; cy <= cy1; cy++)
        for (let cx = cx0; cx <= cx1; cx++) {
          const k = cy * this.nx + cx;
          const l = this.cells.get(k);
          if (l) l.push(s); else this.cells.set(k, [s]);
        }
    }
  }
  private cx(x: number) { return Math.max(0, Math.min(this.nx - 1, Math.floor((x - this.minX) / this.cell) + 1)); }
  private cy(y: number) { return Math.max(0, Math.floor((y - this.minY) / this.cell) + 1); }
  near(x: number, y: number): boolean {
    const l = this.cells.get(this.cy(y) * this.nx + this.cx(x));
    if (!l) return false;
    const t2 = this.tol * this.tol;
    for (const s of l) {
      const x0 = this.segs[4 * s], y0 = this.segs[4 * s + 1], dx = this.segs[4 * s + 2] - x0, dy = this.segs[4 * s + 3] - y0;
      const d2 = dx * dx + dy * dy;
      const t = d2 > 0 ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / d2)) : 0;
      const ex = x0 + t * dx - x, ey = y0 + t * dy - y;
      if (ex * ex + ey * ey <= t2) return true;
    }
    return false;
  }
}

type Piece = { a: Vec2; b: Vec2; keep: boolean };

/** One ring cut into pieces that are either on the part's boundary (dropped) or inside the part (kept). */
function pieces(ring: Ring, idx: BoundaryIndex): Piece[] {
  const out: Piece[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len === 0) continue;
    const n = Math.min(MAX_SAMPLES, Math.max(2, Math.ceil(len / SAMPLE_STEP)));
    const at = (k: number): Vec2 => (k === 0 ? a : k === n ? b : [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    const on: boolean[] = [];
    for (let k = 0; k <= n; k++) { const p = at(k); on.push(idx.near(p[0], p[1])); }
    const keep = (k: number) => !(on[k] && on[k + 1]); // sub-interval k..k+1 lies on the boundary only if both ends do
    let start = 0;
    for (let k = 1; k <= n; k++)
      if (k === n || keep(k) !== keep(start)) {
        out.push({ a: at(start), b: at(k), keep: keep(start) });
        start = k;
      }
  }
  return out;
}

/**
 * Runs of the (implicitly closed) rings that lie inside the part: edges within `EDGE_TOL` of the part's own boundary are
 * dropped. A ring that is kept completely stays closed (first point repeated); the rest become open polylines.
 */
export function insideRuns(rings: Ring[], part: Shape, tol = EDGE_TOL, minRun = MIN_RUN): Vec2[][] {
  const idx = new BoundaryIndex(part, tol);
  const runs: Vec2[][] = [];
  const len = (l: Vec2[]) => l.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - l[i - 1][0], p[1] - l[i - 1][1]) : 0), 0);
  for (const ring of rings) {
    if (ring.length < 3) continue;
    const ps = pieces(ring, idx);
    if (ps.length === 0) continue;
    if (ps.every((p) => p.keep)) {
      const line = [...ring, ring[0]];
      if (len(line) >= minRun) runs.push(line);
      continue;
    }
    const first = ps.findIndex((p) => !p.keep);
    const rot = [...ps.slice(first), ...ps.slice(0, first)]; // starts on a dropped piece, so runs never wrap
    let cur: Vec2[] = [];
    const flush = () => { if (cur.length && len(cur) >= minRun) runs.push(cur); cur = []; };
    for (const p of rot) {
      if (!p.keep) { flush(); continue; }
      if (cur.length === 0) cur.push(p.a);
      cur.push(p.b);
    }
    flush();
  }
  return runs;
}
