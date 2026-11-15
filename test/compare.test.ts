import { describe, expect, it } from "vitest";
import { bestRows, comparisonSettings, compareRow, runComparison, type CompareRow } from "../src/core/compare";
import { Pipeline } from "../src/core/pipeline";
import { CURRENT_ROW_NAME, STARTER_PRESETS, compareEntries, type Preset } from "../src/presets";
import { box, uvSphere } from "./fixtures/meshes";
import { settings, weld } from "./helpers";

function make(raw = box(30, 30, 30)) {
  const { mesh, stats } = weld(raw);
  const p = new Pipeline();
  p.setMesh(mesh, stats);
  return p;
}
const mine: Preset = { name: "Birch 2.5", values: { thickness: 2.5, sheetW: 300, sheetH: 200, kerf: 0.1, pricePerSheet: 7 } };

describe("comparison entries (preset merging)", () => {
  it("current settings first, then every preset, each current settings plus the preset's values", () => {
    const cur = settings({ cutSpeed: 12, pricePerSheet: 4, mode: "undersize", kerf: 0.3 });
    const e = compareEntries(cur, [...STARTER_PRESETS, mine]);
    expect(e.map((x) => x.name)).toEqual([CURRENT_ROW_NAME, ...STARTER_PRESETS.map((p) => p.name), "Birch 2.5"]);
    expect(e[0].current).toBe(true);
    expect(e.slice(1).every((x) => !x.current)).toBe(true);
    expect(e[0].settings).toEqual(cur);
    const three = e[1].settings; // starter 3 mm: leaves speeds and price out, so the user's stay
    expect(three).toMatchObject({ thickness: 3, kerf: 0.15, cutSpeed: 12, pricePerSheet: 4, mode: "undersize" });
    expect(e[4].settings).toMatchObject({ thickness: 2.5, sheetW: 300, sheetH: 200, kerf: 0.1, pricePerSheet: 7, cutSpeed: 12, mode: "undersize" });
  });
  it("clears the layer range and leaves the input alone", () => {
    const cur = settings({ rangeFrom: 3, rangeTo: 5 });
    const e = compareEntries(cur, [mine]);
    expect(e.every((x) => x.settings.rangeFrom === null && x.settings.rangeTo === null)).toBe(true);
    expect(cur.rangeFrom).toBe(3);
    expect(comparisonSettings(cur, { thickness: 9 })).toMatchObject({ thickness: 9, rangeFrom: null });
  });
  it("only material values differ from the current settings", () => {
    const cur = settings();
    const keys = Object.keys(compareEntries(cur, [mine])[1].settings).filter((k) => JSON.stringify((compareEntries(cur, [mine])[1].settings as never)[k]) !== JSON.stringify((cur as never)[k]));
    expect(keys.sort()).toEqual(["kerf", "pricePerSheet", "sheetH", "sheetW", "thickness"]);
  });
});

describe("comparison runner", () => {
  it("gives one row per entry with plausible numbers", async () => {
    const p = make();
    const entries = compareEntries(settings({ cutSpeed: 10, pricePerSheet: 2 }), [...STARTER_PRESETS, mine]);
    const rows: CompareRow[] = [];
    const ok = await runComparison(p.fork(), entries, { onRow: (i, r) => (rows[i] = r) });
    expect(ok).toBe(true);
    expect(rows).toHaveLength(entries.length);
    for (const r of rows) {
      expect(r.layers).toBe(Math.ceil(30 / r.thickness - 1e-9));
      expect(r.parts).toBe(r.layers); // a box: one part per layer
      expect(r.sheets).toBeGreaterThan(0);
      expect(r.usePct).toBeGreaterThan(0);
      expect(r.cutLength).toBeGreaterThan(0);
      expect(r.time).not.toBeNull();
      expect(r.cost).toBeCloseTo(r.sheets * (r.name === "Birch 2.5" ? 7 : 2));
      expect(r.weight).not.toBeNull(); // default density 0.65
    }
    expect(rows[0].thickness).toBe(4);
    expect(rows[0].layers).toBe(8);
    // thicker material, fewer layers; shorter total cut length
    expect(rows[3].layers).toBeLessThan(rows[1].layers + 1);
    expect(rows[3].thickness).toBe(6);
    expect(rows[3].layers).toBe(5);
  });

  it("matches a plain run with the same settings", async () => {
    const p = make();
    const e = compareEntries(settings(), [mine]);
    const rows: CompareRow[] = [];
    await runComparison(p.fork(), e, { onRow: (i, r) => (rows[i] = r) });
    const plain = await make().run(e[1].settings);
    expect(rows[1]).toEqual(compareRow(e[1], plain!));
  });

  it("leaves the main pipeline's caches, counters and last result untouched", async () => {
    const p = make(uvSphere(15, 24, 36));
    const s = settings();
    const first = await p.run(s);
    const runs = { ...p.runs };
    const last = p.last;
    await runComparison(p.fork(), compareEntries(s, STARTER_PRESETS), { onRow: () => {} });
    expect(p.runs).toEqual(runs);
    expect(p.last).toBe(last);
    // and the next preview run is still a pure cache hit
    const again = await p.run(s);
    expect(p.runs).toEqual(runs);
    expect(again!.parts).toBe(first!.parts);
  });

  it("the comparison does not depend on the main pipeline's state", async () => {
    const p = make();
    await p.run(settings({ thickness: 5 })); // main caches hold another thickness
    const rows: CompareRow[] = [];
    await runComparison(p.fork(), compareEntries(settings(), []), { onRow: (i, r) => (rows[i] = r) });
    expect(rows[0].layers).toBe(8);
  });

  it("can be cancelled between rows and inside a run", async () => {
    const p = make();
    const entries = compareEntries(settings(), STARTER_PRESETS);
    // between rows: abort after the first row
    let seen = 0;
    const rows: CompareRow[] = [];
    let ok = await runComparison(p.fork(), entries, { onRow: (i, r) => ((rows[i] = r), seen++), shouldAbort: () => seen >= 1 });
    expect(ok).toBe(false);
    expect(rows.filter(Boolean)).toHaveLength(1);
    // inside a run: abort at the first checkpoint of the first entry
    let calls = 0;
    const got: CompareRow[] = [];
    ok = await runComparison(p.fork(), entries, { onRow: (_i, r) => got.push(r), shouldAbort: () => ++calls > 2 });
    expect(ok).toBe(false);
    expect(got.length).toBe(0);
  });

  it("every entry gets a row even for a degenerate setting", async () => {
    const p = make();
    const entries = compareEntries(settings(), [mine]);
    entries[0].settings = { ...entries[0].settings, thickness: NaN }; // planLayers cannot handle it
    const rows: CompareRow[] = [];
    let ok = await runComparison(p.fork(), entries, { onRow: (i, r) => (rows[i] = r) });
    // a NaN thickness may also just produce an empty result; either way every entry gets a row
    expect(ok).toBe(true);
    expect(rows).toHaveLength(2);
    expect(rows[1].layers).toBe(12);
  });

  it("reports progress from 0 to 1 and counts warnings (info notes excluded)", async () => {
    const p = make();
    const fr: number[] = [];
    const rows: CompareRow[] = [];
    // sheet smaller than the model: the parts do not fit, which is a warning
    const entries = compareEntries(settings({ sheetW: 20, sheetH: 20 }), []);
    await runComparison(p.fork(), entries, { onRow: (i, r) => (rows[i] = r), progress: (f) => fr.push(f) });
    expect(fr[fr.length - 1]).toBe(1);
    expect(fr.every((v, i) => i === 0 || v >= fr[i - 1] - 1e-9)).toBe(true);
    expect(rows[0].warnings).toBeGreaterThan(0);
  });

  it("estimates are null when the settings are not set", async () => {
    const rows: CompareRow[] = [];
    await runComparison(make().fork(), compareEntries(settings({ density: 0 }), []), { onRow: (i, r) => (rows[i] = r) });
    expect(rows[0]).toMatchObject({ time: null, cost: null, weight: null });
  });

  it("fork needs a model", () => {
    expect(() => new Pipeline().fork()).toThrow();
  });
});

describe("best rows", () => {
  const row = (o: Partial<CompareRow>): CompareRow => ({ name: "x", current: false, thickness: 3, sheetW: 1, sheetH: 1, layers: 1, parts: 1, sheets: 2, usePct: 50, cutLength: 1, time: null, weight: null, cost: null, warnings: 0, errors: 0, ...o });
  it("marks the lowest, ignores errors, nulls and ties", () => {
    const b = bestRows([row({ sheets: 3, cost: 9, time: 100 }), row({ sheets: 2, cost: 8, time: 100 }), row({ sheets: 1, error: "x" }), undefined, row({ sheets: 2, cost: null })]);
    expect([...b.sheets]).toEqual([1, 4]);
    expect([...b.cost]).toEqual([1]);
    expect([...b.time]).toEqual([]); // all equal
    expect([...bestRows([row({ sheets: 4 })]).sheets]).toEqual([]); // one row only
  });
});
