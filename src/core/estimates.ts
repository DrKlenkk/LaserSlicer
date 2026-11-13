// Estimates: weight, rough cutting time and material cost.
// Split in two on purpose. `measureParts` reads geometry only (so it runs in the worker with the slicing result and is cached
// with it); `estimate` turns the measurements and the four Material settings into weight / time / cost on the main thread, so
// changing density, speeds or price never starts a slicing run. Pure: no DOM, no clipper.
import type { Part, Vec2 } from "./types";
import { cutPathsByKind } from "./bridges";

/** Geometry measurements of one slicing result (mm, mm2, mm3). */
export type Measurements = {
  /** kerf-compensated cut paths: outer outlines, inner rings, dowel circles; bridged rings without their gaps (BRIDGE gaps not counted) */
  cutLength: number;
  /** engrave polylines plus label stroke polylines, as written to the files */
  engraveLength: number;
  /** summed part area before kerf (outer minus holes and cavities), mm2 */
  area: number;
  /** area x thickness, mm3: the volume of the glued stack (dowel holes and rods ignored) */
  volume: number;
  /** sheets used (partial sheets count whole) */
  sheets: number;
};

/** The four settings the estimates need. 0 means "not set". */
export type EstimateSettings = { density: number; cutSpeed: number; engraveSpeed: number; pricePerSheet: number };

/** What the estimates give; null = the setting it needs is not set. */
export type Estimates = {
  /** grams */
  weight: number | null;
  /** seconds, cutting and engraving together (ignores travel moves, acceleration and power ramps) */
  time: number | null;
  cutTime: number | null;
  engraveTime: number | null;
  /** price per sheet x sheets used */
  cost: number | null;
};

/** Length of a polyline as written (a closed one repeats its first point, so its closing segment is included). */
function pathLength(l: Vec2[]): number {
  let s = 0;
  for (let i = 1; i < l.length; i++) s += Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]);
  return s;
}

/** Perimeter of a closed ring (last point != first). */
function ringLength(r: Vec2[]): number {
  return r.length < 2 ? 0 : pathLength(r) + Math.hypot(r[0][0] - r[r.length - 1][0], r[0][1] - r[r.length - 1][1]);
}

/**
 * @param parts final (kerf-compensated, possibly bridged) parts
 * @param areaBeforeKerf summed area of the same parts before kerf compensation (mm2)
 * @param sheetCount number of sheets the nesting used
 */
export function measureParts(parts: Part[], areaBeforeKerf: number, thickness: number, sheetCount: number): Measurements {
  let cut = 0, engrave = 0;
  for (const p of parts) {
    const k = cutPathsByKind(p);
    for (const r of [...k.outerClosed, ...k.innerClosed]) cut += ringLength(r);
    for (const l of [...k.outerOpen, ...k.innerOpen]) cut += pathLength(l);
    for (const h of p.holes) cut += Math.PI * h.d;
    for (const l of p.engrave) engrave += pathLength(l);
    for (const l of p.label) engrave += pathLength(l);
  }
  return { cutLength: cut, engraveLength: engrave, area: areaBeforeKerf, volume: areaBeforeKerf * thickness, sheets: sheetCount };
}

const set = (v: number) => Number.isFinite(v) && v > 0;

export function estimate(m: Measurements, s: EstimateSettings): Estimates {
  const weight = set(s.density) ? (m.volume / 1000) * s.density : null; // mm3 -> cm3, g/cm3
  const cutTime = set(s.cutSpeed) ? m.cutLength / s.cutSpeed : null;
  const engraveTime = set(s.engraveSpeed) ? m.engraveLength / s.engraveSpeed : null;
  const time = cutTime === null && engraveTime === null ? null : (cutTime ?? 0) + (engraveTime ?? 0);
  const cost = set(s.pricePerSheet) ? s.pricePerSheet * m.sheets : null;
  return { weight, time, cutTime, engraveTime, cost };
}

// ---------- text ----------

const fmtLength = (mm: number) => (mm >= 10000 ? `${(mm / 1000).toFixed(2)} m` : `${mm.toFixed(0)} mm`);
const fmtVolume = (mm3: number) => `${(mm3 / 1000).toFixed(mm3 >= 1e6 ? 0 : 1)} cm3`;
const fmtWeight = (g: number) => (g >= 1000 ? `${(g / 1000).toFixed(2)} kg` : `${g.toFixed(0)} g`);
/** "1 h 05 min", "12 min", "45 s" */
export function formatDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)} s`;
  const min = Math.round(sec / 60);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
}
const fmtCost = (c: number) => c.toFixed(2);

/** The full list, one `label: value` entry per line (run info tooltip, ZIP README). Unset estimates are left out. */
export function estimateLines(m: Measurements, e: Estimates): string[] {
  const L = [`Cut length: ${fmtLength(m.cutLength)}`, `Engrave length: ${fmtLength(m.engraveLength)} (engrave lines and label strokes)`, `Glued volume: ${fmtVolume(m.volume)} (part area ${(m.area / 100).toFixed(1)} cm2 x thickness, before kerf)`];
  if (e.weight !== null) L.push(`Weight: ${fmtWeight(e.weight)}`);
  if (e.time !== null) {
    const parts = [e.cutTime !== null ? `cutting ${formatDuration(e.cutTime)}` : "cutting not included (no cut speed)", e.engraveTime !== null ? `engraving ${formatDuration(e.engraveTime)}` : "engraving not included (no engrave speed)"];
    L.push(`Cutting time (rough): about ${formatDuration(e.time)} (${parts.join(", ")}; travel moves and acceleration ignored)`);
  }
  if (e.cost !== null) L.push(`Material cost: ${fmtCost(e.cost)} (${m.sheets} sheet${m.sheets === 1 ? "" : "s"}, partial sheets count whole)`);
  return L;
}

/** Short form for the summary line: cut length, rough time if set, cost if set (weight instead of cost when no price is set). */
export function estimateSummary(m: Measurements, e: Estimates): string {
  const v = [`cut ${fmtLength(m.cutLength)}`];
  if (e.time !== null) v.push(`≈ ${formatDuration(e.time)}`);
  if (e.cost !== null) v.push(`cost ${fmtCost(e.cost)}`);
  else if (e.weight !== null && v.length < 3) v.push(fmtWeight(e.weight));
  return v.join(" · ");
}

/** README block (indented lines). */
export function estimateReadme(m: Measurements, s: EstimateSettings): string[] {
  const e = estimate(m, s);
  const L = ["Estimates (from the geometry and the Material settings; cutting time is rough)", ...estimateLines(m, e).map((l) => `  ${l}`)];
  const missing = [!set(s.density) && "density (weight)", !(set(s.cutSpeed) || set(s.engraveSpeed)) && "speeds (time)", !set(s.pricePerSheet) && "price per sheet (cost)"].filter(Boolean);
  if (missing.length) L.push(`  Not shown, setting is 0: ${missing.join(", ")}`);
  return L;
}

/** The four estimate settings of a settings object. */
export function estimateSettingsOf(s: EstimateSettings): EstimateSettings {
  return { density: s.density, cutSpeed: s.cutSpeed, engraveSpeed: s.engraveSpeed, pricePerSheet: s.pricePerSheet };
}
