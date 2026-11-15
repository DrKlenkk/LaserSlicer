import { describe, expect, it } from "vitest";
import { applyPlacement, nestParts } from "../src/core/nest";
import { shapesBounds } from "../src/core/poly";
import { Pipeline } from "../src/core/pipeline";
import { activeBlocked, cleanBlocked, firstSheetSize, MAX_BLOCKED, sheetOrigins } from "../src/core/offcut";
import { buildExportFiles } from "../src/core/export/files";
import { buildReadme } from "../src/core/export/zip";
import { DEFAULT_SETTINGS, parseProject, serializeProject } from "../src/state";
import { basicSettings } from "../src/basicMode";
import { slicingKey } from "../src/updateController";
import { box } from "./fixtures/meshes";
import { settings, slice, weld } from "./helpers";
import type { Part } from "../src/core/types";

const mk = (id: string, layer: number, w: number, h: number): Part => ({ id, layer, cut: { outer: [[0, 0], [w, 0], [w, h], [0, h]], holes: [] }, engrave: [], label: [], holes: [] });
const S = { sheetW: 200, sheetH: 150, partSpacing: 3, sheetMargin: 5 };
const boundsOf = (p: Part, pl: { x: number; y: number; angleDeg: number }) => {
  const b = shapesBounds([applyPlacement(p, pl).cut])!;
  return { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY };
};
const overlap = (a: { minX: number; minY: number; maxX: number; maxY: number }, b: { x: number; y: number; w: number; h: number }, gap = 0) =>
  a.minX < b.x + b.w + gap - 1e-6 && a.maxX > b.x - gap + 1e-6 && a.minY < b.y + b.h + gap - 1e-6 && a.maxY > b.y - gap + 1e-6;

describe("offcut helpers", () => {
  it("first sheet size: offcut size where set, else the sheet", () => {
    expect(firstSheetSize({ sheetW: 600, sheetH: 400 })).toEqual({ w: 600, h: 400 });
    expect(firstSheetSize({ sheetW: 600, sheetH: 400, offcutEnabled: true, offcutW: 250, offcutH: 0 })).toEqual({ w: 250, h: 400 });
    expect(firstSheetSize({ sheetW: 600, sheetH: 400, offcutEnabled: false, offcutW: 250, offcutH: 100 })).toEqual({ w: 600, h: 400 });
  });
  it("blocked areas apply only when enabled and invalid ones are dropped", () => {
    const list = [{ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 0, h: 10 }, { x: NaN, y: 0, w: 1, h: 1 }, "x", null];
    expect(cleanBlocked(list)).toEqual([{ x: 0, y: 0, w: 10, h: 10 }]);
    expect(cleanBlocked("nope")).toEqual([]);
    expect(cleanBlocked(Array.from({ length: 80 }, () => ({ x: 0, y: 0, w: 1, h: 1 })))).toHaveLength(MAX_BLOCKED);
    expect(activeBlocked({ sheetW: 1, sheetH: 1, blockedAreas: list as never, offcutEnabled: false })).toEqual([]);
    expect(activeBlocked({ sheetW: 1, sheetH: 1, blockedAreas: list as never, offcutEnabled: true })).toHaveLength(1);
  });
  it("sheet origins add the widths and the gap", () => {
    expect(sheetOrigins([100, 200, 200], 20)).toEqual([0, 120, 340]);
    expect(sheetOrigins([], 20)).toEqual([]);
  });
});

describe("offcut nesting", () => {
  it("is unchanged while the option is off, even with blocked areas stored", () => {
    const parts = [mk("A", 0, 60, 40), mk("B", 1, 50, 30)];
    const base = nestParts(parts, S);
    const off = nestParts(parts, { ...S, offcutEnabled: false, offcutW: 80, offcutH: 80, blockedAreas: [{ x: 0, y: 0, w: 100, h: 100 }] });
    expect(off).toEqual(base);
  });
  it("uses the offcut size for the first sheet only", () => {
    const parts = Array.from({ length: 6 }, (_, i) => mk(`P${i}`, i, 60, 40));
    const r = nestParts(parts, { ...S, offcutEnabled: true, offcutW: 80, offcutH: 60, blockedAreas: [] });
    expect(r.sheets[0]).toMatchObject({ w: 80, h: 60 });
    expect(r.sheets[1]).toMatchObject({ w: 200, h: 150 });
    for (const pl of r.placements.filter((p) => p.sheet === 0)) {
      const b = boundsOf(parts.find((p) => p.id === pl.partId)!, pl);
      expect(b.minX).toBeGreaterThanOrEqual(5 - 1e-6);
      expect(b.minY).toBeGreaterThanOrEqual(5 - 1e-6);
      expect(b.maxX).toBeLessThanOrEqual(80 - 5 + 1e-6);
      expect(b.maxY).toBeLessThanOrEqual(60 - 5 + 1e-6);
    }
    expect(r.sheets[0].partIds.length).toBeGreaterThan(0);
  });
  it("never places a part on a blocked area and keeps the part spacing to it", () => {
    const blocked = [{ x: 0, y: 0, w: 100, h: 150 }, { x: 150, y: 60, w: 30, h: 30 }]; // left half used up, a patch on the right
    const parts = Array.from({ length: 8 }, (_, i) => mk(`P${i}`, i, 40 + (i % 3) * 5, 30));
    const r = nestParts(parts, { ...S, offcutEnabled: true, blockedAreas: blocked });
    const onFirst = r.placements.filter((p) => p.sheet === 0);
    expect(onFirst.length).toBeGreaterThan(0);
    for (const pl of onFirst) {
      const b = boundsOf(parts.find((p) => p.id === pl.partId)!, pl);
      for (const bl of blocked) expect(overlap(b, bl, S.partSpacing), `${pl.partId} too close to ${JSON.stringify(bl)}`).toBe(false);
    }
    expect(r.sheets[0].blocked).toEqual(blocked);
    expect(r.sheets[1]?.blocked).toBeUndefined();
  });
  it("parts on later sheets ignore the blocked areas", () => {
    const blocked = [{ x: 0, y: 0, w: 200, h: 150 }]; // the whole first sheet is used up
    const r = nestParts([mk("A", 0, 50, 50)], { ...S, offcutEnabled: true, blockedAreas: blocked });
    // the first sheet takes nothing, is dropped, and the part sits on a full sheet (now sheet 0, without blocked areas)
    expect(r.sheets).toHaveLength(1);
    expect(r.sheets[0].blocked).toBeUndefined();
    expect(r.placements[0].sheet).toBe(0);
    expect(r.warnings.some((w) => /offcut/.test(w.message))).toBe(true);
  });
  it("blocked areas near the edge respect the sheet margin too", () => {
    const blocked = [{ x: -20, y: -20, w: 60, h: 60 }]; // sticks out of the sheet at the corner
    const parts = [mk("A", 0, 30, 30), mk("B", 1, 30, 30), mk("C", 2, 30, 30)];
    const r = nestParts(parts, { ...S, offcutEnabled: true, blockedAreas: blocked });
    for (const pl of r.placements.filter((p) => p.sheet === 0)) {
      const b = boundsOf(parts.find((p) => p.id === pl.partId)!, pl);
      expect(overlap(b, blocked[0], 3)).toBe(false);
      expect(b.minX).toBeGreaterThanOrEqual(5 - 1e-6);
    }
  });
  it("works together with copies", () => {
    const blocked = [{ x: 0, y: 0, w: 120, h: 150 }];
    const parts = [mk("A", 0, 40, 40)];
    const r = nestParts(parts, { ...S, copies: 6, offcutEnabled: true, blockedAreas: blocked });
    expect(r.placements).toHaveLength(6);
    for (const pl of r.placements.filter((p) => p.sheet === 0)) expect(overlap(boundsOf(parts[0], pl), blocked[0], 3)).toBe(false);
  });
});

describe("offcut in the pipeline and the export", () => {
  it("re-nests only when the offcut settings change", async () => {
    const { mesh, stats } = weld(box(30, 20, 40));
    const p = new Pipeline();
    p.setMesh(mesh, stats);
    await p.run(settings());
    const before = { ...p.runs };
    const r = (await p.run(settings({ offcutEnabled: true, offcutW: 100, offcutH: 80, blockedAreas: [{ x: 0, y: 0, w: 30, h: 30 }] })))!;
    expect(p.runs.nest).toBe(before.nest + 1);
    expect(p.runs.slice).toBe(before.slice);
    expect(p.runs.kerf).toBe(before.kerf);
    expect(r.sheets[0]).toMatchObject({ w: 100, h: 80 });
    // offcut off again: back to the cached full-sheet nesting key (a new run of the nesting, same result as the first)
    const r0 = (await p.run(settings()))!;
    expect(r0.sheets[0]).toMatchObject({ w: 600, h: 400 });
    expect(slicingKey(settings({ offcutEnabled: true }))).not.toBe(slicingKey(settings()));
  });
  it("sheet files have the offcut size; blocked areas are not drawn into them", async () => {
    const blocked = [{ x: 0, y: 0, w: 40, h: 40 }];
    const full = await slice(box(30, 20, 40), { sheetW: 120, sheetH: 100 });
    const r = await slice(box(30, 20, 40), { sheetW: 120, sheetH: 100, offcutEnabled: true, offcutW: 90, offcutH: 70, blockedAreas: blocked });
    const dxf = new TextDecoder().decode(buildExportFiles(r, { formats: ["dxf"], perLayerFiles: false, exportSheet: true }, "m")[0].bytes);
    expect(dxf).toContain("90.0");
    const svgFiles = (res: typeof r) => buildExportFiles(res, { formats: ["svg"], perLayerFiles: false }, "m").map((f) => new TextDecoder().decode(f.bytes));
    const svgFull = svgFiles(r)[0];
    expect(svgFull).toContain(`width="90.0mm" height="70.0mm"`);
    // same number of cut paths as without blocked areas (they add no geometry); only the sheet differs
    const count = (ts: string[]) => ts.reduce((n, t) => n + (t.match(/<path/g)?.length ?? 0), 0);
    expect(count(svgFiles(r))).toBe(count(svgFiles(full)));
    expect(r.parts.length).toBe(full.parts.length);
    const readme = buildReadme(r, settings({ sheetW: 120, sheetH: 100, offcutEnabled: true, offcutW: 90, offcutH: 70, blockedAreas: blocked }), "m", []);
    expect(readme).toContain("OFFCUT: sheet 1");
    expect(readme).toContain("0, 0, 40, 40");
  });
});

describe("offcut settings", () => {
  it("defaults to off with empty values and Basic mode ignores it", () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ offcutEnabled: false, offcutW: 0, offcutH: 0, blockedAreas: [] });
    expect(basicSettings(settings({ offcutEnabled: true, offcutW: 50, blockedAreas: [{ x: 1, y: 2, w: 3, h: 4 }] }))).toMatchObject({ offcutEnabled: false, offcutW: 0, blockedAreas: [] });
  });
  it("round-trips in project files and is validated", () => {
    const s = settings({ offcutEnabled: true, offcutW: 250, offcutH: 180, blockedAreas: [{ x: 10, y: 20, w: 30, h: 40 }, { x: -5, y: 0, w: 1.5, h: 2.5 }] });
    expect(parseProject(serializeProject(s))).toEqual(s);
    const bad = (patch: object) => JSON.stringify({ format: "laser-slicer-project", settings: patch });
    expect(() => parseProject(bad({ blockedAreas: "x" }))).toThrow(/"blockedAreas"/);
    expect(() => parseProject(bad({ blockedAreas: [{ x: 0, y: 0, w: 0, h: 5 }] }))).toThrow(/"blockedAreas"/);
    expect(() => parseProject(bad({ blockedAreas: [{ x: 0, y: 0, w: 5 }] }))).toThrow(/"blockedAreas"/);
    expect(() => parseProject(bad({ blockedAreas: Array.from({ length: MAX_BLOCKED + 1 }, () => ({ x: 0, y: 0, w: 1, h: 1 })) }))).toThrow(/"blockedAreas"/);
    expect(() => parseProject(bad({ offcutW: -1 }))).toThrow(/"offcutW"/);
    expect(parseProject(bad({})).blockedAreas).toEqual([]);
  });
});
