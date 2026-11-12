// Hollowing (plan section 8): cut a cavity into the inner layers while keeping a full-width wall at every glue joint.
//
// For layer i (not within `solidCapLayers` of the bottom or the top):
//   support = layer[i-1] ∩ layer[i] ∩ layer[i+1]     the material both neighbours also have above and below
//   hole    = offset(support, -wall)                  at least `wall` from every outline of the three layers
//   layer[i] = layer[i] − hole
// The hole stays inside the support, so each glue joint (the overlap of two layers) keeps a ring at least `wall`
// wide, and the part's own outline is never touched. Pieces of the hole smaller than minPartArea are dropped
// (they would leave unprintable pinholes), and island detection is run again on the result.
import type { Layer, Part, Settings, Shape, Warning } from "./types";
import { difference, intersect, offset, shapeArea } from "./poly";
import { partIds } from "./layers";

export type HollowSettings = Pick<Settings, "hollowEnabled" | "hollowWall" | "solidCapLayers" | "minPartArea">;

/** The cavity of layer `i`, or an empty list when it stays solid. `layers` are the cleaned outlines. */
export function hollowCavity(layers: Layer[], i: number, s: HollowSettings): Shape[] {
  const n = layers.length;
  const cap = Math.max(0, Math.floor(s.solidCapLayers));
  if (i < cap || i >= n - cap || i === 0 || i === n - 1) return [];
  const here = layers[i].shapes;
  if (!here.length || !layers[i - 1].shapes.length || !layers[i + 1].shapes.length) return [];
  const support = intersect(intersect(layers[i - 1].shapes, here), layers[i + 1].shapes);
  if (!support.length) return [];
  const hole = offset(support, -s.hollowWall, "miter", 2);
  return hole.filter((h) => shapeArea(h) >= s.minPartArea);
}

/** Hollows the layers and rebuilds the parts (new island split and ids). Layers that stay solid are returned unchanged. */
export function hollowLayers(layers: Layer[], parts: Part[], s: HollowSettings): { layers: Layer[]; parts: Part[]; warnings: Warning[] } {
  if (!s.hollowEnabled || s.hollowWall <= 0) return { layers, parts, warnings: [] };
  const warnings: Warning[] = [];
  const outLayers: Layer[] = [];
  const outParts: Part[] = [];
  let hollowed = 0;
  for (let i = 0; i < layers.length; i++) {
    const L = layers[i];
    const cavity = hollowCavity(layers, i, s);
    if (!cavity.length) {
      outLayers.push(L);
      outParts.push(...parts.filter((p) => p.layer === i));
      continue;
    }
    hollowed++;
    const shapes = difference(L.shapes, cavity)
      .map((sh) => ({ sh, area: shapeArea(sh) }))
      .sort((a, b) => b.area - a.area)
      .filter(({ area }) => {
        if (area >= s.minPartArea) return true;
        warnings.push({ level: "warn", layer: i, message: `Hollowing left a ${area.toFixed(2)} mm² piece in layer ${i}; it was removed` });
        return false;
      })
      .map(({ sh }) => sh);
    outLayers.push({ ...L, shapes });
    const ids = partIds(i, shapes.length);
    shapes.forEach((cut, j) => outParts.push({ id: ids[j], layer: i, cut, engrave: [], label: [], holes: [] }));
  }
  if (hollowed === 0)
    warnings.push({ level: "info", message: "Hollowing is on, but no layer has room for a cavity (wall too thick or too few layers)" });
  return { layers: outLayers, parts: outParts, warnings };
}
