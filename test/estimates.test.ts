import { describe, expect, it } from "vitest";
import { estimate, estimateLines, estimateReadme, estimateSummary, formatDuration, measureParts } from "../src/core/estimates";
import { addBridges } from "../src/core/bridges";
import { buildReadme } from "../src/core/export/zip";
import { DEFAULT_SETTINGS, parseProject } from "../src/state";
import { slicingKey } from "../src/updateController";
import type { Part, Ring } from "../src/core/types";
import { box, uvSphere } from "./fixtures/meshes";
import { settings, slice } from "./helpers";

const rect = (x: number, y: number, w: number, h: number): Ring => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const NONE = { density: 0, cutSpeed: 0, engraveSpeed: 0, pricePerSheet: 0 };

describe("measureParts", () => {
  it("counts rings, dowel circles, engrave and label lengths", () => {
    const p: Part = {
      id: "L000", layer: 0,
      cut: { outer: rect(0, 0, 100, 50), holes: [rect(10, 10, 10, 10).reverse()] },
      engrave: [[[0, 0], [30, 0]], [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]], // open 30, closed square 40
      label: [[[0, 0], [3, 4]]], // 5
      holes: [{ c: [50, 25], d: 10 }],
    };
    const m = measureParts([p], 5000 - 100, 4, 1);
    expect(m.cutLength).toBeCloseTo(300 + 40 + Math.PI * 10, 6);
    expect(m.engraveLength).toBeCloseTo(75, 6);
    expect(m.area).toBe(4900);
    expect(m.volume).toBe(19600);
    expect(m.sheets).toBe(1);
  });
  it("bridged rings are counted without their gaps", () => {
    const p: Part = { id: "L000", layer: 0, cut: { outer: rect(0, 0, 100, 100), holes: [] }, engrave: [], label: [], holes: [] };
    const plain = measureParts([p], 0, 4, 1).cutLength;
    const [b] = addBridges([p], { bridgesEnabled: true, bridgeCount: 2, bridgeWidth: 0.5, bridgeMinLength: 40, bridgeHoles: false, bridgeMaxSpacing: 0, kerf: 0.15 }).parts;
    expect(b.bridges!.length).toBe(1);
    const gaps = b.bridges![0].gaps.reduce((n, g) => n + Math.hypot(g[g.length - 1][0] - g[0][0], g[g.length - 1][1] - g[0][1]), 0);
    expect(gaps).toBeGreaterThan(1.2);
    expect(measureParts([b], 0, 4, 1).cutLength).toBeCloseTo(plain - gaps, 6);
  });
});

describe("pipeline measurements", () => {
  it("a 40 x 40 x 8 box in 4 mm layers", async () => {
    const r = await slice(box(40, 40, 8), { thickness: 4, kerf: 0, labels: false, engraveNextOutline: true });
    expect(r.measure.area).toBeCloseTo(3200, 3);
    expect(r.measure.volume).toBeCloseTo(12800, 3);
    expect(r.measure.cutLength).toBeCloseTo(320, 3);
    expect(r.measure.sheets).toBe(1);
  });
  it("engrave length is the sum of the engrave and label polylines of the parts", async () => {
    const r = await slice(uvSphere(15, 24, 32), { thickness: 4, kerf: 0, labels: true, engraveNextOutline: true });
    let sum = 0;
    for (const p of r.parts) for (const l of [...p.engrave, ...p.label]) for (let i = 1; i < l.length; i++) sum += Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]);
    expect(sum).toBeGreaterThan(100);
    expect(r.measure.engraveLength).toBeCloseTo(sum, 6);
    const noLabels = await slice(uvSphere(15, 24, 32), { thickness: 4, kerf: 0, labels: false, engraveNextOutline: false });
    expect(noLabels.measure.engraveLength).toBe(0);
  });
  it("area is taken before kerf, cut length after", async () => {
    const r = await slice(box(40, 40, 8), { thickness: 4, kerf: 0.2, labels: false });
    expect(r.measure.area).toBeCloseTo(3200, 3);
    expect(r.measure.cutLength).toBeCloseTo(2 * 4 * 40.2, 1);
  });
  it("hollow cavities are not part of the volume", async () => {
    const solid = await slice(box(60, 60, 24), { thickness: 4, kerf: 0 });
    const hollow = await slice(box(60, 60, 24), { thickness: 4, kerf: 0, hollowEnabled: true, hollowWall: 10 });
    expect(hollow.measure.volume).toBeLessThan(solid.measure.volume);
    expect(hollow.measure.cutLength).toBeGreaterThan(solid.measure.cutLength);
  });
});

describe("estimate", () => {
  const m = { cutLength: 3000, engraveLength: 600, area: 5000, volume: 20000, sheets: 3 };
  it("0 means not set", () => {
    const e = estimate(m, NONE);
    expect(e).toEqual({ weight: null, time: null, cutTime: null, engraveTime: null, cost: null });
    expect(estimateLines(m, e).length).toBe(3);
    expect(estimateSummary(m, e)).toBe("cut 3.00 m".replace("3.00 m", "3000 mm"));
  });
  it("weight, time and cost", () => {
    const e = estimate(m, { density: 0.65, cutSpeed: 10, engraveSpeed: 100, pricePerSheet: 4.5 });
    expect(e.weight).toBeCloseTo(13, 9); // 20 cm3 x 0.65
    expect(e.cutTime).toBe(300);
    expect(e.engraveTime).toBe(6);
    expect(e.time).toBe(306);
    expect(e.cost).toBe(13.5); // whole sheets
    const text = estimateLines(m, e).join("\n");
    expect(text).toMatch(/Weight: 13 g/);
    expect(text).toMatch(/Cutting time \(rough\): about 5 min/);
    expect(text).toMatch(/Material cost: 13.50 \(3 sheets, partial sheets count whole\)/);
    expect(estimateSummary(m, e)).toBe("cut 3000 mm · ≈ 5 min · cost 13.50");
  });
  it("time with only one speed says what is missing; garbage counts as not set", () => {
    const e = estimate(m, { ...NONE, engraveSpeed: 60 });
    expect(e.time).toBe(10);
    expect(estimateLines(m, e).join("\n")).toMatch(/cutting not included/);
    expect(estimate(m, { density: NaN, cutSpeed: -1, engraveSpeed: 0, pricePerSheet: 0 }).weight).toBeNull();
  });
  it("formats durations", () => {
    expect(formatDuration(45)).toBe("45 s");
    expect(formatDuration(720)).toBe("12 min");
    expect(formatDuration(3900)).toBe("1 h 05 min");
  });
});

describe("README and settings", () => {
  it("ZIP README lists the estimates with the settings given and names what is not set", async () => {
    const r = await slice(box(40, 40, 8), { thickness: 4 });
    const on = buildReadme(r, settings({ density: 0.7, cutSpeed: 8, engraveSpeed: 50, pricePerSheet: 12 }), "m", []);
    expect(on).toMatch(/Cut length: /);
    expect(on).toMatch(/Weight: /);
    expect(on).toMatch(/Cutting time \(rough\)/);
    expect(on).toMatch(/Material cost: 12.00 \(1 sheet, partial sheets count whole\)/);
    expect(on).not.toMatch(/Not shown/);
    const off = buildReadme(r, settings({ density: 0 }), "m", []);
    expect(off).not.toMatch(/Weight:|Cutting time|Material cost/);
    expect(off).toMatch(/Not shown, setting is 0: density \(weight\), speeds \(time\), price per sheet \(cost\)/);
    expect(estimateReadme(r.measure, NONE)[0]).toMatch(/rough/);
  });
  it("changing them never changes the slicing key (no run, no stale preview)", () => {
    const base = slicingKey(settings());
    for (const patch of [{ density: 0.9 }, { cutSpeed: 12 }, { engraveSpeed: 80 }, { pricePerSheet: 7 }]) expect(slicingKey(settings(patch))).toBe(base);
    expect(slicingKey(settings({ kerf: 0.2 }))).not.toBe(base);
  });
  it("project files without the keys load with the defaults; values are validated", () => {
    const proj = (st: object) => JSON.stringify({ format: "laser-slicer-project", version: 1, settings: st });
    const d = parseProject(proj({ kerf: 0.1 }));
    expect([d.density, d.cutSpeed, d.engraveSpeed, d.pricePerSheet]).toEqual([DEFAULT_SETTINGS.density, 0, 0, 0]);
    expect(parseProject(proj({ density: 0.5, cutSpeed: 12, engraveSpeed: 90, pricePerSheet: 8.5 })).pricePerSheet).toBe(8.5);
    for (const k of ["density", "cutSpeed", "engraveSpeed", "pricePerSheet"]) {
      expect(() => parseProject(proj({ [k]: -1 }))).toThrow(new RegExp(k));
      expect(() => parseProject(proj({ [k]: "x" }))).toThrow(new RegExp(k));
    }
  });
});
