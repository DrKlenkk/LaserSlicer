// Nesting (plan section 11, v1): minimum-area bounding rectangles packed with MaxRects (best short side fit).
import type { Part, Placement, Settings, Shape, Sheet, Vec2, Warning } from "./types";
import { shapeArea } from "./poly";

// ---------- geometry ----------

/** Convex hull (Andrew's monotone chain), counter-clockwise, no repeated points. */
export function convexHull(points: Vec2[]): Vec2[] {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Vec2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

export type Rect = { angleDeg: number; w: number; h: number; area: number };

/**
 * Minimum-area bounding rectangle by rotating calipers: an optimal rectangle has a side collinear with a
 * hull edge, so try every hull edge direction. `angleDeg` is the CCW rotation that makes that edge horizontal
 * (rotating the part by it gives an axis-aligned rectangle of size w x h, w >= h).
 */
export function minAreaRect(points: Vec2[]): Rect {
  const hull = convexHull(points);
  if (hull.length < 3) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of hull) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const w = Math.max(maxX - minX, 0), h = Math.max(maxY - minY, 0);
    return { angleDeg: 0, w, h, area: w * h };
  }
  let best: Rect | null = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-12) continue;
    const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len; // edge direction
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of hull) {
      const u = p[0] * ux + p[1] * uy, v = -p[0] * uy + p[1] * ux;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const w = maxU - minU, h = maxV - minV, area = w * h;
    if (!best || area < best.area - 1e-9) {
      let angle = (-Math.atan2(uy, ux) * 180) / Math.PI;
      let rw = w, rh = h;
      if (rh > rw) { // make the long side horizontal
        [rw, rh] = [rh, rw];
        angle += 90;
      }
      best = { angleDeg: normAngle(angle), w: rw, h: rh, area };
    }
  }
  return best!;
}

function normAngle(a: number): number {
  a = a % 360;
  return a < 0 ? a + 360 : a;
}

function rotate(p: Vec2, c: number, s: number): Vec2 {
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
}

function trig(angleDeg: number): [number, number] {
  // exact values for multiples of 90 so axis-aligned parts stay exact
  const a = normAngle(angleDeg);
  if (a === 0) return [1, 0];
  if (a === 90) return [0, 1];
  if (a === 180) return [-1, 0];
  if (a === 270) return [0, -1];
  const r = (a * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r)];
}

/** Rotate by `angleDeg` (CCW) about the origin, then translate by (x, y). Orientation is preserved. */
export function transformPoints(pts: Vec2[], angleDeg: number, x: number, y: number): Vec2[] {
  const [c, s] = trig(angleDeg);
  return pts.map((p) => {
    const q = rotate(p, c, s);
    return [q[0] + x, q[1] + y] as Vec2;
  });
}

/** Geometry of a part as placed on its sheet: cut, engrave, label and dowel holes. */
export function applyPlacement(part: Part, pl: Pick<Placement, "x" | "y" | "angleDeg">): Part {
  const t = (r: Vec2[]) => transformPoints(r, pl.angleDeg, pl.x, pl.y);
  const shape: Shape = { outer: t(part.cut.outer), holes: part.cut.holes.map(t) };
  return {
    ...part,
    cut: shape,
    engrave: part.engrave.map(t),
    label: part.label.map(t),
    holes: part.holes.map((h) => ({ c: t([h.c])[0], d: h.d })),
  };
}

// ---------- MaxRects ----------

type R = { x: number; y: number; w: number; h: number };

class MaxRectsBin {
  free: R[];
  constructor(w: number, h: number) {
    this.free = [{ x: 0, y: 0, w, h }];
  }

  /** Best short side fit over both orientations; returns the placement or null. */
  find(w: number, h: number, allowRotate: boolean): { x: number; y: number; rot: boolean; short: number; long: number } | null {
    let best: { x: number; y: number; rot: boolean; short: number; long: number } | null = null;
    const eps = 1e-9;
    for (const f of this.free) {
      for (const rot of allowRotate ? [false, true] : [false]) {
        const iw = rot ? h : w, ih = rot ? w : h;
        if (iw > f.w + eps || ih > f.h + eps) continue;
        const dw = f.w - iw, dh = f.h - ih;
        const short = Math.min(dw, dh), long = Math.max(dw, dh);
        if (!best || short < best.short - eps || (Math.abs(short - best.short) <= eps && long < best.long - eps))
          best = { x: f.x, y: f.y, rot, short, long };
      }
    }
    return best;
  }

  place(r: R) {
    const next: R[] = [];
    for (const f of this.free) {
      if (r.x >= f.x + f.w - 1e-9 || r.x + r.w <= f.x + 1e-9 || r.y >= f.y + f.h - 1e-9 || r.y + r.h <= f.y + 1e-9) {
        next.push(f);
        continue;
      }
      if (r.x > f.x + 1e-9) next.push({ x: f.x, y: f.y, w: r.x - f.x, h: f.h });
      if (r.x + r.w < f.x + f.w - 1e-9) next.push({ x: r.x + r.w, y: f.y, w: f.x + f.w - r.x - r.w, h: f.h });
      if (r.y > f.y + 1e-9) next.push({ x: f.x, y: f.y, w: f.w, h: r.y - f.y });
      if (r.y + r.h < f.y + f.h - 1e-9) next.push({ x: f.x, y: r.y + r.h, w: f.w, h: f.y + f.h - r.y - r.h });
    }
    // prune rectangles contained in another one
    this.free = next.filter((a, i) => !next.some((b, j) => i !== j && contains(b, a) && (!contains(a, b) || j < i)));
  }
}

function contains(o: R, i: R): boolean {
  const e = 1e-9;
  return i.x >= o.x - e && i.y >= o.y - e && i.x + i.w <= o.x + o.w + e && i.y + i.h <= o.y + o.h + e;
}

// ---------- nesting ----------

export type NestResult = { placements: Placement[]; sheets: Sheet[]; warnings: Warning[] };

/**
 * Nest parts onto sheets. Parts are sorted by layer (then by size, largest first) and each is rotated to its
 * minimum-area rectangle; MaxRects may also turn it by 90 degrees. `partSpacing` is kept between parts and
 * `sheetMargin` at the sheet edges (spacing is added to every rectangle and to the bin, the usual trick).
 * Parts that do not fit even an empty sheet get an error warning and no placement.
 */
export function nestParts(
  parts: Part[],
  s: Pick<Settings, "sheetW" | "sheetH" | "partSpacing" | "sheetMargin">,
): NestResult {
  const warnings: Warning[] = [];
  const placements: Placement[] = [];
  const sheets: Sheet[] = [];
  const bins: MaxRectsBin[] = [];
  const spacing = Math.max(0, s.partSpacing);
  const usableW = s.sheetW - 2 * s.sheetMargin, usableH = s.sheetH - 2 * s.sheetMargin;

  type Item = { part: Part; rect: Rect; minX: number; minY: number; area: number };
  const items: Item[] = [];
  for (const part of parts) {
    const rect = minAreaRect(part.cut.outer);
    const fits = (rect.w <= usableW + 1e-9 && rect.h <= usableH + 1e-9) || (rect.h <= usableW + 1e-9 && rect.w <= usableH + 1e-9);
    if (!fits) {
      warnings.push({
        level: "error",
        layer: part.layer,
        partId: part.id,
        message: `Part ${part.id} (${rect.w.toFixed(1)} × ${rect.h.toFixed(1)} mm) is larger than the usable sheet area (${usableW.toFixed(1)} × ${usableH.toFixed(1)} mm) and was left out`,
      });
      continue;
    }
    items.push({ part, rect, minX: 0, minY: 0, area: shapeArea(part.cut) });
  }
  items.sort((a, b) => a.part.layer - b.part.layer || b.rect.area - a.rect.area);

  for (const it of items) {
    // Rect at rotation angle: rotated outer has bbox [0,w] x [0,h] after the translation computed below.
    const { w, h } = it.rect;
    let placed = false;
    for (let si = 0; si <= bins.length && !placed; si++) {
      if (si === bins.length) {
        bins.push(new MaxRectsBin(usableW + spacing, usableH + spacing));
        sheets.push({ index: si, w: s.sheetW, h: s.sheetH, partIds: [], usedArea: 0, usePct: 0 });
      }
      const f = bins[si].find(w + spacing, h + spacing, true);
      if (!f) continue;
      const rw = f.rot ? h : w, rh = f.rot ? w : h;
      bins[si].place({ x: f.x, y: f.y, w: rw + spacing, h: rh + spacing });
      const angle = normAngle(it.rect.angleDeg + (f.rot ? 90 : 0));
      // bbox of the part rotated by `angle`
      const rot = transformPoints(it.part.cut.outer, angle, 0, 0);
      let minX = Infinity, minY = Infinity;
      for (const [x, y] of rot) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
      }
      placements.push({
        partId: it.part.id,
        sheet: si,
        x: s.sheetMargin + f.x - minX,
        y: s.sheetMargin + f.y - minY,
        angleDeg: angle,
      });
      sheets[si].partIds.push(it.part.id);
      sheets[si].usedArea += it.area;
      placed = true;
    }
  }
  for (const sh of sheets) sh.usePct = (sh.usedArea / (sh.w * sh.h)) * 100;
  return { placements, sheets, warnings };
}

/** Overall material use in percent over all sheets (0 without sheets). */
export function materialUse(sheets: Sheet[]): number {
  let used = 0, total = 0;
  for (const s of sheets) {
    used += s.usedArea;
    total += s.w * s.h;
  }
  return total > 0 ? (used / total) * 100 : 0;
}
