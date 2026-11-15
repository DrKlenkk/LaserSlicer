// Generates the test models used by the browser test protocol (docs/test-protocol/PROTOCOL.md).
// Run from the repository root: node docs/test-protocol/models/generate.mjs
import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { OBJExporter } from "three/examples/jsm/exporters/OBJExporter.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { zipSync, strToU8 } from "fflate";
import { writeFileSync } from "node:fs";

const dir = "docs/test-protocol/models/";
const stl = new STLExporter();
const save = (name, geo) => {
  const mesh = new THREE.Mesh(geo);
  writeFileSync(dir + name, Buffer.from(stl.parse(mesh, { binary: true }).buffer));
};
// Z-up: three's primitives are Y-up, rotate so the axis is Z.
const zUp = (g) => g.rotateX(Math.PI / 2);
const extrude = (shape, h) => new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 48 });
const rectShape = (w, h) => {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, -h / 2); s.lineTo(w / 2, -h / 2); s.lineTo(w / 2, h / 2); s.lineTo(-w / 2, h / 2); s.lineTo(-w / 2, -h / 2);
  return s;
};
const circlePath = (cx, cy, r) => { const p = new THREE.Path(); p.absarc(cx, cy, r, 0, Math.PI * 2, true); return p; };

// 1 cube 20 mm
save("cube20.stl", new THREE.BoxGeometry(20, 20, 20));
// 2 cylinder d40 h30
save("cylinder40x30.stl", zUp(new THREE.CylinderGeometry(20, 20, 30, 96)));
// 3 sphere d60
save("sphere60.stl", new THREE.SphereGeometry(30, 96, 48));
// 4 cone d50 h40
save("cone50x40.stl", zUp(new THREE.CylinderGeometry(0, 25, 40, 96)));
// 5 torus R30 r10 (lying flat, axis Z)
save("torus30x10.stl", new THREE.TorusGeometry(30, 10, 48, 128));
// 6 plate 80x60x12 with 4 corner holes d6 and a 20x10 slot
{
  const s = rectShape(80, 60);
  for (const [x, y] of [[-32, -22], [32, -22], [-32, 22], [32, 22]]) s.holes.push(circlePath(x, y, 3));
  const slot = new THREE.Path(); slot.moveTo(-10, -5); slot.lineTo(-10, 5); slot.lineTo(10, 5); slot.lineTo(10, -5); slot.lineTo(-10, -5);
  s.holes.push(slot);
  save("plate80x60_holes.stl", extrude(s, 12));
}
// 7 stepped round tower (lathe): d60 x 12, d40 x 12, d20 x 12
{
  const pts = [[0, 0], [30, 0], [30, 12], [20, 12], [20, 24], [10, 24], [10, 36], [0, 36]].map(([r, z]) => new THREE.Vector2(r, z));
  save("stepped_tower.stl", zUp(new THREE.LatheGeometry(pts, 96)).rotateX(Math.PI));
}
// 8 inch cube: 1 x 1 x 1 units (meant to be loaded with import unit = inch)
save("cube_1unit_inch.stl", new THREE.BoxGeometry(1, 1, 1));
// 9 3MF cube 2 x 2 x 2 with unit="centimeter"
{
  const g = mergeVertices(new THREE.BoxGeometry(2, 2, 2).deleteAttribute("normal").deleteAttribute("uv"));
  const p = g.attributes.position, idx = g.index;
  let v = "", t = "";
  for (let i = 0; i < p.count; i++) v += `<vertex x="${p.getX(i) + 1}" y="${p.getY(i) + 1}" z="${p.getZ(i) + 1}"/>`;
  for (let i = 0; i < idx.count; i += 3) t += `<triangle v1="${idx.getX(i)}" v2="${idx.getX(i + 1)}" v3="${idx.getX(i + 2)}"/>`;
  const model = `<?xml version="1.0" encoding="UTF-8"?><model unit="centimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" type="model"><mesh><vertices>${v}</vertices><triangles>${t}</triangles></mesh></object></resources><build><item objectid="1"/></build></model>`;
  const files = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`),
    "3D/3dmodel.model": strToU8(model),
  };
  writeFileSync(dir + "cube2cm.3mf", zipSync(files));
}
// 10 OBJ: box 30 x 20 x 10
writeFileSync(dir + "box30x20x10.obj", new OBJExporter().parse(new THREE.Mesh(new THREE.BoxGeometry(30, 20, 10))));
// 11 large slab 250 x 180 x 24 (nesting over several sheets with a small sheet size)
save("slab250x180x24.stl", new THREE.BoxGeometry(250, 180, 24));
// 12 tiny pin d6 h6 (label shrink / too-small warnings)
save("pin6x6.stl", zUp(new THREE.CylinderGeometry(3, 3, 6, 48)));
// 13 broken cube: 20 mm cube with two triangles removed (open mesh)
{
  const g = new THREE.BoxGeometry(20, 20, 20).toNonIndexed();
  const pos = g.attributes.position.array.slice(0, g.attributes.position.array.length - 18);
  const b = new THREE.BufferGeometry(); b.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  save("broken_cube.stl", b);
}
console.log("models written to " + dir);
