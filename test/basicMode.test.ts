import { describe, expect, it } from "vitest";
import DxfParser from "dxf-parser";
import { BASIC_OVERRIDES, BASIC_STORED_KEYS, basicSettings, effectiveSettings } from "../src/basicMode";
import { DEFAULT_SETTINGS, Store, serializeProject, parseProject } from "../src/state";
import { slicingKey } from "../src/updateController";
import { parseUiPrefs } from "../src/uiPrefs";
import { buildExportFiles } from "../src/core/export/files";
import { Pipeline } from "../src/core/pipeline";
import { buildDemoStl } from "../src/core/demo";
import { parseToSoup } from "../src/core/loaders";
import { buildMesh } from "../src/core/mesh";
import type { Settings } from "../src/core/types";
import { settings } from "./helpers";

const expertValues = () =>
  settings({
    thickness: 3, sheetW: 500, kerf: 0.2, formats: ["svg", "guide"], dowels: true, dowelDiameter: 4, bridgesEnabled: true, hollowEnabled: true,
    labels: false, engraveNextOutline: true, exportBridge: true, exportEngrave: true, perLayerFiles: true, rangeFrom: 2, rangeTo: 4,
    smoothRadius: 1, simplifyTol: 0.5, minPartArea: 20, minFeature: 2, mode: "undersize", partSpacing: 9, sheetMargin: 11, density: 0.9, cutSpeed: 7, pricePerSheet: 12,
    dpi: 600, rasterStyle: "outline", exportInnerLayer: true, exportSheet: true,
  });

describe("Basic mode settings", () => {
  it("keeps the Basic keys and replaces every other key by its default or its stated Basic value", () => {
    const s = expertValues();
    const src: Settings = { ...s, axis: "-X", rotationSteps: [1, 0, 2], importUnit: "cm", scale: 1.5, targetSize: { dim: "y", mm: 80 } };
    const b = basicSettings(src);
    const keep = new Set<string>(BASIC_STORED_KEYS);
    for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof typeof DEFAULT_SETTINGS)[]) {
      if (k === "formats") continue;
      if (keep.has(k)) expect(b[k], k).toEqual(src[k]);
      else expect(b[k], k).toEqual(k in BASIC_OVERRIDES ? BASIC_OVERRIDES[k] : DEFAULT_SETTINGS[k]);
    }
    expect(b.formats).toEqual(["svg"]); // no assembly guide in Basic
    expect(b.thickness).toBe(3);
    expect(b.kerf).toBe(0.2);
  });

  it("states a Basic value only for keys that are not Basic keys, and exports the cut outlines only", () => {
    for (const k of Object.keys(BASIC_OVERRIDES)) expect((BASIC_STORED_KEYS as readonly string[]).includes(k), k).toBe(false);
    const b = basicSettings(expertValues());
    expect([b.exportCut, b.exportEngrave, b.exportLabel, b.exportBridge, b.exportSheet, b.exportInnerLayer]).toEqual([true, false, false, false, false, false]);
    expect([b.engraveNextOutline, b.labels, b.dowels, b.bridgesEnabled, b.hollowEnabled, b.perLayerFiles, b.rangeFrom, b.rangeTo]).toEqual([false, false, false, false, false, false, null, null]);
  });

  it("does not change the stored settings (Expert values come back)", () => {
    const s = expertValues();
    const copy = structuredClone(s);
    basicSettings(s);
    expect(s).toEqual(copy);
    const st = { settings: s, uiMode: "basic" as const };
    expect(effectiveSettings(st)).not.toBe(s);
    expect(effectiveSettings({ settings: s, uiMode: "expert" })).toBe(s);
  });

  it("changes the slicing key only through settings that affect slicing", () => {
    const d = structuredClone(DEFAULT_SETTINGS);
    expect(slicingKey(basicSettings(d))).not.toBe(slicingKey(d)); // default has engraving and labels on
    expect(slicingKey(basicSettings({ ...d, dowels: true }))).toBe(slicingKey(basicSettings(d)));
    expect(slicingKey(basicSettings({ ...d, thickness: 3 }))).not.toBe(slicingKey(basicSettings(d)));
    // an Expert-only change on a Basic-equal setup does not start a run in Basic
    expect(slicingKey(basicSettings({ ...d, minPartArea: 50, mode: "undersize", partSpacing: 20 }))).toBe(slicingKey(basicSettings(d)));
  });

  it("slices and exports with cut outlines only", async () => {
    const bytes = buildDemoStl();
    const { mesh, stats } = buildMesh(parseToSoup(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, "stl"));
    const p = new Pipeline();
    p.setMesh(mesh, stats);
    const eff = basicSettings({ ...expertValues(), thickness: 4, sheetW: 600, sheetH: 400 });
    const r = (await p.run(eff))!;
    expect(r.parts.every((q) => q.engrave.length === 0 && q.label.length === 0 && q.holes.length === 0)).toBe(true);
    const files = buildExportFiles(r, { ...eff, formats: ["dxf"] }, "demo");
    expect(files.length).toBe(1);
    const dxf = new DxfParser().parseSync(new TextDecoder().decode(files[0].bytes))!;
    const layers = new Set(dxf.entities.map((e) => e.layer));
    expect([...layers]).toEqual(["CUT"]);
    expect(dxf.entities.length).toBeGreaterThan(0);
  });
});

describe("Basic mode as a UI preference", () => {
  it("defaults to Expert and reads the stored choice", () => {
    expect(parseUiPrefs(null).uiMode).toBe("expert");
    expect(parseUiPrefs('{"uiMode":"basic"}').uiMode).toBe("basic");
    expect(parseUiPrefs('{"uiMode":"nonsense"}').uiMode).toBe("expert");
    expect(parseUiPrefs('{"autoUpdate":false}').uiMode).toBe("expert");
  });

  it("is not a setting: switching it adds no undo step and leaves the settings alone", () => {
    const st = new Store();
    st.updateSettings({ kerf: 0.3 });
    const before = st.get().settings;
    st.set({ uiMode: "basic" });
    expect(st.get().settings).toBe(before);
    expect(st.canUndo).toBe(true);
    st.undo();
    expect(st.get().settings.kerf).toBe(DEFAULT_SETTINGS.kerf);
    expect(st.get().uiMode).toBe("basic");
  });

  it("project files hold what Basic runs with (the panel passes the effective settings)", () => {
    const s = expertValues();
    const saved = parseProject(serializeProject(effectiveSettings({ settings: s, uiMode: "basic" })));
    expect(saved).toEqual(basicSettings(s));
    expect(saved.dowels).toBe(false);
    expect(saved.thickness).toBe(3);
  });
});
