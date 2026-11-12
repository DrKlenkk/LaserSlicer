// Pure byte-level helpers for raster export (no DOM, testable in Node): DPI metadata for PNG and JPEG and the
// canvas size limits. The rendering itself (OffscreenCanvas) lives in raster.ts.

export const MAX_SIDE_PX = 16384;
export const MAX_PIXELS = 200e6;
export const MM_PER_INCH = 25.4;

/** Pixels for a length in mm at a DPI (plan: px = mm / 25.4 x DPI). */
export function pixelSize(mm: number, dpi: number): number {
  return Math.max(1, Math.round((mm / MM_PER_INCH) * dpi));
}

export type SizeCheck = { ok: true; w: number; h: number } | { ok: false; w: number; h: number; message: string };

/** Refuses images above 16384 px on a side or 200 megapixels and names a DPI that would work. */
export function checkRasterSize(widthMm: number, heightMm: number, dpi: number): SizeCheck {
  const w = pixelSize(widthMm, dpi), h = pixelSize(heightMm, dpi);
  if (w <= MAX_SIDE_PX && h <= MAX_SIDE_PX && w * h <= MAX_PIXELS) return { ok: true, w, h };
  // Largest DPI that satisfies both limits, rounded down to a multiple of 10 (a rough, safe suggestion).
  const byPx = (MAX_SIDE_PX * MM_PER_INCH) / Math.max(widthMm, heightMm);
  const byMp = Math.sqrt((MAX_PIXELS * MM_PER_INCH * MM_PER_INCH) / (widthMm * heightMm));
  const suggest = Math.max(1, Math.floor(Math.min(byPx, byMp) / 10) * 10 || Math.floor(Math.min(byPx, byMp)));
  return {
    ok: false,
    w,
    h,
    message: `Image would be ${w} x ${h} px (${(w * h / 1e6).toFixed(0)} MP) at ${dpi} DPI; the limit is ${MAX_SIDE_PX} px per side and ${MAX_PIXELS / 1e6} MP. Choose a lower DPI (at most ${suggest}).`,
  };
}

// ---------- PNG ----------

const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];

let crcTable: Uint32Array | null = null;
export function crc32(data: Uint8Array, start = 0, end = data.length): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Pixels per metre for a DPI, as stored in pHYs. */
export const pixelsPerMetre = (dpi: number) => Math.round(dpi / 0.0254);

type Chunk = { type: string; start: number; end: number }; // start..end covers length+type+data+crc

function pngChunks(png: Uint8Array): Chunk[] {
  if (png.length < 8 || PNG_SIG.some((b, i) => png[i] !== b)) throw new Error("Not a PNG file");
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out: Chunk[] = [];
  let p = 8;
  while (p + 12 <= png.length) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(png[p + 4], png[p + 5], png[p + 6], png[p + 7]);
    const end = p + 12 + len;
    if (end > png.length) throw new Error("Truncated PNG");
    out.push({ type, start: p, end });
    p = end;
  }
  return out;
}

/** Returns a copy of the PNG with a pHYs chunk (unit = metre) right after IHDR; an existing pHYs is replaced. */
export function insertPngPhys(png: Uint8Array, dpi: number): Uint8Array {
  const chunks = pngChunks(png);
  if (chunks[0]?.type !== "IHDR") throw new Error("PNG without IHDR");
  const ppm = pixelsPerMetre(dpi);
  const phys = new Uint8Array(21); // length(4) type(4) x(4) y(4) unit(1) crc(4)
  const dv = new DataView(phys.buffer);
  dv.setUint32(0, 9);
  phys.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  dv.setUint32(8, ppm);
  dv.setUint32(12, ppm);
  phys[16] = 1;
  dv.setUint32(17, crc32(phys, 4, 17));
  const parts: Uint8Array[] = [png.subarray(0, chunks[0].end), phys];
  for (const c of chunks.slice(1)) if (c.type !== "pHYs") parts.push(png.subarray(c.start, c.end));
  const out = new Uint8Array(parts.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of parts) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

/** Reads the pHYs chunk back (verifies its CRC). `dpi` is null when the unit is not the metre. */
export function readPngDpi(png: Uint8Array): { ppmX: number; ppmY: number; dpi: number | null } | null {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  for (const c of pngChunks(png)) {
    if (c.type !== "pHYs") continue;
    const len = dv.getUint32(c.start);
    if (len !== 9) throw new Error("Bad pHYs length");
    if (dv.getUint32(c.end - 4) !== crc32(png, c.start + 4, c.end - 4)) throw new Error("pHYs CRC mismatch");
    const ppmX = dv.getUint32(c.start + 8), ppmY = dv.getUint32(c.start + 12);
    return { ppmX, ppmY, dpi: png[c.start + 16] === 1 ? ppmX * 0.0254 : null };
  }
  return null;
}

/** Width and height from IHDR. */
export function readPngSize(png: Uint8Array): { w: number; h: number } {
  pngChunks(png);
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { w: dv.getUint32(16), h: dv.getUint32(20) };
}

// ---------- JPEG ----------

/** JFIF APP0 segment (marker included) with density units = 1 (dots per inch). */
function jfifSegment(dpi: number): Uint8Array {
  const d = Math.max(1, Math.min(65535, Math.round(dpi)));
  return new Uint8Array([
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, // marker, length 16, "JFIF\0"
    0x01, 0x02, // version 1.02
    0x01, // units: dots per inch
    d >> 8, d & 255, d >> 8, d & 255, // X and Y density
    0x00, 0x00, // no thumbnail
  ]);
}

const isJfif = (b: Uint8Array, p: number) =>
  b[p] === 0xff && b[p + 1] === 0xe0 && b[p + 4] === 0x4a && b[p + 5] === 0x46 && b[p + 6] === 0x49 && b[p + 7] === 0x46 && b[p + 8] === 0;

/** Returns a copy of the JPEG whose JFIF header says units = dpi, X/Y density = dpi (patched or inserted after SOI). */
export function patchJpegDpi(jpg: Uint8Array, dpi: number): Uint8Array {
  if (jpg.length < 4 || jpg[0] !== 0xff || jpg[1] !== 0xd8) throw new Error("Not a JPEG file");
  const d = Math.max(1, Math.min(65535, Math.round(dpi)));
  if (isJfif(jpg, 2) && jpg.length >= 20) {
    const out = jpg.slice();
    out[13] = 1;
    out[14] = d >> 8; out[15] = d & 255;
    out[16] = d >> 8; out[17] = d & 255;
    return out;
  }
  // No JFIF segment first (JFIF must directly follow SOI): insert one.
  const seg = jfifSegment(dpi);
  const out = new Uint8Array(jpg.length + seg.length);
  out.set(jpg.subarray(0, 2), 0);
  out.set(seg, 2);
  out.set(jpg.subarray(2), 2 + seg.length);
  return out;
}

/** JFIF density read-back: units 0 = none (aspect only), 1 = per inch, 2 = per cm. */
export function readJpegDensity(jpg: Uint8Array): { units: number; x: number; y: number } | null {
  if (jpg.length < 20 || jpg[0] !== 0xff || jpg[1] !== 0xd8 || !isJfif(jpg, 2)) return null;
  return { units: jpg[13], x: (jpg[14] << 8) | jpg[15], y: (jpg[16] << 8) | jpg[17] };
}
