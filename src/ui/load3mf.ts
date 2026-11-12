// 3MF parsing on the MAIN thread: three's 3MFLoader uses DOMParser, which is not
// available in workers. We flatten all objects (with their transforms) into a triangle
// soup and hand that to the worker like any other mesh (ext "soup"). See DECISIONS.md.
import { ThreeMFLoader } from "three/examples/jsm/loaders/3MFLoader.js";
import { objectToSoup } from "../core/loaders";

export function load3mfToSoup(buffer: ArrayBuffer): Float32Array {
  const group = new ThreeMFLoader().parse(buffer);
  const soup = objectToSoup(group);
  if (soup.length < 9) throw new Error("The 3MF file contains no triangles");
  return soup;
}
