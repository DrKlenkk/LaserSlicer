import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(`public/${f}`, "utf8");
const OPERATOR = ["Louis Adrian Spencer", "c/o Online-Impressum.de #105667", "Europaring 90", "53757 Sankt Augustin", "info@laserslicer.com"];
const emails = (t: string) => [...new Set([...t.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)].map((m) => m[0]))];
const h2s = (t: string) => [...t.matchAll(/<h2>/g)].length;

describe("English legal pages", () => {
  const pairs: [string, string][] = [["impressum.html", "legal-notice.html"], ["datenschutz.html", "privacy.html"]];
  for (const [de, en] of pairs) {
    it(`${en} keeps the operator data of ${de} and uses no other email address`, () => {
      for (const t of [read(de), read(en)]) {
        for (const o of OPERATOR) expect(t).toContain(o);
        expect(emails(t)).toEqual(["info@laserslicer.com"]);
      }
    });
    it(`${en} and ${de} link to each other and the English page names the German one as binding`, () => {
      expect(read(en)).toContain(`href="${de}"`);
      expect(read(en)).toContain("legally binding");
      expect(read(de)).toContain(`href="${en}"`);
      expect(read(en)).toMatch(/<html lang="en">/);
      expect(read(de)).toMatch(/<html lang="de">/);
    });
    it(`${en} has the same structure as ${de}`, () => {
      expect(h2s(read(en))).toBe(h2s(read(de)));
      expect((read(en).match(/<li>/g) ?? []).length).toBe((read(de).match(/<li>/g) ?? []).length);
      expect((read(en).match(/<tr>/g) ?? []).length).toBe((read(de).match(/<tr>/g) ?? []).length);
    });
  }
  it("the privacy policy lists every storage key and the Cloudflare cookies of the German one", () => {
    for (const k of ["laserslicer.settings.v1", "laserslicer.ui.v1", "laserslicer.presets.v1", "laserslicer.legend.collapsed", "laserslicer.session", "__cf_bm", "cf_clearance", "Cloudflare, Inc."]) {
      expect(read("datenschutz.html")).toContain(k);
      expect(read("privacy.html")).toContain(k);
    }
  });
  it("is in the sitemap and linked from the app footer", () => {
    const sm = read("sitemap.xml");
    expect(sm).toContain("https://laserslicer.com/legal-notice.html");
    expect(sm).toContain("https://laserslicer.com/privacy.html");
    const legal = readFileSync("src/ui/legal.ts", "utf8");
    expect(legal).toContain('"legal-notice.html"');
    expect(legal).toContain('"privacy.html"');
  });
});
