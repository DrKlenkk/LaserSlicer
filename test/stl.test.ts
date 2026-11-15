import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { buildStackedStl, stackedTriangles, writeBinaryStl } from "../src/core/export/stl";
import { buildReadme, buildZip } from "../src/core/export/zip";
import { slicingKey } from "../src/updateController";
import { box, uvSphere } from "./fixtures/meshes";
import { settings, slice } from "./helpers";
import { DEFAULT_SETTINGS, parseProject, serializeProject } from "../src/state";
import type { RunResult } from "../src/core/pipeline";

function parse(bytes: Uint8Array) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = dv.getUint32(80, true);
  const tris: number[][] = [];
  for (let i = 0; i < n; i++) {
    const o = 84 + i * 50;
    const f = (k: number) => dv.getFloat32(o + 4 * k, true);
    tris.push([f(0), f(1), f(2), f(3), f(4), f(5), f(6), f(7), f(8), f(9), f(10), f(11)]);
  }
  return { n, tris, length: bytes.length };
}

function bounds(tris: number[][]) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (let v = 0; v < 3; v++) for (let a = 0; a < 3; a++) {
    min[a] = Math.min(min[a], t[3 + v * 3 + a]);
    max[a] = Math.max(max[a], t[3 + v * 3 + a]);
  }
  return { min, max };
}

/** Every undirected edge must be used by exactly two triangles, once in each direction (closed, consistently oriented surface). */
function edgeStats(tris: number[][]) {
  const q = (x: number) => Math.round(x * 1000);
  const key = (t: number[], v: number) => `${q(t[3 + v * 3])},${q(t[4 + v * 3])},${q(t[5 + v * 3])}`;
  const dir = new Map<string, number>();
  for (const t of tris) for (let v = 0; v < 3; v++) {
    const k = `${key(t, v)}>${key(t, (v + 1) % 3)}`;
    dir.set(k, (dir.get(k) ?? 0) + 1);
  }
  let open = 0, twice = 0;
  for (const [k, c] of dir) {
    const [a, b] = k.split(">");
    if (c > 1) twice++;
    if (dir.get(`${b}>${a}`) !== c) open++;
  }
  return { open, twice };
}

/** Signed volume (positive when the surface is outward oriented). */
function volume(tris: number[][]) {
  let v = 0;
  for (const t of tris) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = t.slice(3);
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return v;
}

describe("binary STL writer", () => {
  it("writes header, count and 50 bytes per triangle with unit normals", () => {
    const bytes = writeBinaryStl(Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]));
    expect(bytes.length).toBe(84 + 50);
    const p = parse(bytes);
    expect(p.n).toBe(1);
    expect(p.tris[0].slice(0, 3)).toEqual([0, 0, 1]);
  });
});

describe("stacked STL of a result", () => {
  it("is non-empty, closed and sized like the model (box)", async () => {
    const r = await slice(box(30, 20, 40), { kerf: 0, thickness: 4 });
    const p = parse(buildStackedStl(r));
    expect(p.n).toBeGreaterThan(0);
    expect(p.length).toBe(84 + 50 * p.n);
    const b = bounds(p.tris);
    expect(b.max[0] - b.min[0]).toBeCloseTo(30, 2);
    expect(b.max[1] - b.min[1]).toBeCloseTo(20, 2);
    expect(b.min[2]).toBeCloseTo(0, 6);
    expect(b.max[2]).toBeCloseTo(r.info.layerCount * 4, 4);
    expect(edgeStats(p.tris).open).toBe(0); // consecutive layers share coincident faces, so edges repeat; none is open
    expect(volume(p.tris)).toBeCloseTo(30 * 20 * 4 * r.info.layerCount, 0);
  });

  it("is watertight for a sphere and its bounding box matches the model", async () => {
    const r = await slice(uvSphere(20, 24, 36), { kerf: 0, thickness: 2, mode: "oversize" });
    const p = parse(buildStackedStl(r));
    const b = bounds(p.tris);
    // oversize layers cover the sphere: at least its extent, at most one layer more on every side of z
    expect(b.max[0] - b.min[0]).toBeGreaterThan(39);
    expect(b.max[0] - b.min[0]).toBeLessThan(42);
    expect(b.max[2]).toBeGreaterThanOrEqual(40 - 1e-3);
    expect(edgeStats(p.tris).open).toBe(0);
    expect(volume(p.tris)).toBeGreaterThan(0);
  });

  it("includes hollow cavities and dowel holes (less volume than solid, still closed)", async () => {
    const solid = await slice(box(60, 60, 40), { kerf: 0, thickness: 4 });
    const hollow = await slice(box(60, 60, 40), { kerf: 0, thickness: 4, hollowEnabled: true, hollowWall: 8, dowels: true, dowelDiameter: 4 });
    const a = parse(buildStackedStl(solid)), b = parse(buildStackedStl(hollow));
    expect(volume(b.tris)).toBeLessThan(volume(a.tris) - 1000);
    expect(edgeStats(b.tris).open).toBe(0);
  });

  it("follows the layer range", async () => {
    const r = await slice(box(30, 20, 40), { kerf: 0, thickness: 4, rangeFrom: 2, rangeTo: 3 });
    const b = bounds(parse(buildStackedStl(r)).tris);
    expect(b.min[2]).toBeCloseTo(8, 4);
    expect(b.max[2]).toBeCloseTo(16, 4);
  });

  it("a single layer with a hole and a dowel hole is a proper 2-manifold of the right volume", () => {
    const sq = (x: number, y: number, w: number): [number, number][] => [[x, y], [x + w, y], [x + w, y + w], [x, y + w]];
    const r = {
      layers: [{ index: 0, z0: 0, z1: 4, shapes: [] }],
      parts: [{ id: "L000", layer: 0, cut: { outer: sq(0, 0, 40), holes: [sq(10, 10, 10).reverse()] }, engrave: [], label: [], holes: [{ c: [30, 30], d: 6 }] }],
      info: { range: { from: 0, to: 0, all: true, clamped: false } },
    } as unknown as RunResult;
    const p = parse(buildStackedStl(r));
    expect(edgeStats(p.tris)).toEqual({ open: 0, twice: 0 });
    const circleArea = 0.5 * 32 * 3 * 3 * Math.sin((2 * Math.PI) / 32);
    expect(volume(p.tris)).toBeCloseTo((1600 - 100 - circleArea) * 4, 3);
    expect(p.n).toBeGreaterThan(40);
  });

  it("is empty (zero triangles) without parts", () => {
    const r = { layers: [], parts: [], info: { range: { from: 0, to: -1, all: true, clamped: false } } } as unknown as RunResult;
    expect(stackedTriangles(r).length).toBe(0);
    expect(parse(buildStackedStl(r)).n).toBe(0);
  });
});

describe("exportStl setting", () => {
  it("defaults off, is export-only and a valid project value", () => {
    expect(DEFAULT_SETTINGS.exportStl).toBe(false);
    expect(slicingKey(settings({ exportStl: true }))).toBe(slicingKey(settings()));
    expect(parseProject(serializeProject(settings({ exportStl: true }))).exportStl).toBe(true);
    expect(() => parseProject(JSON.stringify({ format: "laser-slicer-project", settings: { exportStl: "yes" } }))).toThrow(/exportStl/);
  });
  it("the ZIP carries stacked.stl and the README names it", async () => {
    const r = await slice(box(30, 20, 40));
    const files = [{ name: "stacked.stl", mime: "model/stl", bytes: buildStackedStl(r) }];
    const zip = unzipSync(buildZip(files, buildReadme(r, settings({ exportStl: true }), "m", files)));
    expect(Object.keys(zip)).toContain("stacked.stl");
    expect(new TextDecoder().decode(zip["README.txt"])).toContain("stacked.stl is the glued stack");
  });
});
