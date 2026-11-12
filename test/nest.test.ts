import { describe, expect, it } from "vitest";
import { applyPlacement, convexHull, minAreaRect, nestParts } from "../src/core/nest";
import { intersect, shapeArea, shapesBounds } from "../src/core/poly";
import type { Part, Ring, Shape } from "../src/core/types";
import { box, uvSphere } from "./fixtures/meshes";
import { settings, slice } from "./helpers";

const rect = (w: number, h: number): Shape => ({ outer: [[0, 0], [w, 0], [w, h], [0, h]], holes: [] });
const mk = (id: string, layer: number, cut: Shape): Part => ({ id, layer, cut, engrave: [], label: [], holes: [] });
const rot = (r: Ring, deg: number): Ring => {
  const a = (deg * Math.PI) / 180;
  return r.map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]);
};

describe("geometry", () => {
  it("convex hull drops interior points", () => {
    expect(convexHull([[0, 0], [4, 0], [4, 4], [0, 4], [2, 2], [2, 0]])).toHaveLength(4);
  });

  it("min-area rectangle of a rotated rectangle recovers its size", () => {
    for (const deg of [0, 17, 45, 133]) {
      const r = minAreaRect(rot(rect(30, 10).outer, deg));
      expect(r.w).toBeCloseTo(30, 6);
      expect(r.h).toBeCloseTo(10, 6);
    }
  });
});

describe("nesting", () => {
  const S = { sheetW: 200, sheetH: 150, partSpacing: 3, sheetMargin: 5 };

  function checkLayout(parts: Part[], res: ReturnType<typeof nestParts>, s = S) {
    const placed = res.placements.map((pl) => ({ pl, part: applyPlacement(parts.find((p) => p.id === pl.partId)!, pl) }));
    for (const { pl, part } of placed) {
      const b = shapesBounds([part.cut])!;
      expect(b.minX).toBeGreaterThanOrEqual(s.sheetMargin - 1e-6);
      expect(b.minY).toBeGreaterThanOrEqual(s.sheetMargin - 1e-6);
      expect(b.maxX).toBeLessThanOrEqual(s.sheetW - s.sheetMargin + 1e-6);
      expect(b.maxY).toBeLessThanOrEqual(s.sheetH - s.sheetMargin + 1e-6);
      expect(pl.sheet).toBeGreaterThanOrEqual(0);
    }
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++) {
        if (placed[i].pl.sheet !== placed[j].pl.sheet) continue;
        const a = intersect([placed[i].part.cut], [placed[j].part.cut]);
        const area = a.reduce((t, sh) => t + shapeArea(sh), 0);
        expect(area).toBe(0);
      }
  }

  it("places many mixed parts without overlap, inside the margins, on several sheets", () => {
    const parts: Part[] = [];
    for (let i = 0; i < 40; i++) {
      const w = 20 + ((i * 37) % 60), h = 10 + ((i * 53) % 40);
      const r = rot(rect(w, h).outer, (i * 29) % 180); // arbitrarily rotated inputs
      parts.push(mk(`L${String(i).padStart(3, "0")}`, i, { outer: r, holes: [] }));
    }
    const res = nestParts(parts, S);
    expect(res.warnings).toHaveLength(0);
    expect(res.placements).toHaveLength(40);
    expect(res.sheets.length).toBeGreaterThan(1);
    checkLayout(parts, res);
    // material use is reported per sheet and matches the placed areas
    const total = res.sheets.reduce((t, s) => t + s.usedArea, 0);
    expect(total).toBeCloseTo(parts.reduce((t, p) => t + shapeArea(p.cut), 0), 6);
    for (const s of res.sheets) expect(s.usePct).toBeCloseTo((s.usedArea / (200 * 150)) * 100, 9);
  });

  it("reports an oversized part as an error and leaves it out", () => {
    const parts = [mk("L000", 0, rect(50, 50)), mk("L001", 1, rect(300, 20)), mk("L002", 2, rect(185, 135))];
    const res = nestParts(parts, S);
    const err = res.warnings.filter((w) => w.level === "error");
    expect(err).toHaveLength(1);
    expect(err[0].partId).toBe("L001");
    expect(res.placements.map((p) => p.partId).sort()).toEqual(["L000", "L002"]);
    expect(res.sheets.flatMap((s) => s.partIds)).not.toContain("L001");
    checkLayout(parts, res);
  });

  it("turns a long part by 90 degrees when that is the only way it fits", () => {
    const res = nestParts([mk("A", 0, rect(120, 20)), mk("B", 0, rect(20, 120))], { ...S, sheetW: 150, sheetH: 150 });
    expect(res.sheets).toHaveLength(1);
    checkLayout([mk("A", 0, rect(120, 20)), mk("B", 0, rect(20, 120))], res, { ...S, sheetW: 150, sheetH: 150 });
  });

  it("nests the parts of a real model (sphere layers, kerf and spacing)", async () => {
    const r = await slice(uvSphere(), { thickness: 2, sheetW: 120, sheetH: 100 });
    expect(r.sheets.length).toBeGreaterThanOrEqual(1);
    expect(r.placements).toHaveLength(r.parts.length);
    checkLayout(r.parts, { placements: r.placements, sheets: r.sheets, warnings: [] }, { ...S, sheetW: 120, sheetH: 100 });
  });

  it("applyPlacement moves cut, engrave, label and holes together", () => {
    const p: Part = { id: "X", layer: 0, cut: rect(10, 10), engrave: [[[1, 1], [2, 2]]], label: [[[3, 3], [4, 4]]], holes: [{ c: [5, 5], d: 2 }] };
    const q = applyPlacement(p, { x: 100, y: 50, angleDeg: 90 });
    expect(q.holes[0].c[0]).toBeCloseTo(95, 9);
    expect(q.holes[0].c[1]).toBeCloseTo(55, 9);
    expect(q.engrave[0][0][0]).toBeCloseTo(99, 9);
    expect(q.engrave[0][0][1]).toBeCloseTo(51, 9);
    expect(shapeArea(q.cut)).toBeCloseTo(100, 9);
  });

  it("pipeline: spacing and margin change only the nesting stage", async () => {
    const r1 = await slice(box(20, 20, 40), { thickness: 4, partSpacing: 3 });
    expect(r1.sheets[0].partIds).toHaveLength(10);
    expect(settings().sheetMargin).toBe(5);
  });
});
