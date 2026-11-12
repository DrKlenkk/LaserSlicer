import { describe, expect, it } from "vitest";
import { difference, intersect, offset, ringArea, shapeArea, shapesArea, simplify, union, unionEvenOdd } from "../src/core/poly";
import type { Ring, Shape } from "../src/core/types";
import { nudgeHeight, prepareMesh, slicePlane } from "../src/core/slice";
import { orientMesh } from "../src/core/transform";
import { roundedPlate } from "./fixtures/meshes";
import { maxReflexDeg, settings, weld } from "./helpers";

const sq = (x0: number, y0: number, x1: number, y1: number): Ring => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const rect = (x0: number, y0: number, x1: number, y1: number): Shape => ({ outer: sq(x0, y0, x1, y1), holes: [] });
const cw = (r: Ring): Ring => r.slice().reverse();

describe("poly", () => {
  it("unionEvenOdd nests rings as outer/hole/island and normalises orientation", () => {
    // wrong windings on purpose: outer CW, hole CCW, island CW
    const shapes = unionEvenOdd([cw(sq(0, 0, 30, 30)), sq(5, 5, 25, 25), cw(sq(10, 10, 20, 20))]);
    expect(shapes).toHaveLength(2);
    const big = shapes.find((s) => s.holes.length === 1)!;
    expect(ringArea(big.outer)).toBeCloseTo(900);
    expect(ringArea(big.holes[0])).toBeCloseTo(-400);
    expect(shapesArea(shapes)).toBeCloseTo(900 - 400 + 100);
  });

  it("boolean operations", () => {
    const a = [rect(0, 0, 10, 10)], b = [rect(5, 5, 15, 15)];
    expect(shapesArea(union(a, b))).toBeCloseTo(175);
    expect(shapesArea(intersect(a, b))).toBeCloseTo(25);
    expect(shapesArea(difference(a, b))).toBeCloseTo(75);
    expect(intersect(a, [rect(20, 20, 30, 30)])).toEqual([]);
  });

  it("offset moves outlines out and holes in (miter, 4+ corners: regression for the clipper2-js bug)", () => {
    const s: Shape = { outer: sq(-10, -10, 10, 10), holes: [cw(sq(-3, -3, 3, 3))] };
    const grown = offset([s], 1, "miter", 2);
    expect(grown).toHaveLength(1);
    expect(ringArea(grown[0].outer)).toBeCloseTo(22 * 22, 2);
    expect(ringArea(grown[0].holes[0])).toBeCloseTo(-16, 2);
    const shrunk = offset([s], -1, "miter", 2);
    expect(ringArea(shrunk[0].outer)).toBeCloseTo(18 * 18, 2);
    expect(ringArea(shrunk[0].holes[0])).toBeCloseTo(-64, 2);
    expect(offset([rect(0, 0, 20, 5)], -3)).toEqual([]);
  });

  it("round offset grows a square by about pi r^2 more at the corners", () => {
    const a = shapesArea(offset([rect(0, 0, 10, 10)], 1, "round"));
    expect(a).toBeCloseTo(100 + 40 + Math.PI, 1);
  });

  it("simplify removes collinear vertices but keeps corners", () => {
    const ring: Ring = [[0, 0], [5, 0], [10, 0], [10, 5], [10, 10], [0, 10]];
    const out = simplify([{ outer: ring, holes: [] }], 0.05);
    expect(out[0].outer).toHaveLength(4);
    expect(shapeArea(out[0])).toBeCloseTo(100);
  });
});

describe("clipper2-js aliasing bug (union of near-coincident outlines)", () => {
  // Two sections of a vertical wall differ only by micrometre rounding. With the unpatched library the union lost about 1.2 mm2
  // of 3424 (and grew hairline spikes) and the intersection lost the same, because intersection points were written into the
  // polygon's own vertex objects.
  const section = (z: number) => {
    const { mesh } = weld(roundedPlate());
    const prep = prepareMesh(orientMesh(mesh, settings()).mesh);
    return unionEvenOdd(slicePlane(prep, nudgeHeight(prep, z)).rings);
  };

  it("union is never smaller than its inputs and intersection never bigger", () => {
    for (const [z0, z1] of [[8.0001, 10], [10, 11.9999], [8.0001, 11.9999]]) {
      const a = section(z0), b = section(z1);
      const aa = shapesArea(a), bb = shapesArea(b);
      const u = shapesArea(union(a, b)), i = shapesArea(intersect(a, b));
      expect(u).toBeGreaterThan(Math.max(aa, bb) - 0.01);
      expect(i).toBeLessThan(Math.min(aa, bb) + 0.01);
      // inclusion-exclusion holds up to micrometre slivers
      expect(Math.abs(aa + bb - u - i)).toBeLessThan(0.05);
    }
  });

  it("the union of a section with a near copy has no spikes", () => {
    const u = union(section(8.0001), section(10));
    for (const s of u) for (const ring of [s.outer, ...s.holes]) expect(maxReflexDeg(ring, ringArea(ring) < 0)).toBeLessThan(5);
  });
});

describe("offset micro-edges", () => {
  it("kerf offset of nearly straight stretches leaves no micrometre edges or kinks", () => {
    const { mesh } = weld(roundedPlate());
    const prep = prepareMesh(orientMesh(mesh, settings()).mesh);
    const shapes = unionEvenOdd(slicePlane(prep, nudgeHeight(prep, 6)).rings);
    for (const d of [0.075, -0.075]) {
      for (const s of offset(shapes, d, "miter", 2))
        for (const ring of [s.outer, ...s.holes]) {
          let minLen = Infinity;
          for (let i = 0; i < ring.length; i++) {
            const p = ring[i], q = ring[(i + 1) % ring.length];
            minLen = Math.min(minLen, Math.hypot(q[0] - p[0], q[1] - p[1]));
          }
          expect(minLen).toBeGreaterThanOrEqual(0.005);
          expect(maxReflexDeg(ring, ringArea(ring) < 0)).toBeLessThan(5);
        }
    }
  });
});
