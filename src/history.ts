// Undo / redo history of settings snapshots. Pure: no DOM, no store, no clock (the caller passes the time).
// A step is the snapshot from before a change; undo swaps it with the current state.

/** How a change is recorded: "edit" = one control changed (rapid repeats on the same setting merge into one step),
 *  "step" = a bulk change that is always its own step (project load, preset, reset). */
export type StepKind = "edit" | "step";

/** Keys whose values differ between two snapshots (compared by value, so arrays and objects work). */
export function changedKeys<T extends object>(a: T, b: T): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: string[] = [];
  for (const k of keys) {
    if (JSON.stringify((a as Record<string, unknown>)[k]) !== JSON.stringify((b as Record<string, unknown>)[k])) out.push(k);
  }
  return out;
}

export const HISTORY_CAP = 100;
/** Changes to the same single setting closer together than this many ms are one step. */
export const HISTORY_MERGE_MS = 1000;

export class History<T extends object> {
  private past: T[] = [];
  private future: T[] = [];
  /** the one setting changed by the newest step, while that step may still absorb further edits */
  private mergeKey: string | null = null;
  private lastAt = -Infinity;

  constructor(private readonly cap = HISTORY_CAP, private readonly mergeMs = HISTORY_MERGE_MS) {}

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  get undoDepth() { return this.past.length; }
  get redoDepth() { return this.future.length; }

  /** Records the change before -> after made at time `now` (ms). Returns false when nothing changed (not recorded). */
  record(before: T, after: T, kind: StepKind, now: number): boolean {
    const keys = changedKeys(before, after);
    if (keys.length === 0) return false;
    this.future = [];
    const single = kind === "edit" && keys.length === 1 ? keys[0] : null;
    if (single !== null && this.mergeKey === single && now - this.lastAt <= this.mergeMs && this.past.length > 0) {
      this.lastAt = now;
      // typed there and back again: the step would change nothing, so drop it
      if (changedKeys(this.past[this.past.length - 1], after).length === 0) {
        this.past.pop();
        this.mergeKey = null;
      }
      return true;
    }
    this.past.push(structuredClone(before));
    if (this.past.length > this.cap) this.past.shift();
    this.mergeKey = single;
    this.lastAt = now;
    return true;
  }

  /** Steps back: returns the snapshot to apply (and remembers `current` for redo), or null when there is nothing to undo. */
  undo(current: T): T | null {
    const snap = this.past.pop();
    if (!snap) return null;
    this.future.push(structuredClone(current));
    this.mergeKey = null;
    return snap;
  }

  redo(current: T): T | null {
    const snap = this.future.pop();
    if (!snap) return null;
    this.past.push(structuredClone(current));
    this.mergeKey = null;
    return snap;
  }

  /** An unrecorded change (model load): writes the changed values into every stored snapshot, so undoing and redoing
   *  across it keeps them. Without this, undo would bring back the old value that no longer fits the model. */
  rebase(patch: Partial<T>) {
    for (const s of [...this.past, ...this.future]) Object.assign(s, structuredClone(patch));
  }

  clear() {
    this.past = [];
    this.future = [];
    this.mergeKey = null;
  }
}
