// View preferences kept in the browser (not part of the project file, which holds slicing settings only).

/** The traces that can be hidden in the Sheets and Layer views (legend toggles). `ghost` is the previous layer of the Layer tab. */
export const TRACES = ["cut", "engrave", "label", "bridge", "sheet", "ghost"] as const;
export type TraceId = (typeof TRACES)[number];

export type UiPrefs = { autoUpdate: boolean; hiddenTraces: TraceId[]; /** opt-in: keep the last model in this browser and load it again at start-up (default off) */ restoreSession: boolean };

const KEY = "laserslicer.ui.v1";

export function parseUiPrefs(raw: string | null): UiPrefs {
  const prefs: UiPrefs = { autoUpdate: true, hiddenTraces: [], restoreSession: false };
  try {
    const o = raw ? (JSON.parse(raw) as Partial<UiPrefs> | null) : null;
    if (o && typeof o.autoUpdate === "boolean") prefs.autoUpdate = o.autoUpdate;
    if (o && typeof o.restoreSession === "boolean") prefs.restoreSession = o.restoreSession;
    if (o && Array.isArray(o.hiddenTraces)) prefs.hiddenTraces = TRACES.filter((t) => (o.hiddenTraces as unknown[]).includes(t));
  } catch {
    /* corrupt: defaults */
  }
  return prefs;
}

export function loadUiPrefs(): UiPrefs {
  try {
    return parseUiPrefs(localStorage.getItem(KEY));
  } catch {
    return parseUiPrefs(null);
  }
}

export function saveUiPrefs(p: UiPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: the preference lasts for this session only */
  }
}
