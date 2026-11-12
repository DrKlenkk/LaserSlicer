import { describe, expect, it } from "vitest";
import { difference, intersect, offset, ringArea, shapeArea, shapesArea, simplify, union, unionEvenOdd } from "../src/core/poly";
import type { Ring, Shape } from "../src/core/types";

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
