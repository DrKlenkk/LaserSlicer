import { describe, expect, it } from "vitest";
import { Pipeline } from "../src/core/pipeline";
import { resolveRange, partsInRange, rangeText } from "../src/core/range";
import { buildExportFiles, exportDrawings } from "../src/core/export/files";
import { buildReadme } from "../src/core/export/zip";
import { DEFAULT_SETTINGS, parseProject } from "../src/state";
import { slicingKey } from "../src/updateController";
import { HELP } from "../src/ui/helpText";
import { box } from "./fixtures/meshes";
import { settings, slice, weld } from "./helpers";

// 40 mm tall box, 4 mm layers = 10 layers (0..9), one part each.
const tower = () => box(30, 20, 40);

describe("resolveRange", () => {
  it("null / null is all layers and not clamped", () => {
    expect(resolveRange(10, null, null)).toEqual({ from: 0, to: 9, all: true, clamped: false });
  });
  it("open ends, a plain range", () => {
    expect(resolveRange(10, 3, null)).toEqual({ from: 3, to: 9, all: false, clamped: false });
    expect(resolveRange(10, null, 4)).toEqual({ from: 0, to: 4, all: false, clamped: false });
    expect(resolveRange(10, 2, 2)).toEqual({ from: 2, to: 2, all: false, clamped: false });
  });
  it("clamps to the model's layers and says so", () => {
    expect(resolveRange(10, 5, 99)).toEqual({ from: 5, to: 9, all: false, clamped: true });
    expect(resolveRange(10, 0, 99)).toEqual({ from: 0, to: 9, all: true, clamped: true });
    expect(resolveRange(10, 50, 60)).toMatchObject({ from: 9, to: 9, clamped: true }); // entirely outside: nearest end layer
  });
  it("swaps a reversed range (flagged as adjusted)", () => {
    expect(resolveRange(10, 6, 2)).toEqual({ from: 2, to: 6, all: false, clamped: true });
  });
  it("a model without layers", () => {
    expect(resolveRange(0, 3, 4).all).toBe(true);
  });
  it("partsInRange and text", () => {
    const parts = [0, 1, 2, 3].map((layer) => ({ layer }));
    expect(partsInRange(parts, resolveRange(4, 1, 2)).map((p) => p.layer)).toEqual([1, 2]);
    expect(partsInRange(parts, undefined)).toBe(parts);
    expect(rangeText(resolveRange(4, null, null), 4)).toBe("");
    expect(rangeText(resolveRange(10, 3, 5), 10)).toContain("layers 3 to 5");
    expect(rangeText(resolveRange(10, 3, 3), 10)).toContain("only layer 3");
  });
});

describe("pipeline layer range", () => {
  it("default: all layers nested, range is all", async () => {
    const r = await slice(tower());
    expect(r.info.layerCount).toBe(10);
    expect(r.info.range.all).toBe(true);
    expect(r.placements).toHaveLength(10);
  });

  it("only parts of layers in the range are nested; all parts stay available for the views", async () => {
    const r = await slice(tower(), { rangeFrom: 3, rangeTo: 5 });
    expect(r.info.range).toMatchObject({ from: 3, to: 5, all: false });
    expect(r.placements.map((p) => p.partId).sort()).toEqual(["L003", "L004", "L005"]);
    expect(r.sheets.flatMap((s) => s.partIds).sort()).toEqual(["L003", "L004", "L005"]);
    expect(r.parts).toHaveLength(10);
    expect(r.layers).toHaveLength(10);
  });

  it("measurements cover only the range", async () => {
    const all = await slice(tower());
    const some = await slice(tower(), { rangeFrom: 0, rangeTo: 4 });
    expect(some.measure.area).toBeCloseTo(all.measure.area / 2, 3);
    expect(some.measure.cutLength).toBeLessThan(all.measure.cutLength);
  });

  it("engrave lines and labels are those of the full model", async () => {
    const all = await slice(tower());
    const some = await slice(tower(), { rangeFrom: 4, rangeTo: 4 });
    const a = all.parts.find((p) => p.id === "L004")!, b = some.parts.find((p) => p.id === "L004")!;
    expect(b.engrave).toEqual(a.engrave);
    expect(b.label).toEqual(a.label);
    expect(b.label.length).toBeGreaterThan(0);
  });

  it("changing the range re-runs nesting only; an equivalent clamped range does not even do that", async () => {
    const { mesh, stats } = weld(tower());
    const p = new Pipeline();
    p.setMesh(mesh, stats);
    await p.run(settings());
    const before = { ...p.runs };
    await p.run(settings({ rangeFrom: 2, rangeTo: 6 }));
    expect(p.runs).toEqual({ ...before, nest: before.nest + 1 });
    await p.run(settings({ rangeFrom: 2, rangeTo: 6 }));
    expect(p.runs.nest).toBe(before.nest + 1);
    await p.run(settings({ rangeFrom: 0, rangeTo: 9 }));
    expect(p.runs.nest).toBe(before.nest + 2);
    await p.run(settings({ rangeFrom: null, rangeTo: 500 })); // clamps to the same layers as "all"
    expect(p.runs.nest).toBe(before.nest + 2);
    expect({ ...p.runs, nest: 0 }).toEqual({ ...before, nest: 0 });
  });
});

describe("export honours the range", () => {
  it("per sheet: only the range's parts are in the files", async () => {
    const r = await slice(tower(), { rangeFrom: 2, rangeTo: 3 });
    const files = buildExportFiles(r, settings({ formats: ["dxf", "svg"] }), "m");
    expect(files.map((f) => f.name)).toEqual(["m_sheet01.dxf", "m_sheet01.svg"]);
    const svg = new TextDecoder().decode(files[1].bytes);
    expect((svg.match(/<path/g) ?? []).length).toBeGreaterThan(0);
    const all = await slice(tower());
    const svgAll = new TextDecoder().decode(buildExportFiles(all, settings({ formats: ["svg"] }), "m")[0].bytes);
    expect(svg.length).toBeLessThan(svgAll.length);
  });

  it("per layer: only layers in the range get a file (raster uses the same list)", async () => {
    const r = await slice(tower(), { rangeFrom: 7, rangeTo: 8 });
    const names = exportDrawings(r, true, "m").map((d) => d.stem);
    expect(names).toEqual(["m_L007", "m_L008"]);
    expect(buildExportFiles(r, settings({ perLayerFiles: true }), "m").map((f) => f.name)).toEqual(["m_L007.dxf", "m_L008.dxf"]);
  });

  it("README says clearly that only the range is included; none of that text when all layers are in", async () => {
    const r = await slice(tower(), { rangeFrom: 2, rangeTo: 4 });
    const txt = buildReadme(r, settings({ rangeFrom: 2, rangeTo: 4 }), "m", []);
    expect(txt).toMatch(/LAYER RANGE: only layers 2 to 4 \(L002 to L004\) \(model has layers 0 to 9\)/);
    expect(txt).toContain("Parts: 3");
    expect(txt).toContain("Layers: 3 of 10");
    const clamped = await slice(tower(), { rangeFrom: 8, rangeTo: 50 });
    expect(buildReadme(clamped, settings(), "m", [])).toMatch(/adjusted/);
    const full = await slice(tower());
    const t = buildReadme(full, settings(), "m", []);
    expect(t).not.toContain("LAYER RANGE");
    expect(t).toContain("Parts: 10");
    expect(t).toContain("Layers: 10");
  });
});

describe("range setting", () => {
  it("defaults to all layers and is a nesting-affecting setting (part of the slicing key, so the preview updates)", () => {
    expect(DEFAULT_SETTINGS.rangeFrom).toBeNull();
    expect(DEFAULT_SETTINGS.rangeTo).toBeNull();
    expect(slicingKey(settings({ rangeFrom: 2 }))).not.toBe(slicingKey(settings()));
  });
  const proj = (s: object) => JSON.stringify({ format: "laser-slicer-project", version: 2, settings: s });
  it("project files: missing key loads the default, valid values load, bad ones are rejected", () => {
    expect(parseProject(proj({ kerf: 0.1 })).rangeFrom).toBeNull();
    const p = parseProject(proj({ rangeFrom: 3, rangeTo: 7 }));
    expect([p.rangeFrom, p.rangeTo]).toEqual([3, 7]);
    expect(parseProject(proj({ rangeFrom: null })).rangeFrom).toBeNull();
    for (const bad of [-1, 1.5, "3", true]) expect(() => parseProject(proj({ rangeTo: bad }))).toThrow(/rangeTo/);
  });
  it("has a tooltip", () => {
    expect(HELP.layerRange.length).toBeGreaterThan(20);
  });
});
