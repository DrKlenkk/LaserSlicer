import { describe, expect, it } from "vitest";
import { Pipeline } from "../src/core/pipeline";
import { direct, settings } from "./helpers";
import { uvSphere } from "./fixtures/meshes";

describe("performance smoke test", () => {
  it("500k triangles, 100 layers, oversize", async () => {
    const raw = uvSphere(10, 500, 500);
    const tris = raw.indices.length / 3;
    const p = new Pipeline();
    p.setMesh(direct(raw));
    const t0 = performance.now();
    const r = await p.run(settings({ thickness: 0.2, mode: "oversize", samplesPerLayer: 3 }));
    const ms = performance.now() - t0;
    process.stderr.write(`\n[perf] ${tris} triangles, ${r!.layers.length} layers, oversize x3: ${(ms / 1000).toFixed(2)} s\n`);
    expect(r!.layers).toHaveLength(100);
    expect(r!.parts.length).toBeGreaterThanOrEqual(99);
    // Target is 5 s. Not enforced tightly so a slow CI machine does not fail the build.
    expect(ms).toBeLessThan(20_000);
  }, 60_000);
});
