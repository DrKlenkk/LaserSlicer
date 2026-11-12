// Promise-based wrapper around the slicer worker (main thread side).
import SlicerWorker from "./slicer.worker?worker&inline";
import type { FromWorker, LoadExt, ToWorker } from "./protocol";

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

type Pending = { resolve: (m: FromWorker) => void; reject: (e: Error) => void };

export class WorkerClient {
  private worker = new SlicerWorker();
  private pending = new Map<number, Pending>();
  private nextJob = 1;

  constructor(onFatal: (message: string) => void) {
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const p = this.pending.get(e.data.jobId);
      if (!p) return; // stale job
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

  private request(msg: DistributiveOmit<ToWorker, "jobId">, transfer: Transferable[] = []): Promise<FromWorker> {
    const jobId = this.nextJob++;
    return new Promise((resolve, reject) => {
      this.pending.set(jobId, { resolve, reject });
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
    const r = await this.request({ type: "load", buffer, ext }, [buffer]);
    if (r.type !== "loaded") throw new Error("Unexpected reply");
    return r;
  }
}
