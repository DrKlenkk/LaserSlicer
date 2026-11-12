// Plane cut of an indexed triangle mesh (plan Algorithm section 4).
//
// All planes of a run are cut in one upward sweep: triangles are sorted once by min Z and
// kept in an "active list" while min Z <= z <= max Z, so the cost is about
// O(T log T + total crossings), not O(T * planes).
//
// Points are keyed by the mesh EDGE they lie on, never by their float coordinates, so
// neighbouring triangles agree on the shared point exactly and stitching is exact.
import type { Mesh, Ring } from "./types";

export const NEAR_VERTEX_TOL = 1e-6; // plane within this of a vertex Z is "on" the vertex
export const NUDGE = 1e-4; // ...and is moved up by this much
export const DEFAULT_GAP_TOL = 0.5; // mm, open-chain endpoints closer than this are joined
const MIN_RING_AREA = 1e-6; // mm^2
const MAX_JOIN_CHAINS = 400;

export type PreparedMesh = {
  positions: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  /** triangle ids sorted by min Z */
  order: Uint32Array;
  /** min / max Z of the triangles, in `order` order */
  triMin: Float64Array;
  triMax: Float64Array;
  /** sorted distinct vertex Z values (for the plane nudge) */
  vertexZ: Float64Array;
};

export function prepareMesh(mesh: Mesh): PreparedMesh {
  const { positions, indices } = mesh;
  const T = indices.length / 3;
  const V = positions.length / 3;
  const mn = new Float64Array(T);
  const mx = new Float64Array(T);
  for (let t = 0; t < T; t++) {
    const a = positions[indices[t * 3] * 3 + 2], b = positions[indices[t * 3 + 1] * 3 + 2], c = positions[indices[t * 3 + 2] * 3 + 2];
    mn[t] = Math.min(a, b, c);
    mx[t] = Math.max(a, b, c);
  }
  const order = new Uint32Array(T);
  for (let t = 0; t < T; t++) order[t] = t;
  order.sort((p, q) => mn[p] - mn[q]);
  const triMin = new Float64Array(T);
  const triMax = new Float64Array(T);
  for (let i = 0; i < T; i++) {
    triMin[i] = mn[order[i]];
    triMax[i] = mx[order[i]];
  }
  const vz = new Float64Array(V);
  for (let v = 0; v < V; v++) vz[v] = positions[v * 3 + 2];
  vz.sort();
  return { positions, indices, vertexCount: V, order, triMin, triMax, vertexZ: vz };
}

/** Distance from z to the nearest vertex Z (binary search). */
function nearestVertexDist(prep: PreparedMesh, z: number): number {
  const a = prep.vertexZ;
  let lo = 0, hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] < z) lo = mid + 1;
    else hi = mid;
  }
  let d = Infinity;
  if (lo < a.length) d = Math.min(d, a[lo] - z);
  if (lo > 0) d = Math.min(d, z - a[lo - 1]);
  return d;
}

/** Plan section 3: a plane within 1e-6 mm of any vertex Z is shifted by 1e-4 mm. */
export function nudgeHeight(prep: PreparedMesh, z: number): number {
  let out = z;
  for (let i = 0; i < 8 && nearestVertexDist(prep, out) <= NEAR_VERTEX_TOL; i++) out += NUDGE;
  return out;
}

export type PlaneResult = {
  z: number;
  rings: Ring[];
  /** open chains that were joined because their gap was below gapTol */
  gapJoined: number;
  /** open chains that had to be closed with a straight line (broken mesh) */
  forcedClosed: number;
};

export type SliceOptions = { gapTol?: number };

type Chain = number[]; // point ids in walking order

/** Key for an undirected edge. V*V < 2^53 needs V < ~9.4e7, far beyond what fits in memory as a mesh. */
const MAX_V = 94_000_000;

/**
 * Cut the mesh at the given plane heights (any order). Heights are used as given: nudging away
 * from vertices is the caller's job (`nudgeHeight`). Results come back in input order.
 */
export function slicePlanes(
  prep: PreparedMesh,
  heights: number[],
  opts: SliceOptions = {},
  onPlane?: (done: number, total: number) => void,
): PlaneResult[] {
  if (prep.vertexCount > MAX_V) throw new Error("Mesh has too many vertices to slice");
  const gapTol = opts.gapTol ?? DEFAULT_GAP_TOL;
  const idx = heights.map((_, i) => i).sort((a, b) => heights[a] - heights[b]);
  const results = new Array<PlaneResult>(heights.length);

  const { positions: P, indices: I, order, triMin, triMax, vertexCount: V } = prep;
  const T = order.length;
  let active = new Uint32Array(1024); // triangle ids
  let activeCount = 0;
  let next = 0; // next triangle (in `order`) not yet activated

  for (let n = 0; n < idx.length; n++) {
    const z = heights[idx[n]];
    // activate triangles starting at or below z
    while (next < T && triMin[next] <= z) {
      if (triMax[next] >= z) {
        if (activeCount === active.length) {
          const g = new Uint32Array(active.length * 2);
          g.set(active);
          active = g;
        }
        active[activeCount++] = order[next];
      }
      next++;
    }
    // drop triangles that ended below z
    let w = 0;
    for (let i = 0; i < activeCount; i++) {
      const t = active[i];
      const base = t * 3;
      const z0 = P[I[base] * 3 + 2], z1 = P[I[base + 1] * 3 + 2], z2 = P[I[base + 2] * 3 + 2];
      if (Math.max(z0, z1, z2) >= z) active[w++] = t;
    }
    activeCount = w;

    // ---- intersect ----
    const edgePoint = new Map<number, number>(); // edge key -> local point id
    const px: number[] = [];
    const py: number[] = [];
    const pointOn = (a: number, b: number): number => {
      const lo = a < b ? a : b, hi = a < b ? b : a;
      const key = lo * V + hi;
      let id = edgePoint.get(key);
      if (id === undefined) {
        id = px.length;
        edgePoint.set(key, id);
        const xa = P[lo * 3], ya = P[lo * 3 + 1], za = P[lo * 3 + 2];
        const xb = P[hi * 3], yb = P[hi * 3 + 1], zb = P[hi * 3 + 2];
        const f = (z - za) / (zb - za);
        px.push(xa + f * (xb - xa));
        py.push(ya + f * (yb - ya));
      }
      return id;
    };
    const segFrom: number[] = [];
    const segTo: number[] = [];
    for (let i = 0; i < activeCount; i++) {
      const base = active[i] * 3;
      const v0 = I[base], v1 = I[base + 1], v2 = I[base + 2];
      const u0 = P[v0 * 3 + 2] > z, u1 = P[v1 * 3 + 2] > z, u2 = P[v2 * 3 + 2] > z;
      if (u0 === u1 && u1 === u2) continue; // not crossing
      // Walk the edges in winding order: the edge going up (below -> above) ends the segment,
      // the edge going down starts it. For an outward CCW triangle this puts solid on the left.
      let from = -1, to = -1;
      const edge = (a: number, b: number, ua: boolean, ub: boolean) => {
        if (ua === ub) return;
        if (ub) to = pointOn(a, b);
        else from = pointOn(a, b);
      };
      edge(v0, v1, u0, u1);
      edge(v1, v2, u1, u2);
      edge(v2, v0, u2, u0);
      if (from >= 0 && to >= 0 && from !== to) {
        segFrom.push(from);
        segTo.push(to);
      }
    }

    results[idx[n]] = stitch(z, px, py, segFrom, segTo, gapTol);
    onPlane?.(n + 1, idx.length);
  }
  return results;
}

/** Convenience wrapper: one plane. */
export function slicePlane(prep: PreparedMesh, z: number, opts?: SliceOptions): PlaneResult {
  return slicePlanes(prep, [z], opts)[0];
}

function stitch(z: number, px: number[], py: number[], segFrom: number[], segTo: number[], gapTol: number): PlaneResult {
  const S = segFrom.length;
  const P = px.length;
  const nextSeg = new Int32Array(P).fill(-1); // point id -> segment starting there
  const incoming = new Uint8Array(P);
  for (let s = 0; s < S; s++) {
    if (nextSeg[segFrom[s]] < 0) nextSeg[segFrom[s]] = s;
    incoming[segTo[s]] = 1;
  }
  const used = new Uint8Array(S);
  const closed: Chain[] = [];
  const open: Chain[] = [];

  const walk = (start: number): { chain: Chain; isClosed: boolean } => {
    const chain: Chain = [segFrom[start]];
    let s = start;
    for (;;) {
      used[s] = 1;
      const p = segTo[s];
      if (p === chain[0]) return { chain, isClosed: true };
      chain.push(p);
      const ns = nextSeg[p];
      if (ns < 0 || used[ns]) return { chain, isClosed: false };
      s = ns;
    }
  };

  // 1) open chains start at a point nothing flows into
  for (let s = 0; s < S; s++) {
    if (used[s] || incoming[segFrom[s]]) continue;
    const { chain } = walk(s);
    open.push(chain);
  }
  // 2) everything left lies on cycles
  for (let s = 0; s < S; s++) {
    if (used[s]) continue;
    const { chain, isClosed } = walk(s);
    (isClosed ? closed : open).push(chain);
  }

  // ---- broken meshes: join open chains whose ends are within gapTol, nearest first ----
  let gapJoined = 0;
  let forcedClosed = 0;
  const chains = open.slice();
  const d2 = (a: number, b: number) => (px[a] - px[b]) ** 2 + (py[a] - py[b]) ** 2;
  const tol2 = gapTol * gapTol;
  // The pairing search is O(n^2) per join; a hopelessly broken mesh just gets forced closing.
  while (chains.length <= MAX_JOIN_CHAINS) {
    let best = Infinity, bi = -1, bj = -1;
    for (let i = 0; i < chains.length; i++) {
      const end = chains[i][chains[i].length - 1];
      for (let j = 0; j < chains.length; j++) {
        const d = d2(end, chains[j][0]);
        if (d < best) {
          best = d;
          bi = i;
          bj = j;
        }
      }
    }
    if (bi < 0 || best > tol2) break;
    gapJoined++;
    if (bi === bj) {
      closed.push(chains[bi]);
      chains.splice(bi, 1);
    } else {
      const merged = chains[bi].concat(chains[bj]);
      chains[bi] = merged;
      chains.splice(bj, 1);
    }
  }
  // whatever is left is closed by a straight line (implicit: rings are closed polygons)
  for (const c of chains) {
    forcedClosed++;
    closed.push(c);
  }

  const rings: Ring[] = [];
  for (const c of closed) {
    const ring: Ring = [];
    for (const p of c) {
      const last = ring[ring.length - 1];
      if (last && last[0] === px[p] && last[1] === py[p]) continue; // no zero-length segments
      ring.push([px[p], py[p]]);
    }
    if (ring.length > 1) {
      const f = ring[0], l = ring[ring.length - 1];
      if (f[0] === l[0] && f[1] === l[1]) ring.pop();
    }
    if (ring.length < 3) continue;
    let a = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    if (Math.abs(a / 2) < MIN_RING_AREA) continue;
    rings.push(ring);
  }
  return { z, rings, gapJoined, forcedClosed };
}
