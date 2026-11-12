import { describe, expect, it } from "vitest";
import { zlibSync } from "fflate";
import {
  checkRasterSize, crc32, insertPngPhys, patchJpegDpi, pixelSize, pixelsPerMetre, readJpegDensity, readPngDpi, readPngSize,
} from "../src/core/export/rasterBytes";
import { paintDrawing } from "../src/core/export/raster";
import { buildReadme } from "../src/core/export/zip";
import type { Drawing } from "../src/core/export/common";
import { box } from "./fixtures/meshes";
import { settings, slice } from "./helpers";

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}
/** Smallest valid PNG: w x h, 8 bit grey, all pixels white. */
function tinyPng(w: number, h: number, extra: Uint8Array[] = []): Uint8Array {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8; // bit depth, colour type 0 (grey)
  const raw = new Uint8Array((w + 1) * h).fill(255);
  for (let y = 0; y < h; y++) raw[y * (w + 1)] = 0; // filter byte
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), ...extra, chunk("IDAT", zlibSync(raw)), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of parts) { out.set(a, o); o += a.length; }
  return out;
}

describe("crc32", () => {
  it("matches the standard check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new TextEncoder().encode("IEND"))).toBe(0xae426082); // the CRC every PNG ends with
  });
});

describe("PNG pHYs", () => {
  it("inserts a pHYs chunk after IHDR that decodes to the chosen DPI with a valid CRC", () => {
    const png = tinyPng(3, 2);
    expect(readPngDpi(png)).toBeNull();
    for (const dpi of [254, 300, 600, 1000, 72, 1234]) {
      const out = insertPngPhys(png, dpi);
      const r = readPngDpi(out)!; // throws on a CRC mismatch
      expect(r.ppmX).toBe(pixelsPerMetre(dpi));
      expect(r.ppmY).toBe(pixelsPerMetre(dpi));
      expect(Math.round(r.dpi!)).toBe(dpi);
      expect(out.length).toBe(png.length + 21);
      expect(readPngSize(out)).toEqual({ w: 3, h: 2 });
    }
    expect(pixelsPerMetre(254)).toBe(10000);
    expect(pixelsPerMetre(300)).toBe(11811);
  });

  it("puts pHYs right after IHDR, before IDAT, and replaces an existing one", () => {
    const old = new Uint8Array(9);
    new DataView(old.buffer).setUint32(0, 2835);
    new DataView(old.buffer).setUint32(4, 2835);
    old[8] = 1;
    const png = tinyPng(2, 2, [chunk("pHYs", old)]);
    const out = insertPngPhys(png, 600);
    expect(out.length).toBe(png.length); // replaced, not duplicated
    expect(Math.round(readPngDpi(out)!.dpi!)).toBe(600);
    const text = String.fromCharCode(...out.subarray(8, 54)); // IHDR chunk is bytes 8..33, pHYs 33..54
    expect(text.indexOf("IHDR")).toBeLessThan(text.indexOf("pHYs"));
    expect(String.fromCharCode(...out.subarray(58, 62))).toBe("IDAT");
  });

  it("detects a corrupted CRC and rejects non-PNG input", () => {
    const out = insertPngPhys(tinyPng(2, 2), 300).slice();
    out[8 + 25 + 8 + 2] ^= 0xff; // flip a byte inside pHYs data
    expect(() => readPngDpi(out)).toThrow(/CRC/);
    expect(() => insertPngPhys(new Uint8Array([1, 2, 3]), 300)).toThrow(/PNG/);
  });
});

describe("JPEG JFIF density", () => {
  const SOI = [0xff, 0xd8];
  const jfif = (units: number, x: number, y: number) => [0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, units, x >> 8, x & 255, y >> 8, y & 255, 0, 0];
  const rest = [0xff, 0xdb, 0, 4, 1, 2, 0xff, 0xd9];

  it("patches an existing JFIF header in place (units 0, 1:1 -> dpi)", () => {
    const jpg = new Uint8Array([...SOI, ...jfif(0, 1, 1), ...rest]);
    expect(readJpegDensity(jpg)).toEqual({ units: 0, x: 1, y: 1 });
    const out = patchJpegDpi(jpg, 600);
    expect(readJpegDensity(out)).toEqual({ units: 1, x: 600, y: 600 });
    expect(out.length).toBe(jpg.length);
    expect(Array.from(out.subarray(20))).toEqual(rest);
  });

  it("inserts a JFIF header when there is none (JFIF must follow SOI)", () => {
    const exif = [0xff, 0xe1, 0, 4, 0x45, 0x78];
    const jpg = new Uint8Array([...SOI, ...exif, ...rest]);
    expect(readJpegDensity(jpg)).toBeNull();
    const out = patchJpegDpi(jpg, 1000);
    expect(readJpegDensity(out)).toEqual({ units: 1, x: 1000, y: 1000 });
    expect(out.length).toBe(jpg.length + 18);
    expect(Array.from(out.subarray(20))).toEqual([...exif, ...rest]);
    expect(() => patchJpegDpi(new Uint8Array([1, 2, 3, 4]), 300)).toThrow(/JPEG/);
  });

  it("clamps absurd DPI values into the 16-bit field", () => {
    const out = patchJpegDpi(new Uint8Array([...SOI, ...rest]), 99999);
    expect(readJpegDensity(out)!.x).toBe(65535);
  });
});

describe("raster size", () => {
  it("pixel size = mm x DPI / 25.4", () => {
    expect(pixelSize(25.4, 300)).toBe(300);
    expect(pixelSize(600, 600)).toBe(14173);
    expect(pixelSize(400, 600)).toBe(9449);
    expect(pixelSize(100, 254)).toBe(1000);
    const c = checkRasterSize(600, 400, 600);
    expect(c).toEqual({ ok: true, w: 14173, h: 9449 }); // the plan's example is fine
  });

  it("refuses more than 16384 px per side or 200 MP with a message that suggests a lower DPI", () => {
    const side = checkRasterSize(600, 400, 1000); // 23622 px wide
    expect(side.ok).toBe(false);
    if (!side.ok) {
      expect(side.message).toMatch(/16384 px per side/);
      expect(side.message).toMatch(/lower DPI/);
      const suggested = Number(/at most (\d+)/.exec(side.message)![1]);
      expect(checkRasterSize(600, 400, suggested).ok).toBe(true);
      expect(checkRasterSize(600, 400, suggested + 10).ok).toBe(false);
    }
    // 15000 x 13000 px is under the per-side limit but 195 MP... use a size just over 200 MP
    const mp = checkRasterSize(16000 / 300 * 25.4, 12600 / 300 * 25.4, 300); // 16000 x 12600 = 201.6 MP
    expect(mp.ok).toBe(false);
    if (!mp.ok) expect(mp.message).toMatch(/200 MP/);
    expect(checkRasterSize(16000 / 300 * 25.4, 12400 / 300 * 25.4, 300).ok).toBe(true); // 198.4 MP
  });
});

describe("painting", () => {
  /** Records the calls paintDrawing makes. */
  function recorder() {
    const calls: string[] = [];
    const ctx: any = new Proxy({ canvas: { width: 100, height: 50 } }, {
      get: (t, k: string) => (k in t ? (t as any)[k] : (...a: unknown[]) => void calls.push(`${k}(${a.map((x) => (typeof x === "number" ? +x.toFixed(2) : x)).join(",")})`)),
      set: (_t, k: string, v) => (calls.push(`${k}=${v}`), true),
    });
    return { ctx, calls };
  }
  const d: Drawing = {
    width: 10, height: 5,
    cut: [[[[0, 0], [4, 0], [4, 4], [0, 4]], [[1, 1], [1, 3], [3, 3], [3, 1]]]],
    circles: [{ c: [8, 2], d: 2 }],
    engrave: [[[0, 0], [1, 1]]], label: [],
  };

  it("filled: black evenodd fill with white holes, Y flipped, grey engrave", () => {
    const { ctx, calls } = recorder();
    paintDrawing(ctx, d, 10, { dpi: 254, style: "filled", engrave: true }, 50);
    expect(calls).toContain("fill(evenodd)");
    expect(calls).toContain("fillStyle=#000");
    expect(calls).toContain("moveTo(0,50)"); // (0,0) mm is the bottom-left pixel
    expect(calls).toContain("lineTo(40,50)");
    expect(calls).toContain("arc(80,30,10,0,6.28)"); // dowel hole, 2 mm diameter at 10 px/mm
    expect(calls.filter((c) => c === "stroke()")).toHaveLength(1); // engrave only
  });

  it("outline: 1 px black lines and no fill of the parts; engrave optional", () => {
    const { ctx, calls } = recorder();
    paintDrawing(ctx, d, 10, { dpi: 254, style: "outline", engrave: false }, 50);
    expect(calls).toContain("lineWidth=1");
    expect(calls).toContain("strokeStyle=#000");
    expect(calls).not.toContain("fill(evenodd)");
    expect(calls.filter((c) => c === "stroke()")).toHaveLength(1);
  });
});

describe("README", () => {
  it("mentions the raster settings", async () => {
    const r = await slice(box(20, 20, 8), { thickness: 4 });
    const txt = buildReadme(r, settings({ formats: ["png"], dpi: 600 }), "m", []);
    expect(txt).toMatch(/600 DPI/);
  });
});
