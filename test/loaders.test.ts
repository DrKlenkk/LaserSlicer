import { describe, it, expect } from "vitest";
import { parseToSoup } from "../src/core/loaders";
import { buildMesh } from "../src/core/mesh";
import { FIXTURES, cube20, toSoup } from "./fixtures/meshes";
import { writeAsciiSTL, writeBinarySTL } from "./fixtures/stlWriter";

const sorted = (a: Float32Array) => Array.from(a).sort((x, y) => x - y);

describe("STL loading", () => {
  for (const [name, f] of Object.entries(FIXTURES)) {
    for (const [fmt, write] of [["binary", writeBinarySTL], ["ASCII", writeAsciiSTL]] as const) {
      it(`${name} round-trips through ${fmt} STL`, () => {
        const raw = f.make();
        const soup = parseToSoup(write(raw), "stl");
        expect(soup.length).toBe(raw.indices.length * 3);
        // identical triangle soup, vertex for vertex
        expect(Array.from(soup)).toEqual(Array.from(toSoup(raw)));
        const { stats } = buildMesh(soup);
        expect(stats.triangles).toBe(raw.indices.length / 3);
        expect(stats.vertices).toBe(raw.positions.length / 3);
        expect(stats.openEdges === 0).toBe(f.closed);
      });
    }
  }

  it("binary STL whose header starts with 'solid' is still read as binary", () => {
    const soup = parseToSoup(writeBinarySTL(cube20(), "solid exported by some CAD"), "stl");
    expect(soup.length / 9).toBe(12);
  });

  it("binary and ASCII give the same bbox", () => {
    const a = buildMesh(parseToSoup(writeBinarySTL(cube20()), "stl")).stats.bbox;
    const b = buildMesh(parseToSoup(writeAsciiSTL(cube20()), "stl")).stats.bbox;
    expect(a).toEqual(b);
    expect(a.max).toEqual([10, 10, 10]);
  });

  it("empty or garbage files give a clear error", () => {
    expect(() => parseToSoup(new ArrayBuffer(0), "stl")).toThrow();
    expect(() => parseToSoup(writeBinarySTL({ positions: new Float32Array(), indices: new Uint32Array() }), "stl")).toThrow(/no triangles/);
  });
});

describe("OBJ loading", () => {
  it("parses quads (triangulated) and merges objects", () => {
    const obj = `
o a
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
f 1 2 3 4
o b
v 5 0 0
v 6 0 0
v 5 1 0
f 5 6 7
`;
    const soup = parseToSoup(new TextEncoder().encode(obj).buffer as ArrayBuffer, "obj");
    expect(soup.length / 9).toBe(3); // quad -> 2 triangles, plus 1
    const { stats } = buildMesh(soup);
    expect(stats.bbox.max[0]).toBe(6);
  });
});

describe("raw soup", () => {
  it("accepts a prepared soup (used for 3MF parsed on the main thread)", () => {
    const soup = toSoup(cube20());
    expect(sorted(parseToSoup(soup.buffer.slice(0) as ArrayBuffer, "soup"))).toEqual(sorted(soup));
  });
  it("rejects NaN coordinates", () => {
    const s = new Float32Array(9);
    s[4] = NaN;
    expect(() => parseToSoup(s.buffer as ArrayBuffer, "soup")).toThrow(/invalid/);
  });
});
