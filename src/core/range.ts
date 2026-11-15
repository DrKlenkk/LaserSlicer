// Layer range for the export ("recut layers 12 to 15"). Pure, no DOM. Layer numbers are the 0-based indices the UI shows
// (Layer tab "Layer 12 of 40", part ids L012).

/** The settings' range resolved against a model with `count` layers. */
export type LayerRange = {
  /** first and last layer included (inclusive); from > to only for a model without layers */
  from: number;
  to: number;
  /** every layer is included (the default) */
  all: boolean;
  /** the requested values had to be changed: outside the model's layers, or from after to (then they are swapped) */
  clamped: boolean;
};

/**
 * `from` / `to` of null mean "no limit" (first / last layer). Values outside 0..count-1 are clamped; a reversed pair is swapped.
 * A range entirely outside the model collapses to its nearest end layer, so the export is never silently empty.
 */
export function resolveRange(count: number, from: number | null | undefined, to: number | null | undefined): LayerRange {
  if (count <= 0) return { from: 0, to: -1, all: true, clamped: false };
  const last = count - 1;
  const reqFrom = from ?? 0, reqTo = to ?? last;
  const c = (v: number) => Math.max(0, Math.min(last, Math.round(v)));
  let lo = c(reqFrom), hi = c(reqTo);
  if (lo > hi) [lo, hi] = [hi, lo];
  return { from: lo, to: hi, all: lo === 0 && hi === last, clamped: lo !== reqFrom || hi !== reqTo };
}

/** Parts of a result that are in its range (all of them when the range is "all"). */
export function partsInRange<T extends { layer: number }>(parts: T[], range: LayerRange | undefined): T[] {
  return !range || range.all ? parts : parts.filter((p) => p.layer >= range.from && p.layer <= range.to);
}

/** "only layers 12 to 15 (L012 to L015) (model has layers 0 to 39)" style text used by the UI and the README; empty when all layers are included. */
export function rangeText(range: LayerRange | undefined, count: number): string {
  if (!range || range.all) return "";
  const l = (i: number) => `L${String(i).padStart(3, "0")}`;
  return range.from === range.to ? `only layer ${range.from} (${l(range.from)}) (model has layers 0 to ${count - 1})` : `only layers ${range.from} to ${range.to} (${l(range.from)} to ${l(range.to)}) (model has layers 0 to ${count - 1})`;
}
