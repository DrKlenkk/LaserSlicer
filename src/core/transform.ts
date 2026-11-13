// Orientation (slicing axis -> +Z, 90 degree steps), scaling, and drop to Z = 0.
import type { Axis, Dim, Mesh, Settings } from "./types";
import { bboxSize, computeBBox } from "./mesh";
import { importUnitFactor } from "./units";

/** Row-major 3x3 rotation matrix. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Proper rotations (det = +1) that map the given axis direction onto +Z. */
export const AXIS_ROTATIONS: Record<Axis, Mat3> = {
  "+Z": IDENTITY,
  "-Z": [1, 0, 0, 0, -1, 0, 0, 0, -1], // (x,y,z) -> (x,-y,-z)
  "+X": [0, 0, -1, 0, 1, 0, 1, 0, 0], //  (x,y,z) -> (-z,y,x)
  "-X": [0, 0, 1, 0, 1, 0, -1, 0, 0], //  (x,y,z) -> (z,y,-x)
  "+Y": [1, 0, 0, 0, 0, -1, 0, 1, 0], //  (x,y,z) -> (x,-z,y)
  "-Y": [1, 0, 0, 0, 0, 1, 0, -1, 0], //  (x,y,z) -> (x,z,-y)
};

/** One 90 degree turn (counter-clockwise looking down the axis) about X, Y or Z. */
const STEP: Record<Dim, Mat3> = {
  x: [1, 0, 0, 0, 0, -1, 0, 1, 0],
  y: [0, 0, 1, 0, 1, 0, -1, 0, 0],
  z: [0, -1, 0, 1, 0, 0, 0, 0, 1],
};

export function mul(a: Mat3, b: Mat3): Mat3 {
  const r = new Array<number>(9).fill(0);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r as Mat3;
}

export function applyMat(m: Mat3, v: [number, number, number]): [number, number, number] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

export function det(m: Mat3): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6])
  );
}

/** Axis alignment first, then rotationSteps about X, then Y, then Z (all in the aligned frame). */
export function orientationMatrix(axis: Axis, rotationSteps: [number, number, number]): Mat3 {
  let m = AXIS_ROTATIONS[axis];
  const dims: Dim[] = ["x", "y", "z"];
  for (let d = 0; d < 3; d++) {
    const turns = ((rotationSteps[d] % 4) + 4) % 4;
    for (let i = 0; i < turns; i++) m = mul(STEP[dims[d]], m);
  }
  return m;
}

export type Oriented = {
  mesh: Mesh; // rotated, scaled, min Z = 0 (indices shared with the input mesh)
  /** effective uniform scale applied */
  scale: number;
  /** extents in mm after orientation and scaling */
  size: [number, number, number];
  /** size at scale 1 (after orientation and import unit, in mm) */
  baseSize: [number, number, number];
};

const DIM_INDEX: Record<Dim, number> = { x: 0, y: 1, z: 2 };

/** Effective uniform scale for the given settings and the oriented size in mm at scale 1 (import unit already applied). */
export function effectiveScale(
  s: Pick<Settings, "scale" | "targetSize">,
  baseSize: [number, number, number],
): number {
  if (s.targetSize) {
    const ext = baseSize[DIM_INDEX[s.targetSize.dim]];
    if (ext > 0 && s.targetSize.mm > 0) return s.targetSize.mm / ext;
  }
  return s.scale > 0 ? s.scale : 1;
}

/** Build the oriented copy of `mesh`. The input is not modified. */
export function orientMesh(
  mesh: Mesh,
  s: Pick<Settings, "axis" | "rotationSteps" | "scale" | "targetSize"> & Partial<Pick<Settings, "importUnit">>,
): Oriented {
  const m = orientationMatrix(s.axis, s.rotationSteps);
  const unit = importUnitFactor(s.importUnit ?? "mm"); // model units -> mm, kept apart from the user scale
  const src = mesh.positions;
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i], y = src[i + 1], z = src[i + 2];
    out[i] = (m[0] * x + m[1] * y + m[2] * z) * unit;
    out[i + 1] = (m[3] * x + m[4] * y + m[5] * z) * unit;
    out[i + 2] = (m[6] * x + m[7] * y + m[8] * z) * unit;
  }
  const rotBox = computeBBox(out);
  const baseSize = bboxSize(rotBox);
  const scale = effectiveScale(s, baseSize);
  const minZ = rotBox.min[2];
  for (let i = 0; i < out.length; i += 3) {
    out[i] *= scale;
    out[i + 1] *= scale;
    out[i + 2] = (out[i + 2] - minZ) * scale; // translate min Z to 0
  }
  const bbox = computeBBox(out);
  return { mesh: { positions: out, indices: mesh.indices, bbox }, scale, size: bboxSize(bbox), baseSize };
}
