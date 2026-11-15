import { describe, expect, it } from "vitest";
import { buildAssemblyGuide, escapeHtml, guideView, THUMB_MAX_H, THUMB_MAX_W } from "../src/core/export/guide";
import { buildReadme } from "../src/core/export/zip";
import { buildExportFiles } from "../src/core/export/files";
import { parseProject, serializeProject } from "../src/state";
import { HELP } from "../src/ui/helpText";
import { box, uvSphere } from "./fixtures/meshes";
import { settings, slice } from "./helpers";

const DATE = new Date("2026-03-04T10:00:00Z");
const svgs = (html: string) => [...html.matchAll(/<svg viewBox="0 0 ([\d.]+) ([\d.]+)" width="([\d.]+)mm" height="([\d.]+)mm"/g)].map((m) => m.slice(1).map(Number));
const blocks = (html: string) => html.split('<section class="layer">').length - 1;

describe("assembly guide", () => {
  it("has one block per layer, in order, with parts, sheets and a thumbnail", async () => {
    const r = await slice(box(30, 20, 40), { dowels: true, dowelDiameter: 3 });
    const html = buildAssemblyGuide(r, settings({ dowels: true, dowelDiameter: 3 }), "tower", DATE);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(blocks(html)).toBe(10);
    expect(svgs(html)).toHaveLength(10); // thumbnails only (legend swatches have no mm size)
    const pos = Array.from({ length: 10 }, (_, i) => html.indexOf(`<b>L${String(i).padStart(3, "0")}</b>`));
    expect(pos.every((p) => p > 0)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
    expect(html).toContain("<b>L003</b>: sheet 1");
    expect(html).toContain("2026-03-04");
    expect(html).toContain("tower");
    expect(html).toContain("dowel");
    expect(html).toContain("<circle");
    expect(html).toContain("layer 9 of 9, top");
  });

  it("uses one scale and one viewBox for every layer (sizes compare)", async () => {
    const r = await slice(uvSphere(40, 40, 60), { thickness: 8 });
    const html = buildAssemblyGuide(r, settings({ thickness: 8 }), "ball", DATE);
    const thumbs = svgs(html);
    expect(thumbs.length).toBe(r.info.layerCount);
    expect(new Set(thumbs.map((t) => t.join(","))).size).toBe(1);
    const [w, h, wmm, hmm] = thumbs[0];
    expect(wmm / w).toBeCloseTo(hmm / h, 1);
    expect(wmm).toBeLessThanOrEqual(THUMB_MAX_W + 0.1);
    expect(hmm).toBeLessThanOrEqual(THUMB_MAX_H + 0.1);
    expect(html).toContain("1 : ");
  });

  it("a small model is shown at 1:1, a large one is reduced", () => {
    expect(guideView([[0, 0], [20, 10]]).scale).toBe(1);
    const big = guideView([[0, 0], [400, 100]]);
    expect(big.scale).toBeLessThan(0.35);
    expect(big.w * big.scale).toBeLessThanOrEqual(THUMB_MAX_W + 1e-9);
  });

  it("is self-contained: no script, no URL, no external resource, no event handlers", async () => {
    const r = await slice(box(30, 20, 40), { dowels: true });
    const html = buildAssemblyGuide(r, settings({ dowels: true }), "m", DATE);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/https?:|\/\/|url\(|@import|<link|<img|<iframe|<object|<embed|\ssrc=|\shref=|xlink:|\son\w+=/i);
    expect(html).toContain("<style>");
  });

  it("respects the layer range and says so", async () => {
    const r = await slice(box(30, 20, 40), { rangeFrom: 3, rangeTo: 5 });
    const html = buildAssemblyGuide(r, settings({ rangeFrom: 3, rangeTo: 5 }), "m", DATE);
    expect(blocks(html)).toBe(3);
    expect(html).toContain("<b>L003</b>");
    expect(html).toContain("<b>L005</b>");
    expect(html).not.toContain("<b>L002</b>");
    expect(html).not.toContain("<b>L006</b>");
    expect(html).toContain("layers 3 to 5");
    expect(html).toContain("dashed: L002"); // the layer below the range is still the orientation hint
    expect(html).toContain('class="prev"');
  });

  it("the first layer has no dashed outline, the others do", async () => {
    const r = await slice(box(30, 20, 40));
    const html = buildAssemblyGuide(r, settings(), "m", DATE);
    const sections = html.split('<section class="layer">').slice(1);
    expect(sections[0]).not.toContain('class="prev"');
    expect(sections[0]).toContain("nothing dashed");
    expect(sections[1]).toContain('class="prev"');
  });

  it("escapes the model name and any text", async () => {
    expect(escapeHtml(`<b>"x" & 'y'</b>`)).toBe("&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;");
    const r = await slice(box(30, 20, 40));
    const evil = `<script>alert(1)</script>"&`;
    const html = buildAssemblyGuide(r, settings(), evil, DATE);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;&quot;&amp;");
    expect(html).not.toMatch(/<script/i);
  });

  it("shows the sheet of each part when there are several sheets", async () => {
    const r = await slice(box(30, 20, 40), { sheetW: 40, sheetH: 30, partSpacing: 2, sheetMargin: 2 });
    expect(r.sheets.length).toBeGreaterThan(2);
    const html = buildAssemblyGuide(r, settings(), "m", DATE);
    for (const pl of r.placements) expect(html).toContain(`<b>${pl.partId}</b>: sheet ${pl.sheet + 1}`);
  });

  it("instructions follow the settings (no dowels, no engrave)", async () => {
    const r = await slice(box(30, 20, 40));
    const off = buildAssemblyGuide(r, settings({ dowels: false, engraveNextOutline: false, labels: false }), "m", DATE);
    expect(off).not.toContain("Thread a dowel");
    expect(off).toContain("carry no engraved outline");
    const on = buildAssemblyGuide(r, settings({ dowels: true }), "m", DATE);
    expect(on).toContain("Thread a dowel");
    expect(on).toContain("labels face up");
  });

  it("is deterministic for a given date", async () => {
    const r = await slice(box(30, 20, 40));
    expect(buildAssemblyGuide(r, settings(), "m", DATE)).toBe(buildAssemblyGuide(r, settings(), "m", DATE));
  });

  it("stays small for a 100-layer sphere", async () => {
    const r = await slice(uvSphere(50, 48, 72), { thickness: 1, samplesPerLayer: 1 });
    expect(r.info.layerCount).toBeGreaterThanOrEqual(99);
    const html = buildAssemblyGuide(r, settings({ thickness: 1 }), "ball", DATE);
    expect(blocks(html)).toBe(r.info.layerCount);
    expect(html.length).toBeLessThan(1_500_000);
  });
});

describe("assembly guide as an export format", () => {
  it("is a valid format in project files and does not produce drawing files", async () => {
    const s = parseProject(serializeProject(settings({ formats: ["dxf", "guide"] })));
    expect(s.formats).toEqual(["dxf", "guide"]);
    expect(() => parseProject(JSON.stringify({ format: "laser-slicer-project", version: 2, settings: { formats: ["pdf"] } }))).toThrow();
    const r = await slice(box(30, 20, 40));
    expect(buildExportFiles(r, settings({ formats: ["guide"] }), "m")).toEqual([]);
  });

  it("the README mentions it, and the tooltip describes it", async () => {
    const r = await slice(box(30, 20, 40));
    const readme = buildReadme(r, settings({ formats: ["dxf", "guide"] }), "m", [{ name: "assembly.html", mime: "text/html", bytes: new Uint8Array() }]);
    expect(readme).toContain("Assembly guide: open assembly.html");
    expect(readme).toContain("  assembly.html");
    expect(buildReadme(r, settings(), "m", [])).not.toContain("Assembly guide");
    expect(HELP.formats).toContain("Assembly guide");
  });
});
