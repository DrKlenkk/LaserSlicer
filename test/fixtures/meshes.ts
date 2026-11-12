// Procedurally generated test meshes. All are closed, outward-facing (CCW) unless stated.
// Every generator returns an indexed RawMesh; use `toSoup` to get what a file loader would give
// (3 separate vertices per triangle), which is what the welding code must repair.

export type RawMesh = { positions: Float32Array; indices: Uint32Array };

export function toSoup(m: RawMesh): Float32Array {
  const out = new Float32Array(m.indices.length * 3);
  for (let i = 0; i < m.indices.length; i++) {
    const v = m.indices[i] * 3;
    out[i * 3] = m.positions[v];
    out[i * 3 + 1] = m.positions[v + 1];
    out[i * 3 + 2] = m.positions[v + 2];
  }
  return out;
}

/** Signed volume (positive for outward-facing CCW triangles). */
export function signedVolume(m: RawMesh): number {
  let vol = 0;
  const p = m.positions;
  for (let t = 0; t < m.indices.length; t += 3) {
    const a = m.indices[t] * 3, b = m.indices[t + 1] * 3, c = m.indices[t + 2] * 3;
    vol +=
      (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
        p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
        p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) /
      6;
  }
  return vol;
}

/** Axis-aligned box centred on the origin. */
export function box(sx: number, sy = sx, sz = sx): RawMesh {
  const x = sx / 2, y = sy / 2, z = sz / 2;
  const positions = new Float32Array([
    -x, -y, -z, x, -y, -z, x, y, -z, -x, y, -z, // 0-3 bottom
    -x, -y, z, x, -y, z, x, y, z, -x, y, z, //     4-7 top
  ]);
  const indices = new Uint32Array([
    0, 2, 1, 0, 3, 2, // bottom (-Z)
    4, 5, 6, 4, 6, 7, // top (+Z)
    0, 1, 5, 0, 5, 4, // -Y
    1, 2, 6, 1, 6, 5, // +X
    2, 3, 7, 2, 7, 6, // +Y
    3, 0, 4, 3, 4, 7, // -X
  ]);
  return { positions, indices };
}

export const cube20 = () => box(20);

/** UV sphere with single pole vertices. Default resolution is high (about 12k triangles). */
export function uvSphere(r = 10, rings = 64, segments = 96, cx = 0, cy = 0, cz = 0): RawMesh {
  const pos: number[] = [cx, cy, cz + r]; // north pole = vertex 0
  for (let i = 1; i < rings; i++) {
    const phi = (Math.PI * i) / rings;
    for (let j = 0; j < segments; j++) {
      const th = (2 * Math.PI * j) / segments;
      pos.push(cx + r * Math.sin(phi) * Math.cos(th), cy + r * Math.sin(phi) * Math.sin(th), cz + r * Math.cos(phi));
    }
  }
  pos.push(cx, cy, cz - r); // south pole
  const south = pos.length / 3 - 1;
  const ring = (i: number, j: number) => 1 + (i - 1) * segments + (j % segments);
  const idx: number[] = [];
  for (let j = 0; j < segments; j++) idx.push(0, ring(1, j), ring(1, j + 1));
  for (let i = 1; i < rings - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const a = ring(i, j), b = ring(i, j + 1), c = ring(i + 1, j), d = ring(i + 1, j + 1);
      idx.push(a, c, d, a, d, b);
    }
  }
  for (let j = 0; j < segments; j++) idx.push(south, ring(rings - 1, j + 1), ring(rings - 1, j));
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
}

/** Torus around the Z axis: major radius R, minor radius r. */
export function torus(R = 20, r = 5, major = 96, minor = 48): RawMesh {
  const pos: number[] = [];
  for (let i = 0; i < major; i++) {
    const u = (2 * Math.PI * i) / major;
    for (let j = 0; j < minor; j++) {
      const v = (2 * Math.PI * j) / minor;
      const rad = R + r * Math.cos(v);
      pos.push(rad * Math.cos(u), rad * Math.sin(u), r * Math.sin(v));
    }
  }
  const idx: number[] = [];
  const at = (i: number, j: number) => (i % major) * minor + (j % minor);
  for (let i = 0; i < major; i++) {
    for (let j = 0; j < minor; j++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
      idx.push(a, b, c, a, c, d);
    }
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
}

export function merge(...parts: RawMesh[]): RawMesh {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const p of parts) {
    const base = pos.length / 3;
    pos.push(...p.positions);
    for (const i of p.indices) idx.push(i + base);
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
}

/** Two separate spheres (r = 10) side by side along X, 30 mm apart. */
export const twoSpheres = () => merge(uvSphere(10, 48, 72, -15, 0, 0), uvSphere(10, 48, 72, 15, 0, 0));

/** Cube with one triangle removed: exactly 3 open edges. */
export function openCube(): RawMesh {
  const c = cube20();
  return { positions: c.positions, indices: c.indices.slice(0, c.indices.length - 3) };
}

/** Cube with every triangle flipped (normals point inwards). */
export function invertedCube(): RawMesh {
  const c = cube20();
  const idx = c.indices.slice();
  for (let t = 0; t < idx.length; t += 3) {
    const tmp = idx[t + 1];
    idx[t + 1] = idx[t + 2];
    idx[t + 2] = tmp;
  }
  return { positions: c.positions, indices: idx };
}

/**
 * Octahedron with apexes at z = 0 and z = 8 and its four equator vertices exactly at z = 4,
 * half-diagonal 5 mm. The slice plane z = 4 passes through vertices and along edges, the
 * degenerate case the slicer must survive.
 */
export function vertexOnPlane(): RawMesh {
  const positions = new Float32Array([
    0, 0, 0, // 0 bottom apex
    5, 0, 4, // 1
    0, 5, 4, // 2
    -5, 0, 4, // 3
    0, -5, 4, // 4
    0, 0, 8, // 5 top apex
  ]);
  const indices = new Uint32Array([
    0, 2, 1, 0, 3, 2, 0, 4, 3, 0, 1, 4, // lower pyramid (outward = downwards)
    5, 1, 2, 5, 2, 3, 5, 3, 4, 5, 4, 1, // upper pyramid
  ]);
  return { positions, indices };
}
export const VERTEX_ON_PLANE_Z = 4;

/** Three triangles sharing one edge (a "fin"): one non-manifold edge. */
export function finMesh(): RawMesh {
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 3, 1, 0, 1, 4]),
  };
}

// ---- rounded plate: a low-poly "real part" for outline-quality tests ----
export type RoundedPlateOpts = {
  W?: number; H?: number; R?: number; f?: number; fm?: number; // width, height, vertical corner R, top/bottom fillet radius, fillet steps (1 = chamfer)
  nFn?: (k: number) => number; // segs per 90deg corner for ring k
  phase?: (k: number) => number; // phase shift (fraction of one segment) per ring
  holeR?: number; holeN?: number; noise?: number; seed?: number;
};

function rng(seed: number) { let s = seed >>> 0 || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

/**
 * Plate with filleted vertical edges (radius R, `nFn(ring)` segments per 90 degrees), fillets of radius f on the top and bottom edges
 * (`fm` steps, 1 = chamfer) and a polygonal hole through it. The section changes with Z in the fillet zones and the facets of
 * neighbouring rings can be tessellated differently (nFn / phase), which is what real low-poly CAD exports do. Closed, outward CCW.
 */
export function roundedPlate(o: RoundedPlateOpts = {}): RawMesh {
  const W = o.W ?? 60, H = o.H ?? 24, R = o.R ?? 12, f = o.f ?? 5, fm = o.fm ?? 6;
  const holeR = o.holeR ?? 4, holeN = o.holeN ?? 16;
  const nFn = o.nFn ?? (() => 8);
  const phase = o.phase ?? (() => 0);
  const rand = rng(o.seed ?? 7);
  const pos: number[] = [];
  const tris: number[] = [];
  const addV = (x: number, y: number, z: number) => { pos.push(x, y, z); return pos.length / 3 - 1; };
  type Loop = { ids: number[]; ang: number[] };
  const mkLoop = (pts: [number, number][], z: number): Loop => {
    const withAng = pts.map(([x, y]) => ({ x, y, a: Math.atan2(y, x) })).sort((p, q) => p.a - q.a);
    return { ids: withAng.map((p) => addV(p.x, p.y, z)), ang: withAng.map((p) => p.a) };
  };
  const ringPts = (d: number, k: number): [number, number][] => {
    const n = nFn(k), ph = phase(k);
    const r = Math.max(R - d, 0.05), c = W / 2 - R;
    const pts: [number, number][] = [];
    for (let q = 0; q < 4; q++) for (let i = 0; i <= n; i++) {
      // phase: shift interior points along the arc (end points stay put so straight edges stay straight)
      let t = i / n; if (i > 0 && i < n) t = Math.min(0.999, Math.max(0.001, t + ph / n));
      const a = (q * Math.PI) / 2 + (t * Math.PI) / 2;
      const cx = (q === 0 || q === 3) ? c : -c, cy = (q === 0 || q === 1) ? c : -c;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return pts;
  };
  const strip = (A: Loop, B: Loop, flip: boolean) => {
    // A lower, B upper (flip: reversed orientation)
    const nA = A.ids.length, nB = B.ids.length;
    const aA = (i: number) => A.ang[i % nA] + (i >= nA ? 2 * Math.PI : 0);
    const aB = (j: number) => B.ang[j % nB] + (j >= nB ? 2 * Math.PI : 0);
    let i = 0, j = 0;
    while (i < nA || j < nB) {
      const advA = i < nA && (j >= nB || aA(i + 1) <= aB(j + 1));
      const a0 = A.ids[i % nA], a1 = A.ids[(i + 1) % nA], b0 = B.ids[j % nB], b1 = B.ids[(j + 1) % nB];
      const t = advA ? [a0, a1, b0] : [a0, b1, b0];
      if (advA) i++; else j++;
      if (flip) t.reverse();
      tris.push(...t);
    }
  };
  // profile: bottom fillet, wall, top fillet. list of (z, inset)
  const prof: [number, number][] = [];
  for (let s = 0; s <= fm; s++) { const th = (Math.PI / 2) * (s / fm); prof.push([f * (1 - Math.cos(th)), f * (1 - Math.sin(th))]); }
  for (let s = fm; s >= 0; s--) { const th = (Math.PI / 2) * (s / fm); prof.push([H - f * (1 - Math.cos(th)), f * (1 - Math.sin(th))]); }
  const loops = prof.map(([z, d], k) => mkLoop(ringPts(d, k), z));
  for (let k = 0; k + 1 < loops.length; k++) strip(loops[k], loops[k + 1], false);
  // hole
  const hpts = (): [number, number][] => Array.from({ length: holeN }, (_, i) => [holeR * Math.cos((2 * Math.PI * i) / holeN + 0.1), holeR * Math.sin((2 * Math.PI * i) / holeN + 0.1)]);
  const h0 = mkLoop(hpts(), 0), h1 = mkLoop(hpts(), H);
  strip(h0, h1, true); // inward-facing wall
  // caps
  const capStrip = (I: Loop, O: Loop, top: boolean) => {
    const nI = I.ids.length, nO = O.ids.length;
    const aI = (i: number) => I.ang[i % nI] + (i >= nI ? 2 * Math.PI : 0);
    const aO = (j: number) => O.ang[j % nO] + (j >= nO ? 2 * Math.PI : 0);
    let i = 0, j = 0;
    while (i < nI || j < nO) {
      const advI = i < nI && (j >= nO || aI(i + 1) <= aO(j + 1));
      const i0 = I.ids[i % nI], i1 = I.ids[(i + 1) % nI], o0 = O.ids[j % nO], o1 = O.ids[(j + 1) % nO];
      const t = advI ? [i0, o0, i1] : [i0, o0, o1];
      if (advI) i++; else j++;
      if (!top) t.reverse();
      tris.push(...t);
    }
  };
  // The hole loops used by the cap must share vertices with the hole wall: reuse h0 / h1.
  capStrip(h0, loops[0], false);
  capStrip(h1, loops[loops.length - 1], true);
  if (o.noise) for (let i = 0; i < pos.length; i++) pos[i] += (rand() * 2 - 1) * o.noise;
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(tris) };
}

/** All fixtures with expectations used by the loader tests. */
export const FIXTURES: Record<string, { make: () => RawMesh; closed: boolean }> = {
  cube20: { make: cube20, closed: true },
  sphere: { make: () => uvSphere(), closed: true },
  torus: { make: () => torus(), closed: true },
  twoSpheres: { make: twoSpheres, closed: true },
  openCube: { make: openCube, closed: false },
  invertedCube: { make: invertedCube, closed: true },
  vertexOnPlane: { make: vertexOnPlane, closed: true },
};
