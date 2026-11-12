// View preferences kept in the browser (not part of the project file, which holds slicing settings only).
export type UiPrefs = { autoUpdate: boolean };

const KEY = "laserslicer.ui.v1";

export function parseUiPrefs(raw: string | null): UiPrefs {
  const prefs: UiPrefs = { autoUpdate: true };
  try {
    const o = raw ? (JSON.parse(raw) as Partial<UiPrefs> | null) : null;
    if (o && typeof o.autoUpdate === "boolean") prefs.autoUpdate = o.autoUpdate;
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
