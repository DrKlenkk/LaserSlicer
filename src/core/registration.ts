// Registration aids (plan section 9): the engraved outline of the next layer and the engraved layer label.
// A cached pipeline stage between cleanup and kerf: it works on the uncompensated outlines, so changing the
// kerf never re-runs it (kerf only grows the cut outline outwards, so everything placed inside stays inside).
import type { Layer, Part, Ring, Settings, Shape, Vec2, Warning } from "./types";
import polylabel from "polylabel";
import { difference, intersect, shapeArea, shapesArea } from "./poly";
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

/**
 * Fills `engrave` and `label` of every part. `layers[i].shapes` are the cleaned (uncompensated) outlines that
 * `parts` were made from. Returns new parts (inputs are not mutated).
 */
export function addRegistration(layers: Layer[], parts: Part[], s: Settings): { parts: Part[]; warnings: Warning[] } {
  const warnings: Warning[] = [];
  const out: Part[] = [];
  for (const p of parts) {
    const next = layers[p.layer + 1]?.shapes ?? [];
    const joint = next.length ? intersect([p.cut], next) : [];
    let engrave: Vec2[][] = [];
    if (s.engraveNextOutline && joint.length) {
      // When the next layer covers the whole part (the stack grows upwards) the joint outline is the part's own
      // edge: engraving it would only retrace the cut line, so the part gets no engrave line (see DECISIONS.md).
      if (shapesArea(joint) < shapeArea(p.cut) * 0.999) engrave = ringsOf(joint);
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
        const own = bestPole([p.cut]);
        if (own) {
          const f = fitText(text, own, [p.cut], start);
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
    out.push({ ...p, engrave, label });
  }
  return { parts: out, warnings };
}
