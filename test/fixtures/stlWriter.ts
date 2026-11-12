// Minimal STL writers (binary and ASCII) for loader tests.
import type { RawMesh } from "./meshes";

function triangles(m: RawMesh) {
  const out: { n: [number, number, number]; v: number[][] }[] = [];
  const p = m.positions;
  for (let t = 0; t < m.indices.length; t += 3) {
    const v = [0, 1, 2].map((k) => [p[m.indices[t + k] * 3], p[m.indices[t + k] * 3 + 1], p[m.indices[t + k] * 3 + 2]]);
    const u = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]];
    const w = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
    const c = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const len = Math.hypot(c[0], c[1], c[2]) || 1;
    out.push({ n: [c[0] / len, c[1] / len, c[2] / len], v });
  }
  return out;
}

/** Binary STL. `headerText` lets tests emulate exporters that start the header with "solid". */
export function writeBinarySTL(m: RawMesh, headerText = "binary stl by test"): ArrayBuffer {
  const tris = triangles(m);
  const buf = new ArrayBuffer(84 + tris.length * 50);
  const dv = new DataView(buf);
  for (let i = 0; i < Math.min(80, headerText.length); i++) dv.setUint8(i, headerText.charCodeAt(i));
  dv.setUint32(80, tris.length, true);
  let o = 84;
  for (const t of tris) {
    for (const x of t.n) { dv.setFloat32(o, x, true); o += 4; }
    for (const v of t.v) for (const x of v) { dv.setFloat32(o, x, true); o += 4; }
    dv.setUint16(o, 0, true);
    o += 2;
  }
  return buf;
}

/** ASCII STL. Values are printed with full precision so float32 data round-trips exactly. */
export function writeAsciiSTL(m: RawMesh, name = "fixture"): ArrayBuffer {
  const lines = [`solid ${name}`];
  for (const t of triangles(m)) {
    lines.push(`  facet normal ${t.n.join(" ")}`, "    outer loop");
    for (const v of t.v) lines.push(`      vertex ${v.join(" ")}`);
    lines.push("    endloop", "  endfacet");
  }
  lines.push(`endsolid ${name}`);
  const bytes = new TextEncoder().encode(lines.join("\n") + "\n");
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
