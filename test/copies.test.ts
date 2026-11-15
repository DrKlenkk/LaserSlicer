import { describe, expect, it } from "vitest";
import { nestParts } from "../src/core/nest";
import { Pipeline } from "../src/core/pipeline";
import { buildAssemblyGuide } from "../src/core/export/guide";
import { buildExportFiles } from "../src/core/export/files";
import { buildReadme } from "../src/core/export/zip";
import { estimate, estimateLines } from "../src/core/estimates";
import { parseProject, serializeProject } from "../src/state";
import { slicingKey } from "../src/updateController";
import { box } from "./fixtures/meshes";
import { settings, slice, weld } from "./helpers";
import type { Part } from "../src/core/types";

const mk = (id: string, layer: number, w: number, h: number): Part => ({ id, layer, cut: { outer: [[0, 0], [w, 0], [w, h], [0, h]], holes: [] }, engrave: [], label: [], holes: [] });
const S = { sheetW: 200, sheetH: 150, partSpacing: 3, sheetMargin: 5 };

describe("copies: nesting", () => {
  it("nests every part once per copy, with the copy index on each placement", () => {
    const parts = [mk("L000", 0, 40, 30), mk("L001", 1, 30, 20)];
    const r = nestParts(parts, { ...S, copies: 3 });
    expect(r.placements).toHaveLength(6);
    expect(r.placements.filter((p) => p.partId === "L000").map((p) => p.copy).sort()).toEqual([0, 1, 2]);
    expect(r.sheets.reduce((n, s) => n + s.partIds.length, 0)).toBe(6);
  });
  it("copies = 1 changes nothing (no copy field)", () => {
    const parts = [mk("L000", 0, 40, 30), mk("L001", 1, 30, 20)];
    const a = nestParts(parts, S), b = nestParts(parts, { ...S, copies: 1 });
    expect(b).toEqual(a);
    expect(a.placements.every((p) => p.copy === undefined)).toBe(true);
  });
  it("more copies need more sheets and the used area scales", () => {
    const parts = [mk("L000", 0, 90, 60)];
    const one = nestParts(parts, S), many = nestParts(parts, { ...S, copies: 12 });
    expect(many.sheets.length).toBeGreaterThan(one.sheets.length);
    expect(many.sheets.reduce((a, s) => a + s.usedArea, 0)).toBeCloseTo(12 * one.sheets[0].usedArea, 6);
  });
  it("a part that does not fit warns once, not once per copy", () => {
    const r = nestParts([mk("L000", 0, 500, 500)], { ...S, copies: 5 });
    expect(r.warnings).toHaveLength(1);
    expect(r.placements).toHaveLength(0);
  });
  it("no two placed copies overlap", () => {
    const r = nestParts([mk("A", 0, 40, 30), mk("B", 0, 25, 25)], { ...S, copies: 4 });
    expect(r.placements).toHaveLength(8);
    const keys = r.placements.map((p) => `${p.sheet}:${p.x.toFixed(3)}:${p.y.toFixed(3)}`);
    expect(new Set(keys).size).toBe(8);
  });
});

describe("copies: pipeline, estimates, export", () => {
  it("re-nests but never re-slices when only the copies change", async () => {
    const { mesh, stats } = weld(box(30, 20, 40));
    const p = new Pipeline();
    p.setMesh(mesh, stats);
    await p.run(settings());
    const before = { ...p.runs };
    const r = await p.run(settings({ copies: 4 }));
    expect(p.runs.nest).toBe(before.nest + 1);
    expect(p.runs.slice).toBe(before.slice);
    expect(p.runs.cleanup).toBe(before.cleanup);
    expect(p.runs.kerf).toBe(before.kerf);
    expect(r!.info.copies).toBe(4);
  });
  it("cut length, area, volume and travel scale with the copies", async () => {
    const one = await slice(box(30, 20, 40), { copies: 1 });
    const three = await slice(box(30, 20, 40), { copies: 3 });
    expect(three.measure.cutLength).toBeCloseTo(3 * one.measure.cutLength, 6);
    expect(three.measure.engraveLength).toBeCloseTo(3 * one.measure.engraveLength, 6);
    expect(three.measure.volume).toBeCloseTo(3 * one.measure.volume, 6);
    expect(three.measure.travelLength).toBeGreaterThan(one.measure.travelLength);
    expect(three.measure.copies).toBe(3);
    const s = settings({ cutSpeed: 10, pricePerSheet: 5 });
    expect(estimate(three.measure, s).time!).toBeCloseTo(3 * estimate(one.measure, s).time!, 6);
    expect(estimate(three.measure, s).cost!).toBe(5 * three.sheets.length);
    expect(estimateLines(three.measure, estimate(three.measure, s))[0]).toContain("Copies: 3");
    expect(estimateLines(one.measure, estimate(one.measure, s))[0]).not.toContain("Copies");
  });
  it("sheet files contain every copy", async () => {
    const r1 = await slice(box(30, 20, 40), { copies: 1 });
    const r2 = await slice(box(30, 20, 40), { copies: 2 });
    const count = (r: typeof r1) => buildExportFiles(r, { formats: ["svg"], perLayerFiles: false }, "m").reduce((n, f) => n + (new TextDecoder().decode(f.bytes).match(/<path/g)?.length ?? 0), 0);
    expect(count(r2)).toBeGreaterThanOrEqual(count(r1) * 2 - 2);
    expect(r2.parts).toHaveLength(r1.parts.length); // the parts themselves are not duplicated
  });
  it("README and guide state the copies", async () => {
    const r = await slice(box(30, 20, 40), { copies: 2 });
    const s = settings({ copies: 2, formats: ["dxf"] });
    expect(buildReadme(r, s, "m", [])).toContain("COPIES: 2");
    const html = buildAssemblyGuide(r, s, "m", new Date("2026-01-01"));
    expect(html).toContain("2 copies");
    expect(html).toContain(`${r.parts.length} per copy`);
    const one = await slice(box(30, 20, 40));
    expect(buildAssemblyGuide(one, settings(), "m", new Date("2026-01-01"))).not.toContain("copies");
  });
});

describe("copies: setting", () => {
  it("is validated in project files (integer 1..50)", () => {
    expect(parseProject(serializeProject(settings({ copies: 7 }))).copies).toBe(7);
    const bad = (v: unknown) => JSON.stringify({ format: "laser-slicer-project", settings: { copies: v } });
    for (const v of [0, 51, 2.5, -1, "3"]) expect(() => parseProject(bad(v)), String(v)).toThrow(/"copies"/);
    expect(parseProject(bad(50)).copies).toBe(50);
  });
  it("is part of the slicing key (the nesting changes the shown result)", () => {
    expect(slicingKey(settings({ copies: 2 }))).not.toBe(slicingKey(settings()));
  });
});
