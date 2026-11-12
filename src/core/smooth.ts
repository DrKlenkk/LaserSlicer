// Outline smoothing (setting `smoothRadius`): a morphological filter with round joins whose direction follows the outline mode,
// so the mode's promise survives.
//
//   oversize  : closing  (grow by r, shrink by r)  -> the result always contains the input. Notches, steps and
//               inside corners are filled; inside corners get a fillet of radius r. Outside corners are NOT touched
//               (rounding them would cut material away), so a real sharp corner of the model is kept.
//   undersize : opening  (shrink by r, grow by r)  -> the result always lies inside the input. Spikes, bumps and
//               outside corners are shaved (fillet of radius r); inside corners are kept.
//   midplane  : closing, then opening (no side is promised): notches are filled and bumps are shaved.
//
// Features narrower than 2r on the removable side disappear: slots and gaps in oversize (they are filled), thin walls,
// small islands and spikes in undersize and mid-plane.
//
// Not done on purpose: turning the facets of a polygonal arc into a curve. A morphological filter cannot do it (rounding the
// facet corners with radius r only changes the outline by about r * (1 / cos(turn / 2) - 1), a few micrometres, because the
// corner turns by only 5 to 20 degrees), and a curve fit that stays on the permitted side (outside the outline in oversize,
// inside in undersize) was tried and dropped: see DECISIONS.md.
import type { Settings, Shape } from "./types";
import { cleanShapes, offset } from "./poly";

export type SmoothMode = Settings["mode"];

/** Arc tolerance (mm) of the round joins: the largest distance of a fillet polygon from its circle. */
export const ARC_TOL = 0.005;

/** Round-join offset pair; `d` > 0 grows first (closing), `d` < 0 shrinks first (opening). */
function morph(shapes: Shape[], d: number): Shape[] {
  return offset(offset(shapes, d, "round", 2, ARC_TOL), -d, "round", 2, ARC_TOL);
}

/**
 * The offset pair returns a sharp corner as a short run of vertices that cuts up to ARC_TOL off its tip. To make the promised side
 * exact the result is moved by SAFETY (6 micrometres: the arc tolerance plus the 1 micrometre grid) in the permitted direction. (Uniting
 * with the input instead restores the tips exactly but leaves a tiny spur at every sharp tip.)
 */
const SAFETY = ARC_TOL + 0.001;
/** Edges shorter than this (mm) are merged afterwards: the tips of the fillets leave 5 to 15 micrometre jags. */
const MIN_EDGE = 0.015;

/** Closing that never loses material (outline only moves outwards, by at most SAFETY more than the filled notches). */
export function closing(shapes: Shape[], r: number): Shape[] {
  return r > 0 && shapes.length ? cleanShapes(offset(morph(shapes, r), SAFETY, "round", 2, 0.002), MIN_EDGE) : shapes;
}

/** Opening that never adds material (the mirror image of `closing`). */
export function opening(shapes: Shape[], r: number): Shape[] {
  return r > 0 && shapes.length ? cleanShapes(offset(morph(shapes, -r), -SAFETY, "round", 2, 0.002), MIN_EDGE) : shapes;
}

/** Smooth the outlines of one layer; `r` is the radius in mm (0 = unchanged). */
export function smoothShapes(shapes: Shape[], r: number, mode: SmoothMode): Shape[] {
  if (!(r > 0) || shapes.length === 0) return shapes;
  if (mode === "oversize") return closing(shapes, r);
  if (mode === "undersize") return opening(shapes, r);
  return opening(closing(shapes, r), r);
}
