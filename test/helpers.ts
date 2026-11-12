import { DEFAULT_SETTINGS } from "../src/state";
import type { Mesh, MeshStats, Settings } from "../src/core/types";
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
