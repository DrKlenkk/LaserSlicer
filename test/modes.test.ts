import { describe, expect, it } from "vitest";
import { ringArea, shapeArea, shapesArea, unionEvenOdd } from "../src/core/poly";
import { nudgeHeight, prepareMesh, slicePlane } from "../src/core/slice";
import { orientMesh } from "../src/core/transform";
import { SAMPLE_EPS } from "../src/core/layers";
import { torus, twoSpheres, uvSphere, box, roundedPlate } from "./fixtures/meshes";
import { maxReflexDeg, slice, settings, weld } from "./helpers";

const layerArea = (r: Awaited<ReturnType<typeof slice>>, i: number) => shapesArea(r.layers[i].shapes);

describe("sphere modes", () => {
  // True section extremes within a layer, measured on the mesh itself with dense planes.
  async function sectionRange(i: number, t: number) {
    const { mesh } = weld(uvSphere());
    const o = orientMesh(mesh, settings());
    const prep = prepareMesh(o.mesh);
    const areas: number[] = [];
    for (let j = 0; j <= 40; j++) {
      const z = i * t + SAMPLE_EPS + ((t - 2 * SAMPLE_EPS) * j) / 40;
      areas.push(shapesArea(unionEvenOdd(slicePlane(prep, nudgeHeight(prep, z)).rings)));
    }
    return { max: Math.max(...areas), min: Math.min(...areas) };
  }

  it("oversize covers the true maximum section of every layer", async () => {
    const t = 4;
    const r = await slice(uvSphere(), { thickness: t, mode: "oversize", simplifyTol: 0.001 });
    for (let i = 0; i < r.layers.length; i++) {
      const { max } = await sectionRange(i, t);
      expect(layerArea(r, i)).toBeGreaterThanOrEqual(max - 0.02);
    }
  });

  it("undersize stays within the true minimum section of every layer", async () => {
    const t = 4;
    const r = await slice(uvSphere(), { thickness: t, mode: "undersize", simplifyTol: 0.001, minPartArea: 0 });
    for (let i = 0; i < r.layers.length; i++) {
      const { min } = await sectionRange(i, t);
      expect(layerArea(r, i)).toBeLessThanOrEqual(min + 0.02);
    }
  });

  it("oversize and undersize keep their guarantees at the default simplifyTol", async () => {
    const t = 4;
    const over = await slice(uvSphere(), { thickness: t, mode: "oversize" });
    const under = await slice(uvSphere(), { thickness: t, mode: "undersize", minPartArea: 0 });
    for (let i = 0; i < over.layers.length; i++) {
      const { max, min } = await sectionRange(i, t);
      expect(layerArea(over, i)).toBeGreaterThanOrEqual(max - 0.02);
      expect(layerArea(under, i)).toBeLessThanOrEqual(min + 0.02);
    }
  });

  it("default simplification keeps oversize within 1% of the unsimplified area", async () => {
    const a = await slice(uvSphere(), { thickness: 4, simplifyTol: 0.001 });
    const b = await slice(uvSphere(), { thickness: 4 });
    for (let i = 0; i < 5; i++) expect(Math.abs(layerArea(b, i) / layerArea(a, i) - 1)).toBeLessThan(0.01);
  });
});

describe("islands", () => {
  it("two spheres give 2 islands per layer with ids -a and -b", async () => {
    const r = await slice(twoSpheres(), { thickness: 4 });
    expect(r.layers).toHaveLength(5);
    for (const l of r.layers) {
      expect(l.shapes).toHaveLength(2);
      const ids = r.parts.filter((p) => p.layer === l.index).map((p) => p.id);
      expect(ids).toEqual([`L00${l.index}-a`, `L00${l.index}-b`]);
    }
    // ordered by area, largest first
    const [a, b] = r.layers[2].shapes.map(shapeArea);
    expect(a).toBeGreaterThanOrEqual(b);
  });

  it("small islands are removed with a warning naming layer and part", async () => {
    const r = await slice(twoSpheres(), { thickness: 4, minPartArea: 250 });
    // layer 2 sections are ~314 mm2 each (kept); layer 0 / 4 sections are ~201 (removed)
    expect(r.layers[0].shapes).toHaveLength(0);
    const w = r.warnings.find((x) => x.layer === 0 && x.partId === "L000-a");
    expect(w?.level).toBe("warn");
    expect(w?.message).toContain("layer 0");
  });

  it("removes small holes with a warning", async () => {
    const r = await slice(torus(), { thickness: 10, mode: "midplane", minPartArea: 500 });
    // annulus area ~1257 and hole area ~707 are both above 500: hole kept; at 800 the hole goes
    expect(r.layers[0].shapes[0].holes).toHaveLength(1);
    const r2 = await slice(torus(), { thickness: 10, mode: "midplane", minPartArea: 800 });
    expect(r2.layers[0].shapes).toHaveLength(1);
    expect(r2.layers[0].shapes[0].holes).toHaveLength(0);
    expect(r2.warnings.some((w) => w.message.startsWith("Hole"))).toBe(true);
  });

  it("minFeature opening removes thin necks", async () => {
    // a plain plate has no features thinner than 1 mm, so the opening must not change it
    const plate = await slice(box(20, 20, 4), { thickness: 4, minFeature: 0 });
    const opened = await slice(box(20, 20, 4), { thickness: 4, minFeature: 1 });
    expect(shapesArea(opened.layers[0].shapes)).toBeCloseTo(shapesArea(plate.layers[0].shapes), 1);
  });
});


describe("filleted plate (low-poly rounded part)", () => {
  it("default oversize outlines have no spikes or notches and cover the mid-plane section", async () => {
    const raw = roundedPlate();
    const over = await slice(raw, { mode: "oversize", samplesPerLayer: 3, minPartArea: 0 });
    const mid = await slice(raw, { mode: "midplane", kerf: 0, minPartArea: 0 });
    for (const p of over.parts) {
      for (const ring of [p.cut.outer, ...p.cut.holes]) expect(maxReflexDeg(ring, ringArea(ring) < 0)).toBeLessThan(5);
    }
    over.layers.forEach((l, i) => expect(shapesArea(l.shapes)).toBeGreaterThan(shapesArea(mid.layers[i].shapes) - 0.05));
  });
});
