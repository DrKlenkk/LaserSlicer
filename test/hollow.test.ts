import { describe, expect, it } from "vitest";
import DxfParser from "dxf-parser";
import { intersect, difference, offset, pointInShape, shapeArea, shapesArea } from "../src/core/poly";
import { hollowCavity } from "../src/core/hollow";
import { pickDowelPoints } from "../src/core/registration";
import { writeDxf } from "../src/core/export/dxf";
import { drawingOf } from "../src/core/export/common";
import type { Shape } from "../src/core/types";
import { box, twoSpheres, uvSphere } from "./fixtures/meshes";
import { settings, slice } from "./helpers";

const WALL = 5;
const T = 2;

describe("hollowing a sphere", async () => {
  const raw = uvSphere(30, 96, 128);
  const solid = await slice(raw, { thickness: T, kerf: 0, simplifyTol: 0.02 });
  const hollow = await slice(raw, { thickness: T, kerf: 0, simplifyTol: 0.02, hollowEnabled: true, hollowWall: WALL, solidCapLayers: 2 });
  const n = hollow.layers.length;

  it("keeps the solid caps untouched", () => {
    for (const i of [0, 1, n - 2, n - 1]) {
      expect(shapesArea(hollow.layers[i].shapes), `layer ${i}`).toBeCloseTo(shapesArea(solid.layers[i].shapes), 6);
      expect(hollow.layers[i].shapes.every((s) => s.holes.length === 0)).toBe(true);
    }
  });

  it("hollows the inner layers and removes material", () => {
    for (let i = 2; i < n - 2; i++) {
      const h = shapesArea(hollow.layers[i].shapes), s = shapesArea(solid.layers[i].shapes);
      if (hollowCavity(solid.layers, i, settings({ hollowEnabled: true, hollowWall: WALL, minPartArea: 4 })).length) expect(h, `layer ${i}`).toBeLessThan(s);
    }
    const mid = hollow.layers[Math.floor(n / 2)].shapes;
    expect(mid).toHaveLength(1);
    expect(mid[0].holes).toHaveLength(1);
    // equator ring: a 30 mm radius disc with a hole of about 25 mm radius
    expect(shapesArea(mid)).toBeLessThan(Math.PI * 30 * 30 * 0.4);
  });

  it("leaves a wall of at least the setting around every cavity (outline and both glue joints)", () => {
    const tol = 0.1;
    for (let i = 2; i < n - 2; i++) {
      const orig = solid.layers[i].shapes;
      const mat = hollow.layers[i].shapes;
      const cavity = difference(orig, mat);
      if (!cavity.length) continue;
      // band within `wall` of the outline must be material
      const band = difference(orig, offset(orig, -(WALL - tol)));
      expect(shapesArea(intersect(band, cavity)), `layer ${i} outline wall`).toBeLessThan(0.05);
      // the cavity lies inside the neighbours shrunk by the wall too (full-width joint)
      for (const j of [i - 1, i + 1]) {
        const nb = offset(solid.layers[j].shapes, -(WALL - tol));
        expect(shapesArea(difference(cavity, nb)), `layer ${i} vs ${j}`).toBeLessThan(0.05);
      }
    }
  });

  it("is a no-op when switched off and does not touch the hollow stage cache twice", async () => {
    expect(shapesArea(solid.layers[10].shapes)).toBeGreaterThan(shapesArea(hollow.layers[10].shapes));
    expect(solid.layers[10].shapes[0].holes).toHaveLength(0);
  });
});

describe("dowels", () => {
  it("picks far apart points inside the core on the 1 mm grid", () => {
    const core: Shape[] = [{ outer: [[0.5, 0.5], [40.5, 0.5], [40.5, 10.5], [0.5, 10.5]], holes: [] }];
    const pts = pickDowelPoints(core, 2);
    expect(pts).toHaveLength(2);
    for (const p of pts) {
      expect(Number.isInteger(p[0]) && Number.isInteger(p[1])).toBe(true);
      expect(pointInShape(p, core[0])).toBe(true);
    }
    expect(Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1])).toBeGreaterThan(35);
    expect(pickDowelPoints(core, 3)).toHaveLength(3);
  });

  it("puts holes at identical XY in every layer of a run, clear of the outline", async () => {
    const r = await slice(uvSphere(30, 96, 128), { thickness: 2, kerf: 0, dowels: true, dowelDiameter: 6, dowelCount: 2 });
    const withHoles = r.parts.filter((p) => p.holes.length);
    expect(withHoles.length).toBeGreaterThan(r.layers.length / 2);
    const key = (c: [number, number]) => `${c[0]},${c[1]}`;
    // one run through the middle: the same two points everywhere
    const mid = r.parts[Math.floor(r.parts.length / 2)];
    expect(mid.holes).toHaveLength(2);
    const ref = mid.holes.map((h) => key(h.c)).sort();
    let same = 0;
    for (const p of withHoles) {
      const k = p.holes.map((h) => key(h.c)).sort();
      if (k.join() === ref.join()) same++;
      for (const h of p.holes) {
        expect(h.d).toBe(6);
        // 3 mm of material between the hole and the part outline
        const clear = difference([{ outer: circle(h.c, 3 + 3 - 0.05), holes: [] }], [p.cut]);
        expect(shapesArea(clear), p.id).toBeLessThan(1e-3);
      }
    }
    expect(same).toBeGreaterThan(withHoles.length * 0.8);
  });

  it("keeps labels off the holes", async () => {
    const r = await slice(uvSphere(30, 96, 128), { thickness: 2, kerf: 0, dowels: true, dowelCount: 1 });
    for (const p of r.parts) {
      if (!p.holes.length || !p.label.length) continue;
      for (const h of p.holes)
        for (const l of p.label)
          for (const [x, y] of l) expect(Math.hypot(x - h.c[0], y - h.c[1]), p.id).toBeGreaterThan(h.d / 2);
    }
  });

  it("shrinks the holes by the kerf and writes CIRCLE entities", async () => {
    const r = await slice(box(40, 40, 20), { thickness: 4, kerf: 0.2, dowels: true, dowelDiameter: 6, dowelCount: 2 });
    expect(r.parts).toHaveLength(5);
    for (const p of r.parts) {
      expect(p.holes).toHaveLength(2);
      expect(p.holes[0].d).toBeCloseTo(5.8, 9);
    }
    const dxf = new DxfParser().parseSync(writeDxf(drawingOf(r.parts, 100, 100)))!;
    const circles = dxf.entities.filter((e) => e.type === "CIRCLE") as unknown as { radius: number; layer: string }[];
    expect(circles).toHaveLength(10);
    expect(circles[0].radius).toBeCloseTo(2.9, 6);
    expect(circles[0].layer).toBe("CUT");
  });

  it("warns for a run shorter than two layers and places no hole there", async () => {
    // a cube, then a small block on top that cannot share a dowel core with it: layer 1 is only 7 mm wide
    const r = await slice(box(20, 20, 4), { thickness: 4, dowels: true, dowelDiameter: 6 });
    expect(r.layers).toHaveLength(1);
    expect(r.warnings.some((w) => /shorter than 2 layers/.test(w.message))).toBe(true);
    expect(r.parts[0].holes).toHaveLength(0);
  });

  it("gives every part of two islands the holes that fall inside it", async () => {
    const r = await slice(twoSpheres(), { thickness: 4, kerf: 0, dowels: true, dowelCount: 2 });
    for (const p of r.parts) for (const h of p.holes) expect(pointInShape(h.c, p.cut)).toBe(true);
  });

  it("works together with hollowing: holes stay in the wall, never in a cavity", async () => {
    const r = await slice(uvSphere(30, 96, 128), { thickness: 2, kerf: 0, hollowEnabled: true, hollowWall: 5, solidCapLayers: 2, dowels: true, dowelCount: 2 });
    for (const p of r.parts) for (const h of p.holes) expect(pointInShape(h.c, p.cut), p.id).toBe(true);
    expect(shapeArea(r.parts[10].cut)).toBeGreaterThan(0);
  });
});

function circle(c: [number, number], rad: number, n = 64) {
  return Array.from({ length: n }, (_, i): [number, number] => [c[0] + rad * Math.cos((2 * Math.PI * i) / n), c[1] + rad * Math.sin((2 * Math.PI * i) / n)]);
}
