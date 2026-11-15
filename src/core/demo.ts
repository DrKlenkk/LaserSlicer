// Built-in demo model, generated in code (no binary asset): a rounded-square base, a round tower with a step and a
// chamfered top, and a through hole along the axis. Pure and deterministic; the result is a binary STL like a user file.

export const DEMO_FILE_NAME = "demo-part.stl";

export type DemoOptions = {
  /** points per contour (every contour has the same number, so neighbouring contours join in quad strips) */
  segments?: number;
  baseSize?: number;
  baseRadius?: number;
  baseHeight?: number;
  towerDiameter?: number;
  /** height where the tower's straight wall ends and the chamfer starts */
  towerHeight?: number;
  totalHeight?: number;
  topDiameter?: number;
  holeDiameter?: number;
};

/** Distance from the centre to the boundary of a square with rounded corners (half side `a`, corner radius `r`) in direction (c, s). */
function roundedSquareRadius(c: number, s: number, a: number, r: number): number {
  const k = a - r; // the corner circles' centres lie at (+-k, +-k)
  const tx = a / Math.abs(c || 1e-12);
  const ty = a / Math.abs(s || 1e-12);
  if (tx * Math.abs(s) <= k) return tx; // hits the vertical straight edge
  if (ty * Math.abs(c) <= k) return ty; // hits the horizontal straight edge
  const dc = Math.abs(c) * k + Math.abs(s) * k; // direction . corner centre
  return dc + Math.sqrt(dc * dc - (2 * k * k - r * r));
}

/**
 * Binary STL (little endian, 80-byte header) of the demo part. The surface is one closed ring of contour strips around the
 * profile (outer bottom, outer wall, step, tower, chamfer, top, hole wall, bottom), so it is a closed 2-manifold by
 * construction and every triangle faces outward.
 */
export function buildDemoStl(o: DemoOptions = {}): Uint8Array {
  const n = o.segments ?? 96;
  const size = o.baseSize ?? 70, rc = o.baseRadius ?? 10, hb = o.baseHeight ?? 12;
  const rt = (o.towerDiameter ?? 40) / 2, ht = o.towerHeight ?? 32, h = o.totalHeight ?? 40;
  const rtop = (o.topDiameter ?? 28) / 2, rh = (o.holeDiameter ?? 12) / 2;
  const square = (z: number) => ({ z, r: (c: number, s: number) => roundedSquareRadius(c, s, size / 2, rc) });
  const circle = (z: number, r: number) => ({ z, r: () => r });
  // Profile, counter-clockwise in the (radius, z) half plane, closed back to the first contour.
  const profile = [square(0), square(hb), circle(hb, rt), circle(ht, rt), circle(h, rtop), circle(h, rh), circle(0, rh)];
  const rings = profile.map((p) => {
    const pts = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n, c = Math.cos(a), s = Math.sin(a), r = p.r(c, s);
      pts[i * 3] = r * c;
      pts[i * 3 + 1] = r * s;
      pts[i * 3 + 2] = p.z;
    }
    return pts;
  });
  const tris = rings.length * n * 2;
  const out = new Uint8Array(84 + tris * 50);
  const dv = new DataView(out.buffer);
  out.set(new TextEncoder().encode("Laser Slicer demo part"), 0);
  dv.setUint32(80, tris, true);
  let off = 84;
  const tri = (A: Float32Array, i: number, B: Float32Array, j: number, C: Float32Array, k: number) => {
    off += 12; // normal left zero: readers recompute it from the winding
    for (const [P, q] of [[A, i], [B, j], [C, k]] as const) for (let d = 0; d < 3; d++, off += 4) dv.setFloat32(off, P[q * 3 + d], true);
    off += 2;
  };
  for (let r = 0; r < rings.length; r++) {
    const a = rings[r], b = rings[(r + 1) % rings.length];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      tri(a, i, a, j, b, j);
      tri(a, i, b, j, b, i);
    }
  }
  return out;
}
