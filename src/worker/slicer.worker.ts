// Slicer worker: all heavy geometry runs here, never on the main thread.
import type { FromWorker, ToWorker } from "./protocol";
import { parseToSoup } from "../core/loaders";
import { buildMesh } from "../core/mesh";
import { Pipeline, type RunResult } from "../core/pipeline";
import type { Settings } from "../core/types";
import { buildExportFiles, modelBaseName } from "../core/export/files";
import { runComparison, type CompareEntry } from "../core/compare";
import { buildRasterFiles } from "../core/export/raster";
import { buildReadme, buildZip } from "../core/export/zip";
import { buildAssemblyGuide } from "../core/export/guide";
import { buildStackedStl } from "../core/export/stl";

const ctx = self as unknown as {
  postMessage(msg: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
};

const pipeline = new Pipeline();
/** Newest "run" job seen. Older runs abandon themselves at their next checkpoint (stale-job dropping). */
let latestRun = 0;

/** The comparison in progress (0 = none); set to 0 by a cancel message or a model load, which makes it abandon itself. */
let activeCompare = 0;

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

/**
 * Material comparison on a fork of the main pipeline: own caches, so the preview's caches, counters and `last` (the result
 * that export uses) stay as they are. It shares the worker's thread with the main runs, but both yield every 25 ms, so a
 * preview run started meanwhile makes progress too (and its stale-job logic is independent of this one).
 */
async function compareJob(jobId: number, entries: CompareEntry[]) {
  activeCompare = jobId;
  try {
    const fork = pipeline.fork();
    const ok = await runComparison(fork, entries, {
      onRow: (index, row) => ctx.postMessage({ type: "compareRow", jobId, index, row }),
      progress: (fraction, _i, stage) => ctx.postMessage({ type: "progress", jobId, stage, fraction }),
      shouldAbort: () => activeCompare !== jobId,
      yieldNow,
    });
    ctx.postMessage({ type: "compareDone", jobId, cancelled: !ok });
  } catch (err) {
    ctx.postMessage({ type: "error", jobId, message: err instanceof Error ? err.message : String(err) });
  } finally {
    if (activeCompare === jobId) activeCompare = 0;
  }
}

/** Builds the ZIP; async because raster images are rendered on an OffscreenCanvas. */
async function exportJob(jobId: number, result: RunResult, settings: Settings, model: string) {
  try {
    const files = [...buildExportFiles(result, settings, model), ...(await buildRasterFiles(result, settings, model))];
    if (settings.exportStl) files.push({ name: "stacked.stl", mime: "model/stl", bytes: buildStackedStl(result) });
    if (settings.formats.includes("guide"))
      files.push({ name: "assembly.html", mime: "text/html", bytes: new TextEncoder().encode(buildAssemblyGuide(result, settings, model)) });
    if (files.length === 0) throw new Error("Nothing to export: select a format and make sure parts exist");
    const bytes = buildZip(files, buildReadme(result, settings, model, files));
    ctx.postMessage({ type: "file", jobId, name: `${model}_laser.zip`, mime: "application/zip", bytes }, [bytes.buffer]);
  } catch (err) {
    ctx.postMessage({ type: "error", jobId, message: err instanceof Error ? err.message : String(err) });
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
        latestRun = msg.jobId; // a run in flight belongs to the old mesh: it abandons itself
        activeCompare = 0; // so does a comparison
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
        const settings = {
          ...last.settings,
          formats: msg.formats,
          perLayerFiles: msg.perLayerFiles,
          dpi: msg.dpi,
          rasterStyle: msg.rasterStyle,
          rasterEngrave: msg.rasterEngrave,
          exportCut: msg.layers.cut,
          exportEngrave: msg.layers.engrave,
          exportLabel: msg.layers.label,
          exportBridge: msg.layers.bridge,
          exportSheet: msg.layers.sheet,
          exportInnerLayer: msg.layers.innerLayer,
          exportStl: msg.stl,
          // the estimate settings may have changed after the run (they never trigger one): use the current ones
          ...msg.estimate,
        };
        void exportJob(msg.jobId, last.result, settings, model);
        break;
      }
      case "compare":
        void compareJob(msg.jobId, msg.entries);
        break;
      case "cancel":
        if (activeCompare === msg.target) activeCompare = 0;
        break;
      case "run":
        latestRun = msg.jobId;
        void runJob(msg.jobId, msg.settings);
        break;
    }
  } catch (err) {
    ctx.postMessage({ type: "error", jobId: msg.jobId, message: err instanceof Error ? err.message : String(err) });
  }
};
