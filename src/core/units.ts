// Import units: STL and OBJ carry no units, 3MF declares one. The unit is a plain factor to millimetres that is
// applied together with (but separate from) the scale in the orient stage. Pure code: runs in the worker and in Node.
import { unzipSync } from "fflate";

export type ImportUnit = "micron" | "mm" | "cm" | "m" | "in" | "ft";

/** Millimetres per model unit. */
export const IMPORT_UNIT_MM: Record<ImportUnit, number> = {
  micron: 0.001,
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  ft: 304.8,
};

/** Dropdown order and labels. */
export const IMPORT_UNIT_OPTIONS: [ImportUnit, string][] = [
  ["micron", "micron (µm)"],
  ["mm", "millimetre (mm)"],
  ["cm", "centimetre (cm)"],
  ["m", "metre (m)"],
  ["in", "inch (in)"],
  ["ft", "foot (ft)"],
];

export const IMPORT_UNITS = Object.keys(IMPORT_UNIT_MM) as ImportUnit[];

export function importUnitFactor(u: ImportUnit): number {
  return IMPORT_UNIT_MM[u] ?? 1;
}

/** 3MF `unit` attribute values (core specification) mapped to import units. */
const THREEMF_UNITS: Record<string, ImportUnit> = {
  micron: "micron",
  millimeter: "mm",
  centimeter: "cm",
  meter: "m",
  inch: "in",
  foot: "ft",
};

/** The 3MF spelling of each unit, for messages. */
export const THREEMF_UNIT_NAME: Record<ImportUnit, string> = {
  micron: "micron", mm: "millimeter", cm: "centimeter", m: "meter", in: "inch", ft: "foot",
};

export const THREEMF_UNIT_PLURAL: Record<ImportUnit, string> = {
  micron: "microns", mm: "millimeters", cm: "centimeters", m: "meters", in: "inches", ft: "feet",
};

const text = (b: Uint8Array) => new TextDecoder().decode(b);

/**
 * Unit declared by the model part of a 3MF archive. Looks up the model part through `_rels/.rels` (the
 * `3dmodel` relationship), falling back to the first `*.model` file. Returns "mm" when the attribute is absent (the
 * format's default) and null when the archive cannot be read or the value is not one the format allows.
 * three's 3MFLoader parses the attribute but does not apply it, so there is no double scaling.
 */
export function read3mfUnit(bytes: Uint8Array): ImportUnit | null {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => /\.(model|rels)$/i.test(f.name) });
  } catch {
    return null;
  }
  const names = Object.keys(files);
  const rels = names.find((n) => n.toLowerCase() === "_rels/.rels");
  let modelName: string | undefined;
  if (rels) {
    for (const m of text(files[rels]).matchAll(/<Relationship\b[^>]*>/gi)) {
      const tag = m[0];
      if (!/Type\s*=\s*["'][^"']*3dmodel["']/i.test(tag)) continue;
      const t = /Target\s*=\s*["']([^"']+)["']/i.exec(tag);
      if (!t) continue;
      const path = t[1].replace(/^\/+/, "");
      modelName = names.find((n) => n.toLowerCase() === path.toLowerCase());
      if (modelName) break;
    }
  }
  modelName ??= names.find((n) => /\.model$/i.test(n));
  if (!modelName) return null;
  const tag = /<(?:[\w-]+:)?model\b[^>]*>/i.exec(text(files[modelName]));
  if (!tag) return null;
  const u = /\bunit\s*=\s*["']([^"']*)["']/i.exec(tag[0]);
  if (!u) return "mm";
  return THREEMF_UNITS[u[1].trim().toLowerCase()] ?? null;
}
