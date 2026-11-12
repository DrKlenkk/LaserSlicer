// Slicer worker: all heavy geometry runs here, never on the main thread.
import type { FromWorker, ToWorker } from "./protocol";

const ctx = self as unknown as {
  postMessage(msg: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
};

ctx.onmessage = (e) => {
  const msg = e.data;
  switch (msg.type) {
    case "ping":
      ctx.postMessage({ type: "pong", jobId: msg.jobId, t: msg.t });
      break;
  }
};
