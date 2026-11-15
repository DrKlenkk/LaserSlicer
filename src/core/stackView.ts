// Maths of the 3D view's "Explode" and "Section" controls (view only: slicing and export never see them). Pure, no DOM, no three.js.
import type { Layer } from "./types";

/** Horizontal axis the section plane is perpendicular to. */
export type SectionAxis = "x" | "y";

/** At 100 % the gap between neighbouring layers is this many layer thicknesses. */
export const MAX_EXPLODE_GAP = 1;

/** Added height of layer `index` for an explode fraction 0..1 (0 = stacked, 1 = a gap of MAX_EXPLODE_GAP thicknesses between layers). */
export function explodeOffset(index: number, thickness: number, frac: number): number {
  const f = Math.min(1, Math.max(0, frac));
  return index * thickness * MAX_EXPLODE_GAP * f;
}

/** Horizontal extent (min, max) of all layers along an axis, or null for an empty stack. */
export function stackExtent(layers: Layer[], axis: SectionAxis): [number, number] | null {
  const k = axis === "x" ? 0 : 1;
  let lo = Infinity, hi = -Infinity;
  for (const l of layers)
    for (const s of l.shapes)
      for (const p of s.outer) {
        if (p[k] < lo) lo = p[k];
        if (p[k] > hi) hi = p[k];
      }
  return lo <= hi ? [lo, hi] : null;
}

/** Plane of three.js (`dot(normal, p) + constant >= 0` is kept). */
export type SectionPlane = { normal: [number, number, number]; constant: number };

/** Constant that clips nothing. */
export const NO_SECTION = 1e9;

/**
 * Section fraction 0..1: 0 = no cut, then the plane moves from the maximum side of the stack towards the minimum side and
 * everything beyond it (larger coordinate) is cut away; 1 = the plane is at the minimum (nothing is left).
 */
export function sectionPlane(axis: SectionAxis, frac: number, extent: [number, number] | null): SectionPlane {
  const normal: [number, number, number] = axis === "x" ? [-1, 0, 0] : [0, -1, 0];
  if (!extent || !(frac > 0)) return { normal, constant: NO_SECTION };
  const f = Math.min(1, frac);
  return { normal, constant: extent[1] - f * (extent[1] - extent[0]) };
}

/** True when a point on the section axis is kept by the plane (testing aid and documentation of the sign convention). */
export function keeps(plane: SectionPlane, p: [number, number, number]): boolean {
  return plane.normal[0] * p[0] + plane.normal[1] * p[1] + plane.normal[2] * p[2] + plane.constant >= 0;
}
