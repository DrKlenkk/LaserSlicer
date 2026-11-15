// First sheet as an offcut or a partly used sheet: its size and rectangular blocked areas. Pure, no DOM.
// Coordinates of blocked areas are in the first sheet's own system, like the exported files: origin lower-left, Y up, mm.
import type { Settings } from "./types";

export type BlockedArea = { x: number; y: number; w: number; h: number };

/** Upper limit of blocked areas (the list in the panel and the project file). */
export const MAX_BLOCKED = 50;

export function isBlockedArea(v: unknown): v is BlockedArea {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  const fin = (k: string) => typeof o[k] === "number" && Number.isFinite(o[k] as number);
  return fin("x") && fin("y") && fin("w") && fin("h") && (o.w as number) > 0 && (o.h as number) > 0;
}

/** The valid blocked areas of an unchecked value (browser storage, older files): invalid entries are dropped, at most MAX_BLOCKED. */
export function cleanBlocked(v: unknown): BlockedArea[] {
  return Array.isArray(v) ? v.filter(isBlockedArea).slice(0, MAX_BLOCKED).map(({ x, y, w, h }) => ({ x, y, w, h })) : [];
}

type OffcutSettings = Pick<Settings, "sheetW" | "sheetH"> & Partial<Pick<Settings, "offcutEnabled" | "offcutW" | "offcutH" | "blockedAreas">>;

/** Size of the first sheet: the offcut size where given (0 = same as the sheet), else the sheet size. */
export function firstSheetSize(s: OffcutSettings): { w: number; h: number } {
  if (!s.offcutEnabled) return { w: s.sheetW, h: s.sheetH };
  return { w: (s.offcutW ?? 0) > 0 ? s.offcutW! : s.sheetW, h: (s.offcutH ?? 0) > 0 ? s.offcutH! : s.sheetH };
}

/** Blocked areas that apply (none unless the offcut option is on). */
export function activeBlocked(s: OffcutSettings): BlockedArea[] {
  return s.offcutEnabled ? cleanBlocked(s.blockedAreas) : [];
}

/** x of the left edge of every sheet when sheets of different widths are drawn side by side with `gap` between them. */
export function sheetOrigins(widths: readonly number[], gap: number): number[] {
  const out: number[] = [];
  let x = 0;
  for (const w of widths) {
    out.push(x);
    x += w + gap;
  }
  return out;
}
