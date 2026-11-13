import { describe, expect, it } from "vitest";
import DxfParser from "dxf-parser";
import { addBridges, clearanceOf, cutPaths, gapLength, placeBridges, polylineLength, splitRing, type BridgeParams } from "../src/core/bridges";
import { applyPlacement, transformPoints } from "../src/core/nest";
import { paintDrawing } from "../src/core/export/raster";
import { drawingOf, sheetDrawing } from "../src/core/export/common";
import { writeDxf } from "../src/core/export/dxf";
import { writeSvg } from "../src/core/export/svg";
import { buildReadme } from "../src/core/export/zip";
import { shapeArea } from "../src/core/poly";
import { Pipeline } from "../src/core/pipeline";
import type { Part, Ring, Vec2 } from "../src/core/types";
import { box } from "./fixtures/meshes";
import { settings, slice, weld } from "./helpers";

const rect = (w: number, h: number): Ring => [[0, 0], [w, 0], [w, h], [0, h]];
const circle = (r: number, n = 96): Ring => Array.from({ length: n }, (_, i) => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)] as Vec2);
const perimeter = (r: Ring) => polylineLength([...r, r[0]]);
const P = (patch: Partial<BridgeParams> = {}): BridgeParams => ({ bridgesEnabled: true, bridgeCount: 2, bridgeWidth: 0.5, bridgeMinLength: 40, bridgeHoles: false, bridgeMaxSpacing: 0, kerf: 0.15, ...patch });
const part = (outer: Ring, holes: Ring[] = [], dowels: Part["holes"] = []): Part => ({ id: "L001", layer: 1, cut: { outer, holes }, engrave: [], label: [], holes: dowels });

/** Which side of an axis-aligned rectangle a point is on (the point is on the outline). */
function side(p: Vec2, w: number, h: number): "bottom" | "right" | "top" | "left" {
  const d = { bottom: p[1], right: w - p[0], top: h - p[1], left: p[0] };
  return (Object.entries(d).sort((a, b) => a[1] - b[1])[0][0]) as "bottom";
}
const mid = (l: Vec2[]): Vec2 => [(l[0][0] + l[l.length - 1][0]) / 2, (l[0][1] + l[l.length - 1][1]) / 2];

describe("bridge placement", () => {
  it("gap = width + kerf, clearance = max(1.5 mm, width)", () => {
    expect(gapLength(0.5, 0.15)).toBeCloseTo(0.65, 9);
    expect(gapLength(0.5, 0)).toBe(0.5);
    expect(clearanceOf(0.5)).toBe(1.5);
    expect(clearanceOf(3)).toBe(3);
  });

  it("N=2 on a rectangle: opposite long sides, never within the clearance of a corner", () => {
    const ring = rect(100, 50);
    const plan = placeBridges(ring, P())!;
    expect(plan.centers).toHaveLength(2);
    const sp = splitRing(ring, plan.centers, gapLength(0.5, 0.15))!;
    const sides = sp.gaps.map((g) => side(mid(g), 100, 50));
    expect(new Set(sides).size).toBe(2);
    expect(sides.sort()).toEqual(["bottom", "top"]);
    for (const g of sp.gaps) {
      expect(g).toHaveLength(2); // straight: no vertex inside the gap
      for (const q of g) {
        const dc = Math.min(...[[0, 0], [100, 0], [100, 50], [0, 50]].map((c) => Math.hypot(q[0] - c[0], q[1] - c[1])));
        expect(dc).toBeGreaterThanOrEqual(clearanceOf(0.5) - 1e-6);
      }
    }
  });

  it("N=4 on a square: one bridge per side, mid-edge", () => {
    const ring = rect(60, 60);
    const plan = placeBridges(ring, P({ bridgeCount: 4 }))!;
    const sp = splitRing(ring, plan.centers, gapLength(0.5, 0.15))!;
    expect(sp.gaps.map((g) => side(mid(g), 60, 60)).sort()).toEqual(["bottom", "left", "right", "top"]);
    for (const g of sp.gaps) {
      const m = mid(g);
      const along = side(m, 60, 60) === "bottom" || side(m, 60, 60) === "top" ? m[0] : m[1];
      expect(along).toBeGreaterThan(15);
      expect(along).toBeLessThan(45);
    }
  });

  it("avoids a short edge and a rounded corner, using the straight stretches", () => {
    // 100 x 6 slot-like rectangle with 45 degree chamfered corners: the long edges are the only good places
    const ring: Ring = [[3, 0], [97, 0], [100, 3], [100, 6], [97, 9], [3, 9], [0, 6], [0, 3]];
    const plan = placeBridges(ring, P())!;
    const sp = splitRing(ring, plan.centers, gapLength(0.5, 0.15))!;
    for (const g of sp.gaps) expect(g).toHaveLength(2);
  });

  it("a circle (no straight stretch) gets evenly spaced bridges on the curve", () => {
    const ring = circle(30);
    const per = perimeter(ring);
    for (const n of [2, 3, 5]) {
      const plan = placeBridges(ring, P({ bridgeCount: n }))!;
      expect(plan.centers).toHaveLength(n);
      for (let i = 0; i < n; i++) {
        const d = (i + 1 < n ? plan.centers[i + 1] : plan.centers[0] + per) - plan.centers[i];
        expect(d).toBeGreaterThan((per / n) * 0.7);
        expect(d).toBeLessThan((per / n) * 1.3);
      }
    }
  });

  it("bridges of one ring never overlap, even when the ring is barely long enough (count is reduced)", () => {
    const ring = rect(6, 6); // perimeter 24: room for 6 gaps with clearance
    const plan = placeBridges(ring, P({ bridgeCount: 8, bridgeMinLength: 10 }))!;
    const minSep = gapLength(0.5, 0.15) + 2 * clearanceOf(0.5);
    expect(plan.reduced).toBe(true);
    expect(plan.centers.length).toBeLessThan(8);
    for (let i = 0; i < plan.centers.length; i++) {
      const d = (i + 1 < plan.centers.length ? plan.centers[i + 1] : plan.centers[0] + 24) - plan.centers[i];
      expect(d).toBeGreaterThanOrEqual(minSep - 1e-6);
    }
  });

  it("outlines shorter than the minimum length get none", () => {
    expect(placeBridges(rect(9, 9), P())).toBeNull(); // 36 < 40
    expect(placeBridges(rect(11, 11), P())).not.toBeNull(); // 44
    expect(placeBridges(rect(11, 11), P({ bridgeMinLength: 50 }))).toBeNull();
  });

  it("maxSpacing adds bridges on long outlines", () => {
    const ring = rect(400, 100); // perimeter 1000
    expect(placeBridges(ring, P({ bridgeCount: 2 }))!.centers).toHaveLength(2);
    expect(placeBridges(ring, P({ bridgeCount: 2, bridgeMaxSpacing: 150 }))!.centers).toHaveLength(7);
  });

  it("the plan does not depend on the rotation or position of the ring", () => {
    const ring = rect(100, 50);
    const a = placeBridges(ring, P())!;
    const b = placeBridges(transformPoints(ring, 37, 12, -5), P())!;
    expect(b.centers.length).toBe(a.centers.length);
    b.centers.forEach((c, i) => expect(c).toBeCloseTo(a.centers[i], 6));
  });
});

describe("split ring and parts", () => {
  it("cut + gaps cover the ring exactly: lengths add up to the perimeter, gaps are width + kerf long", () => {
    for (const ring of [rect(100, 50), circle(30), [[0, 0], [60, 0], [60, 20], [30, 20], [30, 60], [0, 60]] as Ring]) {
      const g = gapLength(0.8, 0.2);
      const plan = placeBridges(ring, P({ bridgeWidth: 0.8, kerf: 0.2, bridgeCount: 3 }))!;
      const sp = splitRing(ring, plan.centers, g)!;
      expect(sp.gaps).toHaveLength(3);
      expect(sp.cut).toHaveLength(3);
      for (const gp of sp.gaps) expect(polylineLength(gp)).toBeCloseTo(g, 6);
      const cutLen = sp.cut.reduce((s, l) => s + polylineLength(l), 0);
      expect(cutLen).toBeCloseTo(perimeter(ring) - 3 * g, 6);
      // continuity: gap k ends where cut k starts, cut k ends where gap k+1 starts
      sp.gaps.forEach((gp, k) => {
        const c = sp.cut[k], next = sp.gaps[(k + 1) % 3];
        expect(Math.hypot(gp[gp.length - 1][0] - c[0][0], gp[gp.length - 1][1] - c[0][1])).toBeLessThan(1e-9);
        expect(Math.hypot(c[c.length - 1][0] - next[0][0], c[c.length - 1][1] - next[0][1])).toBeLessThan(1e-9);
      });
    }
  });

  it("holes only with bridgeHoles; dowel holes never; outer ring first", () => {
    const hole = rect(30, 30).reverse().map(([x, y]) => [x + 35, y + 35] as Vec2); // CW
    const p = part(rect(100, 100), [hole], [{ c: [10, 10], d: 6 }, { c: [90, 90], d: 40 }]);
    const off = addBridges([p], P()).parts[0];
    expect(off.bridges!.map((b) => b.ring)).toEqual([0]);
    const on = addBridges([p], P({ bridgeHoles: true })).parts[0];
    expect(on.bridges!.map((b) => b.ring)).toEqual([0, 1]);
    expect(on.holes).toEqual(p.holes); // dowel holes stay plain circles
    expect(on.cut).toBe(p.cut); // the closed shape is untouched (hit-testing, area)
    // a small hole (perimeter 24 < 40) is skipped even with bridgeHoles
    const small = part(rect(100, 100), [rect(6, 6).reverse().map(([x, y]) => [x + 20, y + 20] as Vec2)]);
    expect(addBridges([small], P({ bridgeHoles: true })).parts[0].bridges!.map((b) => b.ring)).toEqual([0]);
  });

  it("disabled: parts come back untouched; too-short outlines give one info warning", () => {
    const p = part(rect(100, 100));
    const r0 = addBridges([p], P({ bridgesEnabled: false }));
    expect(r0.parts[0]).toBe(p);
    expect(r0.warnings).toEqual([]);
    const r1 = addBridges([part(rect(5, 5)), part(rect(6, 6))], P());
    expect(r1.warnings).toHaveLength(1);
    expect(r1.warnings[0].level).toBe("info");
    expect(r1.parts[0].bridges).toBeUndefined();
  });

  it("applyPlacement moves and turns the bridge data with the part", () => {
    const p = addBridges([part(rect(100, 50), [], [])], P({ bridgeCount: 3 })).parts[0];
    const placed = applyPlacement(p, { x: 40, y: -7, angleDeg: 37 });
    const a = cutPaths(p), b = cutPaths(placed);
    expect(b.gaps).toHaveLength(a.gaps.length);
    a.gaps.forEach((g, i) => {
      expect(polylineLength(b.gaps[i])).toBeCloseTo(polylineLength(g), 6);
      const t = transformPoints(g, 37, 40, -7);
      t.forEach((q, k) => {
        expect(q[0]).toBeCloseTo(b.gaps[i][k][0], 6);
        expect(q[1]).toBeCloseTo(b.gaps[i][k][1], 6);
      });
    });
    // all bridge points lie on the placed (closed) outline
    const outer = placed.cut.outer;
    for (const g of b.gaps) for (const q of g) {
      let d = Infinity;
      for (let i = 0; i < outer.length; i++) {
        const u = outer[i], v = outer[(i + 1) % outer.length];
        const L2 = (v[0] - u[0]) ** 2 + (v[1] - u[1]) ** 2;
        const t = Math.max(0, Math.min(1, ((q[0] - u[0]) * (v[0] - u[0]) + (q[1] - u[1]) * (v[1] - u[1])) / L2));
        d = Math.min(d, Math.hypot(q[0] - u[0] - t * (v[0] - u[0]), q[1] - u[1] - t * (v[1] - u[1])));
      }
      expect(d).toBeLessThan(1e-6);
    }
    expect(shapeArea(placed.cut)).toBeCloseTo(shapeArea(p.cut), 6);
  });
});

describe("export", () => {
  const ring = rect(100, 50);
  const g = gapLength(0.5, 0.15);
  const bp = addBridges([part(ring, [], [{ c: [50, 25], d: 6 }])], P({ bridgeCount: 3 })).parts[0];
  const per = perimeter(ring);
  const drawing = sheetDrawing([bp], [{ partId: bp.id, sheet: 0, x: 10, y: 20, angleDeg: 90 }], 0, 600, 400);
  const lens = (ents: any[]) => ents.reduce((s, e) => s + polylineLength(e.vertices.map((v: any) => [v.x, v.y] as Vec2)), 0);

  it("DXF: CUT polylines are open with total length perimeter - gaps; BRIDGE holds exactly the gaps", () => {
    const dxf = new DxfParser().parseSync(writeDxf(drawing))!;
    const ents = dxf.entities as any[];
    const cut = ents.filter((e) => e.layer === "CUT" && e.type === "POLYLINE");
    const bridge = ents.filter((e) => e.layer === "BRIDGE");
    expect(cut).toHaveLength(3);
    for (const e of cut) expect(e.shape).toBe(false); // flag 70 = 0: open
    expect(bridge).toHaveLength(3);
    for (const e of bridge) expect(e.shape).toBe(false);
    expect(lens(cut)).toBeCloseTo(per - 3 * g, 3);
    expect(lens(bridge)).toBeCloseTo(3 * g, 3);
    expect(ents.filter((e) => e.type === "CIRCLE")).toHaveLength(1); // dowel hole untouched
    const layers = (dxf.tables as any).layer.layers;
    expect(layers.BRIDGE.colorIndex).toBe(6);
  });

  it("DXF: excluding BRIDGE removes the entities, the CUT polylines stay open (uncut tabs); excluding CUT keeps BRIDGE", () => {
    const ents = (t: string) => (new DxfParser().parseSync(t)!.entities as any[]);
    const noBridge = ents(writeDxf(drawing, { layers: { bridge: false } }));
    expect(noBridge.filter((e) => e.layer === "BRIDGE")).toHaveLength(0);
    const cut = noBridge.filter((e) => e.layer === "CUT" && e.type === "POLYLINE");
    expect(cut).toHaveLength(3);
    expect(lens(cut)).toBeCloseTo(per - 3 * g, 3);
    const noCut = ents(writeDxf(drawing, { layers: { cut: false } }));
    expect(noCut.filter((e) => e.layer === "CUT")).toHaveLength(0);
    expect(noCut.filter((e) => e.layer === "BRIDGE")).toHaveLength(3);
  });

  it("an unbridged drawing has no BRIDGE entities and a closed CUT ring (unchanged behaviour)", () => {
    const plain = drawingOf([part(ring)], 600, 400);
    const ents = new DxfParser().parseSync(writeDxf(plain))!.entities as any[];
    expect(ents.filter((e) => e.layer === "BRIDGE")).toHaveLength(0);
    expect(ents.filter((e) => e.layer === "CUT")[0].shape).toBe(true);
    expect(writeSvg(plain)).not.toContain("BRIDGE");
  });

  it("SVG: group BRIDGE with the gaps, omitted when excluded", () => {
    const svg = writeSvg(drawing);
    expect(svg).toMatch(/<g id="BRIDGE" stroke="#d000d0"/);
    expect((svg.match(/<g id="BRIDGE"[\s\S]*?<\/g>/)![0].match(/<path /g) ?? []).length).toBe(3);
    expect(writeSvg(drawing, { bridge: false })).not.toContain('id="BRIDGE"');
  });

  function recorded(o: Parameters<typeof paintDrawing>[3]) {
    const calls: string[] = [];
    const ctx: any = new Proxy({ canvas: { width: 1200, height: 800 } }, {
      get: (t, k: string) => (k in t ? (t as any)[k] : (...a: unknown[]) => void calls.push(`${k}(${a.length})`)),
      set: (_t, k: string, v) => (calls.push(`${k}=${v}`), true),
    });
    paintDrawing(ctx, drawing, 2, o, 800);
    return calls;
  }
  it("raster outline draws bridges magenta unless excluded; filled images ignore them", () => {
    expect(recorded({ dpi: 50, style: "outline", engrave: false })).toContain("strokeStyle=#d000d0");
    expect(recorded({ dpi: 50, style: "outline", engrave: false, bridge: false })).not.toContain("strokeStyle=#d000d0");
    const filled = recorded({ dpi: 50, style: "filled", engrave: false });
    expect(filled).not.toContain("strokeStyle=#d000d0");
    expect(filled).toContain("fill(1)"); // whole part filled
  });

  it("README mentions BRIDGE only when bridges are enabled", async () => {
    const r = await slice(box(60, 60, 8), { thickness: 4, bridgesEnabled: true });
    const txt = buildReadme(r, settings({ bridgesEnabled: true }), "m", []);
    expect(txt).toMatch(/Holding bridges: \d+/);
    expect(txt).toMatch(/BRIDGE \(magenta\)/);
    expect(buildReadme(r, settings({ bridgesEnabled: true, exportBridge: false }), "m", [])).toMatch(/BRIDGE is not included/);
    expect(buildReadme(r, settings(), "m", [])).not.toMatch(/BRIDGE/);
  });
});

describe("pipeline stage", () => {
  it("produces bridges after kerf, with the gap = width + kerf; material use and part shapes unchanged", async () => {
    const off = await slice(box(60, 40, 8), { thickness: 4, kerf: 0.2 });
    const on = await slice(box(60, 40, 8), { thickness: 4, kerf: 0.2, bridgesEnabled: true, bridgeCount: 4, bridgeWidth: 0.6 });
    expect(on.parts).toHaveLength(off.parts.length);
    for (const [i, p] of on.parts.entries()) {
      expect(p.cut).toEqual(off.parts[i].cut);
      expect(p.bridges).toHaveLength(1);
      expect(p.bridges![0].gaps).toHaveLength(4);
      for (const gp of p.bridges![0].gaps) expect(polylineLength(gp)).toBeCloseTo(0.8, 6);
    }
    expect(on.sheets.map((s) => s.usePct)).toEqual(off.sheets.map((s) => s.usePct));
    expect(on.placements).toEqual(off.placements);
  });

  it("changing bridge settings re-runs only the bridge stage (no slice, kerf, registration or nesting)", async () => {
    const { mesh, stats } = weld(box(60, 40, 8));
    const p = new Pipeline();
    p.setMesh(mesh, stats);
    await p.run(settings({ thickness: 4, bridgesEnabled: true }));
    const base = { ...p.runs };
    expect(base.bridges).toBe(1);
    await p.run(settings({ thickness: 4, bridgesEnabled: true, bridgeWidth: 0.8 }));
    expect(p.runs).toEqual({ ...base, bridges: 2 });
    await p.run(settings({ thickness: 4, bridgesEnabled: true, bridgeWidth: 0.8, bridgeCount: 4, bridgeHoles: true, bridgeMinLength: 60, bridgeMaxSpacing: 50 }));
    expect(p.runs).toEqual({ ...base, bridges: 3 });
    await p.run(settings({ thickness: 4, bridgesEnabled: false }));
    expect(p.runs).toEqual({ ...base, bridges: 3 });
    const r = (await p.run(settings({ thickness: 4, bridgesEnabled: false })))!;
    expect(r.parts.every((q) => !q.bridges)).toBe(true);
  });
});
