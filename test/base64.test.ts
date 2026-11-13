import { describe, expect, it } from "vitest";
import { decodeBase64, encodeBase64 } from "../src/core/base64";

describe("base64", () => {
  it("matches the reference encoder for every length 0..40", () => {
    for (let n = 0; n <= 40; n++) {
      const b = new Uint8Array(n).map((_, i) => (i * 37 + n * 11) & 255);
      expect(encodeBase64(b)).toBe(Buffer.from(b).toString("base64"));
      expect(Array.from(decodeBase64(Buffer.from(b).toString("base64")))).toEqual(Array.from(b));
    }
  });
  it("knows the RFC 4648 vectors", () => {
    const t = (s: string) => encodeBase64(new TextEncoder().encode(s));
    expect([t(""), t("f"), t("fo"), t("foo"), t("foob"), t("fooba"), t("foobar")]).toEqual(["", "Zg==", "Zm8=", "Zm9v", "Zm9vYg==", "Zm9vYmE=", "Zm9vYmFy"]);
  });
  it("round-trips a large buffer (chunk borders, odd length) without overflowing the stack", () => {
    const n = 3 * 16384 * 5 + 2; // several chunks plus a 2 byte rest
    const b = new Uint8Array(n);
    for (let i = 0; i < n; i++) b[i] = (i * 31 + (i >> 8)) & 255;
    const text = encodeBase64(b);
    expect(text.length).toBe(Math.ceil(n / 3) * 4);
    expect(Buffer.from(decodeBase64(text)).equals(Buffer.from(b))).toBe(true);
    expect(text).toBe(Buffer.from(b).toString("base64"));
  });
  it("ignores white space and rejects damaged text", () => {
    expect(Array.from(decodeBase64("Zm9v\nYmFy "))).toEqual(Array.from(new TextEncoder().encode("foobar")));
    expect(() => decodeBase64("Zm9")).toThrow(); // length
    expect(() => decodeBase64("Zm9v!mFy")).toThrow(); // character
    expect(() => decodeBase64("Zm9vémFy")).toThrow();
    expect(() => decodeBase64("Zg=a")).toThrow();
  });
});
