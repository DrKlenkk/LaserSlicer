// Slicer worker: all heavy geometry runs here, never on the main thread.
import type { FromWorker, ToWorker } from "./protocol";
import type { Mesh } from "../core/types";
import { parseToSoup } from "../core/loaders";
import { buildMesh } from "../core/mesh";

const ctx = self as unknown as {
  postMessage(msg: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
};

/** Welded mesh of the loaded model; the slicing stages (M2+) will read it. */
let currentMesh: Mesh | null = null;

ctx.onmessage = (e) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case "ping":
        ctx.postMessage({ type: "pong", jobId: msg.jobId, t: msg.t });
        break;
      case "load": {
        const soup = parseToSoup(msg.buffer, msg.ext);
        const { mesh, stats } = buildMesh(soup);
        currentMesh = mesh;
        // Keep our copy; transfer a copy to the UI for the 3D view.
        const positions = mesh.positions.slice();
        const indices = mesh.indices.slice();
        ctx.postMessage(
          { type: "loaded", jobId: msg.jobId, stats, positions, indices, bbox: mesh.bbox },
          [positions.buffer, indices.buffer],
        );
        break;
      }
    }
  } catch (err) {
    ctx.postMessage({ type: "error", jobId: msg.jobId, message: err instanceof Error ? err.message : String(err) });
  }
};

// Referenced so the cached mesh is not flagged as unused until the pipeline lands.
export const hasMesh = () => currentMesh !== null;
