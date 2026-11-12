// Loader output (triangle soup) -> indexed, welded mesh; bbox; edge statistics.
import type { Box3, Mesh, MeshStats } from "./types";

/** Weld tolerance relative to the bbox diagonal (plan: 1e-5 x diagonal). */
export const WELD_REL_TOL = 1e-5;

export function computeBBox(positions: ArrayLike<number>): Box3 {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  if (positions.length === 0) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min, max };
}

export function bboxSize(b: Box3): [number, number, number] {
  return [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
}

export function bboxDiagonal(b: Box3): number {
  const s = bboxSize(b);
  return Math.hypot(s[0], s[1], s[2]);
}

/**
 * Weld a triangle soup (3 vertices per triangle, x/y/z floats) into an indexed mesh.
 * Vertices closer than WELD_REL_TOL x bbox diagonal are merged using a spatial hash:
 * the grid cell edge equals the tolerance, so a match can only be in the 3x3x3
 * neighbourhood of the vertex's own cell. Triangles that collapse to a line or point
 * after welding (repeated index) are dropped.
 */
export function weldSoup(soup: Float32Array): { mesh: Mesh; degenerateRemoved: number } {
  if (soup.length % 9 !== 0) throw new Error("Triangle data is not a multiple of 3 vertices");
  const triCount = soup.length / 9;
  const bbox = computeBBox(soup);
  const diag = bboxDiagonal(bbox);
  const tol = diag > 0 ? diag * WELD_REL_TOL : 1e-9;
  const tol2 = tol * tol;
  const inv = 1 / tol;

  const cells = new Map<number, number[]>(); // cell hash -> vertex ids
  const outPos: number[] = [];
  const remap = new Uint32Array(triCount * 3);

  const hash = (ix: number, iy: number, iz: number) =>
    (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) | 0;

  for (let v = 0; v < triCount * 3; v++) {
    const x = soup[v * 3], y = soup[v * 3 + 1], z = soup[v * 3 + 2];
    const cx = Math.floor(x * inv), cy = Math.floor(y * inv), cz = Math.floor(z * inv);
    let found = -1;
    search: for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = cells.get(hash(cx + dx, cy + dy, cz + dz));
          if (!bucket) continue;
          for (const id of bucket) {
            const ex = outPos[id * 3] - x, ey = outPos[id * 3 + 1] - y, ez = outPos[id * 3 + 2] - z;
            if (ex * ex + ey * ey + ez * ez <= tol2) {
              found = id;
              break search;
            }
          }
        }
      }
    }
    if (found < 0) {
      found = outPos.length / 3;
      outPos.push(x, y, z);
      const h = hash(cx, cy, cz);
      const bucket = cells.get(h);
      if (bucket) bucket.push(found);
      else cells.set(h, [found]);
    }
    remap[v] = found;
  }

  const idx: number[] = [];
  let degenerateRemoved = 0;
  for (let t = 0; t < triCount; t++) {
    const a = remap[t * 3], b = remap[t * 3 + 1], c = remap[t * 3 + 2];
    if (a === b || b === c || a === c) degenerateRemoved++;
    else idx.push(a, b, c);
  }

  const positions = Float32Array.from(outPos);
  return {
    mesh: { positions, indices: Uint32Array.from(idx), bbox: computeBBox(positions) },
    degenerateRemoved,
  };
}

/** Count edges used by one triangle (open) and by more than two (non-manifold). */
export function edgeStats(indices: Uint32Array, vertexCount: number): { openEdges: number; nonManifoldEdges: number } {
  const counts = new Map<number, number>();
  const add = (a: number, b: number) => {
    const key = a < b ? a * vertexCount + b : b * vertexCount + a; // < 2^53 for any realistic V
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  for (let t = 0; t < indices.length; t += 3) {
    add(indices[t], indices[t + 1]);
    add(indices[t + 1], indices[t + 2]);
    add(indices[t + 2], indices[t]);
  }
  let openEdges = 0, nonManifoldEdges = 0;
  for (const c of counts.values()) {
    if (c === 1) openEdges++;
    else if (c > 2) nonManifoldEdges++;
  }
  return { openEdges, nonManifoldEdges };
}

/** Soup -> welded mesh + statistics. */
export function buildMesh(soup: Float32Array): { mesh: Mesh; stats: MeshStats } {
  const { mesh, degenerateRemoved } = weldSoup(soup);
  const vertices = mesh.positions.length / 3;
  const { openEdges, nonManifoldEdges } = edgeStats(mesh.indices, vertices);
  return {
    mesh,
    stats: {
      triangles: mesh.indices.length / 3,
      vertices,
      bbox: mesh.bbox,
      openEdges,
      nonManifoldEdges,
      degenerateRemoved,
    },
  };
}
