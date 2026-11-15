import { describe, expect, it } from "vitest";
import DxfParser from "dxf-parser";
import { cuttingSequence, drawingTravel, orderEntities, travelOf, type Entity } from "../src/core/export/order";
import { drawingOf, sheetDrawing, splitCut, type Drawing } from "../src/core/export/common";
import { writeDxf } from "../src/core/export/dxf";
import { writeSvg } from "../src/core/export/svg";
import { buildExportFiles } from "../src/core/export/files";
import { buildReadme } from "../src/core/export/zip";
import { Pipeline } from "../src/core/pipeline";
import { DEFAULT_SETTINGS } from "../src/state";
import { slicingKey } from "../src/updateController";
import type { Ring, Vec2 } from "../src/core/types";
import { uvSphere } from "./fixtures/meshes";
import { settings, slice, weld } from "./helpers";

const sq = (x: number, y: number, s: number): Ring => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
const parse = (t: string) => new DxfParser().parseSync(t)!;
const key = (pts: Vec2[]) => pts.map((p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`).sort().join(" ");
const area = (r: Vec2[]) => r.reduce((a, p, i) => a + (p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1]), 0) / 2;

/** Reference: plain O(n^2) greedy nearest neighbour with the same entity semantics. */
function bruteTravel(ents: Entity[], from: Vec2): number {
  const left = ents.map((_, i) => i);
  let cur = from, t = 0;
  const cands = (e: Entity): { p: Vec2; end: Vec2 }[] =>
    e.k === "circle" ? [{ p: [e.c[0] + e.d / 2, e.c[1]], end: [e.c[0] + e.d / 2, e.c[1]] }]
    : e.k === "closed" ? e.pts.map((p) => ({ p, end: p }))
    : [{ p: e.pts[0], end: e.pts[e.pts.length - 1] }, { p: e.pts[e.pts.length - 1], end: e.pts[0] }];
  while (left.length) {
    let best = Infinity, bi = -1, be: Vec2 = cur;
    left.forEach((id, li) => {
      for (const c of cands(ents[id])) {
        const d = Math.hypot(c.p[0] - cur[0], c.p[1] - cur[1]);
        if (d < best) { best = d; bi = li; be = c.end; }
      }
    });
    t += best;
    cur = be;
    left.splice(bi, 1);
  }
  return t;
}

function random(n: number, seed = 1): Entity[] {
  let s = seed;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 1000;
  return Array.from({ length: n }, (_, i): Entity => {
    const x = r(), y = r();
    if (i % 3 === 0) return { k: "closed", pts: sq(x, y, 5 + (i % 7)) };
    if (i % 3 === 1) return { k: "open", pts: [[x, y], [x + 8, y + 3], [x + 12, y - 4]] };
    return { k: "circle", c: [x, y], d: 6 };
  });
}

describe("orderEntities", () => {
  it("starts at the origin and always goes to the nearest remaining entity", () => {
    const a: Entity = { k: "closed", pts: sq(50, 0, 5) };
    const b: Entity = { k: "closed", pts: sq(10, 0, 5) };
    const c: Entity = { k: "circle", c: [100, 0], d: 4 };
    const o = orderEntities([c, a, b], [0, 0]);
    expect(o.ents.map((e) => e.k === "circle" ? "c" : (e.pts[0][0] === 10 ? "b" : "a"))).toEqual(["b", "a", "c"]);
    expect(o.travel).toBeCloseTo(10 + (50 - 10) + (102 - 50), 9);
  });

  it("rotates a closed ring to the vertex nearest the previous end, geometry unchanged", () => {
    const ring: Ring = sq(40, 40, 10); // vertices (40,40) (50,40) (50,50) (40,50)
    const o = orderEntities([{ k: "closed", pts: ring }], [49, 52]);
    const out = (o.ents[0] as { pts: Vec2[] }).pts;
    expect(out[0]).toEqual([50, 50]);
    expect(out).toHaveLength(4);
    expect(key(out)).toBe(key(ring));
    expect(Math.abs(area(out) - area(ring))).toBe(0);
    // same cyclic order, same direction
    expect(out).toEqual([[50, 50], [40, 50], [40, 40], [50, 40]]);
    expect(o.end).toEqual([50, 50]);
  });

  it("reverses an open polyline when its far end is closer; the circle start is its angle-0 point", () => {
    const line: Entity = { k: "open", pts: [[0, 0], [10, 0], [20, 10]] };
    const o = orderEntities([line], [21, 11]);
    expect((o.ents[0] as { pts: Vec2[] }).pts).toEqual([[20, 10], [10, 0], [0, 0]]);
    expect(o.end).toEqual([0, 0]);
    const c = orderEntities([{ k: "circle", c: [10, 10], d: 6 }], [0, 0]);
    expect(c.travel).toBeCloseTo(Math.hypot(13, 10), 9);
  });

  it("matches a brute-force nearest-neighbour path (grid search is exact)", () => {
    for (const [n, seed] of [[1, 1], [2, 2], [40, 3], [300, 4]] as const) {
      const ents = random(n, seed);
      const o = orderEntities(ents, [0, 0]);
      expect(o.ents).toHaveLength(n);
      expect(o.travel).toBeCloseTo(bruteTravel(ents, [0, 0]), 6);
      expect(travelOf(o.ents)).toBeCloseTo(o.travel, 6);
    }
  });

  it("handles degenerate layouts (all on one line, all at one point)", () => {
    const line: Entity[] = Array.from({ length: 200 }, (_, i) => ({ k: "circle", c: [i * 3, 0], d: 1 }));
    expect(orderEntities(line, [0, 0]).ents).toHaveLength(200);
    const same: Entity[] = Array.from({ length: 50 }, () => ({ k: "circle", c: [5, 5], d: 1 }));
    expect(orderEntities(same, [0, 0]).ents).toHaveLength(50);
    expect(orderEntities([], [1, 2])).toEqual({ ents: [], end: [1, 2], travel: 0 });
  });

  it("every entity is kept exactly once, with the same vertices", () => {
    const ents = random(500, 9);
    const o = orderEntities(ents, [0, 0]);
    const sig = (e: Entity) => (e.k === "circle" ? `c${e.c}` : `${e.k}${key(e.pts)}`);
    expect(o.ents.map(sig).sort()).toEqual(ents.map(sig).sort());
  });

  it("is fast for thousands of entities", () => {
    const ents = random(20000, 5);
    const t0 = performance.now();
    orderEntities(ents, [0, 0]);
    const ms = performance.now() - t0;
    process.stderr.write(`\n[perf] ordering 20000 entities: ${ms.toFixed(0)} ms\n`);
    expect(ms).toBeLessThan(5000);
  });
});

describe("cutting order in the files", () => {
  const multi = async (patch = {}) => {
    const r = await slice(uvSphere(40, 24, 48), { thickness: 4, sheetW: 200, sheetH: 150, hollowEnabled: true, dowels: true, labels: true, engraveNextOutline: true, ...patch });
    expect(r.sheets.length).toBeGreaterThan(1);
    return r;
  };

  it("engrave and label first, then every inner cut, then every outline (DXF and SVG)", async () => {
    const r = await multi();
    for (const innerLayer of [false, true]) {
      for (const sh of r.sheets) {
        const d = sheetDrawing(r.parts, r.placements, sh.index, sh.w, sh.h);
        const cut = splitCut(d);
        const nInner = cut.innerClosed.length + cut.innerOpen.length + d.circles.length;
        expect(d.circles.length).toBeGreaterThan(0);
        expect(cut.innerClosed.length).toBeGreaterThan(0);
        const ents = parse(writeDxf(d, { layers: { innerLayer } })).entities as any[];
        const layers = ents.map((e) => e.layer);
        const firstCut = layers.findIndex((l) => l === "CUT" || l === "CUT_INNER");
        expect(layers.slice(0, firstCut).every((l) => l === "ENGRAVE" || l === "LABEL")).toBe(true);
        expect(layers.slice(0, firstCut).length).toBe(d.engrave.length + d.label.length);
        const cuts = ents.slice(firstCut);
        expect(cuts).toHaveLength(nInner + cut.outerClosed.length + cut.outerOpen.length);
        // files hold 4 decimals: compare by vertex count and centroid
        const sig = (pts: Vec2[]) => [pts.length, pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length, Math.abs(area(pts))];
        const innerSigs = cut.innerClosed.map(sig);
        const isInner = (e: any) => e.type === "CIRCLE" || ((s) => innerSigs.some((t) => t[0] === s[0] && Math.abs(t[1] - s[1]) < 0.01 && Math.abs(t[2] - s[2]) < 0.01 && Math.abs(t[3] - s[3]) < 0.5))(sig(e.vertices.map((v: any) => [v.x, v.y])));
        expect(cuts.slice(0, nInner).every(isInner)).toBe(true);
        expect(cuts.slice(nInner).some(isInner)).toBe(false);
        if (innerLayer) {
          expect(cuts.slice(0, nInner).every((e) => e.layer === "CUT_INNER")).toBe(true);
          expect(cuts.slice(nInner).every((e) => e.layer === "CUT")).toBe(true);
        }
        // the SVG has the same sequence: ENGRAVE, LABEL, [CUT_INNER], CUT groups in this order
        const svg = writeSvg(d, { innerLayer });
        const gi = (id: string) => svg.indexOf(`<g id="${id}"`);
        expect(gi("ENGRAVE")).toBeLessThan(gi("LABEL"));
        expect(gi("LABEL")).toBeLessThan(gi(innerLayer ? "CUT_INNER" : "CUT"));
        if (innerLayer) expect(gi("CUT_INNER")).toBeLessThan(gi("CUT"));
      }
    }
  });

  it("DXF and SVG list the same entities in the same order", async () => {
    const r = await multi();
    const d = sheetDrawing(r.parts, r.placements, 0, r.sheets[0].w, r.sheets[0].h);
    const dxfStarts = (parse(writeDxf(d)).entities as any[]).map((e) => (e.type === "CIRCLE" ? [e.center.x + e.radius, e.center.y] : [e.vertices[0].x, e.vertices[0].y]));
    const svg = writeSvg(d);
    const svgStarts = [...svg.matchAll(/<path d="M([-\d.]+) ([-\d.]+)|<circle cx="([-\d.]+)" cy="([-\d.]+)" r="([-\d.]+)"/g)].map((m) =>
      m[1] !== undefined ? [Number(m[1]), d.height - Number(m[2])] : [Number(m[3]) + Number(m[5]), d.height - Number(m[4])]);
    expect(svgStarts).toHaveLength(dxfStarts.length);
    svgStarts.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(dxfStarts[i][0], 3);
      expect(p[1]).toBeCloseTo(dxfStarts[i][1], 3);
    });
  });

  it("the geometry is unchanged: same rings (rotated), same lines (maybe reversed), same circles", async () => {
    const r = await multi();
    const d = sheetDrawing(r.parts, r.placements, 0, r.sheets[0].w, r.sheets[0].h);
    const seq = cuttingSequence(d);
    const sig = (e: Entity) => (e.k === "circle" ? `c${e.c}${e.d}` : e.k === "closed" ? `r${key(e.pts)}` : `o${key(e.pts)}`);
    const cut = splitCut(d);
    const expectInner = [...cut.innerClosed.map((p) => `r${key(p)}`), ...cut.innerOpen.map((p) => `o${key(p)}`), ...d.circles.map((c) => `c${c.c}${c.d}`)];
    expect(seq.inner.map(sig).sort()).toEqual(expectInner.sort());
    expect(seq.outer.map(sig).sort()).toEqual([...cut.outerClosed.map((p) => `r${key(p)}`), ...cut.outerOpen.map((p) => `o${key(p)}`)].sort());
    for (const e of seq.outer) if (e.k === "closed") expect(Math.abs(area(e.pts))).toBeGreaterThan(0);
  });

  it("travel is shorter than the old order and the README and measurements report it", async () => {
    const r = await multi();
    let oldT = 0, newT = 0;
    for (const sh of r.sheets) {
      const d = sheetDrawing(r.parts, r.placements, sh.index, sh.w, sh.h);
      const c = splitCut(d);
      const closed = (rs: Ring[]): Entity[] => rs.map((pts) => ({ k: "closed", pts }));
      const open = (ls: Vec2[][]): Entity[] => ls.map((pts) => ({ k: "open", pts }));
      // the order of earlier versions: inner rings, dowels, outlines, bridges, engrave, label, in part order
      const legacy: Entity[] = [...closed(c.innerClosed), ...open(c.innerOpen), ...d.circles.map((x): Entity => ({ k: "circle", c: x.c, d: x.d })), ...closed(c.outerClosed), ...open(c.outerOpen), ...open(d.bridge ?? []), ...open(d.engrave), ...open(d.label)];
      oldT += travelOf(legacy);
      newT += drawingTravel(d);
    }
    process.stderr.write(`\n[order] ${r.sheets.length} sheets: travel ${oldT.toFixed(0)} mm -> ${newT.toFixed(0)} mm (${((1 - newT / oldT) * 100).toFixed(0)} % less)\n`);
    expect(newT).toBeLessThan(oldT * 0.6);
    expect(r.measure.travelLength).toBeCloseTo(newT, 6);
    const s = settings({ formats: ["dxf"] });
    const readme = buildReadme(r, s, "ball", buildExportFiles(r, s, "ball"));
    expect(readme).toMatch(/Travel between cuts: \d+ mm/);
  });

  it("travel is zero for an empty drawing and counts the way in from the origin", () => {
    expect(drawingTravel(drawingOf([], 100, 100))).toBe(0);
    const d: Drawing = { width: 100, height: 100, cut: [], circles: [{ c: [30, 40], d: 10 }], engrave: [], label: [] };
    expect(drawingTravel(d)).toBeCloseTo(Math.hypot(35, 40), 9);
  });

  it("is not a setting: no new key, nothing in the slicing key", () => {
    expect(Object.keys(DEFAULT_SETTINGS).filter((k) => /order|travel/i.test(k))).toEqual([]);
    expect(slicingKey(settings())).toBe(slicingKey(settings()));
  });

  it("the measurement follows the nesting only: same inputs, same travel; a smaller sheet changes it", async () => {
    const { mesh, stats } = weld(uvSphere(40, 24, 48));
    const p = new Pipeline();
    p.setMesh(mesh, stats);
    const a = (await p.run(settings({ thickness: 4, sheetW: 200, sheetH: 150 })))!;
    const b = (await p.run(settings({ thickness: 4, sheetW: 200, sheetH: 150, density: 0.6 })))!;
    expect(b.measure.travelLength).toBe(a.measure.travelLength);
    const c = (await p.run(settings({ thickness: 4, sheetW: 500, sheetH: 400 })))!;
    expect(c.measure.travelLength).not.toBe(a.measure.travelLength);
  });
});
