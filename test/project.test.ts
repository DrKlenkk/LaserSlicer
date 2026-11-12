import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, parseProject, serializeProject } from "../src/state";
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
