// Message types between the UI (main thread) and the slicer worker.
import type { Box3, MeshStats } from "../core/types";

/** ext "soup" = raw triangle soup (Float32Array x,y,z per vertex, 3 vertices per triangle). */
export type LoadExt = "stl" | "obj" | "soup";

export type ToWorker =
  | { type: "ping"; jobId: number; t: number }
  | { type: "load"; jobId: number; buffer: ArrayBuffer; ext: LoadExt };

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
  | { type: "error"; jobId: number; message: string };
