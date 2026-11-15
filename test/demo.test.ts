import { describe, expect, it } from "vitest";
import { buildDemoStl, DEMO_FILE_NAME } from "../src/core/demo";
import { parseToSoup } from "../src/core/loaders";
import { buildMesh } from "../src/core/mesh";
import { Pipeline } from "../src/core/pipeline";
import { settings } from "./helpers";

function load() {
  const bytes = buildDemoStl();
  const soup = parseToSoup(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, "stl");
  return { bytes, ...buildMesh(soup) };
}

describe("demo model", () => {
  it("is a deterministic binary STL of a few dozen KB at most", () => {
    const a = buildDemoStl(), b = buildDemoStl();
    expect(a).toEqual(b);
    const dv = new DataView(a.buffer);
    expect(a.length).toBe(84 + dv.getUint32(80, true) * 50);
    expect(a.length).toBeLessThan(100_000);
    expect(DEMO_FILE_NAME).toBe("demo-part.stl");
  });

  it("is a closed 2-manifold with the intended size", () => {
    const { mesh, stats } = load();
    expect(stats.openEdges).toBe(0);
    expect(stats.nonManifoldEdges).toBe(0);
    expect(stats.degenerateRemoved).toBe(0);
    const [x0, y0, z0, x1, y1, z1] = [mesh.bbox.min[0], mesh.bbox.min[1], mesh.bbox.min[2], mesh.bbox.max[0], mesh.bbox.max[1], mesh.bbox.max[2]];
    expect([x1 - x0, y1 - y0, z1 - z0].map((v) => +v.toFixed(3))).toEqual([70, 70, 40]);
  });

  it("is consistently oriented outwards (positive enclosed volume, every edge used once per direction)", () => {
    const { mesh } = load();
    const p = mesh.positions, ix = mesh.indices;
    let vol = 0;
    const dir = new Map<string, number>();
    for (let t = 0; t < ix.length; t += 3) {
      const [a, b, c] = [ix[t], ix[t + 1], ix[t + 2]];
      const A = [p[a * 3], p[a * 3 + 1], p[a * 3 + 2]], B = [p[b * 3], p[b * 3 + 1], p[b * 3 + 2]], C = [p[c * 3], p[c * 3 + 1], p[c * 3 + 2]];
      vol += (A[0] * (B[1] * C[2] - B[2] * C[1]) - A[1] * (B[0] * C[2] - B[2] * C[0]) + A[2] * (B[0] * C[1] - B[1] * C[0])) / 6;
      for (const [u, v] of [[a, b], [b, c], [c, a]]) dir.set(`${u}>${v}`, (dir.get(`${u}>${v}`) ?? 0) + 1);
    }
    for (const [k, n] of dir) {
      const [u, v] = k.split(">");
      expect(n, k).toBe(1);
      expect(dir.get(`${v}>${u}`), k).toBe(1);
    }
    // base 70x70 (rounded corners) x 12 + tower, minus the hole: roughly 70*70*12 + pi*20^2*20 + cone - pi*6^2*40
    expect(vol).toBeGreaterThan(70_000);
    expect(vol).toBeLessThan(95_000);
  });

  it("slices with default settings into 10 layers with a hole in each and an engrave line at the step", async () => {
    const { mesh, stats } = load();
    const pl = new Pipeline();
    pl.setMesh(mesh, stats);
    const t0 = Date.now();
    const r = await pl.run(settings());
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(r!.layers.length).toBe(10);
    for (const l of r!.layers) {
      expect(l.shapes.length, `layer ${l.index}`).toBe(1);
      expect(l.shapes[0].holes.length, `layer ${l.index}`).toBe(1);
    }
    expect(r!.parts.length).toBe(10);
    expect(r!.parts.find((q) => q.layer === 2)!.engrave.length).toBeGreaterThan(0); // the step: layer 3 is smaller than layer 2
    expect(r!.parts.find((q) => q.layer === 0)!.engrave.length).toBe(0); // same outline as the next layer: nothing to engrave
    expect(r!.sheets.length).toBe(1);
  });
});
