// Registration aids (plan section 9): the engraved outline of the next layer and the engraved layer label.
// A cached pipeline stage between cleanup and kerf: it works on the uncompensated outlines, so changing the
// kerf never re-runs it (kerf only grows the cut outline outwards, so everything placed inside stays inside).
import type { Layer, Part, Ring, Settings, Shape, Vec2, Warning } from "./types";
import polylabel from "polylabel";
import { difference, intersect, offset, pointInShape, shapeArea, shapesArea } from "./poly";
import { textToPolylines, textWidth } from "./font/hershey";

/** Smallest label cap height (mm) before we give up on the joint area and fall back to the whole part. */
export const MIN_LABEL_HEIGHT = 3;
/** Free space kept around the label text box (mm). */
const CLEARANCE = 0.25;
/** polylabel precision (mm). */
const PRECISION = 0.1;

/** "L012" -> "L12", "L012-b" -> "L12-b" (the plan's label form; part ids keep the zero padding). */
export function labelText(partId: string): string {
  const m = /^L0*(\d+)(.*)$/.exec(partId);
  return m ? `L${m[1]}${m[2]}` : partId;
}

const close = (r: Ring): Vec2[] => [...r, r[0]];
const rect = (cx: number, cy: number, w: number, h: number): Shape => ({
  outer: [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]],
  holes: [],
});

/** Engrave polylines: every ring of the shapes, closed. */
function ringsOf(shapes: Shape[]): Vec2[][] {
  const out: Vec2[][] = [];
  for (const s of shapes) for (const r of [s.outer, ...s.holes]) if (r.length >= 3) out.push(close(r));
  return out;
}

type Pole = { c: Vec2; d: number };

/** Best interior point over all shapes of a region (the one with the largest clearance). */
function bestPole(region: Shape[]): Pole | null {
  let best: Pole | null = null;
  for (const s of region) {
    const poly = [s.outer, ...s.holes].map((r) => close(r));
    const p = polylabel(poly, PRECISION);
    if (p.distance > 0 && (!best || p.distance > best.d)) best = { c: [p[0], p[1]], d: p.distance };
  }
  return best;
}

type Fit = { height: number; rotate: boolean };

/**
 * Largest cap height (from `start` down to `MIN_LABEL_HEIGHT`) at which the text box centred on the pole lies
 * inside `region` with clearance; tries the text horizontal and turned by 90 degrees. The inscribed-circle test
 * (box diagonal within the pole distance) accepts the easy cases; the rest is checked with polygon operations:
 * box minus region must have no area.
 */
function fitText(text: string, pole: Pole, region: Shape[], start: number): Fit | null {
  const heights: number[] = [];
  for (let h = start; h > MIN_LABEL_HEIGHT; h *= 0.92) heights.push(h);
  heights.push(MIN_LABEL_HEIGHT);
  for (const h of heights) {
    const w = textWidth(text, h) + 2 * CLEARANCE;
    const hh = h + 2 * CLEARANCE;
    if (Math.hypot(w, hh) / 2 <= pole.d) return { height: h, rotate: false };
    for (const rotate of [false, true]) {
      const box = rotate ? rect(pole.c[0], pole.c[1], hh, w) : rect(pole.c[0], pole.c[1], w, hh);
      if (shapesArea(difference([box], region)) < 1e-3) return { height: h, rotate };
    }
  }
  return null;
}

/** Text strokes for `text` with the box centred at `c`, optionally turned by 90 degrees. */
function placeText(text: string, height: number, rotate: boolean, c: Vec2): Vec2[][] {
  const w = textWidth(text, height);
  return textToPolylines(text, height).map((line) =>
    line.map(([x, y]): Vec2 => {
      const dx = x - w / 2, dy = y - height / 2; // centre the box on the origin
      return rotate ? [c[0] - dy, c[1] + dx] : [c[0] + dx, c[1] + dy];
    }),
  );
}

// ---------- dowel holes (plan section 9, third bullet) ----------

/** Extra distance (mm) between a dowel hole and any outline, besides its radius. */
const DOWEL_EDGE = 3;
/** Upper bound on grid candidates per run (the 1 mm grid coarsens for very large cores). */
const MAX_CANDIDATES = 40000;

export type DowelRun = { first: number; last: number; points: Vec2[] };

/** Grid points (multiples of `step` mm) inside the shapes, by scanline (even-odd over all rings of the core). */
function gridPointsIn(shapes: Shape[]): Vec2[] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const sh of shapes)
    for (const [x, y] of sh.outer) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  if (!(minX <= maxX)) return [];
  let step = 1;
  const cells = ((maxX - minX) / step + 1) * ((maxY - minY) / step + 1);
  if (cells > MAX_CANDIDATES) step = Math.ceil(Math.sqrt(cells / MAX_CANDIDATES));
  const rings: Ring[] = shapes.flatMap((sh) => [sh.outer, ...sh.holes]);
  const pts: Vec2[] = [];
  for (let y = Math.ceil(minY / step) * step; y <= maxY; y += step) {
    const xs: number[] = [];
    for (const r of rings)
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [xi, yi] = r[i], [xj, yj] = r[j];
        if (yi > y !== yj > y) xs.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
      }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2)
      for (let x = Math.ceil(xs[k] / step) * step; x <= xs[k + 1]; x += step) pts.push([x, y]);
  }
  return pts;
}

/**
 * Picks `count` points in a core as far apart as possible: the first is the candidate farthest from the centroid,
 * every further one the candidate farthest from all points chosen so far (farthest-point sampling).
 */
export function pickDowelPoints(core: Shape[], count: number): Vec2[] {
  const cand = gridPointsIn(core);
  if (cand.length === 0) {
    const pole = bestPole(core); // tiny core without a grid point: its most interior point
    return pole ? [pole.c] : [];
  }
  let cx = 0, cy = 0;
  for (const [x, y] of cand) { cx += x; cy += y; }
  cx /= cand.length; cy /= cand.length;
  const dist = new Float64Array(cand.length); // squared distance to the nearest chosen point
  const chosen: Vec2[] = [];
  let ref: Vec2 = [cx, cy];
  for (let k = 0; k < count && k < cand.length; k++) {
    let best = -1, bd = -1;
    for (let i = 0; i < cand.length; i++) {
      const d = k === 0 ? (cand[i][0] - ref[0]) ** 2 + (cand[i][1] - ref[1]) ** 2 : dist[i];
      if (d > bd) { bd = d; best = i; }
    }
    ref = cand[best];
    chosen.push(ref);
    for (let i = 0; i < cand.length; i++) {
      const d = (cand[i][0] - ref[0]) ** 2 + (cand[i][1] - ref[1]) ** 2;
      dist[i] = k === 0 ? d : Math.min(dist[i], d);
    }
    if (bd <= 0 && k > 0) { chosen.pop(); break; }
  }
  return chosen;
}

/**
 * Runs of consecutive layers that share a core: the intersection over the run of every layer's shapes shrunk by
 * `dowelDiameter / 2 + 3 mm` (so a dowel centred anywhere in the core stays 3 mm clear of every outline and cavity).
 * Greedy: a run grows while the core stays non-empty. Runs of one layer get no holes (nothing to join) and a warning.
 */
export function planDowels(layers: Layer[], s: Settings): { runs: DowelRun[]; warnings: Warning[] } {
  const warnings: Warning[] = [];
  const runs: DowelRun[] = [];
  const reach = s.dowelDiameter / 2 + DOWEL_EDGE;
  const shrunk = layers.map((l) => offset(l.shapes, -reach, "miter", 2));
  const tooSmall: number[] = [];
  const area = (sh: Shape[]) => shapesArea(sh);
  for (let i = 0; i < layers.length; ) {
    if (area(shrunk[i]) < 1e-3) {
      if (layers[i].shapes.length) tooSmall.push(i);
      i++;
      continue;
    }
    let core = shrunk[i];
    let j = i;
    while (j + 1 < layers.length) {
      const c = intersect(core, shrunk[j + 1]);
      if (area(c) < 1e-3) break;
      core = c;
      j++;
    }
    if (j === i) {
      warnings.push({ level: "warn", layer: i, message: `Dowel run at layer ${i} is shorter than 2 layers (the next layer shares no room for a ${s.dowelDiameter} mm dowel); no dowel holes there` });
    } else {
      const points = pickDowelPoints(core, s.dowelCount);
      if (points.length < s.dowelCount)
        warnings.push({ level: "info", layer: i, message: `Layers ${i} to ${j}: room for only ${points.length} of ${s.dowelCount} dowels` });
      runs.push({ first: i, last: j, points });
    }
    i = j + 1;
  }
  if (tooSmall.length)
    warnings.push({ level: "info", layer: tooSmall[0], message: `Too small for dowel holes: layer${tooSmall.length > 1 ? "s" : ""} ${compact(tooSmall)}` });
  if (runs.length === 0 && layers.some((l) => l.shapes.length))
    warnings.push({ level: "warn", message: "Dowels are on, but no stretch of two or more layers has room for a dowel hole" });
  return { runs, warnings };
}

function compact(ix: number[]): string {
  const out: string[] = [];
  for (let k = 0; k < ix.length; ) {
    let e = k;
    while (e + 1 < ix.length && ix[e + 1] === ix[e] + 1) e++;
    out.push(e > k ? `${ix[k]}-${ix[e]}` : String(ix[k]));
    k = e + 1;
  }
  return out.join(", ");
}

/** Circle as a polygon, used to keep other features clear of a hole. */
function circleShape(c: Vec2, r: number, n = 32): Shape {
  const outer: Ring = [];
  for (let i = 0; i < n; i++) outer.push([c[0] + r * Math.cos((2 * Math.PI * i) / n), c[1] + r * Math.sin((2 * Math.PI * i) / n)]);
  return { outer, holes: [] };
}

/** Free space (mm) kept between a dowel hole and a label. */
const LABEL_HOLE_CLEARANCE = 1;

/**
 * Fills `engrave`, `label` and dowel `holes` of every part. `layers[i].shapes` are the cleaned (uncompensated) outlines that
 * `parts` were made from. Returns new parts (inputs are not mutated).
 */
export function addRegistration(layers: Layer[], parts: Part[], s: Settings): { parts: Part[]; warnings: Warning[] } {
  const warnings: Warning[] = [];
  const out: Part[] = [];
  const dowels = s.dowels ? planDowels(layers, s) : null;
  if (dowels) warnings.push(...dowels.warnings);
  // With hollowing the cavity edges are not interesting as engrave lines (they are cut anyway), so only outer rings count.
  const solid = (sh: Shape[]): Shape[] => (s.hollowEnabled ? sh.map((x) => ({ outer: x.outer, holes: [] })) : sh);
  for (const p0 of parts) {
    const holes: Part["holes"] = [];
    for (const run of dowels?.runs ?? [])
      if (p0.layer >= run.first && p0.layer <= run.last)
        for (const c of run.points) if (pointInShape(c, p0.cut)) holes.push({ c, d: s.dowelDiameter });
    const p = { ...p0, holes };
    const avoid: Shape[] = holes.map((hl) => circleShape(hl.c, hl.d / 2 + LABEL_HOLE_CLEARANCE));
    const clearOfHoles = (region: Shape[]) => (avoid.length ? difference(region, avoid) : region);
    const next = layers[p.layer + 1]?.shapes ?? [];
    const jointFull = next.length ? intersect([p.cut], next) : [];
    const joint = clearOfHoles(jointFull);
    let engrave: Vec2[][] = [];
    if (s.engraveNextOutline && jointFull.length) {
      // When the next layer covers the whole part (the stack grows upwards) the joint outline is the part's own
      // edge: engraving it would only retrace the cut line, so the part gets no engrave line (see DECISIONS.md).
      const j = solid(jointFull);
      if (shapesArea(j) < shapeArea(solid([p.cut])[0]) * 0.999) engrave = ringsOf(j);
    }
    let label: Vec2[][] = [];
    if (s.labels) {
      const text = labelText(p.id);
      const start = Math.max(s.labelHeight, MIN_LABEL_HEIGHT);
      let fit: { pole: Pole; fit: Fit } | null = null;
      const pole = joint.length ? bestPole(joint) : null;
      if (pole) {
        const f = fitText(text, pole, joint, start);
        if (f) fit = { pole, fit: f };
      }
      if (!fit) {
        // Top layer, or the joint area is too small / empty: anywhere inside the part.
        const ownRegion = clearOfHoles([p.cut]);
        const own = bestPole(ownRegion);
        if (own) {
          const f = fitText(text, own, ownRegion, start);
          if (f) fit = { pole: own, fit: f };
          else {
            // Not even 3 mm fits: shrink to what the inscribed circle allows, or skip when it is unreadable.
            const k = textWidth(text, 1);
            const hgt = Math.min(start, (2 * (own.d - CLEARANCE)) / Math.hypot(k, 1));
            if (hgt >= 1) {
              fit = { pole: own, fit: { height: hgt, rotate: false } };
              warnings.push({ level: "warn", layer: p.layer, partId: p.id, message: `Label of ${p.id} shrunk to ${hgt.toFixed(1)} mm (part is very small)` });
            } else {
              warnings.push({ level: "warn", layer: p.layer, partId: p.id, message: `Part ${p.id} is too small for a label` });
            }
          }
          if (fit && next.length && fit.fit.height >= MIN_LABEL_HEIGHT - 1e-9)
            warnings.push({ level: "info", layer: p.layer, partId: p.id, message: `Label of ${p.id} does not fit under the next layer; placed inside the part` });
        }
      }
      if (fit) label = placeText(text, fit.fit.height, fit.fit.rotate, fit.pole.c);
    }
    out.push({ ...p, engrave, label, holes });
  }
  return { parts: out, warnings };
}
