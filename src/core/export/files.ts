// Builds the export files (per sheet or per layer, DXF and/or SVG) from a pipeline result.
import type { Settings } from "../types";
import type { RunResult } from "../pipeline";
import { layerLabel } from "../layers";
import { layerDrawing, sheetDrawing, type Drawing } from "./common";
import { writeDxf } from "./dxf";
import { writeSvg } from "./svg";

export type ExportFile = { name: string; mime: string; bytes: Uint8Array };
export type VectorFormat = "dxf" | "svg";

const enc = new TextEncoder();
const MIME: Record<VectorFormat, string> = { dxf: "application/dxf", svg: "image/svg+xml" };

/** File-name safe model name without extension. */
export function modelBaseName(fileName: string): string {
  const base = fileName.replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return base || "model";
}

export function encodeDrawing(d: Drawing, format: VectorFormat): Uint8Array {
  return enc.encode(format === "dxf" ? writeDxf(d) : writeSvg(d));
}

/**
 * Files for every selected vector format: `<model>_sheet01.dxf` per sheet, or `<model>_L012.dxf` per layer
 * when `perLayer` is set. Raster formats are not handled here (M7).
 */
export function buildExportFiles(
  result: RunResult,
  settings: Pick<Settings, "formats" | "perLayerFiles">,
  model: string,
): ExportFile[] {
  const formats = settings.formats.filter((f): f is VectorFormat => f === "dxf" || f === "svg");
  const files: ExportFile[] = [];
  const drawings: { stem: string; drawing: Drawing }[] = [];
  if (settings.perLayerFiles) {
    for (const layer of result.layers) {
      const parts = result.parts.filter((p) => p.layer === layer.index);
      if (parts.length === 0) continue;
      drawings.push({ stem: `${model}_${layerLabel(layer.index)}`, drawing: layerDrawing(parts) });
    }
  } else {
    for (const sh of result.sheets) {
      drawings.push({
        stem: `${model}_sheet${String(sh.index + 1).padStart(2, "0")}`,
        drawing: sheetDrawing(result.parts, result.placements, sh.index, sh.w, sh.h),
      });
    }
  }
  for (const { stem, drawing } of drawings)
    for (const f of formats) files.push({ name: `${stem}.${f}`, mime: MIME[f], bytes: encodeDrawing(drawing, f) });
  return files;
}
