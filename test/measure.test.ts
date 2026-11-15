import { describe, expect, it } from "vitest";
import { formatMeasure, measure, nearestVertex, sheetAtX, snapRadius } from "../src/core/measure";
import type { Vec2 } from "../src/core/types";

describe("measure", () => {
  it("gives distance and signed dx, dy (Y up)", () => {
    const m = measure([1, 2], [4, -2]);
    expect(m.dx).toBe(3);
    expect(m.dy).toBe(-4);
    expect(m.dist).toBe(5);
  });
  it("is symmetric in distance and antisymmetric in dx, dy", () => {
    const a: Vec2 = [10.5, 3], b: Vec2 = [-2, 7.25];
    const ab = measure(a, b), ba = measure(b, a);
    expect(ab.dist).toBeCloseTo(ba.dist, 12);
    expect(ab.dx).toBeCloseTo(-ba.dx, 12);
    expect(ab.dy).toBeCloseTo(-ba.dy, 12);
  });
  it("formats with two decimals in mm and never shows -0.00", () => {
    expect(formatMeasure(measure([0, 0], [3, 4]))).toBe("5.00 mm (dx 3.00, dy 4.00)");
    expect(formatMeasure({ dx: -0.0001, dy: 0.004, dist: 0.004 })).toBe("0.00 mm (dx 0.00, dy 0.00)");
    expect(formatMeasure(measure([0, 0], [-1.234, 0]))).toBe("1.23 mm (dx -1.23, dy 0.00)");
  });
});

describe("vertex snapping", () => {
  const ring: Vec2[] = [[0, 0], [100, 0], [100, 50], [0, 50]];
  const hole: Vec2[] = [[20, 20], [30, 20], [30, 30], [20, 30]];
  it("snaps to the nearest vertex within the radius", () => {
    expect(nearestVertex([99.5, 0.4], [ring, hole], 2)).toBe(ring[1]);
    expect(nearestVertex([21, 19], [ring, hole], 2)).toBe(hole[0]);
  });
  it("returns null when no vertex is close enough", () => {
    expect(nearestVertex([50, 25], [ring, hole], 5)).toBeNull();
    expect(nearestVertex([5, 5], [ring], 4)).toBeNull(); // distance 7.07 > 4
    expect(nearestVertex([0, 0], [], 5)).toBeNull();
  });
  it("picks the closer of two candidates and treats the radius as inclusive", () => {
    const g: Vec2[] = [[0, 0], [3, 0]];
    expect(nearestVertex([2, 0], [g], 5)).toBe(g[1]);
    expect(nearestVertex([0, 3], [g], 3)).toBe(g[0]);
  });
  it("converts the pixel tolerance to world units by the zoom", () => {
    expect(snapRadius(8, 2)).toBe(4); // 2 px per mm: 8 px = 4 mm
    expect(snapRadius(8, 0.5)).toBe(16);
    expect(snapRadius(8, 0)).toBe(0);
    // zoomed in 20x, a vertex 1 mm away (20 px) is out of reach, 0.3 mm (6 px) is in
    expect(nearestVertex([1, 0], [[[0, 0]]], snapRadius(8, 20))).toBeNull();
    expect(nearestVertex([0.3, 0], [[[0, 0]]], snapRadius(8, 20))).toEqual([0, 0]);
  });
  it("copes with a large vertex set quickly", () => {
    const big: Vec2[] = Array.from({ length: 200_000 }, (_, i) => [i * 0.01, Math.sin(i) * 50]);
    const t = performance.now();
    for (let i = 0; i < 20; i++) nearestVertex([1000 + i, 0], [big], 1);
    expect(performance.now() - t).toBeLessThan(500);
  });
});

describe("sheet index of a view x coordinate", () => {
  it("maps x to the sheet strip (width + gap)", () => {
    expect(sheetAtX(10, 600, 20)).toBe(0);
    expect(sheetAtX(619, 600, 20)).toBe(0);
    expect(sheetAtX(630, 600, 20)).toBe(1);
    expect(sheetAtX(-5, 600, 20)).toBe(0);
  });
});
