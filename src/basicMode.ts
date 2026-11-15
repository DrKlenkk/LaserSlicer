// Basic mode: which settings the user controls there, and what every other setting is fixed to. The stored settings are
// never changed by the mode; the pipeline, the slicing key, the estimates, the export and the project file use the
// "effective" settings (stored settings with every non-Basic key replaced), so Expert values come back unchanged.
import type { Settings } from "./core/types";
import { DEFAULT_SETTINGS, type AppState } from "./state";

/** Settings the Basic panel shows and edits: they come from the stored settings. `formats` is one of them, minus "guide". */
export const BASIC_STORED_KEYS = [
  "axis", "rotationSteps", "importUnit", "scale", "targetSize", // Model group
  "thickness", "sheetW", "sheetH", "kerf", // Material group (the preset dropdown writes more keys, which only Expert uses)
  "formats", // Export: DXF / SVG / PNG / JPG
] as const satisfies readonly (keyof Settings)[];

/**
 * Values that differ from DEFAULT_SETTINGS (or that matter enough to state explicitly): only the cut outlines are
 * exported. Every other non-Basic key takes its DEFAULT_SETTINGS value.
 */
export const BASIC_OVERRIDES: Partial<Settings> = {
  engraveNextOutline: false,
  labels: false,
  dowels: false,
  bridgesEnabled: false,
  hollowEnabled: false,
  offcutEnabled: false, // Basic always nests on full sheets
  exportCut: true,
  exportEngrave: false,
  exportLabel: false,
  exportBridge: false,
  exportSheet: false,
  exportInnerLayer: false,
  exportStl: false,
  perLayerFiles: false,
  rangeFrom: null,
  rangeTo: null,
};

/** The settings Basic mode runs with (a new object; `s` is not changed). */
export function basicSettings(s: Settings): Settings {
  const out = structuredClone(DEFAULT_SETTINGS) as Settings;
  const o = out as unknown as Record<string, unknown>;
  const src = s as unknown as Record<string, unknown>;
  for (const k of BASIC_STORED_KEYS) o[k] = structuredClone(src[k]);
  out.formats = out.formats.filter((f) => f !== "guide"); // the assembly guide is an Expert format
  Object.assign(out, structuredClone(BASIC_OVERRIDES));
  return out;
}

/** What slicing, estimates, export and the project file use: the stored settings in Expert mode, the Basic values in Basic mode. */
export function effectiveSettings(st: Pick<AppState, "settings" | "uiMode">): Settings {
  return st.uiMode === "basic" ? basicSettings(st.settings) : st.settings;
}
