import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, parseProject, parseProjectFile, serializeProject } from "../src/state";
import { settings } from "./helpers";

describe("project file", () => {
  it("round-trips settings exactly", () => {
    const s = settings({ thickness: 3.8, hollowEnabled: true, hollowWall: 9, dowels: true, formats: ["dxf", "png"], targetSize: { dim: "y", mm: 120 }, rotationSteps: [1, 0, 3], axis: "-X", mode: "undersize" });
    expect(parseProject(serializeProject(s))).toEqual(s);
  });
  it("fills missing keys with defaults and ignores unknown ones", () => {
    const text = JSON.stringify({ format: "laser-slicer-project", version: 1, settings: { kerf: 0.2, future: 1 } });
    expect(parseProject(text)).toEqual({ ...DEFAULT_SETTINGS, kerf: 0.2 });
  });
  it("rejects foreign, corrupt and invalid files with one clear sentence", () => {
    expect(() => parseProject("not json")).toThrow(/not JSON/);
    expect(() => parseProject("{}")).toThrow(/not a Laser Slicer project/);
    expect(() => parseProject("null")).toThrow(/not a Laser Slicer project/);
    const bad = (patch: object) => JSON.stringify({ format: "laser-slicer-project", settings: patch });
    expect(() => parseProject(bad({ thickness: 0 }))).toThrow(/"thickness"/);
    expect(() => parseProject(bad({ kerf: "x" }))).toThrow(/"kerf"/);
    expect(() => parseProject(bad({ mode: "huge" }))).toThrow(/"mode"/);
    expect(() => parseProject(bad({ formats: ["gif"] }))).toThrow(/"formats"/);
    expect(() => parseProject(bad({ samplesPerLayer: 1.5 }))).toThrow(/"samplesPerLayer"/);
  });
});

describe("project file with a model (version 2)", () => {
  const model = { name: "part.stl", bytes: new Uint8Array([0, 1, 2, 250, 251, 252, 255]) }; // odd length
  const text = (patch: object) => JSON.stringify({ format: "laser-slicer-project", version: 2, settings: { kerf: 0.2 }, ...patch });

  it("round-trips settings and the model bytes, including odd lengths", () => {
    for (const n of [0, 1, 2, 3, 4, 5, 1000]) {
      if (n === 0) continue;
      const m = { name: "a.3mf", bytes: new Uint8Array(n).map((_, i) => (i * 7) & 255) };
      const out = parseProjectFile(serializeProject(settings({ kerf: 0.3 }), m));
      expect(out.settings.kerf).toBe(0.3);
      expect(out.model?.name).toBe("a.3mf");
      expect(Array.from(out.model!.bytes)).toEqual(Array.from(m.bytes));
    }
  });
  it("writes version 2, with a model key only when a model is given", () => {
    expect(JSON.parse(serializeProject(settings())).version).toBe(2);
    expect(JSON.parse(serializeProject(settings())).model).toBeUndefined();
    const o = JSON.parse(serializeProject(settings(), model));
    expect(o.model.name).toBe("part.stl");
    expect(typeof o.model.data).toBe("string");
  });
  it("loads version 1 files exactly as before and ignores a model key in them", () => {
    const v1 = JSON.stringify({ format: "laser-slicer-project", version: 1, settings: { kerf: 0.2 }, model: { name: "x.stl", data: "AAAA" } });
    expect(parseProjectFile(v1)).toEqual({ settings: { ...DEFAULT_SETTINGS, kerf: 0.2 }, model: null });
    expect(parseProject(v1)).toEqual({ ...DEFAULT_SETTINGS, kerf: 0.2 });
    expect(parseProjectFile(JSON.stringify({ format: "laser-slicer-project", settings: {} })).model).toBeNull(); // no version = 1
  });
  it("version 2 without a model is settings only; a later version is read like version 2", () => {
    expect(parseProjectFile(text({})).model).toBeNull();
    expect(parseProjectFile(text({ version: 3, model: { name: "x.obj", data: "AAAA" } })).model?.name).toBe("x.obj");
  });
  it("rejects a corrupt model with one clear sentence", () => {
    const damaged = /model stored in this project file is damaged/;
    expect(() => parseProjectFile(text({ model: { name: "x.stl", data: "AAA" } }))).toThrow(damaged); // length
    expect(() => parseProjectFile(text({ model: { name: "x.stl", data: "AA!A" } }))).toThrow(damaged); // character
    expect(() => parseProjectFile(text({ model: { name: "x.stl", data: "" } }))).toThrow(damaged); // empty
    expect(() => parseProjectFile(text({ model: { name: "x.stl", data: 5 } }))).toThrow(damaged);
    expect(() => parseProjectFile(text({ model: { data: "AAAA" } }))).toThrow(damaged);
    expect(() => parseProjectFile(text({ model: "x" }))).toThrow(damaged);
    expect(() => parseProjectFile(text({ model: { name: "x.png", data: "AAAA" } }))).toThrow(/unsupported type/);
  });
  it("a corrupt model does not matter to parseProject (settings only readers)", () => {
    expect(parseProject(text({ model: { name: "x.stl", data: "!!" } })).kerf).toBe(0.2);
  });
  it("still validates the settings of a version 2 file", () => {
    expect(() => parseProjectFile(text({ settings: { thickness: 0 }, model }))).toThrow(/"thickness"/);
  });
});
