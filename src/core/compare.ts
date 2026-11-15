// Material comparison: the same model run with the current settings and with each material preset, one row of numbers per run.
// Pure (no DOM, no worker): the worker calls `runComparison` with a forked pipeline, tests call it in Node.
import type { Settings } from "./types";
import type { Pipeline, RunResult } from "./pipeline";
import { estimate, estimateSettingsOf } from "./estimates";
import { materialUse } from "./nest";

/** One run of the comparison: a display name and the complete settings to run (current settings with the material values replaced). */
export type CompareEntry = { name: string; settings: Settings; /** the row of the user's current settings */ current: boolean };

/** One row of the table. Numbers that need an unset estimate setting (speeds, price, density) are null. */
export type CompareRow = {
  name: string;
  current: boolean;
  thickness: number;
  sheetW: number;
  sheetH: number;
  layers: number;
  parts: number;
  sheets: number;
  /** material use over the used sheets, percent */
  usePct: number;
  cutLength: number;
  /** seconds, null when neither speed is set */
  time: number | null;
  /** grams, null when density is 0 */
  weight: number | null;
  /** null when the price is 0 */
  cost: number | null;
  /** warnings of level warn or error (info notes are not counted) */
  warnings: number;
  /** of those, the errors */
  errors: number;
  /** set when the run failed; the numbers are then 0 */
  error?: string;
};

/** The settings of a comparison run: the current settings with the preset's values on top. The layer range is dropped
 *  (layer numbers mean something else at another thickness, and "which material" needs the whole model). */
export function comparisonSettings(current: Settings, values: Partial<Settings>): Settings {
  return { ...current, ...values, rangeFrom: null, rangeTo: null };
}

/** Numbers of one finished run. Pure function of the result and the settings it ran with. */
export function compareRow(entry: CompareEntry, r: RunResult): CompareRow {
  const s = entry.settings;
  const e = estimate(r.measure, estimateSettingsOf(s));
  const warnings = r.warnings.filter((w) => w.level !== "info");
  return {
    name: entry.name,
    current: entry.current,
    thickness: s.thickness,
    sheetW: s.sheetW,
    sheetH: s.sheetH,
    layers: r.info.layerCount,
    parts: r.parts.length,
    sheets: r.sheets.length,
    usePct: materialUse(r.sheets),
    cutLength: r.measure.cutLength,
    time: e.time,
    weight: e.weight,
    cost: e.cost,
    warnings: warnings.length,
    errors: warnings.filter((w) => w.level === "error").length,
  };
}

export function failedRow(entry: CompareEntry, message: string): CompareRow {
  const s = entry.settings;
  return { name: entry.name, current: entry.current, thickness: s.thickness, sheetW: s.sheetW, sheetH: s.sheetH, layers: 0, parts: 0, sheets: 0, usePct: 0, cutLength: 0, time: null, weight: null, cost: null, warnings: 0, errors: 0, error: message };
}

export type CompareHooks = {
  /** a row is complete (rows arrive in the order of `entries`) */
  onRow(index: number, row: CompareRow): void;
  /** overall progress 0..1, the index of the entry being run and the pipeline's stage name */
  progress?(fraction: number, index: number, stage: string): void;
  shouldAbort?(): boolean;
  yieldNow?(): Promise<void>;
};

/**
 * Runs the entries one after another on `pipeline`, which must be a fork of the main pipeline (see `Pipeline.fork`): it has
 * its own stage caches, so the main preview's caches and `last` result are never touched. Consecutive entries with the same
 * thickness (or kerf, sheet size, ...) reuse the earlier stages of this private pipeline like any pipeline runs do.
 * A run that throws becomes a row with an error text and the comparison goes on. Returns false when aborted (no row for the
 * entry that was cut short), true when every entry has a row.
 */
export async function runComparison(pipeline: Pipeline, entries: CompareEntry[], hooks: CompareHooks): Promise<boolean> {
  for (let i = 0; i < entries.length; i++) {
    if (hooks.shouldAbort?.()) return false;
    const entry = entries[i];
    let row: CompareRow;
    try {
      const r = await pipeline.run(entry.settings, {
        progress: (stage, f) => hooks.progress?.((i + f) / entries.length, i, stage),
        shouldAbort: hooks.shouldAbort,
        yieldNow: hooks.yieldNow,
      });
      if (!r) return false; // aborted inside the run
      row = compareRow(entry, r);
    } catch (err) {
      row = failedRow(entry, err instanceof Error ? err.message : String(err));
    }
    hooks.onRow(i, row);
    hooks.progress?.((i + 1) / entries.length, i, "Done");
    if (hooks.yieldNow) await hooks.yieldNow(); // let a cancel message arrive between rows
  }
  return true;
}

/** Indices of the best rows (lowest value, only among rows without an error and with a value) for the columns where
 *  a lower number is better. Empty for a column when fewer than two rows have a value or all values are equal. */
export function bestRows(rows: (CompareRow | undefined)[]): { sheets: Set<number>; cost: Set<number>; time: Set<number> } {
  const pick = (get: (r: CompareRow) => number | null) => {
    const vals: [number, number][] = [];
    rows.forEach((r, i) => {
      const v = r && !r.error ? get(r) : null;
      if (v !== null && v > 0) vals.push([i, v]);
    });
    const out = new Set<number>();
    if (vals.length < 2) return out;
    const min = Math.min(...vals.map((v) => v[1]));
    if (vals.every((v) => v[1] === min)) return out;
    for (const [i, v] of vals) if (v === min) out.add(i);
    return out;
  };
  return { sheets: pick((r) => r.sheets), cost: pick((r) => r.cost), time: pick((r) => r.time) };
}
