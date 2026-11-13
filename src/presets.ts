// Material presets: a named set of the Material group values, kept in the browser (own localStorage key, not part of the
// project file). Pure parts (validation, matching, applying) are separate from the storage wrapper so tests need no DOM.
import type { Settings } from "./core/types";

export const PRESET_FIELDS = ["thickness", "sheetW", "sheetH", "kerf", "partSpacing", "sheetMargin", "density", "cutSpeed", "engraveSpeed", "pricePerSheet"] as const;
export type PresetField = (typeof PRESET_FIELDS)[number];
export type PresetValues = Partial<Pick<Settings, PresetField>>;
export type Preset = { name: string; values: PresetValues };

export const PRESETS_KEY = "laserslicer.presets.v1";
export const MAX_PRESETS = 50;
export const MAX_NAME = 60;

/** Fields that must be greater than zero (all others: zero or more). */
const POSITIVE: readonly PresetField[] = ["thickness", "sheetW", "sheetH"];

/**
 * Built-in presets. They are starting points only: kerf depends on the laser, and speeds and price on the machine and the
 * shop, so these leave speeds and price out (applying one keeps the user's own). Not stored, not deletable.
 */
export const STARTER_PRESETS: readonly Preset[] = [
  { name: "3 mm plywood (starting point)", values: { thickness: 3, sheetW: 600, sheetH: 400, kerf: 0.15, partSpacing: 3, sheetMargin: 5, density: 0.65 } },
  { name: "4 mm plywood (starting point)", values: { thickness: 4, sheetW: 600, sheetH: 400, kerf: 0.15, partSpacing: 3, sheetMargin: 5, density: 0.65 } },
  { name: "6 mm plywood (starting point)", values: { thickness: 6, sheetW: 600, sheetH: 400, kerf: 0.2, partSpacing: 3, sheetMargin: 5, density: 0.65 } },
];

export const normalizeName = (n: string) => n.trim().replace(/\s+/g, " ").slice(0, MAX_NAME);
const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Keeps the valid fields of a values object; null when nothing valid is left. */
export function cleanValues(v: unknown): PresetValues | null {
  if (!v || typeof v !== "object") return null;
  const out: PresetValues = {};
  for (const k of PRESET_FIELDS) {
    const x = (v as Record<string, unknown>)[k];
    if (typeof x !== "number" || !Number.isFinite(x)) continue;
    if (POSITIVE.includes(k) ? !(x > 0) : x < 0) continue;
    out[k] = x;
  }
  return Object.keys(out).length ? out : null;
}

/** Reads the stored text; entries that are not valid are dropped (also duplicates by name, starter names, and anything past the limit). */
export function parsePresets(raw: string | null): Preset[] {
  const out: Preset[] = [];
  try {
    const a = raw ? (JSON.parse(raw) as unknown) : null;
    if (!Array.isArray(a)) return out;
    for (const e of a) {
      if (out.length >= MAX_PRESETS) break;
      if (!e || typeof e !== "object" || typeof (e as Preset).name !== "string") continue;
      const name = normalizeName((e as Preset).name);
      const values = cleanValues((e as Preset).values);
      if (!name || !values) continue;
      if (isReserved(name) || out.some((p) => sameName(p.name, name))) continue;
      out.push({ name, values });
    }
  } catch {
    /* corrupt: no presets */
  }
  return out;
}

export const isReserved = (name: string) => STARTER_PRESETS.some((p) => sameName(p.name, name));

/** The Material values of the settings, as a preset's values (all fields). */
export function presetValuesOf(s: Settings): PresetValues {
  const v: PresetValues = {};
  for (const k of PRESET_FIELDS) v[k] = s[k];
  return v;
}

/** Settings with the preset's values applied (fields the preset lacks stay as they are). */
export function applyPreset(s: Settings, p: Preset): Settings {
  return { ...s, ...p.values };
}

/** True when every value of the preset equals the setting (so the dropdown can show it as selected). */
export function matchesPreset(s: Settings, p: Preset): boolean {
  return PRESET_FIELDS.every((k) => p.values[k] === undefined || p.values[k] === s[k]);
}

type Storage_ = Pick<Storage, "getItem" | "setItem">;

/** User presets with persistence. Storage failures never throw: the presets then last for this session only (`persisted` is false). */
export class PresetStore {
  private items: Preset[] = [];
  persisted = true;

  constructor(private readonly storage: Storage_ | null | undefined = defaultStorage()) {
    try {
      this.items = parsePresets(this.storage ? this.storage.getItem(PRESETS_KEY) : null);
    } catch {
      this.items = [];
      this.persisted = false;
    }
  }

  /** User presets, sorted by name. */
  list(): Preset[] {
    return [...this.items].sort((a, b) => a.name.localeCompare(b.name));
  }
  /** Starters first, then user presets. */
  all(): Preset[] {
    return [...STARTER_PRESETS, ...this.list()];
  }
  find(name: string): Preset | undefined {
    return this.all().find((p) => sameName(p.name, name));
  }
  isUser(name: string) {
    return this.items.some((p) => sameName(p.name, name));
  }
  /** Would saving under this name replace a user preset? */
  exists(name: string) {
    return this.isUser(normalizeName(name));
  }

  /** Saves (adds or replaces by name). Returns an error sentence, or null on success. */
  save(rawName: string, values: PresetValues): string | null {
    const name = normalizeName(rawName);
    if (!name) return "Enter a name for the preset";
    if (isReserved(name)) return `"${name}" is a built-in starting point; choose another name`;
    const clean = cleanValues(values);
    if (!clean) return "There are no valid values to save";
    const i = this.items.findIndex((p) => sameName(p.name, name));
    if (i >= 0) this.items[i] = { name, values: clean };
    else if (this.items.length >= MAX_PRESETS) return `At most ${MAX_PRESETS} presets can be saved; delete one first`;
    else this.items.push({ name, values: clean });
    this.persist();
    return null;
  }

  delete(name: string): boolean {
    const i = this.items.findIndex((p) => sameName(p.name, name));
    if (i < 0) return false;
    this.items.splice(i, 1);
    this.persist();
    return true;
  }

  private persist() {
    try {
      if (!this.storage) throw new Error("no storage");
      this.storage.setItem(PRESETS_KEY, JSON.stringify(this.items));
      this.persisted = true;
    } catch {
      this.persisted = false;
    }
  }
}

function defaultStorage(): Storage_ | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}
