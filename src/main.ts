import "./style.css";
import SlicerWorker from "./worker/slicer.worker?worker&inline";
import type { FromWorker } from "./worker/protocol";

const app = document.getElementById("app")!;
app.innerHTML = `<main class="m0"><h1>Laser Slicer</h1><p id="status">Starting worker…</p></main>`;
const status = document.getElementById("status")!;

const worker = new SlicerWorker();
worker.onerror = (e) => {
  status.textContent = `Worker error: ${e.message}`;
  status.className = "err";
};
worker.onmessage = (e: MessageEvent<FromWorker>) => {
  if (e.data.type === "pong") {
    const ms = performance.now() - e.data.t;
    status.textContent = `Worker ready (ping/pong ${ms.toFixed(1)} ms)`;
  }
};
worker.postMessage({ type: "ping", jobId: 1, t: performance.now() });
