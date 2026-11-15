import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/state";
import { EXTRA_HELP_KEYS, HELP, HELP_DOC, docUrl } from "../src/ui/helpText";
import { placeTooltip } from "../src/ui/tooltip";

const uiSource = readdirSync("src/ui").filter((f) => f.endsWith(".ts") && f !== "helpText.ts").map((f) => readFileSync(`src/ui/${f}`, "utf8")).join("\n") + readFileSync("src/main.ts", "utf8");
const used = new Set([...uiSource.matchAll(/(?:infoIcon\(|help: )"(\w+)"/g)].map((m) => m[1]));
// boolField(label, key, "helpKey") passes the key as a plain third argument
for (const m of uiSource.matchAll(/boolField\("[^"]*", "\w+", "(\w+)"/g)) used.add(m[1]);
for (const m of uiSource.matchAll(/\], "(\w+)"\)/g)) used.add(m[1]);

// Settings whose tooltip lives under a different key (one control covers several settings).
const COVERED_BY: Record<string, string> = { sheetW: "sheetSize", sheetH: "sheetSize", rotationSteps: "rotate", exportCut: "exportLayers", exportEngrave: "exportLayers", exportLabel: "exportLayers", exportBridge: "exportLayers", exportSheet: "exportLayers", rangeFrom: "layerRange", rangeTo: "layerRange" };

describe("help texts", () => {
  it("has a real text for every key", () => {
    for (const [k, v] of Object.entries(HELP)) {
      expect(v.trim().length, k).toBeGreaterThan(80);
      expect(v.length, k).toBeLessThan(900);
    }
  });
  it("every key is a Settings key or a declared extra", () => {
    for (const k of Object.keys(HELP)) expect(k in DEFAULT_SETTINGS || (EXTRA_HELP_KEYS as readonly string[]).includes(k), k).toBe(true);
  });
  it("every key is used by the UI", () => {
    for (const k of Object.keys(HELP)) expect(used.has(k), `${k} is not shown anywhere`).toBe(true);
  });
  it("every UI help reference exists", () => {
    for (const k of used) expect(k in HELP, k).toBe(true);
  });
  it("every Settings key has a tooltip (directly or via another key)", () => {
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
      const key = COVERED_BY[k] ?? k;
      expect(key in HELP, `Settings.${k} has no help text`).toBe(true);
    }
  });
});

describe("tooltip placement", () => {
  const vw = 800, vh = 600;
  it("goes below an icon near the top and above one near the bottom", () => {
    expect(placeTooltip({ left: 100, right: 115, top: 20, bottom: 35 }, 300, 150, vw, vh).below).toBe(true);
    expect(placeTooltip({ left: 100, right: 115, top: 560, bottom: 575 }, 300, 150, vw, vh).below).toBe(false);
  });
  it("stays inside the viewport at every edge", () => {
    for (const x of [0, 5, 400, 785, 800]) for (const y of [0, 300, 585, 600]) {
      const p = placeTooltip({ left: x, right: x + 15, top: y, bottom: y + 15 }, 320, 200, vw, vh);
      expect(p.left).toBeGreaterThanOrEqual(8);
      expect(p.left + 320).toBeLessThanOrEqual(vw - 8);
      expect(p.top).toBeGreaterThanOrEqual(8);
      expect(p.top + 200).toBeLessThanOrEqual(vh - 8);
    }
  });
});

// Every section id of public/docs.html that the documentation promises (the anchors the tooltips may link to are a subset).
const DOC_SECTIONS = ["getting-started", "interface", "basic-expert", "tabs", "view-toggle", "legend", "auto-update", "warnings", "undo-redo", "model", "import-unit", "scale", "orientation", "material", "thickness", "sheet-size", "copies", "kerf", "calibration", "presets", "compare", "estimates", "slicing", "outline-modes", "layer-height", "smoothing", "simplify", "small-parts", "hollowing", "gluing-aids", "engrave-lines", "labels", "dowels", "bridges", "nesting", "export", "formats", "layers-in-files", "inner-cuts", "cut-order", "layer-range", "per-layer-files", "raster", "assembly-guide", "project", "laser-workflow", "mobile", "troubleshooting", "privacy", "glossary"];

describe("documentation links", () => {
  it("maps every help key to an anchor (and nothing else)", () => {
    expect(Object.keys(HELP_DOC).sort()).toEqual(Object.keys(HELP).sort());
    for (const [k, a] of Object.entries(HELP_DOC)) expect(a, k).toMatch(/^[a-z][a-z0-9-]*$/);
  });
  it("builds relative links to docs.html", () => {
    expect(docUrl("kerf")).toBe("docs.html#kerf");
    expect(docUrl("dowelCount")).toBe("docs.html#dowels");
  });
  it("only maps to documented sections", () => {
    for (const [k, a] of Object.entries(HELP_DOC)) expect(DOC_SECTIONS, `${k} -> ${a}`).toContain(a);
  });
  it("public/docs.html exists and has every anchor", () => {
    let html = "";
    try {
      html = readFileSync("public/docs.html", "utf8");
    } catch {
      throw new Error("public/docs.html is missing: the documentation page has not been added yet");
    }
    const ids = new Set([...html.matchAll(/\sid\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]));
    const missing = DOC_SECTIONS.filter((a) => !ids.has(a));
    expect(missing, `docs.html lacks the section ids: ${missing.join(", ")}`).toEqual([]);
    const used = [...new Set(Object.values(HELP_DOC))].filter((a) => !ids.has(a));
    expect(used, `tooltip anchors missing in docs.html: ${used.join(", ")}`).toEqual([]);
  });
});
