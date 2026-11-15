// Cutting order for the vector files (DXF and SVG): a greedy nearest-neighbour path over the entities of a drawing, starting at the
// sheet origin. Pure, no DOM. Closed rings are rotated so they start at the vertex closest to the previous end point (the geometry
// is unchanged), open polylines may be reversed. Nearest-point queries use a uniform grid, so thousands of entities stay fast.
//
// File order (kept the same in DXF and SVG): ENGRAVE, LABEL, inner cuts (holes, cavities, dowel circles), outer outlines, BRIDGE.
// Every group continues from the end of the one before. Inner cuts always come before outlines (see DECISIONS.md).
import type { Ring, Vec2 } from "../types";
import { polyline, splitCut, type Drawing } from "./common";

export type Entity =
  | { k: "closed"; pts: Vec2[] } // ring, last point != first
  | { k: "open"; pts: Vec2[] }
  | { k: "circle"; c: Vec2; d: number };

/** Where a pen starts on a circle: DXF CIRCLE and SVG circle both start at angle 0. */
const circleStart = (e: { c: Vec2; d: number }): Vec2 => [e.c[0] + e.d / 2, e.c[1]];

type Ordered = { ents: Entity[]; end: Vec2; travel: number };

/**
 * Greedy nearest-neighbour order starting at `from`. Each step goes to the entity with the closest access point (any vertex of a
 * closed ring, either end of an open polyline, the start of a circle) among those not yet visited.
 */
export function orderEntities(input: Entity[], from: Vec2): Ordered {
  const n = input.length;
  if (n === 0) return { ents: [], end: from, travel: 0 };
  // access points: x, y, entity, vertex index
  const total = input.reduce((a, e) => a + (e.k === "closed" ? e.pts.length : e.k === "open" ? 2 : 1), 0);
  const px = new Float64Array(total), py = new Float64Array(total), pe = new Int32Array(total), pi = new Int32Array(total);
  let m = 0;
  const add = (x: number, y: number, e: number, i: number) => { px[m] = x; py[m] = y; pe[m] = e; pi[m] = i; m++; };
  input.forEach((e, id) => {
    if (e.k === "closed") e.pts.forEach((p, i) => add(p[0], p[1], id, i));
    else if (e.k === "open") { add(e.pts[0][0], e.pts[0][1], id, 0); add(e.pts[e.pts.length - 1][0], e.pts[e.pts.length - 1][1], id, e.pts.length - 1); }
    else { const s = circleStart(e); add(s[0], s[1], id, 0); }
  });

  const alive = new Uint8Array(n).fill(1);
  let aliveCount = n;
  // grid in CSR form over the points of the entities still alive; rebuilt when half of them are gone
  let gw = 1, gh = 1, cell = 1, x0 = 0, y0 = 0, cellStart = new Int32Array(2), cellPts = new Int32Array(0), builtFor = 0;
  const build = (qx: number, qy: number) => {
    const idx: number[] = [];
    let minX = qx, minY = qy, maxX = qx, maxY = qy;
    for (let i = 0; i < m; i++) {
      if (!alive[pe[i]]) continue;
      idx.push(i);
      if (px[i] < minX) minX = px[i];
      if (px[i] > maxX) maxX = px[i];
      if (py[i] < minY) minY = py[i];
      if (py[i] > maxY) maxY = py[i];
    }
    const w = maxX - minX, h = maxY - minY, np = Math.max(idx.length, 1);
    cell = Math.max(Math.sqrt((w * h * 2) / np), (Math.max(w, h) * 2) / np, 1e-9);
    gw = Math.floor(w / cell) + 1;
    gh = Math.floor(h / cell) + 1;
    x0 = minX; y0 = minY;
    cellStart = new Int32Array(gw * gh + 1);
    const cellOf = (i: number) => Math.min(gw - 1, Math.floor((px[i] - x0) / cell)) + Math.min(gh - 1, Math.floor((py[i] - y0) / cell)) * gw;
    for (const i of idx) cellStart[cellOf(i) + 1]++;
    for (let c = 0; c < gw * gh; c++) cellStart[c + 1] += cellStart[c];
    const fill = cellStart.slice(0, gw * gh);
    cellPts = new Int32Array(idx.length);
    for (const i of idx) cellPts[fill[cellOf(i)]++] = i;
    builtFor = aliveCount;
  };
  build(from[0], from[1]);

  const nearest = (qx: number, qy: number): number => {
    const cx = Math.min(gw - 1, Math.max(0, Math.floor((qx - x0) / cell)));
    const cy = Math.min(gh - 1, Math.max(0, Math.floor((qy - y0) / cell)));
    let best = -1, bestD = Infinity;
    const scan = (gx: number, gy: number) => {
      const c = gx + gy * gw;
      for (let k = cellStart[c]; k < cellStart[c + 1]; k++) {
        const i = cellPts[k];
        if (!alive[pe[i]]) continue;
        const d = (px[i] - qx) ** 2 + (py[i] - qy) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      }
    };
    const maxR = Math.max(gw, gh);
    for (let r = 0; r <= maxR; r++) {
      if (best >= 0 && Math.sqrt(bestD) <= (r - 1) * cell) break; // everything in ring r or beyond is farther than the best
      const ylo = cy - r, yhi = cy + r, xlo = cx - r, xhi = cx + r;
      for (let gy = Math.max(0, ylo); gy <= Math.min(gh - 1, yhi); gy++) {
        if (gy === ylo || gy === yhi) for (let gx = Math.max(0, xlo); gx <= Math.min(gw - 1, xhi); gx++) scan(gx, gy);
        else {
          if (xlo >= 0) scan(xlo, gy);
          if (xhi < gw && xhi !== xlo) scan(xhi, gy);
        }
      }
    }
    return best;
  };

  const out: Entity[] = [];
  let cur: Vec2 = from, travel = 0;
  while (aliveCount > 0) {
    const i = nearest(cur[0], cur[1]);
    const e = input[pe[i]];
    travel += Math.hypot(px[i] - cur[0], py[i] - cur[1]);
    alive[pe[i]] = 0;
    aliveCount--;
    if (e.k === "closed") {
      const s = pi[i];
      out.push({ k: "closed", pts: s === 0 ? e.pts : [...e.pts.slice(s), ...e.pts.slice(0, s)] });
      cur = e.pts[s];
    } else if (e.k === "open") {
      if (pi[i] === 0) { out.push(e); cur = e.pts[e.pts.length - 1]; }
      else { out.push({ k: "open", pts: [...e.pts].reverse() }); cur = e.pts[0]; }
    } else { out.push(e); cur = circleStart(e); }
    if (aliveCount > 0 && aliveCount * 2 < builtFor && builtFor > 64) build(cur[0], cur[1]);
  }
  return { ents: out, end: cur, travel };
}

/** Length of the rapid moves of a sequence that starts at `from`: jumps from one entity's end to the next one's start. */
export function travelOf(seq: Entity[], from: Vec2 = [0, 0]): number {
  let cur = from, t = 0;
  for (const e of seq) {
    const s = e.k === "circle" ? circleStart(e) : e.pts[0];
    t += Math.hypot(s[0] - cur[0], s[1] - cur[1]);
    cur = e.k === "circle" ? s : e.k === "open" ? e.pts[e.pts.length - 1] : e.pts[0];
  }
  return t;
}

const closedOf = (r: Ring): Entity[] => (r.length >= 2 ? [{ k: "closed", pts: r }] : []);
const openOf = (l: Vec2[]): Entity[] => (l.length >= 2 ? [{ k: "open", pts: l }] : []);
/** Engrave / label polylines: a repeated first point means closed (the repeat is dropped, as the writers do). */
const lineOf = (l: Vec2[]): Entity[] => {
  const { pts, closed } = polyline(l);
  return pts.length < 2 ? [] : [{ k: closed ? "closed" : "open", pts }];
};

export type Sequence = {
  engrave: Entity[];
  label: Entity[];
  /** holes, cavities, bridged inner rings and dowel circles */
  inner: Entity[];
  outer: Entity[];
  bridge: Entity[];
  /** rapid travel length over the whole sequence, from the sheet origin */
  travel: number;
};

/** The cutting order of a (filtered) drawing, see the header. */
export function cuttingSequence(d: Drawing, origin: Vec2 = [0, 0]): Sequence {
  const cut = splitCut(d);
  let cur = origin, travel = 0;
  const next = (ents: Entity[]) => {
    const o = orderEntities(ents, cur);
    cur = o.end;
    travel += o.travel;
    return o.ents;
  };
  const engrave = next(d.engrave.flatMap(lineOf));
  const label = next(d.label.flatMap(lineOf));
  const inner = next([...cut.innerClosed.flatMap(closedOf), ...cut.innerOpen.flatMap(openOf), ...d.circles.map((c): Entity => ({ k: "circle", c: c.c, d: c.d }))]);
  const outer = next([...cut.outerClosed.flatMap(closedOf), ...cut.outerOpen.flatMap(openOf)]);
  const bridge = next((d.bridge ?? []).flatMap(openOf));
  return { engrave, label, inner, outer, bridge, travel };
}

/** Rapid travel (mm) of the files written from this drawing with everything on (all layers, bridge gaps included). */
export function drawingTravel(d: Drawing): number {
  return cuttingSequence(d).travel;
}
