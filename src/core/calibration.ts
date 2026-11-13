// Calibration sheet: a small drawing (about 160 x 80 mm) with a kerf test and a dowel test. Pure geometry plus the file bundle;
// no DOM, no clipper (all shapes are rectangles and circles). Y up, origin lower-left, mm.
//
// Kerf test: KERF_VALUES.length pairs of a nominal 20 mm square and a 20 mm square hole. For a test kerf k the square's cut path is
// outset by k/2 and the hole's cut path inset by k/2, exactly as the slicer compensates parts and holes. If the real kerf equals k,
// the burn removes k from each side's path distance and square and hole both come out 20.00 mm, so the pair fits snugly.
// The holes sit in one strip (a part with 7 holes), each square is a separate part directly below its hole, labels are engraved
// inside the square and inside the strip below the hole.
//
// Dowel test: DOWEL_OFFSETS.length round holes with diameter D + offset (D = the Dowel diameter setting). The label is the value to
// enter as "Dowel diameter"; the drawn circle is that value minus the kerf setting, as in the main pipeline (so do the kerf test first).
import type { Part, Ring, Vec2 } from "./types";
import { textToPolylines, textWidth } from "./font/hershey";
import { drawingOf, type Drawing } from "./export/common";
import { encodeDrawing, type ExportFile } from "./export/files";
import { buildZip } from "./export/zip";

export const KERF_VALUES = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3];
export const DOWEL_OFFSETS = [-0.2, -0.1, 0, 0.1, 0.2];
export const SQUARE = 20;
const WEB = 2; // material between holes, and gap between squares
const MARGIN = 2;
const BAND = 7; // label band under the holes of a strip
const KERF_CAP = 3.5; // cap height of the labels on squares
const STRIP_CAP = 3;
const DOWEL_WEB = 3;

export type CalibrationOptions = { dowelDiameter: number; kerf: number };

export type Calibration = {
  drawing: Drawing;
  width: number;
  height: number;
  kerfValues: number[];
  /** dowel diameters as labelled (the values to enter as the setting) and as drawn (label minus kerf) */
  dowelLabels: number[];
  dowelDrawn: number[];
};

/** "0.15", "6", "5.8": at most 2 decimals, trailing zeros dropped, and a "0." before fractions (the font has a decimal point). */
export function formatMm(v: number): string {
  return String(Math.round(v * 100) / 100);
}

const rect = (x0: number, y0: number, x1: number, y1: number): Ring => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]; // CCW

/** Text centred on (cx, cy) as label strokes. */
function centred(text: string, cx: number, cy: number, cap: number): Vec2[][] {
  const w = textWidth(text, cap);
  return textToPolylines(text, cap).map((l) => l.map(([x, y]): Vec2 => [x + cx - w / 2, y + cy - cap / 2]));
}

export function buildCalibration(opts: CalibrationOptions): Calibration {
  const D = opts.dowelDiameter > 0 ? opts.dowelDiameter : 6;
  const kerf = Math.max(0, opts.kerf);
  const n = KERF_VALUES.length;
  const pitch = SQUARE + WEB;
  const stripW = n * pitch + WEB;

  // dowel strip dimensions
  const labels = DOWEL_OFFSETS.map((o) => Math.round((D + o) * 100) / 100).filter((v) => v > 0);
  const drawn = labels.map((v) => Math.max(0.1, v - kerf));
  const dmax = Math.max(...labels);
  const labW = Math.max(...labels.map((v) => textWidth(formatMm(v), STRIP_CAP)));
  const dPitch = Math.max(dmax + DOWEL_WEB, labW + 2);
  const dStripW = labels.length * dPitch;
  const dStripH = DOWEL_WEB + dmax + BAND;

  const stripH = WEB + SQUARE + BAND;
  const width = MARGIN * 2 + Math.max(stripW, dStripW);
  const height = MARGIN * 2 + stripH + WEB + SQUARE + WEB + dStripH;

  const parts: Part[] = [];
  const x0 = MARGIN;
  // y layout from the top: hole strip, squares, dowel strip
  const stripY1 = height - MARGIN, stripY0 = stripY1 - stripH;
  const sqY1 = stripY0 - WEB, sqY0 = sqY1 - SQUARE;
  const dY1 = sqY0 - WEB, dY0 = dY1 - dStripH;

  const strip: Part = { id: "KERF-HOLES", layer: 0, cut: { outer: rect(x0, stripY0, x0 + stripW, stripY1), holes: [] }, engrave: [], label: [], holes: [] };
  KERF_VALUES.forEach((k, i) => {
    const hx0 = x0 + WEB + i * pitch, hx1 = hx0 + SQUARE;
    const hy0 = stripY0 + BAND, hy1 = hy0 + SQUARE;
    const e = k / 2;
    strip.cut.holes.push(rect(hx0 + e, hy0 + e, hx1 - e, hy1 - e).reverse()); // inset by k/2, CW
    const text = formatMm(k);
    strip.label.push(...centred(text, (hx0 + hx1) / 2, stripY0 + BAND / 2, STRIP_CAP));
    parts.push({
      id: `KERF-${text}`, layer: 0,
      cut: { outer: rect(hx0 - e, sqY0 - e, hx1 + e, sqY1 + e), holes: [] }, // outset by k/2
      engrave: [], label: centred(text, (hx0 + hx1) / 2, (sqY0 + sqY1) / 2, KERF_CAP), holes: [],
    });
  });
  parts.unshift(strip);

  const dowel: Part = { id: "DOWEL", layer: 0, cut: { outer: rect(x0, dY0, x0 + dStripW, dY1), holes: [] }, engrave: [], label: [], holes: [] };
  labels.forEach((v, i) => {
    const cx = x0 + dPitch * (i + 0.5);
    dowel.holes.push({ c: [cx, dY0 + BAND + dmax / 2], d: drawn[i] });
    dowel.label.push(...centred(formatMm(v), cx, dY0 + BAND / 2, STRIP_CAP));
  });
  parts.push(dowel);

  return { drawing: drawingOf(parts, width, height), width, height, kerfValues: KERF_VALUES, dowelLabels: labels, dowelDrawn: drawn };
}

export function calibrationReadme(c: Calibration, o: CalibrationOptions): string {
  const f = formatMm;
  return [
    "Laser Slicer calibration sheet",
    "",
    `Sheet size: ${f(c.width)} x ${f(c.height)} mm. Cut it from a scrap piece of the plywood you will use, with the same power and speed as the real job.`,
    "Files: calibration.dxf and calibration.svg (the same drawing). Layers: CUT (red) = outlines, holes and dowel holes; LABEL (green) = the numbers, engrave only.",
    "",
    "1. Kerf test (top two rows)",
    `  Top row: a strip with ${KERF_VALUES.length} square holes. Row below: ${KERF_VALUES.length} loose squares, one under each hole, 20 mm nominal.`,
    `  Each pair is drawn for a different kerf, in mm: ${KERF_VALUES.map(f).join(", ")}. The number is engraved on the square and under the hole.`,
    "  The cut path of a square is enlarged by half that kerf and the path of its hole is reduced by half of it, the way the slicer compensates parts.",
    "  Press each square into the hole with the same number. The pair that fits snugly (no gap, no force) shows your real kerf.",
    "  Enter that number as Kerf in the Material group. Too loose everywhere: use a smaller value; too tight everywhere: a larger one.",
    "  You can also measure a square and its hole with calipers: the real kerf is the label value plus (hole size - square size) / 2.",
    "",
    "2. Dowel test (bottom strip)",
    `  Round holes labelled ${c.dowelLabels.map(f).join(", ")} mm, around the current Dowel diameter of ${f(o.dowelDiameter)} mm.`,
    `  The circles are drawn ${f(o.kerf)} mm smaller than the label (the current Kerf setting), as the slicer does for dowel holes, so do the kerf test first`,
    "  and enter the result before downloading this sheet again. Try your rod in each hole: the label of the hole that fits is the value to enter as Dowel diameter.",
    "  Choose a hole that lets the rod slide in by hand if you want an easy glue-up, or the tightest one for a press fit.",
    "",
  ].join("\n");
}

/** DXF and SVG of the sheet plus README.txt, as a ZIP. */
export function buildCalibrationZip(o: CalibrationOptions): { name: string; bytes: Uint8Array; calibration: Calibration } {
  const calibration = buildCalibration(o);
  const files: ExportFile[] = [
    { name: "calibration.dxf", mime: "application/dxf", bytes: encodeDrawing(calibration.drawing, "dxf") },
    { name: "calibration.svg", mime: "image/svg+xml", bytes: encodeDrawing(calibration.drawing, "svg") },
  ];
  return { name: "laser-slicer-calibration.zip", bytes: buildZip(files, calibrationReadme(calibration, o)), calibration };
}
