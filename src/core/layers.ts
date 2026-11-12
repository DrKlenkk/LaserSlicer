// Layer heights, outline modes and cleanup (plan sections 3, 5, 6, 7).
import type { Settings, Shape, Warning } from "./types";
import { intersect, offset, ringArea, shapeArea, simplify, union } from "./poly";

/** Margin that keeps sample planes off the layer faces (mm). */
export const SAMPLE_EPS = 1e-4;
export const MAX_LAYERS = 5000;

export type LayerSpec = {
  index: number;
  z0: number;
  z1: number;
  /** plane heights for this layer, ascending, before nudging away from vertices */
  samples: number[];
};

export type LayerPlan = {
  count: number;
  thickness: number;
  /** model height used for planning */
  height: number;
  /** how far the stack sticks out above the model (count * t - height) */
  overshoot: number;
  specs: LayerSpec[];
};

/** Uniform scale factor so that height becomes a whole number of layers (plan: roundHeightToLayers). */
export function roundHeightFactor(height: number, thickness: number): number {
  if (!(height > 0) || !(thickness > 0)) return 1;
  const n = Math.max(1, Math.round(height / thickness));
  return (n * thickness) / height;
}

export function planLayers(height: number, s: Pick<Settings, "thickness" | "mode" | "samplesPerLayer">): LayerPlan {
  const t = s.thickness;
  if (!(t > 0)) throw new Error("Material thickness must be greater than 0");
  if (!(height > 1e-9)) throw new Error("The model has no height along the slicing axis");
  // The tolerance stops 20.0000001 / 4 from becoming 6 layers.
  const count = Math.max(1, Math.ceil(height / t - 1e-6));
  if (count > MAX_LAYERS) throw new Error(`Too many layers (${count}); increase the material thickness`);
  const k = s.mode === "midplane" ? 1 : Math.max(1, Math.floor(s.samplesPerLayer));
  const specs: LayerSpec[] = [];
  for (let i = 0; i < count; i++) {
    const z0 = i * t, z1 = (i + 1) * t;
    const samples: number[] = [];
    if (k === 1) samples.push((z0 + z1) / 2);
    else for (let j = 0; j < k; j++) samples.push(z0 + SAMPLE_EPS + ((z1 - z0 - 2 * SAMPLE_EPS) * j) / (k - 1));
    specs.push({ index: i, z0, z1, samples });
  }
  return { count, thickness: t, height, overshoot: count * t - height, specs };
}

/**
 * Plan section 6: combine the sample sections of one layer.
 * Oversize = union (covers the model everywhere in the layer), undersize = intersection
 * (never sticks out), mid-plane = the single section.
 */
export function combineSamples(mode: Settings["mode"], samples: Shape[][]): Shape[] {
  if (samples.length === 0) return [];
  if (mode === "midplane" || samples.length === 1) return samples[0];
  let acc = samples[0];
  for (let i = 1; i < samples.length; i++) {
    acc = mode === "oversize" ? union(acc, samples[i]) : intersect(acc, samples[i]);
    if (acc.length === 0 && mode === "undersize") break;
  }
  return acc;
}

/** "L012" */
export function layerLabel(index: number): string {
  return `L${String(index).padStart(3, "0")}`;
}

/** Island suffix: a, b, ... z, aa, ab ... */
function suffix(i: number): string {
  let s = "";
  let n = i;
  do {
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/**
 * Ids for the shapes of a layer (in area-sorted order). A lone shape is "L012"; several
 * islands are "L012-a" (largest), "L012-b", ...
 */
export function partIds(index: number, count: number): string[] {
  const label = layerLabel(index);
  if (count === 1) return [label];
  return Array.from({ length: count }, (_, i) => `${label}-${suffix(i)}`);
}

/**
 * Plan section 7: cleanup of one layer's outline. Returns shapes sorted by area, largest first;
 * that order defines the island ids. Removed pieces are reported in `warnings` under the id
 * they would have had before removal (so "L003-c removed" sorts last, after the kept islands).
 */
export function cleanupLayer(
  index: number,
  shapes: Shape[],
  s: Pick<Settings, "simplifyTol" | "minPartArea" | "minFeature">,
  warnings: Warning[],
): Shape[] {
  let cur = shapes;
  if (cur.length === 0) return cur;
  if (s.simplifyTol > 0) cur = simplify(cur, s.simplifyTol);
  if (s.minFeature > 0) {
    // Morphological opening: erode by r then dilate by r removes slivers and necks thinner than 2r.
    // Miter joins keep the sharp convex corners of the model (round joins would round them).
    const r = s.minFeature / 2;
    cur = offset(offset(cur, -r, "miter", 2), r, "miter", 2);
  }
  const sorted = cur.map((sh) => ({ sh, area: shapeArea(sh) })).sort((a, b) => b.area - a.area);
  const ids = partIds(index, sorted.length);
  const kept: Shape[] = [];
  sorted.forEach(({ sh, area }, i) => {
    const id = ids[i];
    if (s.minPartArea > 0 && area < s.minPartArea) {
      warnings.push({
        level: "warn",
        layer: index,
        partId: id,
        message: `Part ${id} removed in layer ${index} (${area.toFixed(2)} mm² is below ${s.minPartArea} mm²)`,
      });
      return;
    }
    const holes = sh.holes.filter((h) => {
      const ha = Math.abs(ringArea(h));
      if (s.minPartArea > 0 && ha < s.minPartArea) {
        warnings.push({
          level: "warn",
          layer: index,
          partId: id,
          message: `Hole of ${ha.toFixed(2)} mm² removed from ${id} in layer ${index}`,
        });
        return false;
      }
      return true;
    });
    kept.push({ outer: sh.outer, holes });
  });
  return kept;
}
