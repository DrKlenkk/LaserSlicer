import { describe, expect, it } from "vitest";
import { History, changedKeys, HISTORY_CAP } from "../src/history";
import { DEFAULT_SETTINGS, Store } from "../src/state";
import type { Settings } from "../src/core/types";

type S = { a: number; b: number; arr: number[] };
const s0: S = { a: 0, b: 0, arr: [0, 0, 0] };

describe("changedKeys", () => {
  it("compares by value", () => {
    expect(changedKeys(s0, { ...s0, arr: [0, 0, 0] })).toEqual([]);
    expect(changedKeys(s0, { ...s0, a: 1, arr: [0, 1, 0] }).sort()).toEqual(["a", "arr"]);
  });
});

describe("History", () => {
  it("records, undoes and redoes", () => {
    const h = new History<S>();
    h.record(s0, { ...s0, a: 1 }, "edit", 0);
    h.record({ ...s0, a: 1 }, { ...s0, a: 1, b: 2 }, "edit", 5000);
    expect(h.undoDepth).toBe(2);
    const u1 = h.undo({ ...s0, a: 1, b: 2 })!;
    expect(u1).toEqual({ ...s0, a: 1 });
    const u2 = h.undo(u1)!;
    expect(u2).toEqual(s0);
    expect(h.undo(u2)).toBeNull();
    expect(h.redo(u2)).toEqual({ ...s0, a: 1 });
    expect(h.redo({ ...s0, a: 1 })).toEqual({ ...s0, a: 1, b: 2 });
    expect(h.redo({ ...s0, a: 1, b: 2 })).toBeNull();
  });
  it("does not record a no-op", () => {
    const h = new History<S>();
    expect(h.record(s0, { ...s0, arr: [0, 0, 0] }, "edit", 0)).toBe(false);
    expect(h.canUndo).toBe(false);
  });
  it("a new change clears redo", () => {
    const h = new History<S>();
    h.record(s0, { ...s0, a: 1 }, "edit", 0);
    const u = h.undo({ ...s0, a: 1 })!;
    expect(h.canRedo).toBe(true);
    h.record(u, { ...u, b: 3 }, "edit", 10);
    expect(h.canRedo).toBe(false);
  });
  it("merges rapid edits of the same setting into one step", () => {
    const h = new History<S>();
    h.record(s0, { ...s0, a: 1 }, "edit", 0);
    h.record({ ...s0, a: 1 }, { ...s0, a: 2 }, "edit", 400);
    h.record({ ...s0, a: 2 }, { ...s0, a: 3 }, "edit", 1300); // window slides from the last change
    expect(h.undoDepth).toBe(1);
    expect(h.undo({ ...s0, a: 3 })).toEqual(s0);
  });
  it("does not merge after the window, for another key, for a bulk step or after an undo", () => {
    const h = new History<S>();
    h.record(s0, { ...s0, a: 1 }, "edit", 0);
    h.record({ ...s0, a: 1 }, { ...s0, a: 2 }, "edit", 1500);
    expect(h.undoDepth).toBe(2);
    h.record({ ...s0, a: 2 }, { ...s0, a: 2, b: 1 }, "edit", 1600);
    expect(h.undoDepth).toBe(3);
    h.record({ ...s0, a: 2, b: 1 }, { ...s0, a: 5, b: 1 }, "step", 1700);
    h.record({ ...s0, a: 5, b: 1 }, { ...s0, a: 6, b: 1 }, "edit", 1800);
    expect(h.undoDepth).toBe(5); // step is not mergeable, nor is an edit after it with a different "single key" history
    const cur = { ...s0, a: 6, b: 1 };
    const u = h.undo(cur)!;
    h.record(u, { ...u, a: 7 }, "edit", 1850);
    expect(h.undoDepth).toBe(5); // after the undo the edit is a new step, not merged into an older one
  });
  it("two keys at once are never merged", () => {
    const h = new History<S>();
    h.record(s0, { ...s0, a: 1, b: 1 }, "edit", 0);
    h.record({ ...s0, a: 1, b: 1 }, { ...s0, a: 2, b: 2 }, "edit", 10);
    expect(h.undoDepth).toBe(2);
  });
  it("drops a merged step that ends where it started", () => {
    const h = new History<S>();
    h.record(s0, { ...s0, a: 1 }, "edit", 0);
    h.record({ ...s0, a: 1 }, s0, "edit", 100);
    expect(h.canUndo).toBe(false);
  });
  it("caps the past", () => {
    const h = new History<S>();
    for (let i = 0; i < HISTORY_CAP + 20; i++) h.record({ ...s0, a: i }, { ...s0, a: i + 1 }, "step", i);
    expect(h.undoDepth).toBe(HISTORY_CAP);
    let cur: S = { ...s0, a: HISTORY_CAP + 20 };
    let n = 0;
    for (let u = h.undo(cur); u; u = h.undo(u)) { cur = u; n++; }
    expect(n).toBe(HISTORY_CAP);
    expect(cur.a).toBe(20);
  });
  it("snapshots are copies", () => {
    const h = new History<S>();
    const before: S = { a: 0, b: 0, arr: [1] };
    h.record(before, { ...before, a: 1 }, "step", 0);
    before.arr.push(9);
    expect(h.undo({ ...before, a: 1 })!.arr).toEqual([1]);
  });
  it("rebase writes an unrecorded change into all snapshots", () => {
    const h = new History<S>();
    h.record(s0, { ...s0, a: 1 }, "step", 0);
    h.record({ ...s0, a: 1 }, { ...s0, a: 2 }, "step", 5000);
    const u = h.undo({ ...s0, a: 2, b: 7 })!;
    h.rebase({ b: 7 });
    expect(u.a).toBe(1);
    const u2 = h.undo({ ...u, b: 7 })!; // the caller's current state already has the unrecorded change
    expect(u2).toEqual({ ...s0, b: 7 });
    expect(h.redo(u2)).toEqual({ ...s0, a: 1, b: 7 });
  });
});

describe("Store undo / redo", () => {
  const st = () => new Store();
  it("undo restores a settings edit in one update and redo reapplies it", () => {
    const store = st();
    const k0 = store.get().settings.kerf;
    let events = 0;
    store.subscribe(() => events++);
    store.updateSettings({ kerf: 0.3 });
    events = 0;
    expect(store.undo()).toBe(true);
    expect(events).toBe(1);
    expect(store.get().settings.kerf).toBe(k0);
    expect(store.canRedo).toBe(true);
    expect(store.redo()).toBe(true);
    expect(store.get().settings.kerf).toBe(0.3);
  });
  it("typing the same setting repeatedly is one step", () => {
    const store = st();
    const k0 = store.get().settings.kerf;
    for (const v of [0.2, 0.21, 0.22]) store.updateSettings({ kerf: v });
    store.undo();
    expect(store.get().settings.kerf).toBe(k0);
    expect(store.canUndo).toBe(false);
  });
  it("a bulk replace (project load) is one step even though many settings change", () => {
    const store = st();
    store.replaceSettings({ ...DEFAULT_SETTINGS, thickness: 9, kerf: 0.4, sheetW: 123 });
    store.undo();
    expect(store.get().settings.thickness).toBe(DEFAULT_SETTINGS.thickness);
    expect(store.canUndo).toBe(false);
  });
  it("silent changes (model load) are not a step and ride along in the snapshots", () => {
    const store = st();
    store.updateSettings({ kerf: 0.5 }, "step");
    store.set({ settings: { ...store.get().settings, importUnit: "in" } }, "silent");
    expect(store.canUndo).toBe(true);
    store.undo();
    expect(store.get().settings.kerf).toBe(DEFAULT_SETTINGS.kerf);
    expect(store.get().settings.importUnit).toBe("in");
    expect(store.canUndo).toBe(false);
    store.redo();
    expect(store.get().settings.importUnit).toBe("in");
    expect(store.get().settings.kerf).toBe(0.5);
  });
  it("changing other state (model, layer) is not recorded", () => {
    const store = st();
    store.set({ layer: 3 });
    store.updateSettings({ kerf: 0.2 });
    store.set({ layer: 4 });
    expect(store.undo()).toBe(true);
    expect(store.get().layer).toBe(4);
    expect(store.undo()).toBe(false);
  });
  it("a change after undo clears redo", () => {
    const store = st();
    store.updateSettings({ kerf: 0.2 }, "step");
    store.undo();
    store.updateSettings({ thickness: 5 });
    expect(store.canRedo).toBe(false);
  });
  it("round trip equals the original settings object by value", () => {
    const store = st();
    const before: Settings = structuredClone(store.get().settings);
    store.updateSettings({ axis: "-X", rotationSteps: [1, 0, 0], targetSize: { dim: "x", mm: 50 } }, "step");
    store.undo();
    expect(store.get().settings).toEqual(before);
  });
});
