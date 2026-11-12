import { describe, expect, it } from "vitest";
import { applyKerf } from "../src/core/kerf";
import { shapesBounds, shapeArea } from "../src/core/poly";
import type { Part, Ring, Shape } from "../src/core/types";
import { box } from "./fixtures/meshes";
import { slice } from "./helpers";

const sq = (x0: number, y0: number, s: number): Ring => [[x0, y0], [x0 + s, y0], [x0 + s, y0 + s], [x0, y0 + s]];
const part = (cut: Shape, extra: Partial<Part> = {}): Part => ({ id: "L000", layer: 0, cut, engrave: [], label: [], holes: [], ...extra });
const width = (r: Ring) => Math.max(...r.map((p) => p[0])) - Math.min(...r.map((p) => p[0]));

describe("kerf", () => {
  it("kerf 0.2 on a 20 mm square gives 20.2 mm", async () => {
    const r = await slice(box(20, 20, 4), { thickness: 4, kerf: 0.2 });
    const b = shapesBounds([r.parts[0].cut])!;
    expect(b.maxX - b.minX).toBeCloseTo(20.2, 3);
    expect(b.maxY - b.minY).toBeCloseTo(20.2, 3);
    // the layer itself is not kerf compensated
    expect(shapesBounds(r.layers[0].shapes)!.maxX - shapesBounds(r.layers[0].shapes)!.minX).toBeCloseTo(20, 3);
  });

  it("a 10 mm hole becomes 9.8 mm and the outer grows", () => {
    const hole = sq(15, 15, 10).reverse(); // CW
    const { parts } = applyKerf([part({ outer: sq(0, 0, 40), holes: [hole] })], 0.2);
    expect(width(parts[0].cut.outer)).toBeCloseTo(40.2, 3);
    expect(width(parts[0].cut.holes[0])).toBeCloseTo(9.8, 3);
  });

  it("shrinks dowel holes by kerf and never touches engrave lines", () => {
    const engrave: [number, number][][] = [[[1, 1], [5, 5]]];
    const label: [number, number][][] = [[[2, 2], [3, 2]]];
    const { parts } = applyKerf([part({ outer: sq(0, 0, 40), holes: [] }, { engrave, label, holes: [{ c: [20, 20], d: 6 }] })], 0.2);
    expect(parts[0].holes[0].d).toBeCloseTo(5.8, 9);
    expect(parts[0].engrave).toEqual(engrave);
    expect(parts[0].label).toEqual(label);
  });

  it("kerf 0 leaves outlines unchanged", () => {
    const s = { outer: sq(0, 0, 10), holes: [] };
    const { parts } = applyKerf([part(s)], 0);
    expect(shapeArea(parts[0].cut)).toBeCloseTo(100, 9);
  });
});
