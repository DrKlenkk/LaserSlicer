import { defineConfig } from "vitest/config";
import { viteSingleFile } from "vite-plugin-singlefile";
import { readFileSync } from "node:fs";

// Embeds THIRD_PARTY_LICENSES.txt into dist/index.html as an HTML comment
// (replaces the <!--LICENSES--> placeholder in index.html).
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
      return html.replace("<!--LICENSES-->", `<!--\n${safe}\n-->`);
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
