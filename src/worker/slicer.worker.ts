// Slicer worker: all heavy geometry runs here, never on the main thread.
import type { FromWorker, ToWorker } from "./protocol";
import { parseToSoup } from "../core/loaders";
import { buildMesh } from "../core/mesh";
import { Pipeline } from "../core/pipeline";
import { buildExportFiles, modelBaseName } from "../core/export/files";
import { buildReadme, buildZip } from "../core/export/zip";

const ctx = self as unknown as {
  postMessage(msg: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
};

const pipeline = new Pipeline();
/** Newest "run" job seen. Older runs abandon themselves at their next checkpoint (stale-job dropping). */
let latestRun = 0;

/** Macrotask yield so queued messages (a newer "run") are delivered while a job is in progress. */
const channel = new MessageChannel();
function yieldNow(): Promise<void> {
  return new Promise((resolve) => {
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(0);
  });
}

async function runJob(jobId: number, settings: Parameters<Pipeline["run"]>[0]) {
  try {
    const res = await pipeline.run(settings, {
      progress: (stage, fraction) => ctx.postMessage({ type: "progress", jobId, stage, fraction }),
      shouldAbort: () => jobId !== latestRun,
      yieldNow,
    });
    if (!res || jobId !== latestRun) return; // stale: drop silently
    ctx.postMessage({ type: "result", jobId, ...res });
  } catch (err) {
    if (jobId === latestRun) ctx.postMessage({ type: "error", jobId, message: err instanceof Error ? err.message : String(err) });
  }
}

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
        pipeline.setMesh(mesh, stats);
        // Keep our copy; transfer a copy to the UI for the 3D view.
        const positions = mesh.positions.slice();
        const indices = mesh.indices.slice();
        ctx.postMessage(
          { type: "loaded", jobId: msg.jobId, stats, positions, indices, bbox: mesh.bbox },
          [positions.buffer, indices.buffer],
        );
        break;
      }
      case "export": {
        const last = pipeline.last;
        if (!last) throw new Error("Nothing to export yet: wait for slicing to finish");
        const model = modelBaseName(msg.model);
        const settings = { ...last.settings, formats: msg.formats, perLayerFiles: msg.perLayerFiles };
        const files = buildExportFiles(last.result, settings, model);
        if (files.length === 0) throw new Error("Nothing to export: select DXF or SVG and make sure parts exist");
        const bytes = buildZip(files, buildReadme(last.result, settings, model, files));
        ctx.postMessage({ type: "file", jobId: msg.jobId, name: `${model}_laser.zip`, mime: "application/zip", bytes }, [bytes.buffer]);
        break;
      }
      case "run":
        latestRun = msg.jobId;
        void runJob(msg.jobId, msg.settings);
        break;
    }
  } catch (err) {
    ctx.postMessage({ type: "error", jobId: msg.jobId, message: err instanceof Error ? err.message : String(err) });
  }
};
