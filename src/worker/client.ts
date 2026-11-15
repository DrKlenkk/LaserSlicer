// Promise-based wrapper around the slicer worker (main thread side).
import SlicerWorker from "./slicer.worker?worker&inline";
import type { FromWorker, LoadExt, ToWorker } from "./protocol";
import type { Settings } from "../core/types";

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

type Pending = {
  resolve: (m: FromWorker) => void;
  reject: (e: Error) => void;
  onProgress?: (stage: string, fraction: number) => void;
  onRow?: (index: number, row: CompareRow) => void;
};

/** Rejection reason for a run that was replaced by a newer one; callers should ignore it. */
export class StaleJobError extends Error {
  constructor() {
    super("Superseded by a newer job");
  }
}
import type { CompareEntry, CompareRow } from "../core/compare";
import type { EstimateSettings } from "../core/estimates";
import type { ExportLayers } from "../core/export/common";

export class WorkerClient {
  private worker = new SlicerWorker();
  private pending = new Map<number, Pending>();
  private nextJob = 1;

  constructor(onFatal: (message: string) => void) {
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const p = this.pending.get(e.data.jobId);
      if (!p) return; // stale job
      if (e.data.type === "progress") {
        p.onProgress?.(e.data.stage, e.data.fraction);
        return;
      }
      if (e.data.type === "compareRow") {
        p.onRow?.(e.data.index, e.data.row);
        return;
      }
      this.pending.delete(e.data.jobId);
      if (e.data.type === "error") p.reject(new Error(e.data.message));
      else p.resolve(e.data);
    };
    this.worker.onerror = (e) => {
      onFatal(e.message || "Worker crashed");
      for (const p of this.pending.values()) p.reject(new Error(e.message || "Worker crashed"));
      this.pending.clear();
    };
  }

  private request(
    msg: DistributiveOmit<ToWorker, "jobId">,
    transfer: Transferable[] = [],
    onProgress?: Pending["onProgress"],
    onRow?: Pending["onRow"],
  ): Promise<FromWorker> {
    const jobId = this.nextJob++;
    return new Promise((resolve, reject) => {
      this.pending.set(jobId, { resolve, reject, onProgress, onRow });
      this.worker.postMessage({ ...msg, jobId } as ToWorker, transfer);
    });
  }

  /** Round-trip time in ms. */
  async ping(): Promise<number> {
    const r = await this.request({ type: "ping", t: performance.now() });
    if (r.type !== "pong") throw new Error("Unexpected reply");
    return performance.now() - r.t;
  }

  async load(buffer: ArrayBuffer, ext: LoadExt) {
    this.dropRun(); // the worker abandons a run in flight when a model loads
    const r = await this.request({ type: "load", buffer, ext }, [buffer]);
    if (r.type !== "loaded") throw new Error("Unexpected reply");
    return r;
  }

  private runJob = 0;

  private dropRun() {
    if (!this.runJob) return;
    this.pending.get(this.runJob)?.reject(new StaleJobError());
    this.pending.delete(this.runJob);
    this.runJob = 0;
  }

  /**
   * Start a slicing run. Starting a new run abandons the previous one: its promise rejects with
   * StaleJobError and the worker drops its result.
   */
  async run(settings: Settings, onProgress?: Pending["onProgress"]) {
    this.dropRun();
    this.runJob = this.nextJob; // the id request() is about to assign
    const r = await this.request({ type: "run", settings }, [], onProgress);
    if (r.type !== "result") throw new Error("Unexpected reply");
    return r;
  }

  /**
   * Material comparison: `onRow` gets each row as soon as it is done, `onProgress` the overall fraction (0..1) and the index
   * of the entry being run. Resolves with `cancelled` true when `cancel()` (or a model load) ended it early. The main run,
   * its progress and its caches are not involved.
   */
  compare(entries: CompareEntry[], onRow: (index: number, row: CompareRow) => void, onProgress: (fraction: number, stage: string) => void) {
    const jobId = this.nextJob;
    const done = this.request({ type: "compare", entries }, [], (stage, f) => onProgress(f, stage), onRow).then((r) => {
      if (r.type !== "compareDone") throw new Error("Unexpected reply");
      return { cancelled: r.cancelled };
    });
    return { done, cancel: () => this.worker.postMessage({ type: "cancel", jobId: 0, target: jobId } satisfies ToWorker) };
  }

  /** ZIP of the last completed run (bytes arrive transferred, not copied). */
  async exportZip(model: string, o: { formats: Settings["formats"]; perLayerFiles: boolean; dpi: number; rasterStyle: Settings["rasterStyle"]; rasterEngrave: boolean; layers: ExportLayers; estimate: EstimateSettings }) {
    const r = await this.request({ type: "export", model, ...o });
    if (r.type !== "file") throw new Error("Unexpected reply");
    return r;
  }
}
