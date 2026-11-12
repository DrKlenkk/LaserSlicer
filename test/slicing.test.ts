import { describe, expect, it } from "vitest";
import { shapeArea, shapesArea, ringArea } from "../src/core/poly";
import { nudgeHeight, prepareMesh, slicePlane } from "../src/core/slice";
import { cube20, invertedCube, openCube, torus, uvSphere, vertexOnPlane, VERTEX_ON_PLANE_Z, box } from "./fixtures/meshes";
import { slice, weld } from "./helpers";

const layerArea = (r: Awaited<ReturnType<typeof slice>>, i: number) => shapesArea(r.layers[i].shapes);

describe("cube", () => {
  it("t = 4 gives 5 layers of 400 mm2", async () => {
    const r = await slice(cube20(), { thickness: 4 });
    expect(r.layers).toHaveLength(5);
    for (const l of r.layers) {
      expect(shapesArea(l.shapes)).toBeCloseTo(400, 2);
      expect(Math.abs(shapesArea(l.shapes) - 400)).toBeLessThan(0.01);
      expect(l.shapes).toHaveLength(1);
    }
    expect(r.parts.map((p) => p.id)).toEqual(["L000", "L001", "L002", "L003", "L004"]);
    expect(r.warnings.filter((w) => w.level !== "info")).toEqual([]);
  });

  it("outer is CCW", async () => {
    const r = await slice(cube20());
    expect(ringArea(r.layers[0].shapes[0].outer)).toBeGreaterThan(0);
  });

  it("overshoot and layer count for a height that is not a multiple", async () => {
    const r = await slice(box(20, 20, 21), { thickness: 4 });
    expect(r.info.layerCount).toBe(6);
    expect(r.info.overshoot).toBeCloseTo(3, 6);
  });

  it("roundHeightToLayers rescales to a whole number of layers", async () => {
    const r = await slice(box(20, 20, 21), { thickness: 4, roundHeightToLayers: true });
    expect(r.info.layerCount).toBe(5); // 21/4 = 5.25 -> 5 layers = 20 mm
    expect(r.info.height).toBeCloseTo(20, 4);
    expect(r.info.scale).toBeCloseTo(20 / 21, 6);
    expect(r.info.overshoot).toBeCloseTo(0, 4);
  });
});

describe("sphere", () => {
  it("mid-plane area within 1% of pi(r2 - z2)", async () => {
    const t = 4;
    const r = await slice(uvSphere(), { thickness: t, mode: "midplane" });
    expect(r.layers).toHaveLength(5);
    r.layers.forEach((l, i) => {
      const z = (i + 0.5) * t - 10; // height above the centre
      const truth = Math.PI * (100 - z * z);
      expect(Math.abs(shapesArea(l.shapes) / truth - 1)).toBeLessThan(0.01);
    });
  });

});

describe("torus", () => {
  it("horizontal cut through the middle is one shape with exactly one hole", async () => {
    const r = await slice(torus(), { thickness: 10, mode: "midplane" });
    expect(r.layers).toHaveLength(1);
    const shapes = r.layers[0].shapes;
    expect(shapes).toHaveLength(1);
    expect(shapes[0].holes).toHaveLength(1);
    // annulus between R - r = 15 and R + r = 25
    expect(shapeArea(shapes[0])).toBeGreaterThan(Math.PI * (625 - 225) * 0.99);
    expect(shapeArea(shapes[0])).toBeLessThan(Math.PI * (625 - 225) * 1.01);
    expect(ringArea(shapes[0].holes[0])).toBeLessThan(0); // holes are CW
  });
});

describe("broken meshes", () => {
  it("open mesh: closed outline plus one warning naming the layer", async () => {
    const r = await slice(openCube(), { thickness: 4, mode: "midplane" });
    const warned = new Set(r.warnings.filter((w) => w.level === "warn" && w.layer !== undefined).map((w) => w.layer));
    expect(warned.size).toBeGreaterThan(0);
    for (const l of r.layers) {
      expect(l.shapes).toHaveLength(1);
      expect(shapesArea(l.shapes)).toBeCloseTo(400, 1);
    }
    for (const layer of warned) {
      const ws = r.warnings.filter((w) => w.layer === layer);
      expect(ws).toHaveLength(1);
      expect(ws[0].message).toContain(`layer ${layer}`);
    }
  });

  it("inverted normals give the same areas as the cube", async () => {
    const good = await slice(cube20(), { thickness: 4 });
    const bad = await slice(invertedCube(), { thickness: 4 });
    expect(bad.layers).toHaveLength(5);
    bad.layers.forEach((l, i) => expect(shapesArea(l.shapes)).toBeCloseTo(layerArea(good, i), 2));
  });

  it("vertex on the plane: no crash, no zero-length segments, correct area", async () => {
    const { mesh } = weld(vertexOnPlane());
    const prep = prepareMesh(mesh);
    const z = nudgeHeight(prep, VERTEX_ON_PLANE_Z);
    expect(z).not.toBe(VERTEX_ON_PLANE_Z);
    const res = slicePlane(prep, z);
    expect(res.rings).toHaveLength(1);
    for (const ring of res.rings)
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThan(0);
      }
    expect(Math.abs(ringArea(res.rings[0]))).toBeCloseTo(50, 2);

    const r = await slice(vertexOnPlane(), { thickness: 8, mode: "midplane" });
    expect(shapesArea(r.layers[0].shapes)).toBeCloseTo(50, 1);
  });

  it("planes exactly through the vertices work even without the nudge", () => {
    const { mesh } = weld(vertexOnPlane());
    const prep = prepareMesh(mesh);
    expect(() => slicePlane(prep, VERTEX_ON_PLANE_Z)).not.toThrow();
  });
});
