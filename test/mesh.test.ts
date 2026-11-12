import { describe, it, expect } from "vitest";
import { buildMesh, computeBBox, edgeStats, weldSoup, bboxDiagonal } from "../src/core/mesh";
import { FIXTURES, cube20, finMesh, toSoup, uvSphere, signedVolume, openCube, torus } from "./fixtures/meshes";

describe("fixtures", () => {
  for (const [name, f] of Object.entries(FIXTURES)) {
    it(`${name} builds and has expected closedness`, () => {
      const raw = f.make();
      const { mesh, stats } = buildMesh(toSoup(raw));
      expect(stats.triangles).toBe(raw.indices.length / 3);
      expect(stats.degenerateRemoved).toBe(0);
      expect(mesh.positions.length / 3).toBe(stats.vertices);
      // welded vertex count equals the generator's vertex count
      expect(stats.vertices).toBe(raw.positions.length / 3);
      expect(stats.nonManifoldEdges).toBe(0);
      if (f.closed) expect(stats.openEdges).toBe(0);
      else expect(stats.openEdges).toBeGreaterThan(0);
    });
  }

  it("generators produce outward-facing meshes with the right volume", () => {
    expect(signedVolume(cube20())).toBeCloseTo(8000, 3);
    const r = 10;
    expect(signedVolume(uvSphere(r))).toBeGreaterThan(0.98 * (4 / 3) * Math.PI * r ** 3);
    expect(signedVolume(uvSphere(r))).toBeLessThan((4 / 3) * Math.PI * r ** 3);
    expect(signedVolume(torus(20, 5))).toBeGreaterThan(0.98 * 2 * Math.PI ** 2 * 20 * 25);
    expect(signedVolume(FIXTURES.invertedCube.make())).toBeCloseTo(-8000, 3);
  });
});

describe("welding", () => {
  it("merges a cube soup (36 vertices) into 8 vertices and 12 triangles", () => {
    const { mesh, degenerateRemoved } = weldSoup(toSoup(cube20()));
    expect(mesh.positions.length / 3).toBe(8);
    expect(mesh.indices.length / 3).toBe(12);
    expect(degenerateRemoved).toBe(0);
  });

  it("welds vertices within 1e-5 x diagonal but not beyond", () => {
    const soup = toSoup(cube20());
    const diag = bboxDiagonal(computeBBox(soup));
    const near = soup.slice();
    // nudge every second triangle's vertices by 0.4 tolerance in each axis
    for (let i = 0; i < near.length; i++) if (Math.floor(i / 9) % 2) near[i] += 0.4e-5 * diag * (i % 3 === 0 ? 1 : -1) / Math.sqrt(3);
    expect(weldSoup(near).mesh.positions.length / 3).toBe(8);

    const far = soup.slice();
    for (let i = 0; i < far.length; i++) if (Math.floor(i / 9) % 2) far[i] += 5e-5 * diag;
    expect(weldSoup(far).mesh.positions.length / 3).toBeGreaterThan(8);
  });

  it("welds across spatial hash cell boundaries", () => {
    // two vertices straddling a cell boundary, closer than tol
    const diag = Math.hypot(10, 10, 0);
    const tol = diag * 1e-5;
    const x = Math.round(5 / tol) * tol; // a grid-cell boundary
    const soup = new Float32Array([
      0, 0, 0, 10, 0, 0, x - tol * 0.1, 10, 0,
      x + tol * 0.1, 10, 0, 10, 0, 0, 10, 10, 0,
    ]);
    // 6 vertices in; the two straddling the boundary and the repeated (10,0,0) merge: 4 unique
    expect(weldSoup(soup).mesh.positions.length / 3).toBe(4);
  });

  it("drops triangles that collapse when welded", () => {
    const soup = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 5, 5, 5, 5, 5, 6, 5, 5, 0, 0, 0, 0, 0, 0, 0, 1, 0]);
    const { mesh, degenerateRemoved } = weldSoup(soup);
    expect(mesh.indices.length / 3).toBe(1);
    expect(degenerateRemoved).toBe(2);
  });

  it("rejects soup whose length is not a multiple of 9", () => {
    expect(() => weldSoup(new Float32Array(10))).toThrow();
  });
});

describe("bbox", () => {
  it("computes min/max", () => {
    const b = computeBBox(new Float32Array([1, 2, 3, -4, 5, 0, 2, -1, 9]));
    expect(b.min).toEqual([-4, -1, 0]);
    expect(b.max).toEqual([2, 5, 9]);
  });
  it("cube bbox is 20 mm", () => {
    const { mesh } = weldSoup(toSoup(cube20()));
    expect(mesh.bbox.min).toEqual([-10, -10, -10]);
    expect(mesh.bbox.max).toEqual([10, 10, 10]);
  });
});

describe("edge statistics", () => {
  it("closed cube: no open edges", () => {
    const { mesh } = weldSoup(toSoup(cube20()));
    expect(edgeStats(mesh.indices, mesh.positions.length / 3)).toEqual({ openEdges: 0, nonManifoldEdges: 0 });
  });
  it("cube with one triangle removed: 3 open edges", () => {
    const { stats } = buildMesh(toSoup(openCube()));
    expect(stats.openEdges).toBe(3);
    expect(stats.triangles).toBe(11);
  });
  it("fin with three triangles on one edge: 1 non-manifold edge, 6 open edges", () => {
    const { stats } = buildMesh(toSoup(finMesh()));
    expect(stats.nonManifoldEdges).toBe(1);
    expect(stats.openEdges).toBe(6);
  });
});
