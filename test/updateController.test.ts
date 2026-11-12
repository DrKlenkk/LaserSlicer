import { describe, expect, it } from "vitest";
import { UpdateController, slicingKey } from "../src/updateController";
import { parseUiPrefs } from "../src/uiPrefs";
import { TraceVisibility } from "../src/traceVisibility";
import { settings } from "./helpers";

describe("UpdateController, auto on", () => {
  it("debounces settings changes and starts a model load at once", () => {
    const c = new UpdateController(true);
    expect(c.settingsChanged()).toBe("debounced");
    expect(c.modelLoaded()).toBe("immediate");
    expect(c.showButton).toBe(false);
    const id = c.runStarted();
    expect(c.showButton).toBe(false);
    expect(c.runFinished(id)).toBe(true);
    expect(c.stale).toBe(false);
  });
});

describe("UpdateController, auto off", () => {
  it("starts stale and button-less, then marks stale on change without a run", () => {
    const c = new UpdateController(false);
    expect(c.showButton).toBe(false);
    expect(c.settingsChanged()).toBe("none");
    expect(c.stale).toBe(true);
    expect(c.showButton).toBe(true);
    expect(c.needsRun).toBe(true);
  });
  it("a loaded model is stale until the first run", () => {
    const c = new UpdateController(false);
    expect(c.modelLoaded()).toBe("none");
    expect(c.showButton).toBe(true);
    const id = c.runStarted();
    expect(c.running).toBe(true);
    expect(c.showButton).toBe(true); // busy
    c.runFinished(id);
    expect(c.showButton).toBe(false);
    expect(c.needsRun).toBe(false);
  });
  it("a change during a run makes the preview stale again afterwards", () => {
    const c = new UpdateController(false);
    c.modelLoaded();
    const id = c.runStarted();
    c.settingsChanged();
    expect(c.running).toBe(true);
    c.runFinished(id);
    expect(c.running).toBe(false);
    expect(c.stale).toBe(true);
    expect(c.showButton).toBe(true);
  });
  it("ignores results of superseded runs and of runs of an old model", () => {
    const c = new UpdateController(false);
    const a = c.runStarted();
    const b = c.runStarted();
    expect(c.isCurrent(a)).toBe(false);
    expect(c.runFinished(a)).toBe(false);
    expect(c.running).toBe(true);
    c.modelLoaded();
    expect(c.isCurrent(b)).toBe(false);
    expect(c.running).toBe(false);
    expect(c.runFinished(b)).toBe(false);
    expect(c.stale).toBe(true);
  });
  it("a failed run stays stale so it can be retried", () => {
    const c = new UpdateController(false);
    const id = c.runStarted();
    expect(c.runFailed(id)).toBe(true);
    expect(c.stale).toBe(true);
    expect(c.running).toBe(false);
    expect(c.showButton).toBe(true);
  });
  it("turning auto on while stale runs now, while current does nothing", () => {
    const c = new UpdateController(false);
    c.settingsChanged();
    expect(c.setAuto(true)).toBe("immediate");
    expect(c.showButton).toBe(false);
    const id = c.runStarted();
    c.runFinished(id);
    expect(c.setAuto(false)).toBe("none");
    expect(c.setAuto(true)).toBe("none");
  });
  it("notifies subscribers on every change", () => {
    const c = new UpdateController(false);
    let n = 0;
    c.subscribe(() => n++);
    c.settingsChanged();
    const id = c.runStarted();
    c.runFinished(id);
    c.setAuto(true);
    expect(n).toBe(4);
  });
});

describe("slicingKey", () => {
  it("ignores export-only settings and notices slicing ones", () => {
    const base = slicingKey(settings());
    expect(slicingKey(settings({ formats: ["dxf", "svg"], dpi: 600, perLayerFiles: true, rasterStyle: "outline", rasterEngrave: false, exportCut: false, exportEngrave: false, exportLabel: false, exportSheet: true }))).toBe(base);
    expect(slicingKey(settings({ thickness: 3.5 }))).not.toBe(base);
    expect(slicingKey(settings({ labels: false }))).not.toBe(base);
  });
});

describe("parseUiPrefs", () => {
  it("defaults to auto update on and tolerates garbage", () => {
    expect(parseUiPrefs(null).autoUpdate).toBe(true);
    expect(parseUiPrefs("{nope").autoUpdate).toBe(true);
    expect(parseUiPrefs('{"autoUpdate":"yes"}').autoUpdate).toBe(true);
    expect(parseUiPrefs('{"autoUpdate":false}').autoUpdate).toBe(false);
  });
});

describe("trace visibility prefs", () => {
  it("parses hidden traces, ignoring unknown or malformed entries", () => {
    expect(parseUiPrefs(null).hiddenTraces).toEqual([]);
    expect(parseUiPrefs('{"hiddenTraces":["engrave","bogus","ghost",5]}').hiddenTraces).toEqual(["engrave", "ghost"]);
    expect(parseUiPrefs('{"hiddenTraces":"engrave"}').hiddenTraces).toEqual([]);
    expect(parseUiPrefs('{"autoUpdate":false}').hiddenTraces).toEqual([]); // prefs saved by an older version
  });
  it("TraceVisibility notifies on change only and keeps the hidden set", () => {
    const v = new TraceVisibility(["label"]);
    let n = 0;
    v.subscribe(() => n++);
    expect(v.visible("label")).toBe(false);
    v.set("label", false); // no change
    v.set("engrave", false);
    v.set("label", true);
    expect(n).toBe(2);
    expect(v.hiddenList()).toEqual(["engrave"]);
  });
});
