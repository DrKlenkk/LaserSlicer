// Verifies dist/ is the deployable site: the self-contained index.html, the three German legal pages and the two licence files,
// with no resource loaded from any external origin and no analytics or tracking code.
import { readdirSync, readFileSync, statSync } from "node:fs";

const fail = (msg) => {
  console.error("CHECK FAILED: " + msg);
  process.exit(1);
};

const EXPECTED = ["LICENSE.txt", "THIRD_PARTY_LICENSES.txt", "datenschutz.html", "impressum.html", "index.html", "lizenzen.html"];
const files = readdirSync("dist").sort();
if (files.join("|") !== EXPECTED.join("|")) fail(`dist must contain exactly ${EXPECTED.join(", ")}, found: ${files.join(", ")}`);

const HTML = files.filter((f) => f.endsWith(".html"));
const read = (f) => readFileSync(`dist/${f}`, "utf8");

/** Ranges of comments (HTML, CSS and JS block comments); licence notices there may contain URLs. */
function commentRanges(text) {
  const r = [];
  for (const re of [/<!--[\s\S]*?-->/g, /\/\*[\s\S]*?\*\//g]) for (const m of text.matchAll(re)) r.push([m.index, m.index + m[0].length]);
  return r;
}

// XML namespace identifiers are names, not references: nothing is ever fetched.
// The app builds one link to its source repository in script (an anchor, so nothing is loaded).
const NAMESPACES = [/^https?:\/\/www\.w3\.org\//, /^https?:\/\/schemas\.microsoft\.com\//, /^https:\/\/github\.com\/DrKlenkk\/LaserSlicer$/];

for (const f of HTML) {
  const html = read(f);
  const comments = commentRanges(html);
  const inComment = (i) => comments.some(([a, b]) => i >= a && i < b);
  const at = (i) => html.slice(Math.max(0, i - 40), i).replace(/\s+/g, " ");

  // Tags: external resource loads. Plain <a href="https://..."> and mailto: anchors are allowed (nothing loads).
  for (const m of html.matchAll(/<(script|link|img|iframe|video|audio|source|embed|object|input|form|base)\b[^>]*>/gi)) {
    if (inComment(m.index)) continue;
    const tag = m[0];
    const tagName = m[1].toLowerCase();
    const ext = /\b(?:src|href|action|data|poster|srcset)\s*=\s*["']?\s*(?:https?:)?\/\//i.test(tag);
    if (ext) fail(`${f}: <${tagName}> loads from an external origin: ${tag.slice(0, 120)}`);
    if (tagName === "script" && /\ssrc\s*=/i.test(tag)) fail(`${f}: external <script src>: ${tag.slice(0, 120)}`);
    if (tagName === "link" && /rel\s*=\s*["']?(stylesheet|modulepreload|preload|prefetch|icon|preconnect|dns-prefetch)/i.test(tag)) fail(`${f}: <link> resource: ${tag.slice(0, 120)}`);
    if (tagName === "form") fail(`${f}: <form> found (nothing may be submitted)`);
  }
  if (/\bsrcset\s*=/i.test(html.replace(/<!--[\s\S]*?-->/g, ""))) fail(`${f}: srcset found`);
  if (/@import\b/i.test(html)) fail(`${f}: @import found`);
  if (/url\(\s*["']?\s*(?:https?:)?\/\//i.test(html)) fail(`${f}: url() to an external origin`);

  // Any other absolute URL outside comments must be an anchor href (index.html carries a few as JS strings and namespaces).
  const anchorHrefs = new Set();
  for (const m of html.matchAll(/<a\b[^>]*\shref\s*=\s*["'](https?:\/\/[^"']+)["']/gi)) anchorHrefs.add(m.index + m[0].lastIndexOf(m[1]));
  const bad = [];
  for (const m of html.matchAll(/https?:\/\/[^\s"'`)<>\\]+/g)) {
    if (inComment(m.index)) continue;
    if (NAMESPACES.some((re) => re.test(m[0]))) continue;
    if (anchorHrefs.has(m.index)) continue;
    bad.push(`${m[0]}   ...${at(m.index)}`);
  }
  if (bad.length) fail(`${f}: network URLs found outside comments, namespaces and <a href>:\n  ${bad.join("\n  ")}`);
}

// The legal pages must work without JavaScript and on phones.
const index = read("index.html");
for (const f of ["impressum.html", "datenschutz.html", "lizenzen.html"]) {
  if (/<script\b/i.test(read(f))) fail(`${f}: legal pages must work without JavaScript`);
  if (!/name="viewport"/.test(read(f))) fail(`${f}: viewport meta missing`);
}

// Impressum content.
const imp = read("impressum.html");
for (const needle of ["#105667", "§ 5 DDG", "§ 18 Abs. 1 MStV", "info@laserslicer.com", "Louis Adrian Spencer"]) {
  if (!imp.includes(needle)) fail(`impressum.html lacks "${needle}"`);
}
for (const forbidden of ["ec.europa.eu/consumers/odr", "OS-Plattform", "Umsatzsteuer", "Handelsregister"]) {
  if (imp.includes(forbidden)) fail(`impressum.html must not contain "${forbidden}"`);
}
const ds = read("datenschutz.html");
for (const needle of ["laserslicer.settings.v1", "laserslicer.ui.v1", "laserslicer.presets.v1", "laserslicer.legend.collapsed", "laserslicer.session", "Stand: 15. November 2026", "Cloudflare, Inc."]) {
  if (!ds.includes(needle)) fail(`datenschutz.html lacks "${needle}"`);
}

// The app shows the notices and links to the legal pages (relative links).
for (const needle of ["© 2026 Louis Adrian Spencer", "GPL-3.0", "https://github.com/DrKlenkk/LaserSlicer", "impressum.html", "datenschutz.html", "lizenzen.html"]) {
  if (!index.includes(needle)) fail(`index.html lacks "${needle}"`);
}

// Licence files.
const lic = read("LICENSE.txt");
if (!/GNU GENERAL PUBLIC LICENSE\s+Version 3, 29 June 2007/.test(lic) || !lic.includes("Copyright (c) 2026 Louis Adrian Spencer")) fail("LICENSE.txt is not the GPL-3.0 with the copyright line");
if (lic.split("\n").length < 670) fail("LICENSE.txt is too short to be the full GPL-3.0");
const third = read("THIRD_PARTY_LICENSES.txt");
for (const n of ["three ", "clipper2-js", "polylabel", "tinyqueue", "fflate", "Hershey", "National Bureau of Standards"]) if (!third.includes(n)) fail(`THIRD_PARTY_LICENSES.txt lacks "${n}"`);
if (!index.includes("Boost Software License") || !index.includes("National Bureau of Standards")) fail("index.html lacks the embedded licence notices");

// No analytics or tracking anywhere in dist.
const TRACKERS = ["cloudflareinsights", "static.cloudflareinsights", "beacon.min.js", "google-analytics", "googletagmanager", "gtag(", "ga('send'", "plausible", "matomo", "piwik", "hotjar", "mixpanel", "segment.com", "fullstory", "clarity.ms", "sentry", "facebook.net", "doubleclick", "fonts.googleapis", "fonts.gstatic", "cookiebot", "onetrust", "usercentrics"];
for (const f of files) {
  const t = read(f).toLowerCase();
  for (const s of TRACKERS) if (t.includes(s.toLowerCase())) fail(`${f}: contains "${s}" (analytics / tracking / external service)`);
  if (!f.endsWith(".txt")) for (const s of ["document.cookie", "sendbeacon", "xmlhttprequest", "new websocket", "new eventsource"]) if (t.includes(s)) fail(`${f}: contains "${s}"`);
}

const sizes = files.map((f) => `${f} ${(statSync(`dist/${f}`).size / 1024).toFixed(1)} KiB`).join(", ");
console.log(`dist OK: ${sizes}; no external resources, no analytics`);
