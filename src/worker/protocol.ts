// Message types between the UI (main thread) and the slicer worker.
export type ToWorker = { type: "ping"; jobId: number; t: number };
export type FromWorker = { type: "pong"; jobId: number; t: number };
