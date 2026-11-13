import { describe, expect, it } from "vitest";
import { PRESETS_KEY, PresetStore, STARTER_PRESETS, applyPreset, cleanValues, matchesPreset, parsePresets, presetValuesOf } from "../src/presets";
import { DEFAULT_SETTINGS } from "../src/state";

const mem = () => {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};
const vals = { thickness: 3.2, sheetW: 500, sheetH: 300, kerf: 0.12, partSpacing: 2, sheetMargin: 4, density: 0.7, cutSpeed: 10, engraveSpeed: 80, pricePerSheet: 5 };

describe("preset validation", () => {
  it("keeps valid fields, drops invalid ones", () => {
    expect(cleanValues({ thickness: 3, kerf: -1, sheetW: 0, density: "x", bogus: 1, cutSpeed: Infinity })).toEqual({ thickness: 3 });
    expect(cleanValues({ kerf: -1 })).toBeNull();
    expect(cleanValues(null)).toBeNull();
    expect(cleanValues([1])).toBeNull();
  });
  it("parsePresets drops invalid entries, duplicates and starter names", () => {
    const raw = JSON.stringify([
      { name: "A", values: { kerf: 0.1 } },
      { name: "a", values: { kerf: 0.2 } },
      { name: "", values: { kerf: 0.1 } },
      { name: 5, values: { kerf: 0.1 } },
      { name: "B", values: { kerf: -1 } },
      { name: STARTER_PRESETS[0].name, values: { kerf: 0.1 } },
      null,
      { name: "  C   d ", values: vals },
    ]);
    expect(parsePresets(raw).map((p) => p.name)).toEqual(["A", "C d"]);
  });
  it("tolerates garbage", () => {
    expect(parsePresets(null)).toEqual([]);
    expect(parsePresets("{")).toEqual([]);
    expect(parsePresets('{"a":1}')).toEqual([]);
  });
  it("starters are valid and named as starting points", () => {
    for (const p of STARTER_PRESETS) {
      expect(cleanValues(p.values)).toEqual(p.values);
      expect(p.name).toMatch(/starting point/);
    }
  });
});

describe("apply and match", () => {
  it("applies only the fields the preset has", () => {
    const s = { ...DEFAULT_SETTINGS, cutSpeed: 20, pricePerSheet: 9 };
    const r = applyPreset(s, STARTER_PRESETS[0]);
    expect(r.thickness).toBe(3);
    expect(r.cutSpeed).toBe(20);
    expect(r.pricePerSheet).toBe(9);
    expect(matchesPreset(r, STARTER_PRESETS[0])).toBe(true);
    expect(matchesPreset({ ...r, kerf: 0.3 }, STARTER_PRESETS[0])).toBe(false);
  });
  it("presetValuesOf takes all fields", () => {
    expect(Object.keys(presetValuesOf(DEFAULT_SETTINGS)).length).toBe(10);
  });
});

describe("PresetStore", () => {
  it("saves, persists, overwrites and deletes", () => {
    const st = mem();
    const p = new PresetStore(st);
    expect(p.save("My ply", vals)).toBeNull();
    expect(p.exists(" my  PLY ")).toBe(true);
    expect(p.save("my ply", { ...vals, kerf: 0.2 })).toBeNull();
    expect(p.list()).toHaveLength(1);
    expect(p.find("My ply")!.values.kerf).toBe(0.2);
    expect(JSON.parse(st.m.get(PRESETS_KEY)!)).toHaveLength(1);
    expect(new PresetStore(st).list()[0].values.kerf).toBe(0.2); // survives a reload
    expect(p.delete("MY PLY")).toBe(true);
    expect(p.delete("My ply")).toBe(false);
    expect(new PresetStore(st).list()).toEqual([]);
  });
  it("refuses empty names, starter names, bad values and too many", () => {
    const p = new PresetStore(mem());
    expect(p.save("  ", vals)).toMatch(/name/);
    expect(p.save(STARTER_PRESETS[1].name.toUpperCase(), vals)).toMatch(/built-in/);
    expect(p.save("x", { kerf: -2 })).toMatch(/valid/);
    for (let i = 0; i < 50; i++) expect(p.save(`n${i}`, vals)).toBeNull();
    expect(p.save("one more", vals)).toMatch(/At most/);
    expect(p.save("n3", vals)).toBeNull(); // replacing still works
  });
  it("lists starters first and cannot delete them", () => {
    const p = new PresetStore(mem());
    p.save("Zed", vals);
    expect(p.all().map((x) => x.name).slice(0, 3)).toEqual(STARTER_PRESETS.map((x) => x.name));
    expect(p.delete(STARTER_PRESETS[0].name)).toBe(false);
    expect(p.isUser(STARTER_PRESETS[0].name)).toBe(false);
  });
  it("works when storage throws or is missing", () => {
    const bad = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); } };
    const p = new PresetStore(bad);
    expect(p.persisted).toBe(false);
    expect(p.save("A", vals)).toBeNull();
    expect(p.list()).toHaveLength(1);
    expect(p.persisted).toBe(false);
    const q = new PresetStore(null);
    expect(q.save("A", vals)).toBeNull();
    expect(q.persisted).toBe(false);
    expect(q.list()).toHaveLength(1);
  });
});
