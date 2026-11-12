import { describe, expect, it } from "vitest";
import { Pipeline } from "../src/core/pipeline";
import { shapesArea } from "../src/core/poly";
import { box, cube20, uvSphere } from "./fixtures/meshes";
import { settings, weld } from "./helpers";

function make(raw = cube20()) {
  const { mesh, stats } = weld(raw);
  const p = new Pipeline();
  p.setMesh(mesh, stats);
  return p;
}

describe("pipeline caching", () => {
  it("re-runs only the stages whose settings changed", async () => {
    const p = make();
    await p.run(settings());
    expect(p.runs).toEqual({ orient: 1, slice: 1, modes: 1, cleanup: 1 });
    await p.run(settings({ kerf: 0.3, labels: false })); // irrelevant to slicing
    expect(p.runs).toEqual({ orient: 1, slice: 1, modes: 1, cleanup: 1 });
    await p.run(settings({ minPartArea: 9 }));
    expect(p.runs).toEqual({ orient: 1, slice: 1, modes: 1, cleanup: 2 });
    await p.run(settings({ minPartArea: 9, mode: "undersize" }));
    expect(p.runs).toEqual({ orient: 1, slice: 2, modes: 2, cleanup: 3 });
    await p.run(settings({ minPartArea: 9, mode: "undersize", axis: "+X" }));
    expect(p.runs.orient).toBe(2);
  });

  it("slices along the chosen axis", async () => {
    const p = make(box(10, 20, 30));
    const z = await p.run(settings({ thickness: 5 }));
    expect(z!.info.layerCount).toBe(6);
    const x = await p.run(settings({ thickness: 5, axis: "+X" }));
    expect(x!.info.layerCount).toBe(2);
    expect(shapesArea(x!.layers[0].shapes)).toBeCloseTo(20 * 30, 1);
  });

  it("reports progress ending at 1 and honours shouldAbort", async () => {
    const p = make(uvSphere());
    const seen: [string, number][] = [];
    const ok = await p.run(settings(), { progress: (s, f) => seen.push([s, f]) });
    expect(ok).not.toBeNull();
    expect(seen.at(-1)).toEqual(["Done", 1]);
    expect(new Set(seen.map(([s]) => s))).toContain("Slicing");
    for (let i = 1; i < seen.length; i++) expect(seen[i][1]).toBeGreaterThanOrEqual(seen[i - 1][1] - 1e-9);
    const q = make(uvSphere());
    expect(await q.run(settings(), { shouldAbort: () => true })).toBeNull();
  });

  it("adds mesh-level warnings from load statistics", async () => {
    const p = make();
    const { mesh, stats } = weld(cube20());
    p.setMesh(mesh, { ...stats, openEdges: 3 });
    const r = await p.run(settings());
    expect(r!.warnings.some((w) => w.message.includes("3 open edges"))).toBe(true);
  });
});
