import { describe, expect, it } from "vitest";
import DxfParser from "dxf-parser";
import { unzipSync } from "fflate";
import { buildCalibration, buildCalibrationZip, calibrationReadme, formatMm, KERF_VALUES, SQUARE } from "../src/core/calibration";
import { textToPolylines, textWidth } from "../src/core/font/hershey";
import { writeDxf } from "../src/core/export/dxf";
import { writeSvg } from "../src/core/export/svg";
import type { Ring, Vec2 } from "../src/core/types";
import { num } from "../src/core/export/common";

const O = { dowelDiameter: 6, kerf: 0.15 };
const bb = (pts: Vec2[]) => ({ x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), y1: Math.max(...pts.map((p) => p[1])) });
const inside = (a: ReturnType<typeof bb>, b: ReturnType<typeof bb>, m = 0) => a.x0 >= b.x0 + m && a.x1 <= b.x1 - m && a.y0 >= b.y0 + m && a.y1 <= b.y1 - m;
const sizeOf = (r: Ring) => { const b = bb(r); return [b.x1 - b.x0, b.y1 - b.y0]; };

describe("decimal point glyph", () => {
  it("draws a small closed square on the baseline", () => {
    const l = textToPolylines(".", 21);
    expect(l).toHaveLength(1);
    expect(l[0][0]).toEqual(l[0][l[0].length - 1]);
    const b = bb(l[0]);
    expect(b.y0).toBeCloseTo(0, 6);
    expect(b.y1 - b.y0).toBeCloseTo(2, 6);
    expect(textWidth("0.1", 21)).toBeGreaterThan(textWidth("01", 21));
  });
  it("formats values", () => {
    expect(formatMm(0)).toBe("0");
    expect(formatMm(0.15)).toBe("0.15");
    expect(formatMm(5.8)).toBe("5.8");
    expect(formatMm(0.30000000000000004)).toBe("0.3");
  });
});

describe("calibration sheet geometry", () => {
  const c = buildCalibration(O);
  const d = c.drawing;
  const sheet = { x0: 0, x1: c.width, y0: 0, y1: c.height };

  it("is about 160 x 80 mm and everything fits on it", () => {
    expect(c.width).toBeLessThanOrEqual(160);
    expect(c.height).toBeLessThanOrEqual(100);
    for (const r of [...d.outerClosed!, ...d.innerClosed!]) expect(inside(bb(r), sheet)).toBe(true);
    for (const l of [...d.label, ...d.engrave]) expect(inside(bb(l), sheet)).toBe(true);
    for (const k of d.circles) expect(inside({ x0: k.c[0] - k.d / 2, x1: k.c[0] + k.d / 2, y0: k.c[1] - k.d / 2, y1: k.c[1] + k.d / 2 }, sheet)).toBe(true);
  });

  it("has 7 outset squares and 7 inset holes whose sizes follow the kerf", () => {
    expect(d.innerClosed).toHaveLength(7);
    const squares = d.outerClosed!.filter((r) => sizeOf(r)[0] < 30);
    expect(squares).toHaveLength(7);
    squares.sort((a, b) => bb(a).x0 - bb(b).x0);
    const holes = [...d.innerClosed!].sort((a, b) => bb(a).x0 - bb(b).x0);
    KERF_VALUES.forEach((k, i) => {
      expect(sizeOf(squares[i])[0]).toBeCloseTo(SQUARE + k, 6);
      expect(sizeOf(squares[i])[1]).toBeCloseTo(SQUARE + k, 6);
      expect(sizeOf(holes[i])[0]).toBeCloseTo(SQUARE - k, 6);
      expect(sizeOf(holes[i])[1]).toBeCloseTo(SQUARE - k, 6);
    });
  });

  it("outlines are on CUT (outer rings of the cut family), parts are separate", () => {
    // 7 squares + hole strip + dowel strip
    expect(d.outerClosed).toHaveLength(9);
    const outers = d.outerClosed!.map(bb);
    for (let i = 0; i < outers.length; i++)
      for (let j = i + 1; j < outers.length; j++) {
        const a = outers[i], b = outers[j];
        expect(a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0, `${i} overlaps ${j}`).toBe(true);
      }
  });

  it("labels sit inside a part and do not touch holes or circles", () => {
    const outers = d.outerClosed!.map(bb);
    const holes = d.innerClosed!.map(bb);
    expect(d.label.length).toBeGreaterThan(0);
    for (const l of d.label) {
      const b = bb(l);
      expect(outers.some((o) => inside(b, o, 0.5)), "label inside a part").toBe(true);
      for (const h of holes) expect(b.x1 <= h.x0 || b.x0 >= h.x1 || b.y1 <= h.y0 || b.y0 >= h.y1, "label vs hole").toBe(true);
      for (const k of d.circles) {
        const dist = Math.max(...l.map(([x, y]) => -Math.hypot(x - k.c[0], y - k.c[1])));
        expect(-dist, "label vs circle").toBeGreaterThan(k.d / 2);
      }
    }
  });

  it("dowel holes: label minus kerf, centred in the strip, all inside the strip", () => {
    expect(c.dowelLabels).toEqual([5.8, 5.9, 6, 6.1, 6.2]);
    expect(d.circles.map((k) => k.d)).toEqual([5.65, 5.75, 5.85, 5.95, 6.05].map((v) => expect.closeTo(v, 6)));
    const strip = d.outerClosed!.map(bb).find((b) => d.circles.every((k) => k.c[0] >= b.x0 && k.c[0] <= b.x1 && k.c[1] > b.y0 && k.c[1] < b.y1))!;
    expect(strip).toBeTruthy();
    for (const k of d.circles) expect(inside({ x0: k.c[0] - k.d / 2, x1: k.c[0] + k.d / 2, y0: k.c[1] - k.d / 2, y1: k.c[1] + k.d / 2 }, strip, 1)).toBe(true);
    const xs = d.circles.map((k) => k.c[0]);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1] - 6.2).toBeGreaterThan(1.5); // webs between holes
  });

  it("follows the dowel setting and survives odd values", () => {
    const big = buildCalibration({ dowelDiameter: 12.5, kerf: 0.2 });
    expect(big.dowelLabels[2]).toBe(12.5);
    expect(big.width).toBeLessThanOrEqual(160);
    expect(buildCalibration({ dowelDiameter: 0, kerf: -1 }).dowelLabels[2]).toBe(6);
    const tiny = buildCalibration({ dowelDiameter: 0.3, kerf: 0.5 });
    expect(tiny.dowelLabels).toEqual([0.1, 0.2, 0.3, 0.4, 0.5]);
    for (const k of tiny.drawing.circles) expect(k.d).toBeGreaterThan(0);
  });
});

describe("calibration files", () => {
  const z = buildCalibrationZip(O);
  const files = unzipSync(z.bytes);
  const dec = (n: string) => new TextDecoder().decode(files[n]);

  it("zip holds DXF, SVG and README", () => {
    expect(Object.keys(files).sort()).toEqual(["README.txt", "calibration.dxf", "calibration.svg"]);
    const readme = dec("README.txt");
    expect(readme).toContain("Kerf test");
    expect(readme).toContain("Dowel test");
    expect(readme).toContain("0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3");
    expect(readme).toContain("5.8, 5.9, 6, 6.1, 6.2");
  });

  it("DXF parses with holes before outlines and labels on LABEL", () => {
    const e = (new DxfParser().parseSync(dec("calibration.dxf"))!.entities as any[]);
    const cut = e.filter((x) => x.layer === "CUT");
    const firstOuter = cut.findIndex((x) => x.type !== "CIRCLE" && x.vertices.length === 4 && Math.max(...x.vertices.map((v: any) => v.x)) - Math.min(...x.vertices.map((v: any) => v.x)) > 19.9 && cut.indexOf(x) >= 12);
    expect(cut.filter((x) => x.type === "CIRCLE")).toHaveLength(5);
    expect(cut.filter((x) => x.type !== "CIRCLE")).toHaveLength(7 + 9);
    expect(firstOuter).toBeGreaterThanOrEqual(12); // 7 holes + 5 circles first
    expect(e.filter((x) => x.layer === "LABEL").length).toBeGreaterThan(30);
    expect(e.every((x) => ["CUT", "LABEL"].includes(x.layer))).toBe(true);
  });

  it("SVG has CUT and LABEL groups of the same size", () => {
    const svg = dec("calibration.svg");
    expect(svg).toContain('<g id="CUT"');
    expect(svg).toContain('<g id="LABEL"');
    expect(svg).toContain(`width="${num(z.calibration.width)}mm"`);
    expect(writeSvg(z.calibration.drawing)).toBe(svg);
    expect(writeDxf(z.calibration.drawing)).toBe(dec("calibration.dxf"));
  });

  it("README states the kerf in use", () => {
    expect(calibrationReadme(z.calibration, { dowelDiameter: 6, kerf: 0.2 })).toContain("0.2 mm smaller");
  });
});
