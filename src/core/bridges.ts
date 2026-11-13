// Holding bridges (a.k.a. tabs or micro-joints): short uncut gaps in the cut path that keep a part attached to the sheet
// (and the scrap inside a hole attached to the part) until it is broken out by hand. Own pipeline stage after kerf: the cut
// geometry is final then, and nothing here changes a part's extent, so nesting does not depend on it.
//
// Representation: `Part.cut` stays the closed shape. A bridged ring is described by `Part.bridges`: the open polylines of
// the ring without the gaps (exported on CUT) and the gap polylines (exported on BRIDGE). Excluding BRIDGE from an export
// therefore leaves plain uncut tabs; running the BRIDGE layer at low power scores the tab so it breaks cleanly.
//
// Gap length. The cut ring is the path of the beam centre (already offset by kerf/2). The beam burns kerf/2 beyond each end
// of an open path, so a gap of length g leaves a web of g - kerf. We want a web of `bridgeWidth`, hence g = bridgeWidth + kerf.
// The BRIDGE polyline covers exactly this gap.
import type { BridgedRing, Part, Ring, Settings, Vec2, Warning } from "./types";

export type BridgeParams = Pick<Settings, "bridgesEnabled" | "bridgeCount" | "bridgeWidth" | "bridgeMinLength" | "bridgeHoles" | "bridgeMaxSpacing" | "kerf">;

/** Length of the gap in the cut path: the web we want plus the beam kerf (see the header). */
export const gapLength = (width: number, kerf: number) => width + Math.max(0, kerf);

/** Free path kept on each side of a gap, so a bridge never touches a corner or the next bridge: 1.5 mm, or the width if larger. */
export const clearanceOf = (width: number) => Math.max(1.5, width);

/** A vertex turning by more than this is a corner; windows over corners score (almost) zero. */
const CORNER_DEG = 25;
/** Total turning inside a window (degrees) that halves the straightness score. */
const HALF_SCORE_DEG = 6;
/** Number of start offsets tried for the even distribution. */
const OFFSETS = 48;
/** Upper bound of the grid step (mm) on which candidate positions are scored. */
const MAX_STEP = 0.5;
const MAX_BRIDGES = 64;

type RingInfo = {
  pts: Vec2[];
  /** arc length at vertex i; s[n] = perimeter */
  s: number[];
  P: number;
  /** absolute turning angle (degrees) at vertex i */
  turn: number[];
  /** prefix sums of turn: cum[i] = sum of turn[0..i-1] */
  cum: number[];
  /** arc positions of corner vertices, ascending */
  corners: number[];
};

function analyse(ring: Ring): RingInfo | null {
  const pts: Vec2[] = [];
  for (const p of ring) {
    const q = pts[pts.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-9) pts.push(p);
  }
  while (pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) <= 1e-9) pts.pop();
  const n = pts.length;
  if (n < 3) return null;
  const s = [0];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    s.push(s[i] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const turn: number[] = [], cum = [0], corners: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i + n - 1) % n], b = pts[i], c = pts[(i + 1) % n];
    const t = Math.abs(Math.atan2((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]), (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]))) * (180 / Math.PI);
    turn.push(t);
    cum.push(cum[i] + t);
    if (t > CORNER_DEG) corners.push(s[i]);
  }
  return { pts, s, P: s[n], turn, cum, corners };
}

/** First index in the ascending array `a` (length n) with a[i] >= x. */
function lowerBound(a: number[], n: number, x: number): number {
  let lo = 0, hi = n;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (a[m] < x) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/** Total turning (degrees) of the vertices whose arc position lies in the window [a, b] (cyclic, length < P). */
function turningIn(r: RingInfo, a: number, b: number): number {
  const n = r.pts.length, e = 1e-9;
  const a0 = ((a % r.P) + r.P) % r.P;
  const b0 = a0 + (b - a);
  const between = (lo: number, hi: number) => r.cum[lowerBound(r.s, n, hi + e)] - r.cum[lowerBound(r.s, n, lo - e)];
  if (b0 <= r.P) return between(a0, b0);
  return between(a0, r.P - 2 * e) + between(0, b0 - r.P);
}

/** Arc distance from position x to the nearest corner (Infinity without corners). */
function cornerDistance(r: RingInfo, x: number): number {
  if (r.corners.length === 0) return Infinity;
  const c = r.corners;
  const i = lowerBound(c, c.length, x);
  let best = Infinity;
  for (const j of [i - 1, i, 0, c.length - 1]) {
    if (j < 0 || j >= c.length) continue;
    const d = Math.abs(c[j] - x);
    best = Math.min(best, d, r.P - d);
  }
  return best;
}

function pointAt(r: RingInfo, x: number): Vec2 {
  const n = r.pts.length;
  x = ((x % r.P) + r.P) % r.P;
  const i = Math.min(n - 1, Math.max(0, lowerBound(r.s, n + 1, x + 1e-12) - 1));
  const a = r.pts[i], b = r.pts[(i + 1) % n];
  const len = r.s[i + 1] - r.s[i];
  const t = len > 0 ? (x - r.s[i]) / len : 0;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** The part of the ring from arc position `a` over `len` (cyclic, in ring order), including the vertices in between. */
function subPath(r: RingInfo, a: number, len: number): Vec2[] {
  const n = r.pts.length, e = 1e-9;
  const a0 = ((a % r.P) + r.P) % r.P, b0 = a0 + len;
  const out: Vec2[] = [pointAt(r, a0)];
  for (let m = 0; m < 2; m++)
    for (let i = 0; i < n; i++) {
      const x = r.s[i] + m * r.P;
      if (x > a0 + e && x < b0 - e) out.push(r.pts[i]);
    }
  out.push(pointAt(r, b0));
  return out;
}

/** What `placeBridges` decided for one ring. */
export type RingPlan = {
  /** gap centres as arc lengths from the ring's first vertex, ascending */
  centers: number[];
  /** the count asked for (after maxSpacing) could not be met because the ring is too short */
  reduced: boolean;
};

/**
 * Where the bridges of one closed ring go (arc-length positions of the gap centres), or null when the ring gets none.
 *
 *  1. The ring is walked once: arc length per vertex, turning angle per vertex. Vertices turning more than 25 degrees are
 *     corners.
 *  2. Every candidate gap centre on a fine grid (<= 0.5 mm) is scored from the window of gap + clearance on both sides:
 *     the straightness is 1 / (1 + (total turning in the window / 6 degrees)^2), so a straight edge scores 1, a gentle curve
 *     a little and a window over a corner almost nothing; that is multiplied by a corner factor (0.5 .. 1) that grows with the
 *     free distance from the window to the nearest corner, so mid-edge beats next-to-the-corner. Straight edges are therefore
 *     preferred, and an outline without any (a circle) still gets evenly spaced bridges on the curve, only with lower scores.
 *  3. N bridges are spread evenly by arc length: target k sits at offset + k * P / N. Of 48 offsets the one with the best
 *     total is kept, where each bridge may slide up to a quarter of the spacing (never so far that neighbours could touch)
 *     to the best-scoring spot nearby (ties go to the position nearest its target, keeping the spacing even). The total is
 *     the mean of the scores and the worst score, times a factor that drops when two bridges are spatially close (on a
 *     folded outline equal arc spacing does not mean far apart). Even arc spacing puts N = 2 on opposite sides, N = 4 on
 *     all four sides of a square.
 *  4. Gaps never overlap: centres are at least gap + 2 * clearance apart, and N is reduced if the ring is too short.
 */
export function placeBridges(ring: Ring, p: Pick<BridgeParams, "bridgeCount" | "bridgeWidth" | "kerf" | "bridgeMinLength" | "bridgeMaxSpacing">): RingPlan | null {
  const r = analyse(ring);
  if (!r || r.P < p.bridgeMinLength) return null;
  const g = gapLength(p.bridgeWidth, p.kerf), c = clearanceOf(p.bridgeWidth);
  const h = g / 2 + c; // half window
  const minSep = g + 2 * c;
  const fit = Math.floor(r.P / minSep + 1e-9);
  if (fit < 1) return null;
  let want = Math.max(1, Math.min(8, Math.round(p.bridgeCount)));
  if (p.bridgeMaxSpacing > 0) want = Math.min(MAX_BRIDGES, Math.max(want, Math.ceil(r.P / p.bridgeMaxSpacing - 1e-9)));
  const N = Math.min(want, fit);

  // ---- scores on the grid ----
  const M = Math.max(8, Math.ceil(r.P / Math.min(MAX_STEP, Math.max(0.1, g / 4))));
  const step = r.P / M;
  const spacing = r.P / N;
  const dRef = Math.max(12, 4 * c, spacing / 4); // free distance from corners at which the corner factor saturates
  const score = new Float64Array(M);
  for (let j = 0; j < M; j++) {
    const x = j * step;
    const th = turningIn(r, x - h, x + h);
    const straight = 1 / (1 + (th / HALF_SCORE_DEG) ** 2);
    const free = Math.max(0, cornerDistance(r, x) - h);
    score[j] = straight * (0.5 + 0.5 * Math.min(1, free / dRef));
  }

  // ---- even distribution with sliding ----
  const slideArc = Math.max(0, Math.min(spacing / 4, (spacing - minSep) / 2) - step);
  const slide = Math.floor(slideArc / step);
  const spatialRef = 0.25 * spacing; // nearer than this (straight line) counts as crowded
  let best: { total: number; idx: number[] } | null = null;
  for (let o = 0; o < OFFSETS; o++) {
    const off = (o / OFFSETS) * spacing;
    const idx: number[] = [], sc: number[] = [];
    let moved = 0;
    for (let k = 0; k < N; k++) {
      const t = Math.round((off + k * spacing) / step);
      let bj = t, bs = -Infinity;
      for (let d = -slide; d <= slide; d++) {
        const j = (((t + d) % M) + M) % M;
        const v = score[j] - 0.02 * (Math.abs(d) / (slide + 1)); // tie-break: stay near the target
        if (v > bs + 1e-12) { bs = v; bj = j; }
      }
      idx.push(bj);
      sc.push(score[bj]);
      moved += Math.min(1, Math.abs((((bj - t) % M) + M + M / 2) % M - M / 2) / (slide + 1)) / N;
    }
    // equal scores: prefer the offset whose bridges needed to slide least (keeps the spacing even, mid-edge)
    let total = (sc.reduce((a, b) => a + b, 0) / N + Math.min(...sc)) / 2 - 0.05 * moved;
    if (N > 1) {
      const pts = idx.map((j) => pointAt(r, j * step));
      let dmin = Infinity;
      for (let a = 0; a < N; a++) for (let b = a + 1; b < N; b++) dmin = Math.min(dmin, Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1]));
      total *= 0.5 + 0.5 * Math.min(1, dmin / spatialRef);
    }
    if (!best || total > best.total + 1e-9) best = { total, idx };
  }
  const centers = best!.idx.map((j) => j * step).sort((a, b) => a - b);
  return { centers, reduced: N < want };
}

/** Split one ring at the planned gaps: the open cut polylines and the gap polylines. */
export function splitRing(ring: Ring, centers: number[], gap: number): { cut: Vec2[][]; gaps: Vec2[][] } | null {
  const r = analyse(ring);
  if (!r || centers.length === 0) return null;
  const cut: Vec2[][] = [], gaps: Vec2[][] = [];
  const n = centers.length;
  for (let k = 0; k < n; k++) {
    const c0 = centers[k], c1 = k + 1 < n ? centers[k + 1] : centers[0] + r.P;
    gaps.push(subPath(r, c0 - gap / 2, gap));
    cut.push(subPath(r, c0 + gap / 2, c1 - c0 - gap));
  }
  return { cut, gaps };
}

/**
 * Stage `bridges`: adds `Part.bridges` to every part. Outer outlines always (when long enough); inner holes only with
 * `bridgeHoles`; dowel holes are circles and never get bridges. Returns the input untouched when bridges are off.
 * Part-local coordinates: the plan depends only on the ring's own geometry, so it is the same whatever the nesting rotation.
 */
export function addBridges(parts: Part[], p: BridgeParams): { parts: Part[]; warnings: Warning[] } {
  if (!p.bridgesEnabled) return { parts, warnings: [] };
  const warnings: Warning[] = [];
  const gap = gapLength(p.bridgeWidth, p.kerf);
  let reduced = 0, total = 0;
  const out = parts.map((part) => {
    const rings: Ring[] = [part.cut.outer, ...(p.bridgeHoles ? part.cut.holes : [])];
    const bridges: BridgedRing[] = [];
    rings.forEach((ring, i) => {
      const plan = placeBridges(ring, p);
      if (!plan) return;
      const sp = splitRing(ring, plan.centers, gap);
      if (!sp) return;
      bridges.push({ ring: i, ...sp });
      total += plan.centers.length;
      if (plan.reduced) reduced++;
    });
    return bridges.length ? { ...part, bridges } : part;
  });
  if (reduced > 0)
    warnings.push({ level: "info", message: `${reduced} outline${reduced === 1 ? " is" : "s are"} too short for ${p.bridgeCount} bridges (gap ${gap.toFixed(2)} mm plus clearance) and got fewer` });
  if (total === 0 && parts.length > 0)
    warnings.push({ level: "info", message: `No bridges were added: every outline is shorter than the minimum length (${p.bridgeMinLength} mm)` });
  return { parts: out, warnings };
}

/** The cut geometry of a part as drawn: closed rings, open polylines (bridged rings without their gaps) and the gap polylines. */
export function cutPaths(part: Part): { closed: Ring[]; open: Vec2[][]; gaps: Vec2[][] } {
  const rings = [part.cut.outer, ...part.cut.holes];
  const bridged = new Map((part.bridges ?? []).map((b) => [b.ring, b]));
  const closed: Ring[] = [], open: Vec2[][] = [], gaps: Vec2[][] = [];
  rings.forEach((ring, i) => {
    const b = bridged.get(i);
    if (!b) closed.push(ring);
    else {
      open.push(...b.cut);
      gaps.push(...b.gaps);
    }
  });
  return { closed, open, gaps };
}

/** Like `cutPaths`, but split into outer outline and inner rings (holes, cavities); dowel circles are not rings and are not included. */
export function cutPathsByKind(part: Part): { outerClosed: Ring[]; outerOpen: Vec2[][]; innerClosed: Ring[]; innerOpen: Vec2[][]; gaps: Vec2[][] } {
  const rings = [part.cut.outer, ...part.cut.holes];
  const bridged = new Map((part.bridges ?? []).map((b) => [b.ring, b]));
  const r = { outerClosed: [] as Ring[], outerOpen: [] as Vec2[][], innerClosed: [] as Ring[], innerOpen: [] as Vec2[][], gaps: [] as Vec2[][] };
  rings.forEach((ring, i) => {
    const b = bridged.get(i);
    if (!b) (i === 0 ? r.outerClosed : r.innerClosed).push(ring);
    else {
      (i === 0 ? r.outerOpen : r.innerOpen).push(...b.cut);
      r.gaps.push(...b.gaps);
    }
  });
  return r;
}

/** Length of a polyline (mm). */
export function polylineLength(l: Vec2[]): number {
  let s = 0;
  for (let i = 1; i < l.length; i++) s += Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]);
  return s;
}
