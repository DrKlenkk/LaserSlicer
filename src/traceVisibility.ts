// Which traces (CUT, ENGRAVE, LABEL, SHEET, previous layer) the Sheets and Layer views draw. One shared state for both
// views and their legends, persisted in the UI prefs. It only redraws: it never touches the settings or the pipeline.
import { loadUiPrefs, saveUiPrefs, type TraceId } from "./uiPrefs";

export class TraceVisibility {
  private hidden: Set<TraceId>;
  private listeners = new Set<() => void>();

  constructor(initial: Iterable<TraceId> = []) {
    this.hidden = new Set(initial);
  }

  visible(t: TraceId): boolean {
    return !this.hidden.has(t);
  }

  set(t: TraceId, visible: boolean) {
    if (this.visible(t) === visible) return;
    if (visible) this.hidden.delete(t);
    else this.hidden.add(t);
    this.listeners.forEach((f) => f());
  }

  hiddenList(): TraceId[] {
    return [...this.hidden];
  }

  subscribe(f: () => void) {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }
}

/** The app-wide instance, restored from and saved to the UI prefs. */
export const traceVisibility = new TraceVisibility(loadUiPrefs().hiddenTraces);
traceVisibility.subscribe(() => saveUiPrefs({ ...loadUiPrefs(), hiddenTraces: traceVisibility.hiddenList() }));
