// File bytes -> triangle soup, using three.js parsing classes only (no DOM, no scene).
// 3MF is NOT handled here: three's 3MFLoader needs DOMParser, which workers lack, so
// the main thread parses 3MF (src/ui/load3mf.ts) and sends a ready-made soup (ext "soup").
import { BufferGeometry, Object3D, Mesh as ThreeMesh, Vector3 } from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";

/** Expand a (possibly indexed) geometry into a non-indexed position array, applying `toWorld` if given. */
function geometryToSoup(geo: BufferGeometry, apply?: (v: Vector3) => void): Float32Array {
  const pos = geo.getAttribute("position");
  const index = geo.getIndex();
  const n = index ? index.count : pos.count;
  const out = new Float32Array(n * 3);
  const v = new Vector3();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, index ? index.getX(i) : i);
    if (apply) apply(v);
    out[i * 3] = v.x;
    out[i * 3 + 1] = v.y;
    out[i * 3 + 2] = v.z;
  }
  return out;
}

/** Merge every mesh under `root` (with its world transform) into one triangle soup. */
export function objectToSoup(root: Object3D): Float32Array {
  root.updateMatrixWorld(true);
  const parts: Float32Array[] = [];
  root.traverse((o) => {
    const m = o as ThreeMesh;
    if (m.isMesh && m.geometry) {
      parts.push(geometryToSoup(m.geometry, (v) => v.applyMatrix4(m.matrixWorld)));
    }
  });
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Float32Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export function parseToSoup(buffer: ArrayBuffer, ext: "stl" | "obj" | "soup"): Float32Array {
  let soup: Float32Array;
  switch (ext) {
    case "stl":
      try {
        soup = geometryToSoup(new STLLoader().parse(buffer));
      } catch {
        throw new Error("This is not a valid STL file");
      }
      break;
    case "obj":
      try {
        soup = objectToSoup(new OBJLoader().parse(new TextDecoder().decode(buffer)));
      } catch {
        throw new Error("This is not a valid OBJ file");
      }
      break;
    case "soup":
      soup = new Float32Array(buffer);
      break;
    default:
      throw new Error(`Unsupported file type: ${String(ext)}`);
  }
  if (soup.length < 9) throw new Error("The file contains no triangles");
  for (let i = 0; i < soup.length; i++) {
    if (!Number.isFinite(soup[i])) throw new Error("The file contains invalid (NaN/Infinity) coordinates");
  }
  return soup;
}
