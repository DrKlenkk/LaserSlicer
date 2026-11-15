import { defineConfig } from "vitest/config";
import { viteSingleFile } from "vite-plugin-singlefile";
import { readFileSync } from "node:fs";

// Embeds a licence notice and THIRD_PARTY_LICENSES.txt into dist/index.html as an HTML comment
// (replaces the <!--LICENSES--> placeholder in index.html) and emits LICENSE.txt and THIRD_PARTY_LICENSES.txt
// into dist/. The static legal pages (impressum.html, datenschutz.html, lizenzen.html) come from public/.
function licenseComment() {
  return {
    name: "license-comment",
    transformIndexHtml(html: string) {
      let text = "";
      try {
        text = readFileSync("THIRD_PARTY_LICENSES.txt", "utf8");
      } catch {
        text = "See THIRD_PARTY_LICENSES.txt";
      }
      // "--" is not allowed inside an HTML comment.
      const safe = text.replace(/--+/g, (m) => m.split("").join(" "));
      const notice =
        "Laser Slicer, Copyright (c) 2026 Louis Adrian Spencer. Free software under the GNU General Public License, version 3 only (GPL-3.0-only).\n" +
        "Source code: https://github.com/DrKlenkk/LaserSlicer . Licence text: LICENSE.txt, third-party components: THIRD_PARTY_LICENSES.txt (both deployed next to this file).\n\n";
      return html.replace("<!--LICENSES-->", `<!--\n${notice}${safe}\n-->`);
    },
    // The licence files are deployed next to index.html (the legal pages in public/ link to them).
    generateBundle(this: { emitFile(f: { type: "asset"; fileName: string; source: string }): unknown }) {
      for (const [src, fileName] of [["LICENSE", "LICENSE.txt"], ["THIRD_PARTY_LICENSES.txt", "THIRD_PARTY_LICENSES.txt"]]) {
        this.emitFile({ type: "asset", fileName, source: readFileSync(src, "utf8") });
      }
    },
  };
}

export default defineConfig({
  plugins: [licenseComment(), viteSingleFile()],
  worker: { format: "iife" },
  build: {
    target: "es2022",
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 4000,
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
