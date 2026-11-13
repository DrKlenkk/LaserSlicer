import { describe, expect, it } from "vitest";
import DxfParser from "dxf-parser";
import { addBridges, type BridgeParams } from "../src/core/bridges";
import { writeDxf } from "../src/core/export/dxf";
import { writeSvg } from "../src/core/export/svg";
import { drawingOf, exportLayersOf } from "../src/core/export/common";
import { buildExportFiles } from "../src/core/export/files";
import { buildReadme } from "../src/core/export/zip";
import { DEFAULT_SETTINGS, parseProject } from "../src/state";
import { slicingKey } from "../src/updateController";
import type { Part, Ring } from "../src/core/types";
import { box } from "./fixtures/meshes";
import { settings, slice } from "./helpers";

const rect = (x: number, y: number, w: number, h: number): Ring => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const parse = (t: string) => new DxfParser().parseSync(t)!;
const part = (id = "L001"): Part => ({
  id, layer: 1,
  cut: { outer: rect(0, 0, 100, 100), holes: [rect(30, 30, 30, 30).reverse()] },
  engrave: [[[5, 5], [20, 5]]], label: [[[5, 90], [9, 95]]],
  holes: [{ c: [80, 80], d: 6 }],
});
const P: BridgeParams = { bridgesEnabled: true, bridgeCount: 2, bridgeWidth: 0.5, bridgeMinLength: 40, bridgeHoles: true, bridgeMaxSpacing: 0, kerf: 0.15 };

/** Layer and kind of each DXF entity in file order. */
const seq = (dxf: string) => (parse(dxf).entities as any[]).map((e) => `${e.layer}:${e.type === "CIRCLE" ? "circle" : e.shape ? "closed" : "open"}`);
const width = (e: any) => (e.type === "CIRCLE" ? 0 : Math.max(...e.vertices.map((v: any) => v.x)) - Math.min(...e.vertices.map((v: any) => v.x)));

describe("inner cuts first (entity order)", () => {
  it("DXF: holes, dowel circles, then outline", () => {
    const cuts = (parse(writeDxf(drawingOf([part("A"), part("B")], 200, 200))).entities as any[]).filter((e) => e.layer === "CUT");
    expect(cuts.map(width)).toEqual([30, 30, 0, 0, 100, 100]);
  });

  it("DXF: bridged rings keep the order and the gaps stay on BRIDGE", () => {
    const d = drawingOf(addBridges([part()], P).parts, 200, 200);
    expect(d.innerOpen!.length).toBeGreaterThan(0);
    expect(d.outerOpen!.length).toBeGreaterThan(0);
    const s = seq(writeDxf(d, { layers: { innerLayer: true } }));
    expect(s.filter((x) => x === "CUT_INNER:open")).toHaveLength(d.innerOpen!.length);
    expect(s.filter((x) => x === "CUT:open")).toHaveLength(d.outerOpen!.length);
    expect(s.indexOf("CUT:open")).toBeGreaterThan(s.lastIndexOf("CUT_INNER:open"));
    expect(s.filter((x) => x === "BRIDGE:open")).toHaveLength(d.bridge!.length);
    const plain = seq(writeDxf(d)).filter((x) => x.startsWith("CUT"));
    expect(plain.lastIndexOf("CUT:circle")).toBeLessThan(plain.indexOf("CUT:open", plain.length - d.outerOpen!.length));
  });

  it("SVG: inner ring and circle before the outline in CUT", () => {
    const svg = writeSvg(drawingOf([part()], 200, 200));
    const cut = svg.slice(svg.indexOf('<g id="CUT"'), svg.indexOf("</g>", svg.indexOf('<g id="CUT"')));
    expect(cut.indexOf("<circle")).toBeGreaterThan(cut.indexOf("M30.0"));
    expect(cut.indexOf("M0.0")).toBeGreaterThan(cut.indexOf("<circle"));
  });
});

describe("CUT_INNER layer", () => {
  const d = drawingOf([part()], 200, 200);
  it("is off by default: no CUT_INNER layer or entity, the same 5 layers as before", () => {
    const dxf = parse(writeDxf(d));
    expect(Object.keys(dxf.tables.layer.layers).sort()).toEqual(["BRIDGE", "CUT", "ENGRAVE", "LABEL", "SHEET"]);
    expect((dxf.entities as any[]).every((e) => e.layer !== "CUT_INNER")).toBe(true);
    expect(writeSvg(d)).not.toContain("CUT_INNER");
    expect(DEFAULT_SETTINGS.exportInnerLayer).toBe(false);
  });
  it("on: DXF holes and dowel circles go to CUT_INNER (ACI 30), the outline stays on CUT, the LAYER table lists it", () => {
    const dxf = parse(writeDxf(d, { layers: { innerLayer: true } }));
    expect(dxf.tables.layer.layers.CUT_INNER.colorIndex).toBe(30);
    const ents = dxf.entities as any[];
    expect(ents.filter((e) => e.layer === "CUT_INNER").map((e) => e.type)).toEqual(["POLYLINE", "CIRCLE"]);
    const cut = ents.filter((e) => e.layer === "CUT");
    expect(cut).toHaveLength(1);
    expect(width(cut[0])).toBe(100);
    expect(ents.findIndex((e) => e.layer === "CUT")).toBeGreaterThan(ents.map((e) => e.layer).lastIndexOf("CUT_INNER"));
    expect(ents.filter((e) => e.layer === "ENGRAVE" || e.layer === "LABEL")).toHaveLength(2);
  });
  it("on: SVG has an orange CUT_INNER group before CUT; without CUT neither is written", () => {
    const svg = writeSvg(d, { innerLayer: true });
    expect(svg).toMatch(/<g id="CUT_INNER" stroke="#ff8000"/);
    expect(svg.indexOf('id="CUT_INNER"')).toBeLessThan(svg.indexOf('id="CUT"'));
    expect(svg.slice(svg.indexOf('id="CUT_INNER"'), svg.indexOf('id="CUT"'))).toContain("<circle");
    expect(svg.slice(svg.indexOf('id="CUT"'), svg.indexOf('id="ENGRAVE"'))).not.toContain("<circle");
    expect(writeSvg(d, { innerLayer: true, cut: false })).not.toContain("CUT_INNER");
    expect((parse(writeDxf(d, { layers: { innerLayer: true, cut: false } })).entities as any[]).some((e) => e.layer.startsWith("CUT"))).toBe(false);
  });
  it("the amount of cut geometry is the same with and without the layer", () => {
    const count = (t: string) => (parse(t).entities as any[]).filter((e) => e.layer.startsWith("CUT")).length;
    expect(count(writeDxf(d, { layers: { innerLayer: true } }))).toBe(count(writeDxf(d)));
  });
  it("hand-made drawings (no split) still work: the first ring of a shape is the outline", () => {
    const hand = { width: 50, height: 50, cut: [[rect(0, 0, 40, 40), rect(10, 10, 5, 5)]], circles: [], engrave: [], label: [] };
    expect((parse(writeDxf(hand, { layers: { innerLayer: true } })).entities as any[]).map((e) => e.layer)).toEqual(["CUT_INNER", "CUT"]);
  });
  it("buildExportFiles and the README follow the setting; it is export-only", async () => {
    const r = await slice(box(40, 40, 8), { thickness: 4 });
    const text = (s: Parameters<typeof settings>[0]) => buildExportFiles(r, settings({ formats: ["dxf", "svg"], ...s }), "m").map((f) => new TextDecoder().decode(f.bytes)).join("\n");
    expect(text({})).not.toContain("CUT_INNER");
    expect(text({ exportInnerLayer: true })).toContain("CUT_INNER"); // the dowel holes
    expect(exportLayersOf({ exportInnerLayer: true }).innerLayer).toBe(true);
    expect(exportLayersOf({}).innerLayer).toBe(false);
    const on = buildReadme(r, settings({ exportInnerLayer: true }), "m", []);
    expect(on).toMatch(/Cut CUT_INNER first, then CUT/);
    expect(on).toMatch(/CUT_INNER \(orange/);
    expect(buildReadme(r, settings(), "m", [])).not.toMatch(/CUT_INNER/);
    expect(slicingKey(settings({ exportInnerLayer: true }))).toBe(slicingKey(settings()));
  });
  it("project files without the key load with the default; the key round-trips and is validated", () => {
    const proj = (st: object) => JSON.stringify({ format: "laser-slicer-project", version: 1, settings: st });
    expect(parseProject(proj({ kerf: 0.1 })).exportInnerLayer).toBe(false);
    expect(parseProject(proj({ exportInnerLayer: true })).exportInnerLayer).toBe(true);
    expect(() => parseProject(proj({ exportInnerLayer: "yes" }))).toThrow(/exportInnerLayer/);
  });
});
