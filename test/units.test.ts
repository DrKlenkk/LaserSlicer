import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { IMPORT_UNIT_MM, IMPORT_UNITS, importUnitFactor, read3mfUnit } from "../src/core/units";
import { orientMesh } from "../src/core/transform";
import { weldSoup } from "../src/core/mesh";
import { box, toSoup } from "./fixtures/meshes";
import { DEFAULT_SETTINGS, parseProject, serializeProject } from "../src/state";
import { slicingKey } from "../src/updateController";
import { Pipeline } from "../src/core/pipeline";
import { settings, weld } from "./helpers";

const base = { axis: "+Z" as const, rotationSteps: [0, 0, 0] as [number, number, number], scale: 1, targetSize: null };
const slab = () => weldSoup(toSoup(box(10, 20, 30))).mesh;

describe("import unit factor", () => {
  it("has the exact millimetre factors", () => {
    expect(IMPORT_UNIT_MM).toEqual({ micron: 0.001, mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 });
    expect(importUnitFactor("in")).toBe(25.4);
  });
  it("scales the oriented mesh and leaves the scale at 1", () => {
    const o = orientMesh(slab(), { ...base, importUnit: "in" });
    expect(o.scale).toBe(1);
    expect(o.size[0]).toBeCloseTo(254, 3);
    expect(o.size[2]).toBeCloseTo(762, 3);
    expect(o.mesh.bbox.min[2]).toBeCloseTo(0, 9);
    expect(o.baseSize[1]).toBeCloseTo(508, 3);
  });
  it("combines with scale, and target size is in mm", () => {
    const a = orientMesh(slab(), { ...base, importUnit: "cm", scale: 0.5 });
    expect(a.size[0]).toBeCloseTo(50, 3);
    const t = orientMesh(slab(), { ...base, importUnit: "cm", targetSize: { dim: "x", mm: 50 } });
    expect(t.size[0]).toBeCloseTo(50, 3);
    expect(t.scale).toBeCloseTo(0.5, 6);
  });
  it("defaults to mm when the unit is missing", () => {
    expect(orientMesh(slab(), base).size[0]).toBeCloseTo(10, 6);
  });
});

describe("import unit setting", () => {
  it("round-trips, defaults for old files, rejects unknown", () => {
    const s = settings({ importUnit: "ft" });
    expect(parseProject(serializeProject(s)).importUnit).toBe("ft");
    expect(parseProject(JSON.stringify({ format: "laser-slicer-project", version: 1, settings: {} })).importUnit).toBe("mm");
    expect(DEFAULT_SETTINGS.importUnit).toBe("mm");
    expect(() => parseProject(JSON.stringify({ format: "laser-slicer-project", settings: { importUnit: "yard" } }))).toThrow(/"importUnit"/);
    for (const u of IMPORT_UNITS) expect(parseProject(serializeProject(settings({ importUnit: u }))).importUnit).toBe(u);
  });
  it("changes the slicing key", () => {
    expect(slicingKey(settings({ importUnit: "in" }))).not.toBe(slicingKey(settings()));
  });
  it("re-runs orient and later stages, and scales the result", async () => {
    const p = new Pipeline();
    p.setMesh(weld(box(10, 10, 10)).mesh);
    const r1 = await p.run(settings({ thickness: 1 }), {});
    const o1 = p.runs.orient;
    const r2 = await p.run(settings({ thickness: 1, importUnit: "cm" }), {});
    expect(p.runs.orient).toBe(o1 + 1);
    expect(r1!.info.size[0]).toBeCloseTo(10, 3);
    expect(r2!.info.size[0]).toBeCloseTo(100, 3);
    expect(r2!.info.scale).toBe(1);
    expect(r2!.layers.length).toBe(100);
  });
});

const model = (unit?: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><model ${unit ? `unit="${unit}" ` : ""}xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources/><build/></model>`;
const rels = (target: string) =>
  `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="${target}" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;
const pack = (files: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));

describe("read3mfUnit", () => {
  it("reads each unit the format allows", () => {
    const want = { micron: "micron", millimeter: "mm", centimeter: "cm", meter: "m", inch: "in", foot: "ft" } as const;
    for (const [attr, u] of Object.entries(want))
      expect(read3mfUnit(pack({ "_rels/.rels": rels("/3D/3dmodel.model"), "3D/3dmodel.model": model(attr) }))).toBe(u);
  });
  it("defaults to mm when the attribute is absent", () => {
    expect(read3mfUnit(pack({ "_rels/.rels": rels("/3D/3dmodel.model"), "3D/3dmodel.model": model() }))).toBe("mm");
  });
  it("follows the relationship to a differently named model part", () => {
    const z = pack({ "_rels/.rels": rels("/3D/other.model"), "3D/3dmodel.model": model("inch"), "3D/other.model": model("meter") });
    expect(read3mfUnit(z)).toBe("m");
  });
  it("falls back to the first .model file without relationships", () => {
    expect(read3mfUnit(pack({ "3D/3dmodel.model": model("centimeter") }))).toBe("cm");
  });
  it("is not fooled by unit attributes on other elements", () => {
    const x = model().replace("<resources/>", '<resources><object unit="inch"/></resources>');
    expect(read3mfUnit(pack({ "3D/3dmodel.model": x }))).toBe("mm");
  });
  it("returns null for garbage, unknown units and archives without a model", () => {
    expect(read3mfUnit(new Uint8Array([1, 2, 3, 4]))).toBeNull();
    expect(read3mfUnit(pack({ "3D/3dmodel.model": model("furlong") }))).toBeNull();
    expect(read3mfUnit(pack({ "readme.txt": "x" }))).toBeNull();
  });
});
