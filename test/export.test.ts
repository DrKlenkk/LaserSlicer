import { describe, expect, it } from "vitest";
import DxfParser from "dxf-parser";
import { unzipSync } from "fflate";
import { writeDxf } from "../src/core/export/dxf";
import { writeSvg } from "../src/core/export/svg";
import { drawingOf, sheetDrawing } from "../src/core/export/common";
import { buildExportFiles } from "../src/core/export/files";
import { buildReadme, buildZip } from "../src/core/export/zip";
import type { Part, Ring, Vec2 } from "../src/core/types";
import { box, uvSphere } from "./fixtures/meshes";
import { settings, slice } from "./helpers";

const sq = (x0: number, y0: number, s: number): Ring => [[x0, y0], [x0 + s, y0], [x0 + s, y0 + s], [x0, y0 + s]];

function samplePart(): Part {
  return {
    id: "L001",
    layer: 1,
    cut: { outer: sq(10.12345, 20, 40), holes: [sq(20, 30, 10).reverse()] },
    engrave: [[[12, 22], [30, 22], [30, 40]], [[15, 25], [25, 25], [25, 35], [15, 35], [15, 25]]],
    label: [[[14, 50], [18, 55]], [[18, 50], [14, 55]]],
    holes: [{ c: [30, 45], d: 5.8 }],
  };
}

const parse = (text: string) => new DxfParser().parseSync(text)!;
const verts = (e: { vertices: { x: number; y: number }[] }): Vec2[] => e.vertices.map((v) => [v.x, v.y]);

describe("DXF", () => {
  const d = drawingOf([samplePart()], 600, 400);
  const text = writeDxf(d);
  const dxf = parse(text);

  it("has the R12 structure and header values", () => {
    expect(text).toContain("AC1009");
    const lines = text.split("\r\n");
    expect(lines.slice(0, 4)).toEqual(["  0", "SECTION", "  2", "HEADER"]);
    expect(lines[lines.length - 2]).toBe("EOF");
    expect(text.indexOf("$INSUNITS")).toBeGreaterThan(0);
    expect(text.indexOf("$MEASUREMENT")).toBeGreaterThan(0);
    for (const sec of ["HEADER", "TABLES", "ENTITIES"]) expect(text).toContain(`  2\r\n${sec}\r\n`);
    expect(text).toContain("CONTINUOUS");
    expect(text).not.toMatch(/\r\n  0\r\nTEXT\r\n/);
  });

  it("round-trips layers, colours and vertex coordinates", () => {
    const layers = (dxf.tables as { layer: { layers: Record<string, { colorIndex: number }> } }).layer.layers;
    expect(Object.keys(layers).sort()).toEqual(["BRIDGE", "CUT", "ENGRAVE", "LABEL", "SHEET"]);
    expect([layers.CUT.colorIndex, layers.ENGRAVE.colorIndex, layers.LABEL.colorIndex, layers.SHEET.colorIndex, layers.BRIDGE.colorIndex]).toEqual([1, 5, 3, 8, 6]);

    const ents = dxf.entities as any[];
    const cut = ents.filter((e) => e.layer === "CUT" && e.type === "POLYLINE");
    expect(cut).toHaveLength(2);
    const p = samplePart();
    for (const [i, ring] of [p.cut.outer, p.cut.holes[0]].entries()) {
      expect(cut[i].shape).toBe(true);
      const v = verts(cut[i]);
      expect(v).toHaveLength(ring.length);
      v.forEach((q, k) => {
        expect(Math.abs(q[0] - ring[k][0])).toBeLessThan(0.001);
        expect(Math.abs(q[1] - ring[k][1])).toBeLessThan(0.001);
      });
    }
    const eng = ents.filter((e) => e.layer === "ENGRAVE");
    expect(eng).toHaveLength(2);
    expect(eng[0].shape).toBe(false);
    expect(verts(eng[0])).toEqual(p.engrave[0]);
    expect(eng[1].shape).toBe(true); // repeated end point = closed
    expect(verts(eng[1])).toHaveLength(4);
    const lab = ents.filter((e) => e.layer === "LABEL");
    expect(lab).toHaveLength(2);
    expect(verts(lab[0])).toEqual(p.label[0]);
    const circ = ents.filter((e) => e.type === "CIRCLE");
    expect(circ).toHaveLength(1);
    expect(circ[0].layer).toBe("CUT");
    expect(circ[0].radius).toBeCloseTo(2.9, 4);
    expect(circ[0].center.x).toBeCloseTo(30, 4);
  });

  it("draws the sheet border on layer SHEET only on request", () => {
    expect((parse(writeDxf(d)).entities as any[]).some((e) => e.layer === "SHEET")).toBe(false);
    const withBorder = parse(writeDxf(d, { sheetBorder: true })).entities as any[];
    const b = withBorder.find((e) => e.layer === "SHEET");
    expect(verts(b)).toEqual([[0, 0], [600, 0], [600, 400], [0, 400]]);
  });

  it("a 20 mm square with kerf 0.2 exports as 20.2 mm", async () => {
    const r = await slice(box(20, 20, 4), { thickness: 4, kerf: 0.2 });
    const files = buildExportFiles(r, settings({ formats: ["dxf"] }), "cube");
    const ent = (parse(new TextDecoder().decode(files[0].bytes)).entities as any[]).find((e) => e.layer === "CUT");
    const xs = verts(ent).map((v) => v[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(20.2, 3);
  });
});

/** Parse "M x y L x y ... Z M ..." back into polylines with the Y flip undone. */
function svgPaths(svg: string, group: string, height: number): { pts: Vec2[]; closed: boolean }[][] {
  const g = new RegExp(`<g id="${group}"[^>]*>([\\s\\S]*?)</g>`).exec(svg)![1];
  const out: { pts: Vec2[]; closed: boolean }[][] = [];
  for (const m of g.matchAll(/<path[^>]* d="([^"]*)"/g)) {
    const subs: { pts: Vec2[]; closed: boolean }[] = [];
    for (const sub of m[1].split("M").filter(Boolean)) {
      const nums = [...sub.matchAll(/-?\d+(?:\.\d+)?/g)].map((x) => Number(x[0]));
      const pts: Vec2[] = [];
      for (let i = 0; i < nums.length; i += 2) pts.push([nums[i], height - nums[i + 1]]);
      subs.push({ pts, closed: /Z\s*$/.test(sub) });
    }
    out.push(subs);
  }
  return out;
}

describe("SVG", () => {
  const d = drawingOf([samplePart()], 600, 400);
  const svg = writeSvg(d);

  it("has mm size, viewBox, groups and stroke width", () => {
    expect(svg).toContain('width="600.0mm" height="400.0mm" viewBox="0 0 600.0 400.0"');
    for (const id of ["CUT", "ENGRAVE", "LABEL"]) expect(svg).toContain(`<g id="${id}"`);
    expect(svg).toContain('stroke-width="0.1"');
    expect(svg).toContain('fill-rule="evenodd"');
  });

  it("matches the DXF outlines after the Y flip", () => {
    const dxf = parse(writeDxf(d));
    const ents = dxf.entities as any[];
    const cutDxf = ents.filter((e) => e.layer === "CUT" && e.type === "POLYLINE").map(verts);
    const cutSvg = svgPaths(svg, "CUT", 400).flatMap((p) => p.map((s) => s.pts));
    expect(cutSvg).toHaveLength(cutDxf.length);
    cutDxf.forEach((ring, i) =>
      ring.forEach((q, k) => {
        expect(Math.abs(q[0] - cutSvg[i][k][0])).toBeLessThan(0.001);
        expect(Math.abs(q[1] - cutSvg[i][k][1])).toBeLessThan(0.001);
      }),
    );
    const engDxf = ents.filter((e) => e.layer === "ENGRAVE").map(verts);
    const engSvg = svgPaths(svg, "ENGRAVE", 400).map((p) => p[0]);
    expect(engSvg.map((e) => e.closed)).toEqual([false, true]);
    engDxf.forEach((l, i) => l.forEach((q, k) => expect(Math.abs(q[1] - engSvg[i].pts[k][1])).toBeLessThan(0.001)));
    expect(svg).toMatch(/<circle cx="30.0" cy="355.0" r="2.9"\/>/);
  });
});

describe("export files and ZIP", () => {
  it("names per-sheet and per-layer files and zips them with a README", async () => {
    const r = await slice(box(20, 20, 12), { thickness: 4 });
    const s = settings({ formats: ["dxf", "svg"] });
    const sheetFiles = buildExportFiles(r, s, "cube");
    expect(sheetFiles.map((f) => f.name)).toEqual(["cube_sheet01.dxf", "cube_sheet01.svg"]);
    const layerFiles = buildExportFiles(r, { ...s, perLayerFiles: true }, "cube");
    expect(layerFiles.map((f) => f.name)).toEqual(["cube_L000.dxf", "cube_L000.svg", "cube_L001.dxf", "cube_L001.svg", "cube_L002.dxf", "cube_L002.svg"]);
    // per-layer drawing starts at the origin
    const e = (parse(new TextDecoder().decode(layerFiles[0].bytes)).entities as any[])[0];
    expect(Math.min(...verts(e).map((v) => v[0]))).toBeCloseTo(0, 3);

    const readme = buildReadme(r, s, "cube", layerFiles);
    const zip = unzipSync(buildZip(layerFiles, readme));
    expect(Object.keys(zip).sort()).toEqual([...layerFiles.map((f) => f.name), "README.txt"].sort());
    const text = new TextDecoder().decode(zip["README.txt"]);
    expect(text).toContain("Layers: 3");
    expect(text).toContain("Sheets: 1");
    expect(text).toContain("Material thickness: 4 mm");
    expect(text).toContain("Stacking order");
    expect(text).toContain("Warnings (0)");
    expect(new TextDecoder().decode(zip["cube_L001.dxf"])).toBe(new TextDecoder().decode(layerFiles[2].bytes));
  });

  it("sheet drawings use placements", async () => {
    const r = await slice(box(20, 20, 8), { thickness: 4 });
    const d = sheetDrawing(r.parts, r.placements, 0, 600, 400);
    expect(d.cut).toHaveLength(2);
    const xs = d.cut.flatMap((sh) => sh[0].map((p) => p[0]));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(5 - 1e-6); // sheet margin
  });
});

describe("export layer selection", () => {
  const d = drawingOf([samplePart()], 600, 400);
  const layersOf = (dxf: string) => new Set((parse(dxf).entities as any[]).map((e) => e.layer));

  it("DXF: excluded layers have no entities (the LAYER table still lists all four)", () => {
    const dxf = writeDxf(d, { layers: { engrave: false, label: false } });
    expect(layersOf(dxf)).toEqual(new Set(["CUT"])); // outlines + dowel circle
    expect(Object.keys(parse(dxf).tables.layer.layers).sort()).toEqual(["BRIDGE", "CUT", "ENGRAVE", "LABEL", "SHEET"]);
    expect(layersOf(writeDxf(d, { layers: { cut: false } }))).toEqual(new Set(["ENGRAVE", "LABEL"]));
    expect((parse(writeDxf(d, { layers: { cut: false } })).entities as any[]).some((e) => e.type === "CIRCLE")).toBe(false); // dowel holes are CUT
    expect(layersOf(writeDxf(d, { layers: { cut: false, engrave: false, label: false } })).size).toBe(0);
  });

  it("DXF: layers.sheet adds the border and extents then cover the sheet", () => {
    const dxf = writeDxf(d, { layers: { cut: false, engrave: false, label: false, sheet: true } });
    expect(layersOf(dxf)).toEqual(new Set(["SHEET"]));
    expect((parse(dxf).header["$EXTMAX"] as { x: number }).x).toBe(600);
  });

  it("SVG: excluded groups are omitted, SHEET is a rect group", () => {
    const only = writeSvg(d, { engrave: false, label: false });
    expect(only).toContain('<g id="CUT"');
    expect(only).not.toContain('id="ENGRAVE"');
    expect(only).not.toContain('id="LABEL"');
    expect(only).not.toContain('id="SHEET"');
    const sheet = writeSvg(d, { cut: false, sheet: true });
    expect(sheet).not.toContain('id="CUT"');
    expect(sheet).toMatch(/<g id="SHEET"[^>]*>\s*<rect x="0" y="0" width="600.0" height="400.0"\/>/);
    expect(writeSvg(d)).not.toContain('id="SHEET"');
  });

  it("buildExportFiles follows the export settings; the defaults keep every trace but the border", async () => {
    const r = await slice(uvSphere(10, 24, 32), { thickness: 4 });
    const text = (s: Parameters<typeof settings>[0]) => buildExportFiles(r, settings({ formats: ["dxf"], ...s }), "m").map((f) => new TextDecoder().decode(f.bytes)).join("\n");
    expect(layersOf(text({}))).toEqual(new Set(["CUT", "ENGRAVE", "LABEL"]));
    expect(layersOf(text({ exportEngrave: false, exportLabel: false }))).toEqual(new Set(["CUT"]));
    expect(layersOf(text({ exportSheet: true })).has("SHEET")).toBe(true);
  });

  it("README lists the included layers and warns without CUT", async () => {
    const r = await slice(box(20, 20, 8), { thickness: 4 });
    expect(buildReadme(r, settings({ exportSheet: true, exportLabel: false }), "m", [])).toMatch(/Layers included: CUT, ENGRAVE, SHEET border \(left out: LABEL\)/);
    const none = buildReadme(r, settings({ exportCut: false }), "m", []);
    expect(none).toMatch(/left out: CUT/);
    expect(none).toMatch(/do not cut the parts out/);
  });
});
