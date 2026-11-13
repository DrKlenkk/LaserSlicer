// PNG / JPG export: draws a sheet or layer drawing on an OffscreenCanvas at the chosen DPI (browser and worker only;
// the byte patching and size limits are pure functions in rasterBytes.ts and tested in Node).
import type { Settings } from "../types";
import type { RunResult } from "../pipeline";
import { exportLayersOf, type Drawing } from "./common";
import { exportDrawings, type ExportFile } from "./files";
import { checkRasterSize, insertPngPhys, patchJpegDpi, MM_PER_INCH } from "./rasterBytes";

export type RasterFormat = "png" | "jpg";
/** `engrave` = draw the ENGRAVE lines; `label` (default: same as `engrave`) the labels; `cut` (default on) the parts and dowel holes; `bridge` (default on) the bridge gaps in outline style (excluded: the gaps are left open; filled images always show the whole part); `sheet` (default off) the sheet border. */
export type RasterOptions = { dpi: number; style: "filled" | "outline"; engrave: boolean; label?: boolean; cut?: boolean; bridge?: boolean; sheet?: boolean };

const JPEG_QUALITY = 0.95;
const GREY = "#808080";
const MAGENTA = "#d000d0";

/** Draw the drawing (mm, Y up) into a 2D context scaled to `k` pixels per mm. */
export function paintDrawing(ctx: OffscreenCanvasRenderingContext2D, d: Drawing, k: number, o: RasterOptions, heightPx: number) {
  const X = (x: number) => x * k;
  const Y = (y: number) => heightPx - y * k; // flip: DXF-style Y up -> image rows down
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, ctx.canvas.width, heightPx);
  const trace = (rings: Drawing["cut"][number]) => {
    for (const ring of rings) {
      ring.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
      ctx.closePath();
    }
  };
  const circle = (c: [number, number], dia: number) => {
    ctx.moveTo(X(c[0]) + (dia / 2) * k, Y(c[1]));
    ctx.arc(X(c[0]), Y(c[1]), (dia / 2) * k, 0, Math.PI * 2);
    ctx.closePath();
  };
  const drawCut = o.cut ?? true;
  if (!drawCut) {
    /* parts excluded */
  } else if (o.style === "filled") {
    ctx.fillStyle = "#000";
    for (const shape of d.fill ?? d.cut) {
      ctx.beginPath();
      trace(shape);
      ctx.fill("evenodd"); // holes stay white
    }
    ctx.fillStyle = "#fff";
    for (const c of d.circles) {
      ctx.beginPath();
      circle(c.c, c.d);
      ctx.fill();
    }
  } else {
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1; // 1 pixel black lines
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (const shape of d.cut) trace(shape);
    for (const c of d.circles) circle(c.c, c.d);
    for (const l of d.cutOpen ?? []) l.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
    ctx.stroke();
  }
  if ((o.bridge ?? true) && o.style === "outline" && (d.bridge ?? []).length) {
    ctx.strokeStyle = MAGENTA;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const l of d.bridge ?? []) l.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
    ctx.stroke();
  }
  const lines = [...(o.engrave ? d.engrave : []), ...((o.label ?? o.engrave) ? d.label : [])];
  if (o.sheet) {
    ctx.strokeStyle = GREY;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(0.5, 0.5, ctx.canvas.width - 1, heightPx - 1);
    ctx.stroke();
  }
  if (lines.length) {
    ctx.strokeStyle = GREY;
    ctx.lineWidth = Math.max(1, 0.2 * k); // 0.2 mm, at least one pixel
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (const line of lines) {
      const closed = line.length > 2 && line[0][0] === line[line.length - 1][0] && line[0][1] === line[line.length - 1][1];
      line.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
      if (closed) ctx.closePath();
    }
    ctx.stroke();
  }
}

/** One image as PNG or JPG bytes with the DPI written into the file. */
export async function renderRaster(d: Drawing, format: RasterFormat, o: RasterOptions): Promise<Uint8Array> {
  const size = checkRasterSize(d.width, d.height, o.dpi);
  if (!size.ok) throw new Error(size.message);
  if (typeof OffscreenCanvas === "undefined") throw new Error("This browser cannot render images off-screen (OffscreenCanvas is missing)");
  const canvas = new OffscreenCanvas(size.w, size.h);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create a drawing context for the image");
  paintDrawing(ctx, d, o.dpi / MM_PER_INCH, o, size.h);
  const blob = await canvas.convertToBlob(format === "png" ? { type: "image/png" } : { type: "image/jpeg", quality: JPEG_QUALITY });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return format === "png" ? insertPngPhys(bytes, o.dpi) : patchJpegDpi(bytes, o.dpi);
}

/** Throws with a clear message before any rendering starts if some image would exceed the limits. */
export function checkRasterLimits(result: RunResult, perLayer: boolean, dpi: number) {
  for (const { stem, drawing } of exportDrawings(result, perLayer, "x")) {
    const c = checkRasterSize(drawing.width, drawing.height, dpi);
    if (!c.ok) throw new Error(`${stem.replace(/^x_/, "")}: ${c.message}`);
  }
}

/** PNG and/or JPG files of every sheet (or layer). Browser only. */
export async function buildRasterFiles(
  result: RunResult,
  settings: Pick<Settings, "formats" | "perLayerFiles" | "dpi" | "rasterStyle" | "rasterEngrave"> & Partial<Pick<Settings, "exportCut" | "exportEngrave" | "exportLabel" | "exportBridge" | "exportSheet" | "exportInnerLayer">>,
  model: string,
): Promise<ExportFile[]> {
  const formats = settings.formats.filter((f): f is RasterFormat => f === "png" || f === "jpg");
  if (formats.length === 0) return [];
  checkRasterLimits(result, settings.perLayerFiles, settings.dpi);
  const L = exportLayersOf(settings);
  // `rasterEngrave` (older projects, "Engrave lines and labels (grey)") stays a raster-only extra switch: engrave lines and labels need both it and their layer checkbox
  const opts: RasterOptions = { dpi: settings.dpi, style: settings.rasterStyle, engrave: settings.rasterEngrave && L.engrave, label: settings.rasterEngrave && L.label, cut: L.cut, bridge: L.bridge, sheet: L.sheet };
  const files: ExportFile[] = [];
  for (const { stem, drawing } of exportDrawings(result, settings.perLayerFiles, model))
    for (const f of formats)
      files.push({ name: `${stem}.${f}`, mime: f === "png" ? "image/png" : "image/jpeg", bytes: await renderRaster(drawing, f, opts) });
  return files;
}
