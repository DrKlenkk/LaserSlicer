// Message types between the UI (main thread) and the slicer worker.
import type { Box3, MeshStats, Settings } from "../core/types";
import type { RunResult } from "../core/pipeline";

/** ext "soup" = raw triangle soup (Float32Array x,y,z per vertex, 3 vertices per triangle). */
export type LoadExt = "stl" | "obj" | "soup";

export type ToWorker =
  | { type: "ping"; jobId: number; t: number }
  | { type: "load"; jobId: number; buffer: ArrayBuffer; ext: LoadExt }
  | { type: "run"; jobId: number; settings: Settings };

export type FromWorker =
  | { type: "pong"; jobId: number; t: number }
  | {
      type: "loaded";
      jobId: number;
      stats: MeshStats;
      /** welded mesh, transferred (the worker keeps its own copy) */
      positions: Float32Array;
      indices: Uint32Array;
      bbox: Box3;
    }
  /** `fraction` is overall progress 0..1 across all stages */
  | { type: "progress"; jobId: number; stage: string; fraction: number }
  | ({ type: "result"; jobId: number } & RunResult)
  | { type: "error"; jobId: number; message: string };
