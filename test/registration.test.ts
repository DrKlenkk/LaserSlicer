import { describe, expect, it } from "vitest";
import { addRegistration, labelText } from "../src/core/registration";
import { textToPolylines, textWidth } from "../src/core/font/hershey";
import { difference, intersect, shapeArea, shapesArea } from "../src/core/poly";
import type { Shape, Vec2 } from "../src/core/types";
import { box, twoSpheres, uvSphere } from "./fixtures/meshes";
import { settings, slice } from "./helpers";

function bboxOf(lines: Vec2[][]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const l of lines)
    for (const [x, y] of l) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  return { minX, minY, maxX, maxY };
}
const rectShape = (b: ReturnType<typeof bboxOf>): Shape => ({
  outer: [[b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY]],
  holes: [],
});
const asShape = (line: Vec2[]): Shape => ({ outer: line.slice(0, -1), holes: [] });

describe("hershey text", () => {
  it("has strokes for digits, capitals and the dash, scaled to the cap height", () => {
    for (const ch of "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-") {
      const lines = textToPolylines(ch, 10);
      expect(lines.length, ch).toBeGreaterThan(0);
      const b = bboxOf(lines);
      expect(b.maxX - b.minX + (b.maxY - b.minY), ch).toBeGreaterThan(0);
      expect(b.minY, ch).toBeGreaterThanOrEqual(-1); // Q has a tail below the baseline
      expect(b.maxY, ch).toBeLessThanOrEqual(10 + 1e-9);
    }
    expect(bboxOf(textToPolylines("H", 10)).maxY).toBeCloseTo(10, 6);
    expect(textToPolylines(" ", 10)).toHaveLength(0);
    expect(textWidth("L12", 12)).toBeCloseTo(2 * textWidth("L12", 6), 9);
    expect(textWidth("AB", 6)).toBeCloseTo(textWidth("A", 6) + textWidth("B", 6), 9);
  });
  it("has distinct lower case glyphs a-z within the cap height, descenders below the baseline", () => {
    const seen = new Set<string>();
    for (const ch of "abcdefghijklmnopqrstuvwxyz") {
      const lines = textToPolylines(ch, 21);
      expect(lines.length, ch).toBeGreaterThan(0);
      const b = bboxOf(lines);
      expect(b.maxY, ch).toBeLessThanOrEqual(21 + 1e-9);
      expect(b.minY, ch).toBeGreaterThanOrEqual(-8);
      expect(b.maxY, ch).toBeGreaterThanOrEqual(14 - 1e-9); // at least x-height
      expect(textWidth(ch, 21), ch).toBeGreaterThan(3);
      seen.add(JSON.stringify(lines));
      expect(JSON.stringify(lines), `${ch} differs from ${ch.toUpperCase()}`).not.toBe(JSON.stringify(textToPolylines(ch.toUpperCase(), 21)));
    }
    expect(seen.size).toBe(26);
    for (const ch of "gjpqy") expect(bboxOf(textToPolylines(ch, 21)).minY, ch).toBeLessThan(-5);
    expect(bboxOf(textToPolylines("x", 21)).minY).toBeCloseTo(0, 6);
  });
  it("label text drops the zero padding", () => {
    expect(labelText("L012")).toBe("L12");
    expect(labelText("L012-b")).toBe("L12-b");
    expect(labelText("L000")).toBe("L0");
  });
});

describe("registration on a sphere", () => {
  it("gives every part a label and keeps it inside the part and, where possible, under the next layer", async () => {
    const r = await slice(uvSphere(), { thickness: 2, kerf: 0 });
    const layers = r.layers;
    expect(r.parts.length).toBe(layers.length);
    let underNext = 0;
    for (const p of r.parts) {
      expect(p.label.length, p.id).toBeGreaterThan(0);
      for (const l of p.label) expect(l.length).toBeGreaterThanOrEqual(2);
      const box = rectShape(bboxOf(p.label));
      expect(shapesArea(difference([box], [p.cut])), `${p.id} inside part`).toBeLessThan(1e-3);
      const next = layers[p.layer + 1]?.shapes;
      if (next) {
        const joint = intersect([p.cut], next);
        const fellBack = r.warnings.some((w) => w.partId === p.id && /does not fit under/.test(w.message));
        if (!fellBack) {
          underNext++;
          expect(shapesArea(difference([box], joint)), `${p.id} under next layer`).toBeLessThan(1e-3);
        }
      }
    }
    expect(underNext).toBeGreaterThan(layers.length / 2);
  });

  it("engrave lines are closed rings inside the part and trace the next layer where it is smaller", async () => {
    const r = await slice(uvSphere(), { thickness: 2, kerf: 0 });
    let withEngrave = 0;
    for (const p of r.parts) {
      if (p.engrave.length) withEngrave++;
      for (const line of p.engrave) {
        expect(line[0]).toEqual(line[line.length - 1]); // closed
        expect(shapesArea(difference([asShape(line)], [{ outer: p.cut.outer, holes: [] }])), p.id).toBeLessThan(1e-3);
      }
      const next = r.layers[p.layer + 1]?.shapes;
      if (next && p.engrave.length) {
        const area = shapesArea(intersect([p.cut], next));
        expect(Math.abs(shapeArea(asShape(p.engrave[0])) - area)).toBeLessThan(area * 0.01);
      }
    }
    // the upper half of the sphere shrinks upwards, so those parts carry the next layer's outline
    expect(withEngrave).toBeGreaterThan(r.parts.length / 3);
    expect(r.parts.at(-1)!.engrave).toHaveLength(0); // top layer
  });

  it("respects the engraveNextOutline and labels switches", async () => {
    const r = await slice(uvSphere(), { thickness: 4, engraveNextOutline: false, labels: false });
    expect(r.parts.every((p) => p.engrave.length === 0 && p.label.length === 0)).toBe(true);
  });

  it("labels each island of a layer with its suffix and keeps labels inside their own island", async () => {
    const r = await slice(twoSpheres(), { thickness: 4, kerf: 0 });
    const ids = r.parts.filter((p) => p.layer === 2).map((p) => p.id);
    expect(ids).toEqual(["L002-a", "L002-b"]);
    for (const p of r.parts) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(shapesArea(difference([rectShape(bboxOf(p.label))], [p.cut]))).toBeLessThan(1e-3);
    }
  });

  it("shrinks the text on a small part but never below 3 mm unless the part is tiny", async () => {
    const r = await slice(box(8, 8, 8), { thickness: 4, kerf: 0, labelHeight: 6 });
    for (const p of r.parts) {
      const b = bboxOf(p.label);
      expect(b.maxY - b.minY).toBeGreaterThanOrEqual(3 - 1e-6);
      expect(b.maxY - b.minY).toBeLessThanOrEqual(6 + 1e-6);
    }
    const lower = bboxOf(r.parts[0].label);
    expect(lower.maxY - lower.minY).toBeLessThan(6); // "L0" at 6 mm is wider than the 8 mm square
  });

  it("kerf does not touch engrave or label lines", async () => {
    const a = await slice(uvSphere(), { thickness: 4, kerf: 0 });
    const b = await slice(uvSphere(), { thickness: 4, kerf: 0.3 });
    expect(b.parts[2].label).toEqual(a.parts[2].label);
    expect(b.parts[2].engrave).toEqual(a.parts[2].engrave);
  });

  it("addRegistration does not mutate its input", async () => {
    const r = await slice(box(20, 20, 8), { thickness: 4, kerf: 0 });
    const bare = r.parts.map((p) => ({ ...p, engrave: [], label: [] }));
    const out = addRegistration(r.layers, bare, settings());
    expect(bare[0].label).toHaveLength(0);
    expect(out.parts[0].label.length).toBeGreaterThan(0);
  });
});

describe("engrave lines retrace nothing", () => {
  const sq = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const holeAt = (cx: number, cy: number, r = 3): Vec2[] => {
    const h: Vec2[] = [];
    for (let i = 0; i < 16; i++) h.push([cx + r * Math.cos((-2 * Math.PI * i) / 16), cy + r * Math.sin((-2 * Math.PI * i) / 16)]);
    return h;
  };
  const corners: [number, number][] = [[10, 10], [70, 10], [70, 70], [10, 70]];
  const lower: Shape = { outer: sq(0, 0, 80, 80), holes: corners.map(([x, y]) => holeAt(x, y)) };
  const layersOf = (upper: Shape) => [
    { index: 0, z0: 0, z1: 3, shapes: [lower] },
    { index: 1, z0: 3, z1: 6, shapes: [upper] },
  ];
  const part = (): Parts => [{ id: "L000", layer: 0, cut: lower, engrave: [], label: [], holes: [] }];
  type Parts = Parameters<typeof addRegistration>[1];
  const lenOf = (ls: Vec2[][]) => ls.reduce((s, l) => s + l.reduce((a, p, i) => (i ? a + Math.hypot(p[0] - l[i - 1][0], p[1] - l[i - 1][1]) : 0), 0), 0);
  const noLabels = settings({ labels: false, dowels: false, hollowEnabled: false });

  it("next layer with one corner chamfered 6 mm (joint 99.7 % of the part): only the chamfer line is engraved, not the cut edge or holes", () => {
    const upper: Shape = { outer: [[0, 0], [80, 0], [80, 74], [74, 80], [0, 80]], holes: lower.holes };
    const out = addRegistration(layersOf(upper), part(), noLabels).parts[0];
    const total = lenOf(out.engrave);
    expect(total).toBeGreaterThan(8);
    expect(total).toBeLessThan(9); // 6 * sqrt(2) = 8.49 mm; before the fix this was about 390 mm (the whole outline and the holes)
  });

  it("next layer with a 10 mm step along one side: only the step line is engraved", () => {
    const upper: Shape = { outer: sq(0, 0, 70, 80), holes: lower.holes.filter((h) => h[0][0] < 70).map((h) => h) };
    const out = addRegistration(layersOf(upper), part(), noLabels).parts[0];
    const total = lenOf(out.engrave);
    // the inner edge x = 70 runs from y = 0 to 80 (minus what lies on the corner hole at (70,10) and (70,70))
    expect(total).toBeGreaterThan(55);
    expect(total).toBeLessThan(81);
    for (const l of out.engrave) for (const [x] of l) expect(x).toBeGreaterThan(60);
    expect(out.engrave.some((l) => l[0][0] === l[l.length - 1][0] && l[0][1] === l[l.length - 1][1])).toBe(false); // open
  });

  it("next layer covering the whole part gives no engrave line", () => {
    const big: Shape = { outer: sq(-5, -5, 85, 85), holes: [] };
    expect(addRegistration(layersOf(big), part(), noLabels).parts[0].engrave).toHaveLength(0);
  });

  it("a clearly smaller next layer keeps its full closed ring", () => {
    const small: Shape = { outer: sq(20, 20, 60, 60), holes: [] };
    const e = addRegistration(layersOf(small), part(), noLabels).parts[0].engrave;
    expect(e).toHaveLength(1);
    expect(e[0][0]).toEqual(e[0][e[0].length - 1]);
    expect(lenOf(e)).toBeCloseTo(160, 3);
  });
});
