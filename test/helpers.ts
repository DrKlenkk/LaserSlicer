import { DEFAULT_SETTINGS } from "../src/state";
import type { Mesh, MeshStats, Ring, Settings } from "../src/core/types";
import { buildMesh, computeBBox } from "../src/core/mesh";
import { Pipeline, type RunResult } from "../src/core/pipeline";
import { toSoup, type RawMesh } from "./fixtures/meshes";

export function settings(patch: Partial<Settings> = {}): Settings {
  return { ...structuredClone(DEFAULT_SETTINGS), ...patch };
}

/** Welded mesh as the loader would deliver it. */
export function weld(raw: RawMesh): { mesh: Mesh; stats: MeshStats } {
  return buildMesh(toSoup(raw));
}

/** Use a generated indexed mesh directly (skips welding; for very large meshes). */
export function direct(raw: RawMesh): Mesh {
  return { positions: raw.positions, indices: raw.indices, bbox: computeBBox(raw.positions) };
}

export async function slice(raw: RawMesh, patch: Partial<Settings> = {}): Promise<RunResult> {
  const { mesh, stats } = weld(raw);
  const p = new Pipeline();
  p.setMesh(mesh, stats);
  const r = await p.run(settings(patch));
  if (!r) throw new Error("aborted");
  return r;
}

/** Largest turn (degrees) against the expected bend direction: outers CCW turn left everywhere, holes CW turn right. */
export function maxReflexDeg(ring: Ring, hole: boolean): number {
  const n = ring.length;
  let worst = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[(i + n - 1) % n], b = ring[i], c = ring[(i + 1) % n];
    const t = Math.atan2((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]), (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]));
    worst = Math.max(worst, ((hole ? t : -t) * 180) / Math.PI);
  }
  return worst;
}
