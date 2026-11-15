import { describe, expect, it } from "vitest";
import { explodeOffset, keeps, MAX_EXPLODE_GAP, NO_SECTION, sectionPlane, stackExtent } from "../src/core/stackView";
import type { Layer } from "../src/core/types";
import { DEFAULT_SETTINGS, serializeProject } from "../src/state";
import { slicingKey } from "../src/updateController";
import { settings } from "./helpers";

const layer = (index: number, x0: number, x1: number, y0: number, y1: number): Layer => ({ index, z0: index * 4, z1: index * 4 + 4, shapes: [{ outer: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], holes: [] }] });

describe("explode", () => {
  it("is zero at 0 % and the bottom layer never moves", () => {
    for (let i = 0; i < 5; i++) expect(explodeOffset(i, 4, 0)).toBe(0);
    expect(explodeOffset(0, 4, 1)).toBe(0);
  });
  it("leaves a gap of one thickness between neighbours at 100 %", () => {
    expect(MAX_EXPLODE_GAP).toBe(1);
    const t = 3.8;
    for (let i = 0; i < 6; i++) expect(explodeOffset(i + 1, t, 1) - explodeOffset(i, t, 1)).toBeCloseTo(t, 12);
  });
  it("grows linearly with the fraction and clamps to 0..1", () => {
    expect(explodeOffset(10, 4, 0.5)).toBe(20);
    expect(explodeOffset(10, 4, 2)).toBe(explodeOffset(10, 4, 1));
    expect(explodeOffset(10, 4, -1)).toBe(0);
  });
});

describe("section plane", () => {
  const layers = [layer(0, -10, 30, 0, 20), layer(1, 0, 10, -5, 25)];
  it("measures the extent of the stack along the axis", () => {
    expect(stackExtent(layers, "x")).toEqual([-10, 30]);
    expect(stackExtent(layers, "y")).toEqual([-5, 25]);
    expect(stackExtent([], "x")).toBeNull();
  });
  it("0 % clips nothing", () => {
    const p = sectionPlane("x", 0, [-10, 30]);
    expect(p.constant).toBe(NO_SECTION);
    expect(keeps(p, [30, 0, 0])).toBe(true);
    expect(keeps(p, [-1e6, 0, 0])).toBe(true);
  });
  it("keeps the side below the plane and cuts the side above it", () => {
    const p = sectionPlane("x", 0.5, [-10, 30]); // plane at x = 10
    expect(p.constant).toBeCloseTo(10, 12);
    expect(keeps(p, [5, 100, 100])).toBe(true);
    expect(keeps(p, [15, 100, 100])).toBe(false);
    const py = sectionPlane("y", 0.25, [-5, 25]); // plane at y = 17.5
    expect(keeps(py, [100, 17, 0])).toBe(true);
    expect(keeps(py, [100, 18, 0])).toBe(false);
  });
  it("100 % puts the plane at the minimum and clamps above", () => {
    const p = sectionPlane("x", 1, [-10, 30]);
    expect(p.constant).toBe(-10);
    expect(keeps(p, [-9, 0, 0])).toBe(false);
    expect(sectionPlane("x", 5, [-10, 30]).constant).toBe(-10);
  });
  it("an empty stack never clips", () => {
    expect(sectionPlane("y", 0.7, null).constant).toBe(NO_SECTION);
  });
});

describe("view-only: no setting, no project field", () => {
  it("is not in the settings, the project file or the slicing key", () => {
    for (const k of Object.keys(DEFAULT_SETTINGS)) expect(/explode|section/i.test(k), k).toBe(false);
    expect(/explode|section/i.test(serializeProject(settings()))).toBe(false);
    expect(slicingKey(settings())).not.toMatch(/explode|section/i);
  });
});
