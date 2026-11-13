import { describe, expect, it } from "vitest";
import { Pipeline } from "../src/core/pipeline";
import { difference, offset, pointInShapes, ringArea, shapesArea } from "../src/core/poly";
import { closing, opening, smoothShapes } from "../src/core/smooth";
import type { Ring, Shape } from "../src/core/types";
import { parseProject, serializeProject } from "../src/state";
import { roundedPlate } from "./fixtures/meshes";
import { maxReflexDeg, settings, slice, weld } from "./helpers";

const sq = (x0: number, y0: number, x1: number, y1: number): Ring => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const rect = (x0: number, y0: number, x1: number, y1: number): Shape => ({ outer: sq(x0, y0, x1, y1), holes: [] });

/** Circle of radius R sampled every `step` mm of arc, with the radius alternating by +-amp: a zig-zag outline. */
function zigzagCircle(R = 12, step = 0.25, amp = 0.05): Shape {
  const n = Math.round((2 * Math.PI * R) / step);
  const outer: Ring = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n, r = R + (i % 2 ? amp : -amp);
    outer.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return { outer, holes: [] };
}
const reflexCount = (shapes: Shape[], minDeg: number) => {
  let c = 0;
  for (const s of shapes)
    for (const ring of [s.outer, ...s.holes]) {
      const hole = ringArea(ring) < 0, n = ring.length;
      for (let i = 0; i < n; i++) {
        const a = ring[(i + n - 1) % n], b = ring[i], d = ring[(i + 1) % n];
        const t = Math.atan2((b[0] - a[0]) * (d[1] - b[1]) - (b[1] - a[1]) * (d[0] - b[0]), (b[0] - a[0]) * (d[0] - b[0]) + (b[1] - a[1]) * (d[1] - b[1]));
        if (((hole ? t : -t) * 180) / Math.PI > minDeg) c++;
      }
    }
  return c;
};
const TOL = 0.008; // the round joins are polygons with 5 micrometres of tolerance

describe("smoothShapes", () => {
  it("removes the zig-zag of a rough arc at a suitable radius (oversize)", () => {
    const zz = [zigzagCircle()];
    expect(reflexCount(zz, 8)).toBeGreaterThan(100); // every valley is a sharp reflex notch
    const sm = smoothShapes(zz, 3, "oversize");
    expect(reflexCount(sm, 8)).toBe(0);
    expect(shapesArea(difference(zz, offset(sm, TOL, "miter")))).toBeLessThan(0.01); // still covers the input
    // and it did not grow the circle: the tips are the same
    expect(shapesArea(sm) - shapesArea(zz)).toBeLessThan(2 * Math.PI * 12 * 0.1); // at most the notch area (depth 0.1)
  });

  it("oversize never removes material and keeps sharp outside corners; undersize never adds", () => {
    const square = [rect(0, 0, 20, 20)];
    const grown = shapesArea(smoothShapes(square, 1, "oversize"));
    expect(grown).toBeGreaterThanOrEqual(400); // never less
    expect(grown).toBeLessThan(400.6); // sharp corners kept: only the 6 micrometre safety margin (80 mm x 0.006) is added
    expect(shapesArea(difference(square, smoothShapes(square, 1, "oversize")))).toBeLessThan(0.001);
    expect(shapesArea(smoothShapes(square, 1, "undersize"))).toBeCloseTo(400 - (4 - Math.PI), 0); // corners shaved (r^2 (4 - pi))
    // an L shape: closing fills the inside corner with a fillet of radius r (area r^2 (1 - pi/4)), opening leaves it
    const L: Shape = { outer: [[0, 0], [20, 0], [20, 10], [10, 10], [10, 20], [0, 20]], holes: [] };
    expect(shapesArea(smoothShapes([L], 1, "oversize"))).toBeCloseTo(300 + (1 - Math.PI / 4), 0);
    const under = smoothShapes([L], 1, "undersize");
    expect(shapesArea(difference(under, [L]))).toBeLessThan(0.01);
    expect(shapesArea(under)).toBeCloseTo(300 - 5 * ((4 - Math.PI) / 4), 0); // five outside corners shaved, the inside corner stays
  });

  it("closing fills slots narrower than 2r and keeps wider ones; opening removes thin walls", () => {
    const withSlot = (w: number): Shape => ({ outer: [[0, 0], [20, 0], [20, 20], [10 + w / 2, 20], [10 + w / 2, 10], [10 - w / 2, 10], [10 - w / 2, 20], [0, 20]], holes: [] });
    expect(shapesArea(closing([withSlot(1)], 1))).toBeGreaterThan(400 - 0.5); // the 1 mm slot (10 mm deep) is filled, only its round end stays
    expect(shapesArea(closing([withSlot(3)], 1))).toBeLessThan(400 - 25);
    expect(opening([rect(0, 0, 20, 1.5)], 1)).toEqual([]); // wall thinner than 2r
    expect(shapesArea(opening([rect(0, 0, 20, 3)], 1))).toBeGreaterThan(55);
  });

  it("mid-plane does both: fills the notch and shaves the spur and the corners", () => {
    const part: Shape = { outer: [[0, 0], [20, 0], [20, 10], [10.2, 10], [10.2, 11], [9.8, 11], [9.8, 10], [0, 10], [0, 5.4], [0.4, 5.4], [0.4, 4.6], [0, 4.6]], holes: [] };
    const sm = smoothShapes([part], 0.75, "midplane");
    expect(sm).toHaveLength(1);
    expect(pointInShapes([0.2, 5], sm)).toBe(true); // the notch (0.4 deep, 0.8 wide: narrower than 2r = 1.5) is filled
    expect(pointInShapes([10, 10.8], sm)).toBe(false); // the 0.4 mm spur is gone
    expect(pointInShapes([0.03, 0.03], sm)).toBe(false); // corner rounded
    expect(pointInShapes([10, 5], sm)).toBe(true);
  });

  it("is a no-op at radius 0", () => {
    const s = [rect(0, 0, 10, 10)];
    expect(smoothShapes(s, 0, "oversize")).toBe(s);
  });
});

describe("smoothing in the pipeline", () => {
  const rough = () => roundedPlate({ nFn: (k) => 6 + (k % 4), noise: 0.15, seed: 5 });
  const layerShapes = (r: Awaited<ReturnType<typeof slice>>) => r.layers.flatMap((l) => l.shapes);

  it("keeps the mode guarantees on a rough low-poly part", async () => {
    const raw = rough();
    for (const [mode, samples] of [["oversize", 3], ["undersize", 3], ["midplane", 1]] as const) {
      // reference: the raw section of the mode (no simplify), which is what the guarantee is about
      const base = await slice(raw, { mode, samplesPerLayer: samples, kerf: 0, minPartArea: 0, simplifyTol: 0 });
      const sm = await slice(raw, { mode, samplesPerLayer: samples, kerf: 0, minPartArea: 0, smoothRadius: 1 });
      base.layers.forEach((l, i) => {
        if (mode === "oversize") expect(shapesArea(difference(l.shapes, offset(sm.layers[i].shapes, TOL, "miter")))).toBeLessThan(0.03);
        if (mode === "undersize") expect(shapesArea(difference(sm.layers[i].shapes, offset(l.shapes, TOL, "miter")))).toBeLessThan(0.03);
      });
      expect(Math.abs(shapesArea(layerShapes(sm)) - shapesArea(layerShapes(base)))).toBeLessThan(0.01 * shapesArea(layerShapes(base)));
    }
  });

  it("does not leave spikes in the kerf-compensated cut of a rough part", async () => {
    const r = await slice(rough(), { mode: "oversize", smoothRadius: 1, minPartArea: 0 });
    for (const p of r.parts) for (const ring of [p.cut.outer, ...p.cut.holes]) expect(maxReflexDeg(ring, ringArea(ring) < 0)).toBeLessThan(60);
  });

  it("changing the radius re-runs cleanup and later stages only; changing the kerf does not re-run it", async () => {
    const { mesh, stats } = weld(roundedPlate());
    const p = new Pipeline();
    p.setMesh(mesh, stats);
    await p.run(settings({ smoothRadius: 0.5 }));
    expect(p.runs).toEqual({ orient: 1, slice: 1, modes: 1, cleanup: 1, hollow: 1, registration: 1, kerf: 1, nest: 1, bridges: 0 });
    await p.run(settings({ smoothRadius: 1 }));
    expect(p.runs).toEqual({ orient: 1, slice: 1, modes: 1, cleanup: 2, hollow: 2, registration: 2, kerf: 2, nest: 2, bridges: 0 });
    await p.run(settings({ smoothRadius: 1, kerf: 0.3 }));
    expect(p.runs).toEqual({ orient: 1, slice: 1, modes: 1, cleanup: 2, hollow: 2, registration: 2, kerf: 3, nest: 3, bridges: 0 });
    await p.run(settings({ smoothRadius: 0, kerf: 0.3 }));
    expect(p.runs.slice).toBe(1);
    expect(p.runs.cleanup).toBe(3);
  });

  it("warns when the radius removes a whole layer", async () => {
    const { mesh, stats } = weld(roundedPlate({ W: 6, R: 2, f: 0.5, fm: 2, holeR: 0.3 }));
    const p = new Pipeline();
    p.setMesh(mesh, stats);
    const r = (await p.run(settings({ mode: "undersize", samplesPerLayer: 1, smoothRadius: 4, minPartArea: 0 })))!;
    expect(r.warnings.some((w) => /Smoothing .* removed everything/.test(w.message))).toBe(true);
  });
});

describe("smoothRadius in the project file", () => {
  it("round-trips and rejects negative values", () => {
    const s = settings({ smoothRadius: 0.75 });
    expect(parseProject(serializeProject(s)).smoothRadius).toBe(0.75);
    expect(() => parseProject(serializeProject({ ...s, smoothRadius: -1 }))).toThrow(/smoothRadius/);
    expect(parseProject('{"format":"laser-slicer-project","version":1,"settings":{}}').smoothRadius).toBe(0);
  });
});
