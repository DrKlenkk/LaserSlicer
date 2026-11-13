// Base64 for the model bytes in a project file. Pure (no btoa/atob, no DOM): runs in Node tests and
// does not build a huge argument list for String.fromCharCode, so a 50 MB file does not overflow the stack.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LOOKUP = new Int16Array(128).fill(-1);
for (let i = 0; i < 64; i++) LOOKUP[ALPHABET.charCodeAt(i)] = i;

/** Bytes turned into a string at a time (a multiple of 3, so only the very last chunk has padding). */
const CHUNK_BYTES = 3 * 16384;

export function encodeBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let start = 0; start < bytes.length; start += CHUNK_BYTES) {
    const end = Math.min(bytes.length, start + CHUNK_BYTES);
    const chars: string[] = [];
    let i = start;
    for (; i + 2 < end; i += 3) {
      const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      chars.push(ALPHABET[n >> 18], ALPHABET[(n >> 12) & 63], ALPHABET[(n >> 6) & 63], ALPHABET[n & 63]);
    }
    if (i < end) {
      const two = i + 1 < end;
      const n = (bytes[i] << 16) | ((two ? bytes[i + 1] : 0) << 8);
      chars.push(ALPHABET[n >> 18], ALPHABET[(n >> 12) & 63], two ? ALPHABET[(n >> 6) & 63] : "=", "=");
    }
    parts.push(chars.join(""));
  }
  return parts.join("");
}

/** Decodes standard base64 (padding required, white space ignored). Throws an Error on any other character or length. */
export function decodeBase64(text: string): Uint8Array {
  const s = text.replace(/\s+/g, "");
  if (s.length % 4 !== 0) throw new Error("Invalid base64 length");
  const pad = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0;
  const out = new Uint8Array((s.length / 4) * 3 - pad);
  const val = (idx: number): number => {
    const c = s.charCodeAt(idx);
    const v = c < 128 ? LOOKUP[c] : -1;
    if (v < 0) throw new Error("Invalid base64 character");
    return v;
  };
  const end = s.length - (pad ? 4 : 0);
  let o = 0;
  let i = 0;
  for (; i < end; i += 4) {
    const n = (val(i) << 18) | (val(i + 1) << 12) | (val(i + 2) << 6) | val(i + 3);
    out[o++] = n >> 16;
    out[o++] = (n >> 8) & 255;
    out[o++] = n & 255;
  }
  if (pad) {
    const n = (val(i) << 18) | (val(i + 1) << 12) | (pad === 1 ? val(i + 2) << 6 : 0);
    out[o++] = n >> 16;
    if (pad === 1) out[o++] = (n >> 8) & 255;
  }
  return out;
}
