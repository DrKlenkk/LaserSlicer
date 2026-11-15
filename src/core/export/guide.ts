// Printable assembly guide: one self-contained HTML page (inline CSS, inline SVG thumbnails, no script, no external
// resource, no URL at all) with a block per layer. Pure, no DOM: runs in the worker and in Node tests.
import type { Part, Settings, Vec2 } from "../types";
import type { RunResult } from "../pipeline";
import { layerLabel } from "../layers";
import { estimateLines, estimate, type EstimateSettings } from "../estimates";
import { materialUse } from "../nest";
import { rangeText } from "../range";

export type GuideSettings = Pick<Settings, "thickness" | "sheetW" | "sheetH" | "kerf" | "dowels" | "dowelDiameter" | "engraveNextOutline" | "labels" | "mode" | "perLayerFiles"> &
  EstimateSettings &
  Partial<Pick<Settings, "exportEngrave" | "exportLabel">>;

/** Thumbnail box in mm on paper: the largest layer is scaled down to fit it (never enlarged beyond 1:1). */
export const THUMB_MAX_W = 118;
export const THUMB_MAX_H = 74;
const PAD = 2; // mm of model around the outlines

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const f1 = (v: number) => String(Math.round(v * 10) / 10);

/** The scale and common view window of a guide: the same for every layer, so the sizes compare. */
export type GuideView = { minX: number; minY: number; maxX: number; maxY: number; w: number; h: number; scale: number };

export function guideView(points: Iterable<Vec2>): GuideView {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (minX > maxX) [minX, minY, maxX, maxY] = [0, 0, 10, 10];
  minX -= PAD; minY -= PAD; maxX += PAD; maxY += PAD;
  const w = maxX - minX, h = maxY - minY;
  return { minX, minY, maxX, maxY, w, h, scale: Math.min(1, THUMB_MAX_W / w, THUMB_MAX_H / h) };
}

function* viewPoints(parts: Part[], prev: Part[]): Generator<Vec2> {
  for (const p of parts) {
    yield* p.cut.outer;
    for (const l of p.engrave) yield* l;
    for (const l of p.label) yield* l;
  }
  for (const p of prev) yield* p.cut.outer;
}

/** Path data of rings / polylines in the view (Y flipped: model Y up, SVG Y down); consecutive duplicates after rounding are dropped. */
function pathData(lines: Vec2[][], v: GuideView, closed: boolean | "auto"): string {
  const out: string[] = [];
  for (const line of lines) {
    const pts: string[] = [];
    let last = "";
    for (const [x, y] of line) {
      const s = `${f1(x - v.minX)} ${f1(v.maxY - y)}`;
      if (s !== last) pts.push(s);
      last = s;
    }
    if (pts.length < 2) continue;
    let isClosed = closed === true;
    if (closed === "auto" && pts.length > 2 && pts[0] === pts[pts.length - 1]) {
      pts.pop();
      isClosed = true;
    }
    out.push(`M${pts.join("L")}${isClosed ? "Z" : ""}`);
  }
  return out.join("");
}

function thumbnail(parts: Part[], prev: Part[], v: GuideView, label: string): string {
  const el: string[] = [];
  const prevD = pathData(prev.map((p) => p.cut.outer), v, true);
  if (prevD) el.push(`<path class="prev" d="${prevD}"/>`);
  const cutD = pathData(parts.flatMap((p) => [p.cut.outer, ...p.cut.holes]), v, true);
  if (cutD) el.push(`<path class="cut" d="${cutD}"/>`);
  const holes = parts.flatMap((p) => p.holes).map((h) => `<circle class="dowel" cx="${f1(h.c[0] - v.minX)}" cy="${f1(v.maxY - h.c[1])}" r="${f1(h.d / 2)}"/>`);
  if (holes.length) el.push(holes.join(""));
  const engD = pathData(parts.flatMap((p) => p.engrave), v, "auto");
  if (engD) el.push(`<path class="eng" d="${engD}"/>`);
  const labD = pathData(parts.flatMap((p) => p.label), v, "auto");
  if (labD) el.push(`<path class="lab" d="${labD}"/>`);
  return `<svg viewBox="0 0 ${f1(v.w)} ${f1(v.h)}" width="${f1(v.w * v.scale)}mm" height="${f1(v.h * v.scale)}mm" role="img" aria-label="${escapeHtml(label)}">${el.join("")}</svg>`;
}

const CSS = `
@page{size:A4;margin:12mm}
*{box-sizing:border-box}
body{font:10.5pt/1.4 Arial,Helvetica,sans-serif;color:#000;background:#fff;margin:0 auto;max-width:190mm;padding:8mm 4mm}
h1{font-size:19pt;margin:0 0 2mm}
h2{font-size:12pt;margin:5mm 0 1.5mm}
.meta{width:100%;border-collapse:collapse;margin:2mm 0}
.meta th{text-align:left;font-weight:normal;color:#444;padding:.6mm 4mm .6mm 0;white-space:nowrap;vertical-align:top;width:34mm}
.meta td{padding:.6mm 0}
.est{margin:2mm 0;padding-left:5mm;font-size:9.5pt}
.how{margin:1mm 0;padding-left:5mm}
.how li{margin:.8mm 0}
.warn{border:1.5px solid #000;padding:1.5mm 3mm;margin:3mm 0;font-weight:bold}
.legend{display:flex;flex-wrap:wrap;gap:1mm 6mm;font-size:9pt;margin:2mm 0 0}
.legend span{display:inline-flex;align-items:center;gap:1.5mm}
.legend svg{width:11mm;height:3mm}
.layer{display:flex;gap:5mm;border-top:1.5px solid #000;padding:3mm 0;break-inside:avoid;page-break-inside:avoid}
.info{flex:0 0 46mm}
.num{font-size:21pt;font-weight:bold;line-height:1}
.num small{display:block;margin-top:1mm;font-size:9.5pt;font-weight:normal;color:#444}
.info ul{list-style:none;margin:2mm 0 0;padding:0;font-size:9.5pt}
.info li{margin:.6mm 0}
.info .sub{color:#444;font-size:9pt;margin-top:2mm}
.pic{flex:1 1 auto;min-width:0}
.pic svg{display:block;max-width:100%;height:auto;border:.4px solid #888}
svg .prev{fill:none;stroke:#555;stroke-width:1;stroke-dasharray:5 3;vector-effect:non-scaling-stroke}
svg .cut{fill:#e6e6e6;fill-rule:evenodd;stroke:#000;stroke-width:1.4;stroke-linejoin:round;vector-effect:non-scaling-stroke}
svg .dowel{fill:#fff;stroke:#000;stroke-width:1;vector-effect:non-scaling-stroke}
svg .eng{fill:none;stroke:#000;stroke-width:1;stroke-dasharray:2 2;vector-effect:non-scaling-stroke}
svg .lab{fill:none;stroke:#000;stroke-width:.8;stroke-linecap:round;vector-effect:non-scaling-stroke}
.foot{border-top:1.5px solid #000;margin-top:3mm;padding-top:2mm;font-size:9pt;color:#444}
@media print{body{max-width:none;padding:0}}
`;

/** Inline legend swatches (same classes as the thumbnails). */
const LEGEND: [string, string][] = [
  ["cut", "<path class=\"cut\" d=\"M1 .6H10V2.4H1Z\"/>"],
  ["prev", "<path class=\"prev\" d=\"M0 1.5H11\"/>"],
  ["eng", "<path class=\"eng\" d=\"M0 1.5H11\"/>"],
  ["lab", "<path class=\"lab\" d=\"M1 2.4L3 .6L5 2.4L7 .6\"/>"],
  ["dowel", "<circle class=\"dowel\" cx=\"5.5\" cy=\"1.5\" r=\"1.1\"/>"],
];

function dateText(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The guide as an HTML string. One block per layer of the export range, in order; every thumbnail uses the same scale and
 * the same model-space window (the model position, not the nested one) and shows the previous layer's outline dashed.
 * `date` is a parameter so the output is deterministic in tests.
 */
export function buildAssemblyGuide(result: RunResult, s: GuideSettings, model: string, date: Date = new Date()): string {
  const n = result.info.layerCount;
  const range = result.info.range;
  const from = range && !range.all ? range.from : 0;
  const to = range && !range.all ? range.to : n - 1;
  const byLayer = new Map<number, Part[]>();
  for (const p of result.parts) {
    const a = byLayer.get(p.layer);
    if (a) a.push(p);
    else byLayer.set(p.layer, [p]);
  }
  const sheetOf = new Map(result.placements.map((pl) => [pl.partId, pl.sheet]));
  const indices: number[] = [];
  for (let i = from; i <= to; i++) indices.push(i);

  // One view for the whole document: every shown layer plus the layer below the first one.
  const all = indices.flatMap((i) => byLayer.get(i) ?? []);
  const view = guideView(viewPoints(all, byLayer.get(from - 1) ?? []));
  const scaleText = view.scale >= 0.999 ? "1 : 1 (true size when printed at 100 %)" : `1 : ${(1 / view.scale).toFixed(1)} (printed at 100 %)`;

  const shown = all.length;
  const sheetsUsed = result.sheets.length;
  const est = estimateLines(result.measure, estimate(result.measure, s));
  const engraved = s.engraveNextOutline && (s.exportEngrave ?? true);
  const labelled = s.labels && (s.exportLabel ?? true);
  const rt = rangeText(range, n);
  const first = layerLabel(from), last = layerLabel(to);

  const o: string[] = [];
  o.push(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(`Assembly guide: ${model}`)}</title><style>${CSS}</style></head><body>`);
  o.push(`<h1>Assembly guide: ${escapeHtml(model)}</h1>`);
  o.push("<table class=\"meta\">");
  const row = (k: string, v: string) => o.push(`<tr><th>${k}</th><td>${v}</td></tr>`);
  row("Date", escapeHtml(dateText(date)));
  row("Material", `${escapeHtml(String(s.thickness))} mm thick, sheets ${escapeHtml(String(s.sheetW))} x ${escapeHtml(String(s.sheetH))} mm, kerf ${escapeHtml(String(s.kerf))} mm`);
  row("Layers", rt ? `${indices.length} of ${n} (${escapeHtml(first)} to ${escapeHtml(last)})` : `${n} (${escapeHtml(layerLabel(0))} bottom${n > 1 ? `, ${escapeHtml(layerLabel(n - 1))} top` : ""})`);
  row("Parts", String(shown));
  row("Sheets", `${sheetsUsed}, material use ${materialUse(result.sheets).toFixed(1)} %`);
  row("Outline mode", escapeHtml(s.mode));
  row("Scale of the drawings", escapeHtml(scaleText));
  o.push("</table>");
  if (rt) o.push(`<p class="warn">Only ${escapeHtml(rt.replace(/^only /, ""))} are in this guide and in the files; the other layers are not included.</p>`);
  o.push(`<ul class="est">${est.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>`);

  o.push("<h2>How to glue</h2><ol class=\"how\">");
  o.push(`<li>Cut every part face-up and never flip a part. Start with ${escapeHtml(first)}${from === 0 ? ", the bottom layer" : ", the lowest layer in this guide"}, and stack upward in the order below.</li>`);
  o.push(engraved
    ? "<li>Each part carries the engraved outline of the next layer (dotted line in the drawings). Glue the next layer exactly on that outline.</li>"
    : "<li>The parts carry no engraved outline in these files; use the dotted line in the drawings, which is where the next layer goes, and the dashed line, which is the layer below.</li>");
  if (labelled) o.push("<li>The part number is engraved on the top face: labels face up. If you can read the label, the part lies the right way.</li>");
  if (s.dowels) o.push(`<li>Thread a dowel (${escapeHtml(String(s.dowelDiameter))} mm) through the dowel holes (circles) while gluing, so the stack stays aligned. Dry-fit first.</li>`);
  o.push("<li>Press the stack together (clamps, weights) and wipe off glue that squeezes out before it dries.</li>");
  o.push("</ol>");
  o.push("<div class=\"legend\">");
  const names: Record<string, string> = { cut: "part outline and holes (this layer)", prev: "layer below (dashed)", eng: "engraved line: next layer goes here", lab: "label", dowel: "dowel hole" };
  for (const [k, svg] of LEGEND) o.push(`<span><svg viewBox="0 0 11 3" aria-hidden="true">${svg}</svg>${names[k]}</span>`);
  o.push("</div>");
  if (all.length === 0) o.push("<p class=\"warn\">There are no parts in this range.</p>");

  for (const i of indices) {
    const parts = byLayer.get(i) ?? [];
    const prev = byLayer.get(i - 1) ?? [];
    const lab = layerLabel(i);
    o.push(`<section class="layer"><div class="info"><div class="num">${escapeHtml(lab)} <small>layer ${i} of ${n - 1}${i === 0 ? ", bottom" : i === n - 1 ? ", top" : ""}</small></div>`);
    o.push("<ul>");
    if (parts.length === 0) o.push("<li>no parts</li>");
    for (const p of parts) {
      const sh = sheetOf.get(p.id);
      o.push(`<li><b>${escapeHtml(p.id)}</b>: ${sh === undefined ? "not on a sheet (does not fit)" : `sheet ${sh + 1}`}</li>`);
    }
    o.push("</ul>");
    const nh = parts.reduce((m, p) => m + p.holes.length, 0);
    if (s.dowels && nh) o.push(`<div class="sub">${nh} dowel hole${nh === 1 ? "" : "s"}</div>`);
    if (i > from || (i > 0 && prev.length)) o.push(`<div class="sub">dashed: ${escapeHtml(layerLabel(i - 1))}</div>`);
    else o.push("<div class=\"sub\">lowest layer: nothing dashed</div>");
    o.push(`</div><div class="pic">${thumbnail(parts, prev, view, `${lab}${parts.length ? "" : ", no parts"}`)}</div></section>`);
  }
  o.push(`<p class="foot">Generated by Laser Slicer. All drawings are at the same scale (${escapeHtml(scaleText)}), in the model's position seen from above (the stacking direction), not nested on the sheet. Sheet numbers are those of the file names (sheet01 is sheet 1).${s.perLayerFiles ? " The files are per layer, so the sheet numbers refer to the nesting shown in the app." : ""}</p>`);
  o.push("</body></html>");
  return o.join("\n");
}
