// Verifies dist/ is a single self-contained index.html with no network references.
import { readdirSync, readFileSync, statSync } from "node:fs";

const fail = (msg) => {
  console.error("CHECK FAILED: " + msg);
  process.exit(1);
};

const files = readdirSync("dist");
if (files.length !== 1 || files[0] !== "index.html") fail(`dist must contain exactly index.html, found: ${files.join(", ")}`);

const html = readFileSync("dist/index.html", "utf8");

// Comment regions (licence notices) may contain URLs.
const comments = [];
for (const re of [/<!--[\s\S]*?-->/g, /\/\*[\s\S]*?\*\//g]) {
  for (const m of html.matchAll(re)) comments.push([m.index, m.index + m[0].length]);
}
const inComment = (i) => comments.some(([a, b]) => i >= a && i < b);

// XML namespace identifiers are names, not references: nothing is ever fetched.
const ALLOWED = [/^https?:\/\/www\.w3\.org\//, /^https?:\/\/schemas\.microsoft\.com\//];

const bad = [];
for (const m of html.matchAll(/https?:\/\/[^\s"'`)<>\\]+/g)) {
  if (inComment(m.index)) continue;
  if (ALLOWED.some((re) => re.test(m[0]))) continue;
  bad.push(`${m[0]}   ...${html.slice(Math.max(0, m.index - 50), m.index).replace(/\s+/g, " ")}`);
}
if (bad.length) fail(`network URLs found outside comments/namespaces:\n  ${bad.join("\n  ")}`);

// External resource tags.
if (/<script[^>]+\ssrc=/i.test(html)) fail("external <script src>");
if (/<link[^>]+rel=["']?(stylesheet|modulepreload)/i.test(html)) fail("external <link>");

console.log(`dist OK: index.html only, ${(statSync("dist/index.html").size / 1024).toFixed(1)} KiB, no network references`);
