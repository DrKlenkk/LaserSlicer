// Stacked model as a binary STL (mm): every part's final cut outline (after hollowing and kerf compensation, before nesting)
// extruded to its plywood thickness at its stacked height, holes (cavities and dowel holes) included. Pure, no DOM.
// Polygons with holes are triangulated with three.js ShapeUtils (earcut); only the polygon's own vertices are used, so the caps
// and the side walls share every vertex and the surface is closed (each edge belongs to exactly two triangles).
import { ShapeUtils, Vector2 } from "three";
import type { Part, Ring, Vec2 } from "../types";
import type { RunResult } from "../pipeline";
import { partsInRange } from "../range";

/** Segments of a dowel hole circle in the STL. */
const DOWEL_SEGMENTS = 32;

function signedArea(r: Ring): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i], q = r[(i + 1) % r.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** The ring without a repeated closing point, wound CCW (`ccw`) or CW. */
function wound(r: Ring, ccw: boolean): Ring {
  let pts = r;
  const n = pts.length;
  if (n > 1 && pts[0][0] === pts[n - 1][0] && pts[0][1] === pts[n - 1][1]) pts = pts.slice(0, n - 1);
  return signedArea(pts) > 0 === ccw ? pts : pts.slice().reverse();
}

function circle(c: Vec2, d: number): Ring {
  const out: Ring = [];
  for (let i = 0; i < DOWEL_SEGMENTS; i++) {
    const a = (2 * Math.PI * i) / DOWEL_SEGMENTS;
    out.push([c[0] + (d / 2) * Math.cos(a), c[1] + (d / 2) * Math.sin(a)]);
  }
  return out;
}

/** Growable list of triangles (9 floats each). */
class Tris {
  data: number[] = [];
  add(a: [number, number, number], b: [number, number, number], c: [number, number, number]) {
    this.data.push(...a, ...b, ...c);
  }
  get count() {
    return this.data.length / 9;
  }
}

/** Adds the closed prism of one part to `t`, from z0 to z1. */
function addPrism(t: Tris, part: Part, z0: number, z1: number) {
  const outer = wound(part.cut.outer, true);
  const holes = [...part.cut.holes.map((h) => wound(h, false)), ...part.holes.map((h) => wound(circle(h.c, h.d), false))];
  if (outer.length < 3) return;
  // caps: triangulate in the plane, orient by the actual triangle winding (earcut's output order is not guaranteed)
  const all: Ring = [...outer, ...holes.flat()];
  const tri = ShapeUtils.triangulateShape(
    outer.map(([x, y]) => new Vector2(x, y)),
    holes.map((h) => h.map(([x, y]) => new Vector2(x, y))),
  );
  for (const [i, j, k] of tri) {
    let a = all[i], b = all[j], c = all[k];
    if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) < 0) [b, c] = [c, b]; // CCW seen from +Z
    t.add([a[0], a[1], z1], [b[0], b[1], z1], [c[0], c[1], z1]); // top, normal +Z
    t.add([a[0], a[1], z0], [c[0], c[1], z0], [b[0], b[1], z0]); // bottom, normal -Z
  }
  // walls: for a CCW outer and CW holes the material is on the left of every edge, so the outward normal is on the right
  for (const ring of [outer, ...holes]) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      t.add([a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1]);
      t.add([a[0], a[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]);
    }
  }
}

/** Triangles (flat array, 9 floats per triangle) of the stacked model of a result, for the layers in its range. */
export function stackedTriangles(result: RunResult): Float32Array {
  const t = new Tris();
  const layers = new Map(result.layers.map((l) => [l.index, l]));
  for (const part of partsInRange(result.parts, result.info.range)) {
    const l = layers.get(part.layer);
    if (!l) continue;
    addPrism(t, part, l.z0, l.z1);
  }
  return Float32Array.from(t.data);
}

/** Binary STL bytes: 80 byte header, triangle count, then normal + 3 vertices + attribute bytes per triangle. */
export function writeBinaryStl(tris: Float32Array, name = "Laser Slicer stacked model"): Uint8Array {
  const n = tris.length / 9;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  const head = new TextEncoder().encode(name.slice(0, 79));
  new Uint8Array(buf, 0, 80).set(head);
  dv.setUint32(80, n, true);
  let o = 84;
  for (let i = 0; i < n; i++) {
    const p = i * 9;
    const ux = tris[p + 3] - tris[p], uy = tris[p + 4] - tris[p + 1], uz = tris[p + 5] - tris[p + 2];
    const vx = tris[p + 6] - tris[p], vy = tris[p + 7] - tris[p + 1], vz = tris[p + 8] - tris[p + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (const v of [nx, ny, nz]) { dv.setFloat32(o, v, true); o += 4; }
    for (let k = 0; k < 9; k++) { dv.setFloat32(o, tris[p + k], true); o += 4; }
    o += 2; // attribute byte count = 0
  }
  return new Uint8Array(buf);
}

/** `stacked.stl` for a result (an empty STL, zero triangles, when no part is in range). */
export function buildStackedStl(result: RunResult): Uint8Array {
  return writeBinaryStl(stackedTriangles(result));
}
