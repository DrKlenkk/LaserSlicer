// Kerf compensation (plan section 10): a separate pipeline stage, so changing the kerf never re-slices.
import type { Part, Shape, Warning } from "./types";
import { offset, shapeArea } from "./poly";

/**
 * Offset the cut outline of every part by +kerf/2 (Miter join, miter limit 2). One offset of the whole
 * shape grows the outer outline and shrinks the holes. Dowel holes are holes too: their diameter shrinks by
 * kerf (radius by kerf/2). Engrave and label lines are never offset.
 *
 * The input parts carry the uncompensated outline; the result is a new array.
 */
export function applyKerf(parts: Part[], kerf: number): { parts: Part[]; warnings: Warning[] } {
  const warnings: Warning[] = [];
  const out: Part[] = [];
  for (const p of parts) {
    const holes = p.holes.map((h) => ({ c: h.c, d: h.d - kerf })).filter((h) => h.d > 0);
    if (!(kerf > 0)) {
      out.push({ ...p, holes });
      continue;
    }
    const grown = offset([p.cut], kerf / 2, "miter", 2);
    if (grown.length === 0) {
      warnings.push({ level: "warn", layer: p.layer, partId: p.id, message: `Part ${p.id} vanished in the kerf offset and was dropped` });
      continue;
    }
    // A thin neck can in theory split a shape: keep the largest piece and say so.
    let cut: Shape = grown[0];
    if (grown.length > 1) {
      cut = grown.reduce((a, b) => (shapeArea(b) > shapeArea(a) ? b : a));
      warnings.push({ level: "warn", layer: p.layer, partId: p.id, message: `Kerf offset split ${p.id} into ${grown.length} pieces; only the largest is kept` });
    }
    out.push({ ...p, cut, holes });
  }
  return { parts: out, warnings };
}
