// Single-stroke text for engraving: Simplex-style glyphs in the Hershey font encoding (public domain format).
//
// Encoding (the usual .jhf one): each glyph is a string. Characters 0 and 1 are the left and right side bearing
// and every following character pair is an (x, y) vertex, all offset by the code of "R" (x right, y DOWN); the
// marker " R" lifts the pen. The cap height is 21 units (y from -12 at the top to +9 at the baseline).
// NOTE: the outlines were reconstructed in the Simplex style (single stroke, polygonal curves); they are not a
// byte-exact copy of the original Hershey table (see DECISIONS.md). Covered: digits, A-Z, a-z, "-" and space.
// Lower case: x-height 14 units (y from -5 to 9), ascenders to the cap height, descenders (g j p q y) down to y = 16/17.
import type { Vec2 } from "../types";

const GLYPHS: Record<string, string> = {
  "0": "H\\R[UZWXXUYQXLWIUGRFOGMILLKPLUMXOZR[",
  "1": "KYOJSFS[",
  "2": "H\\KJMHOGQFSFVGWHYJYLYNWPK[Y[",
  "3": "H\\LINGQFTFWHXJXLWOUPRQRPUPWRYSYUYXWYU[R[O[MZKX",
  "4": "H\\U[UFKUYU",
  "5": "H\\WFMFLPMNPMSMUNWPXSXVWXUZS[P[MZKW",
  "6": "H\\XJUFRFOGMKLPLT RLTLWMYPZR[TZWYXWYTXQWOTNRMPNMOLQLT",
  "7": "H\\KFYFP[",
  "8": "H\\RQTPVOWMWJVHTGRFPGNHMJMMNOPPRQ RRPOQMRKTKWMYOZR[UZWYYWYTWRUQRP",
  "9": "H\\LWOZR[UZXVYQYM RYMXJWHTGRFPGMHLJLMLPMRPSRTTSWRXPYM",
  "A": "G]J[RFZ[ RMTWT",
  "B": "H[KFSFVGWIWKVMSOKO RKFK[T[WYXWXRWPTO",
  "C": "F]XJVGSFPFMGKJJMIPJTKWMZP[S[VZXW",
  "D": "H\\KFK[R[VYXUXLVHRFKF",
  "E": "H[XFKFK[X[ RKPSP",
  "F": "H[XFKFK[ RKPSP",
  "G": "F]XJVGSFPFMHKJINIRJULXOZR[UZWXYUZQZRRR",
  "H": "H\\K[KF RY[YF RKPYP",
  "I": "OUR[RF",
  "J": "JZWFWUVYTZR[PZNYMV",
  "K": "H[KFK[ RXFKS ROOX[",
  "L": "IZLFL[W[",
  "M": "G]J[JFR[ZFZ[",
  "N": "H\\K[KFY[YF",
  "O": "F^R[UZXXZU[QZLXIUGRFOGLIJLIPJULXOZR[",
  "P": "H[K[KFSFVGXIXLVNSOKO",
  "Q": "F^R[UZXXZU[QZLXIUGRFOGLIJLIPJULXOZR[ RTVZ\\",
  "R": "H[K[KFSFVGXIXLVNSOKO RROX[",
  "S": "H\\XIVGSFPFMGLILKMMPOTPWRYTYWWYTZQ[NZLXKV",
  "T": "H\\KFYF RRFR[",
  "U": "H\\KFKTLXOZR[VZXXYTYF",
  "V": "G]JFR[ZF",
  "W": "E_HFM[RFW[\\F",
  "X": "H\\K[YF RY[KF",
  "Y": "H\\KFRPYF RRPR[",
  "Z": "H[KFXFK[X[",
  "-": "JZMPWP",
  "a": "P`^T^Q\\OZNXMVNTORQRTRWTYVZX[ZZ\\Y^W^T R^M^[",
  "b": "P`RFR[ R^T^Q\\OZNXMVNTORQRTRWTYVZX[ZZ\\Y^W^T",
  "c": "P_]P[NXMVMTORQRTRWTYV[X[[Z]X",
  "d": "P`^F^[ R^T^Q\\OZNXMVNTORQRTRWTYVZX[ZZ\\Y^W^T",
  "e": "P`RT^T^Q\\OZMXMVNTORRRTSWTYV[X[[Z]X",
  "f": "Q`W[WLXIZG\\F^F RSM\\M",
  "g": "P`^T^Q\\OZNXMVNTORQRTRWTYVZX[ZZ\\Y^W^T R^M^^]a[bXcUbS`",
  "h": "P_RFR[ RRQTNWMZM\\N]Q][",
  "i": "PTRMR[ RRFRG",
  "j": "OXVMV^UaSbQb RVFVG",
  "k": "P^RFR[ R\\MRW RVS\\[",
  "l": "PTRFR[",
  "m": "PfRMR[ RRQTNVMXMZN[Q[[ R[Q]N_MaMcNdQd[",
  "n": "P^RMR[ RRQTNWMYM[N\\Q\\[",
  "o": "P`^T^Q\\OZNXMVNTORQRTRWTYVZX[ZZ\\Y^W^T",
  "p": "P`RMRb R^T^Q\\OZNXMVNTORQRTRWTYVZX[ZZ\\Y^W^T",
  "q": "P`^M^b R^T^Q\\OZNXMVNTORQRTRWTYVZX[ZZ\\Y^W^T",
  "r": "P]RMR[ RRRTOVMYM[N",
  "s": "P^\\OZMWMTMRORQTSWTZU\\W\\YZ[W[T[RY",
  "t": "P]VFVXWZY[[[ RRMZM",
  "u": "P^RMRVSYU[X[ZZ\\W R\\M\\[",
  "v": "P^RMW[\\M",
  "w": "PdRMV[ZM^[bM",
  "x": "P^RM\\[ R\\MR[",
  "y": "P^RMWZ R\\MV^TaRb",
  "z": "P^RM\\MR[\\[",
  " ": "JZ",
};

const R = 82; // "R"
const CAP = 21; // cap height in glyph units
const BASELINE = 9; // y of the baseline in the encoding (y down)

type Glyph = { adv: number; left: number; strokes: Vec2[][] };
const cache = new Map<string, Glyph>();

function decode(code: string): Glyph {
  const left = code.charCodeAt(0) - R;
  const right = code.charCodeAt(1) - R;
  const strokes: Vec2[][] = [];
  for (const part of code.slice(2).split(" R")) {
    if (part.length < 2) continue;
    const pts: Vec2[] = [];
    for (let i = 0; i + 1 < part.length; i += 2) pts.push([part.charCodeAt(i) - R, BASELINE - (part.charCodeAt(i + 1) - R)]);
    strokes.push(pts); // y flipped: up is positive, baseline at 0
  }
  return { adv: right - left, left, strokes };
}

function glyph(ch: string): Glyph {
  const c = ch;
  let g = cache.get(c);
  if (!g) {
    g = decode(GLYPHS[c] ?? GLYPHS[c.toUpperCase()] ?? GLYPHS[" "]);
    cache.set(c, g);
  }
  return g;
}

/** Width of `text` in mm for the given cap height (advance of all characters). */
export function textWidth(text: string, capHeight: number): number {
  const k = capHeight / CAP;
  let w = 0;
  for (const ch of text) w += glyph(ch).adv;
  return w * k;
}

/**
 * Text as polylines in mm: the baseline starts at the origin and runs along +x, +y is up, capitals are
 * `capHeight` tall. A stroke whose first and last point coincide is closed (the project-wide convention).
 * Unknown characters become a space.
 */
export function textToPolylines(text: string, capHeight: number): Vec2[][] {
  const k = capHeight / CAP;
  const out: Vec2[][] = [];
  let x = 0;
  for (const ch of text) {
    const g = glyph(ch);
    for (const s of g.strokes) out.push(s.map(([px, py]): Vec2 => [x + (px - g.left) * k, py * k]));
    x += g.adv * k;
  }
  return out;
}
