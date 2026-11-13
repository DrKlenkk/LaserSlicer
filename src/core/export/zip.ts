// ZIP bundle: all selected files plus README.txt (plan "ZIP and project file").
import { zipSync } from "fflate";
import type { Settings } from "../types";
import type { RunResult } from "../pipeline";
import { materialUse } from "../nest";
import { layerLabel } from "../layers";
import type { ExportFile } from "./files";
import { exportLayersOf } from "./common";
import { estimateReadme } from "../estimates";

export function buildReadme(result: RunResult, s: Settings, model: string, files: ExportFile[]): string {
  const L: string[] = [];
  const n = result.info.layerCount;
  L.push(`Laser Slicer export: ${model}`, "");
  L.push("Summary");
  L.push(`  Layers: ${n}`);
  L.push(`  Parts: ${result.parts.length}`);
  L.push(`  Sheets: ${result.sheets.length} (${s.sheetW} x ${s.sheetH} mm), material use ${materialUse(result.sheets).toFixed(1)} %`);
  for (const sh of result.sheets) L.push(`    sheet ${sh.index + 1}: ${sh.partIds.length} parts, ${sh.usePct.toFixed(1)} % used`);
  L.push("");
  L.push(...estimateReadme(result.measure, s));
  L.push("");
  L.push("Settings used");
  L.push(`  Axis: ${s.axis}, extra rotation steps (X,Y,Z): ${s.rotationSteps.join(",")}`);
  L.push(`  Scale: ${(result.info.scale * 100).toFixed(2)} %, model size ${result.info.size.map((v) => v.toFixed(2)).join(" x ")} mm`);
  L.push(`  Material thickness: ${s.thickness} mm, kerf: ${s.kerf} mm, part spacing: ${s.partSpacing} mm, sheet margin: ${s.sheetMargin} mm`);
  L.push(`  Mode: ${s.mode}, samples per layer: ${s.samplesPerLayer}, simplify tolerance: ${s.simplifyTol} mm, smoothing radius: ${s.smoothRadius > 0 ? `${s.smoothRadius} mm` : "off"}`);
  L.push(`  Min part area: ${s.minPartArea} mm2, min feature: ${s.minFeature} mm`);
  L.push(`  Formats: ${s.formats.join(", ")}, files per ${s.perLayerFiles ? "layer" : "sheet"}`);
  const EL = exportLayersOf(s);
  const layerList = [["CUT", EL.cut], ["ENGRAVE", EL.engrave], ["LABEL", EL.label], ...(s.bridgesEnabled ? [["BRIDGE", EL.bridge] as const] : []), ["SHEET border", EL.sheet]] as const;
  const incl = layerList.filter(([, on]) => on).map(([n]) => n);
  const excl = layerList.filter(([, on]) => !on).map(([n]) => n);
  L.push(`  Layers included: ${incl.join(", ") || "none"}${excl.length ? ` (left out: ${excl.join(", ")})` : ""}`);
  if (s.bridgesEnabled) {
    const gap = s.bridgeWidth + Math.max(0, s.kerf);
    const nb = result.parts.reduce((n, p) => n + (p.bridges ?? []).reduce((m, b) => m + b.gaps.length, 0), 0);
    L.push(`  Holding bridges: ${nb} (${s.bridgeCount} per outline, ${s.bridgeWidth} mm of material left after the kerf = gap of ${gap.toFixed(2)} mm in the cut path, outlines of at least ${s.bridgeMinLength} mm${s.bridgeHoles ? ", inner holes included" : ""}${s.bridgeMaxSpacing > 0 ? `, at most ${s.bridgeMaxSpacing} mm apart` : ""})`);
    L.push(EL.bridge ? "  Bridges are on DXF layer BRIDGE (SVG group BRIDGE): run it at low power / high speed so it scores but does not cut through, or leave the layer out for plain uncut tabs." : "  BRIDGE is not included: the gaps are left out, so the cut outlines have uncut tabs.");
  }
  L.push(EL.innerLayer && EL.cut
    ? "  Inner cuts: holes, cavities and dowel holes are on DXF layer CUT_INNER (SVG group CUT_INNER, orange); only the outer outlines are on CUT. Cut CUT_INNER first, then CUT. PNG and JPG images ignore this and show everything as before."
    : "  Inner cuts (holes, cavities, dowel holes) are written before the outer outlines in every part's DXF and SVG data.");
  if (!EL.cut) L.push("  Note: CUT is not included, so these files do not cut the parts out.");
  if (s.formats.includes("png") || s.formats.includes("jpg"))
    L.push(`  Raster images: ${s.dpi} DPI, ${s.rasterStyle} style${s.rasterEngrave && (EL.engrave || EL.label) ? ", engrave and labels in grey" : ""}; not suitable for cutting without tracing`);
  L.push("");
  L.push("Stacking order");
  L.push(`  Cut every part face-up and stack bottom-up without flipping: ${layerLabel(0)} is the bottom layer${n > 1 ? `, ${layerLabel(n - 1)} the top` : ""}.`);
  L.push("  Glue each layer onto the one below it; align it to the engraved outline of the next layer where one exists.");
  L.push("");
  L.push(`DXF layers: CUT (red), ENGRAVE (blue), LABEL (green), ${s.bridgesEnabled ? "BRIDGE (magenta), " : ""}${EL.innerLayer && EL.cut ? "CUT_INNER (orange, inner cuts: cut first), " : ""}SHEET (grey). Units: mm, Y up, R12 (AC1009).`);
  L.push("");
  L.push("Files");
  for (const f of files) L.push(`  ${f.name}`);
  L.push("");
  L.push(`Warnings (${result.warnings.length})`);
  if (result.warnings.length === 0) L.push("  none");
  for (const w of result.warnings) L.push(`  [${w.level}] ${w.message}`);
  return L.join("\n") + "\n";
}

/** ZIP of the files plus README.txt. */
export function buildZip(files: ExportFile[], readme: string): Uint8Array {
  const entries: Record<string, Uint8Array | [Uint8Array, { level: 0 | 6 }]> = {};
  // PNG and JPG are compressed already: store them.
  for (const f of files) entries[f.name] = /\.(png|jpg)$/.test(f.name) ? [f.bytes, { level: 0 }] : f.bytes;
  entries["README.txt"] = new TextEncoder().encode(readme);
  return zipSync(entries, { level: 6 });
}
