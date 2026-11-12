import { describe, it, expect } from "vitest";
import { AXIS_ROTATIONS, applyMat, det, effectiveScale, orientationMatrix, orientMesh } from "../src/core/transform";
import { weldSoup } from "../src/core/mesh";
import { box, toSoup } from "./fixtures/meshes";
import type { Axis, Settings } from "../src/core/types";

const base: Pick<Settings, "axis" | "rotationSteps" | "scale" | "targetSize"> = {
  axis: "+Z",
  rotationSteps: [0, 0, 0],
  scale: 1,
  targetSize: null,
};
const dirs: Record<Axis, [number, number, number]> = {
  "+X": [1, 0, 0], "-X": [-1, 0, 0], "+Y": [0, 1, 0], "-Y": [0, -1, 0], "+Z": [0, 0, 1], "-Z": [0, 0, -1],
};
const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));
// a 10 x 20 x 30 box, so every axis gives a distinct oriented size
const slab = () => weldSoup(toSoup(box(10, 20, 30))).mesh;

describe("axis rotation", () => {
  for (const axis of Object.keys(dirs) as Axis[]) {
    it(`${axis} maps to +Z with det +1`, () => {
      expect(det(AXIS_ROTATIONS[axis])).toBeCloseTo(1, 12);
      close(applyMat(AXIS_ROTATIONS[axis], dirs[axis]), [0, 0, 1]);
    });
  }

  it("oriented size follows the chosen axis", () => {
    const size = (axis: Axis) => orientMesh(slab(), { ...base, axis }).size.map((v) => Math.round(v));
    expect(size("+Z")[2]).toBe(30);
    expect(size("-Z")[2]).toBe(30);
    expect(size("+X")[2]).toBe(10);
    expect(size("-X")[2]).toBe(10);
    expect(size("+Y")[2]).toBe(20);
    expect(size("-Y")[2]).toBe(20);
  });

  it("-Z flips the model upside down", () => {
    // a point on the original top face ends up at the bottom
    const m = orientMesh(slab(), { ...base, axis: "-Z" });
    expect(m.mesh.bbox.min[2]).toBeCloseTo(0, 6);
  });

  it("90 degree steps compose and wrap at 4", () => {
    close(orientationMatrix("+Z", [4, 4, 4]), orientationMatrix("+Z", [0, 0, 0]));
    // one Z step turns +X into +Y
    close(applyMat(orientationMatrix("+Z", [0, 0, 1]), [1, 0, 0]), [0, 1, 0]);
    // one X step turns +Y into +Z
    close(applyMat(orientationMatrix("+Z", [1, 0, 0]), [0, 1, 0]), [0, 0, 1]);
    // one Y step turns +Z into +X
    close(applyMat(orientationMatrix("+Z", [0, 1, 0]), [0, 0, 1]), [1, 0, 0]);
    expect(det(orientationMatrix("+X", [1, 3, 2]))).toBeCloseTo(1, 12);
  });

  it("an X step swaps the Y and Z extents", () => {
    const s = orientMesh(slab(), { ...base, rotationSteps: [1, 0, 0] }).size.map((v) => Math.round(v));
    expect(s).toEqual([10, 30, 20]);
  });
});

describe("translate and scale", () => {
  it("translates min Z to 0 for every axis", () => {
    for (const axis of Object.keys(dirs) as Axis[]) {
      const o = orientMesh(slab(), { ...base, axis });
      expect(o.mesh.bbox.min[2]).toBeCloseTo(0, 5);
    }
  });

  it("uniform scale multiplies the size", () => {
    const o = orientMesh(slab(), { ...base, scale: 2.5 });
    expect(o.scale).toBe(2.5);
    expect(o.size[0]).toBeCloseTo(25, 4);
    expect(o.size[1]).toBeCloseTo(50, 4);
    expect(o.size[2]).toBeCloseTo(75, 4);
  });

  it("targetSize scales one dimension and keeps proportions", () => {
    const o = orientMesh(slab(), { ...base, targetSize: { dim: "y", mm: 100 } });
    expect(o.scale).toBeCloseTo(5, 9);
    expect(o.size[0]).toBeCloseTo(50, 3);
    expect(o.size[1]).toBeCloseTo(100, 3);
    expect(o.size[2]).toBeCloseTo(150, 3);
  });

  it("targetSize is relative to the oriented size", () => {
    const o = orientMesh(slab(), { ...base, axis: "+X", targetSize: { dim: "z", mm: 50 } }); // z extent is 10 here
    expect(o.size[2]).toBeCloseTo(50, 3);
    expect(o.scale).toBeCloseTo(5, 9);
  });

  it("effectiveScale falls back to scale for invalid targets", () => {
    expect(effectiveScale({ scale: 2, targetSize: { dim: "x", mm: 0 } }, [10, 10, 10])).toBe(2);
    expect(effectiveScale({ scale: 0, targetSize: null }, [10, 10, 10])).toBe(1);
  });

  it("does not modify the input mesh", () => {
    const m = slab();
    const before = m.positions.slice();
    orientMesh(m, { ...base, axis: "+X", scale: 3 });
    expect(Array.from(m.positions)).toEqual(Array.from(before));
  });
});
