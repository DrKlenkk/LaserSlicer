import { describe, expect, it } from "vitest";
import { angleDeg, closestOnSegment, constrainAxis, findSnap, fitCircle, formatDelta, formatDiameter, formatMeasure, measure, nearestVertex, sheetAtX, snapRadius } from "../src/core/measure";
import { sheetOrigins } from "../src/core/offcut";
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
    expect(formatMeasure(measure([0, 0], [3, 4]))).toBe("5.00 mm (dx 3.00, dy 4.00, 53.1\u00b0)");
    expect(formatMeasure({ dx: -0.0001, dy: 0.004, dist: 0.004 })).toBe("0.00 mm (dx 0.00, dy 0.00, 91.4\u00b0)");
    expect(formatMeasure(measure([0, 0], [-1.234, 0]))).toBe("1.23 mm (dx -1.23, dy 0.00, 180.0\u00b0)");
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
    const o = sheetOrigins([600, 600], 20);
    expect(sheetAtX(10, o)).toBe(0);
    expect(sheetAtX(619, o)).toBe(0);
    expect(sheetAtX(630, o)).toBe(1);
    expect(sheetAtX(-5, o)).toBe(0);
    // an offcut first sheet of another width moves the later sheets
    const odd = sheetOrigins([300, 600, 600], 20);
    expect(odd).toEqual([0, 320, 940]);
    expect(sheetAtX(319, odd)).toBe(0);
    expect(sheetAtX(330, odd)).toBe(1);
    expect(sheetAtX(950, odd)).toBe(2);
  });
});

const circle = (cx: number, cy: number, r: number, n = 48, phase = 0.1): Vec2[] =>
  Array.from({ length: n }, (_, i) => [cx + r * Math.cos(phase + (2 * Math.PI * i) / n), cy + r * Math.sin(phase + (2 * Math.PI * i) / n)] as Vec2);

describe("circle detection", () => {
  it("fits a polygonised circle (centre and diameter)", () => {
    const c = fitCircle(circle(12, -7, 3));
    expect(c).not.toBeNull();
    expect(c!.c[0]).toBeCloseTo(12, 6);
    expect(c!.c[1]).toBeCloseTo(-7, 6);
    expect(c!.r * 2).toBeCloseTo(6, 6);
    expect(formatDiameter(c!)).toBe("\u00d8 6.00 mm");
  });
  it("fits an unevenly sampled circle", () => {
    const pts: Vec2[] = [];
    for (let i = 0; i < 40; i++) {
      const a = i * 0.08; // a 3.1 rad arc: a gap of more than 180 degrees
      pts.push([5 + 10 * Math.cos(a), 5 + 10 * Math.sin(a)]);
    }
    expect(fitCircle(pts)).toBeNull(); // only a part of the circle: big gap
    const full = circle(5, 5, 10, 90).filter((_, i) => i % 7 !== 3 && i % 11 !== 4);
    expect(fitCircle(full)!.c[0]).toBeCloseTo(5, 6);
  });
  it("rejects rectangles, coarse polygons, ellipses and D shapes", () => {
    expect(fitCircle([[0, 0], [10, 0], [10, 10], [0, 10]])).toBeNull();
    expect(fitCircle(circle(0, 0, 5, 8))).toBeNull();
    expect(fitCircle(circle(0, 0, 5, 64).map(([x, y]) => [x * 1.5, y] as Vec2))).toBeNull();
    const d = circle(0, 0, 5, 64).filter(([x]) => x < 2);
    expect(fitCircle(d)).toBeNull();
    // rectangle with many points along the edges
    const rect: Vec2[] = [];
    for (let i = 0; i < 10; i++) rect.push([i * 10, 0]);
    for (let i = 0; i < 5; i++) rect.push([100, i * 10]);
    for (let i = 0; i < 10; i++) rect.push([100 - i * 10, 50]);
    for (let i = 0; i < 5; i++) rect.push([0, 50 - i * 10]);
    expect(fitCircle(rect)).toBeNull();
  });
});

describe("findSnap", () => {
  const rect: Vec2[] = [[0, 0], [100, 0], [100, 50], [0, 50]];
  const hole = circle(50, 25, 3);
  it("prefers corners over midpoints and edges", () => {
    const s = findSnap([1, 1], [rect], 5)!;
    expect(s.type).toBe("corner");
    expect(s.p).toEqual([0, 0]);
  });
  it("snaps to edge midpoints, then to the nearest point on an edge", () => {
    const m = findSnap([51, 1], [rect], 3)!;
    expect(m.type).toBe("midpoint");
    expect(m.p).toEqual([50, 0]);
    const e = findSnap([30, 2], [rect], 3)!;
    expect(e.type).toBe("edge");
    expect(e.p[0]).toBeCloseTo(30, 9);
    expect(e.p[1]).toBeCloseTo(0, 9);
    expect(findSnap([30, 10], [rect], 3)).toBeNull();
  });
  it("snaps to a hole centre with its diameter, ahead of midpoints and edges", () => {
    const s = findSnap([51, 26], [rect, hole], 4)!;
    expect(s.type).toBe("centre");
    expect(s.p[0]).toBeCloseTo(50, 6);
    expect(s.circle!.r * 2).toBeCloseTo(6, 6);
  });
  it("offers a circular ring's edge (with the circle) but not its vertices", () => {
    // pointer on the rim, centre out of reach: edge snap, no corner although vertices are near
    const s = findSnap([53.2, 25.1], [hole], 1)!;
    expect(s.type).toBe("edge");
    expect(s.circle!.r).toBeCloseTo(3, 6);
  });
  it("handles analytic circles (dowel holes)", () => {
    const c = { c: [10, 10] as Vec2, r: 2 };
    expect(findSnap([10.5, 9.5], [], 1, [c])!.type).toBe("centre");
    const rim = findSnap([12.4, 10], [], 1, [c])!;
    expect(rim.type).toBe("edge");
    expect(rim.p[0]).toBeCloseTo(12, 9);
    expect(findSnap([20, 20], [], 1, [c])).toBeNull();
  });
  it("returns null for zero radius, empty input and far pointers", () => {
    expect(findSnap([0, 0], [rect], 0)).toBeNull();
    expect(findSnap([0, 0], [], 5)).toBeNull();
    expect(findSnap([500, 500], [rect], 5)).toBeNull();
  });
  it("closes the ring (midpoint of the last edge)", () => {
    const s = findSnap([0.5, 25], [rect], 2)!;
    expect(s.type).toBe("midpoint");
    expect(s.p).toEqual([0, 25]);
  });
  it("projects onto segment ends", () => {
    expect(closestOnSegment([-5, 3], [0, 0], [10, 0])).toEqual([0, 0]);
    expect(closestOnSegment([15, 3], [0, 0], [10, 0])).toEqual([10, 0]);
  });
});

describe("constrain and angle", () => {
  it("locks to the dominant axis", () => {
    expect(constrainAxis([10, 10], [30, 12])).toEqual([30, 10]);
    expect(constrainAxis([10, 10], [12, -30])).toEqual([10, -30]);
    expect(constrainAxis([0, 0], [5, 5])).toEqual([5, 0]);
  });
  it("gives the angle counter-clockwise, Y up", () => {
    expect(angleDeg(measure([0, 0], [1, 1]))).toBeCloseTo(45, 9);
    expect(angleDeg(measure([0, 0], [0, -1]))).toBeCloseTo(-90, 9);
    expect(angleDeg(measure([0, 0], [-1, 0]))).toBe(180);
    expect(angleDeg(measure([1, 1], [1, 1]))).toBe(0);
    expect(formatDelta(measure([0, 0], [3, 4]))).toBe("dx 3.00  dy 4.00  53.1\u00b0");
  });
});
