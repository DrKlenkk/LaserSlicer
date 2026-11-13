// Decides when the slicing preview is out of date and when a run is due. No DOM, no worker: main.ts feeds it events
// (settings changed, model loaded, run started / finished) and acts on the returned RunAction.
import type { Settings } from "./core/types";

/** What the caller should do after an event: nothing, start a run after the debounce delay, or start one now. */
export type RunAction = "none" | "debounced" | "immediate";

/** Settings that only affect the export step, never the slicing result. Changing them leaves the preview current. */
const EXPORT_ONLY = ["formats", "perLayerFiles", "dpi", "rasterStyle", "rasterEngrave", "exportCut", "exportEngrave", "exportLabel", "exportBridge", "exportSheet", "exportInnerLayer"] as const;

/** Stable key of the settings that affect slicing; equal keys mean the same result. */
export function slicingKey(s: Settings): string {
  const rest: Record<string, unknown> = { ...s };
  for (const k of EXPORT_ONLY) delete rest[k];
  return JSON.stringify(rest, Object.keys(rest).sort());
}

export class UpdateController {
  private _stale = false;
  private _running = false;
  private runId = 0;
  private listeners = new Set<() => void>();

  constructor(private _auto = true) {}

  /** Automatic updates on: every change starts a (debounced) run. */
  get auto() { return this._auto; }
  /** The shown result does not match the current settings or model (or there is none yet). */
  get stale() { return this._stale; }
  get running() { return this._running; }
  /** The "Update preview" button is shown: manual mode and something to update or a run in progress. */
  get showButton() { return !this._auto && (this._stale || this._running); }
  /** Export must run the pipeline first. */
  get needsRun() { return this._stale; }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() { for (const l of this.listeners) l(); }

  /** A setting that affects slicing changed. */
  settingsChanged(): RunAction {
    this._stale = true;
    this.emit();
    return this._auto ? "debounced" : "none";
  }

  /** A new model was loaded: any run in progress belonged to the old model and is dropped. */
  modelLoaded(): RunAction {
    this._stale = true;
    this._running = false;
    this.runId++;
    this.emit();
    return this._auto ? "immediate" : "none";
  }

  setAuto(on: boolean): RunAction {
    if (on === this._auto) return "none";
    this._auto = on;
    this.emit();
    return on && this._stale ? "immediate" : "none";
  }

  /** A run starts with the current settings (and replaces any run in progress). Returns its id. */
  runStarted(): number {
    this._running = true;
    this._stale = false;
    const id = ++this.runId;
    this.emit();
    return id;
  }

  /** True while `id` is the newest run: only then may its result be shown. */
  isCurrent(id: number) { return id === this.runId; }

  /** The run finished and its result was shown. Ignored (false) for a superseded run. */
  runFinished(id: number): boolean {
    if (id !== this.runId) return false;
    this._running = false;
    this.emit();
    return true;
  }

  /** The run failed or was cancelled: the preview stays out of date so it can be retried. */
  runFailed(id: number): boolean {
    if (id !== this.runId) return false;
    this._running = false;
    this._stale = true;
    this.emit();
    return true;
  }
}
