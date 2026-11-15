// Verifies dist/ is the deployable site: the self-contained index.html, the documentation page (docs.html with its
// docs-img/ screenshots), the three German legal pages, 404.html, the two licence files and the SEO files (robots.txt,
// sitemap.xml, og-image.png, favicon.svg, apple-touch-icon.png), with no resource loaded from any external origin and
// no analytics or tracking code. Absolute URLs on https://laserslicer.com are allowed only as metadata (canonical, Open
// Graph, Twitter card, JSON-LD, sitemap, robots), never as a resource load. Also checks that every tooltip link (HELP_DOC) points to a section
// of docs.html and that every screenshot docs.html shows exists.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";

const fail = (msg) => {
  console.error("CHECK FAILED: " + msg);
  process.exit(1);
};

const EXPECTED = ["404.html", "LICENSE.txt", "THIRD_PARTY_LICENSES.txt", "apple-touch-icon.png", "datenschutz.html", "docs-img", "docs.html", "favicon.svg", "impressum.html", "index.html", "lizenzen.html", "og-image.png", "robots.txt", "sitemap.xml"];
const entries = readdirSync("dist").sort();
if (!entries.includes("docs.html")) fail("dist/docs.html is missing (the documentation page lives in public/docs.html)");
if (entries.join("|") !== EXPECTED.join("|")) fail(`dist must contain exactly ${EXPECTED.join(", ")}, found: ${entries.join(", ")}`);
if (!statSync("dist/docs-img").isDirectory()) fail("dist/docs-img must be a directory");
// Screenshots: only png and jpg, no subfolders.
const images = readdirSync("dist/docs-img").sort();
for (const i of images) if (!/^[\w.-]+\.(png|jpg)$/.test(i) || !statSync(`dist/docs-img/${i}`).isFile()) fail(`dist/docs-img/${i}: only .png and .jpg files are allowed`);
const files = entries.filter((e) => e !== "docs-img");

const SITE = "https://laserslicer.com";
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
// JSON-LD may name its vocabulary, the licence and the repository (data, nothing is loaded).
const JSONLD_URLS = [/^https:\/\/schema\.org$/, /^https:\/\/www\.gnu\.org\/licenses\/gpl-3\.0\.html$/, /^https:\/\/github\.com\/DrKlenkk\/LaserSlicer$/];
const NAMESPACES = [/^https?:\/\/www\.w3\.org\//, /^https?:\/\/schemas\.microsoft\.com\//, /^https:\/\/github\.com\/DrKlenkk\/LaserSlicer$/];

for (const f of HTML) {
  const html = read(f);
  const comments = commentRanges(html);
  const inComment = (i) => comments.some(([a, b]) => i >= a && i < b);
  // Metadata that may carry absolute URLs on the own domain: canonical link, og:/twitter: meta tags, JSON-LD blocks.
  const metaRanges = [];
  for (const m of html.matchAll(/<link\b[^>]*\brel\s*=\s*["']canonical["'][^>]*>/gi)) metaRanges.push([m.index, m.index + m[0].length, "own"]);
  for (const m of html.matchAll(/<meta\b[^>]*\b(?:property|name)\s*=\s*["'](?:og|twitter):[^"']*["'][^>]*>/gi)) metaRanges.push([m.index, m.index + m[0].length, "own"]);
  for (const m of html.matchAll(/<script\s+type\s*=\s*["']application\/ld\+json["']\s*>([\s\S]*?)<\/script>/gi)) metaRanges.push([m.index, m.index + m[0].length, "jsonld"]);
  const metaAt = (i) => metaRanges.find(([a, b]) => i >= a && i < b)?.[2];
  const at = (i) => html.slice(Math.max(0, i - 40), i).replace(/\s+/g, " ");

  // Tags: external resource loads. Plain <a href="https://..."> and mailto: anchors are allowed (nothing loads).
  for (const m of html.matchAll(/<(script|link|img|iframe|video|audio|source|embed|object|input|form|base)\b[^>]*>/gi)) {
    if (inComment(m.index)) continue;
    const tag = m[0];
    const tagName = m[1].toLowerCase();
    const ext = /\b(?:src|href|action|data|poster|srcset)\s*=\s*["']?\s*(?:https?:)?\/\//i.test(tag);
    const ownCanonical = tagName === "link" && /rel\s*=\s*["']canonical["']/i.test(tag) && tag.includes(`href="${SITE}/`);
    if (tagName === "script" && /\stype\s*=\s*["']application\/ld\+json["']/i.test(tag) && !/\ssrc\s*=/i.test(tag)) continue;
    if (ext && !ownCanonical) fail(`${f}: <${tagName}> loads from an external origin: ${tag.slice(0, 120)}`);
    if (tagName === "script" && /\ssrc\s*=/i.test(tag)) fail(`${f}: external <script src>: ${tag.slice(0, 120)}`);
    if (tagName === "link" && /rel\s*=\s*["']?(stylesheet|modulepreload|preload|prefetch|preconnect|dns-prefetch)/i.test(tag)) fail(`${f}: <link> resource: ${tag.slice(0, 120)}`);
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
    const kind = metaAt(m.index);
    if (kind === "own" && (m[0] === SITE || m[0].startsWith(SITE + "/"))) continue;
    if (kind === "jsonld" && (m[0] === SITE || m[0].startsWith(SITE + "/") || JSONLD_URLS.some((re) => re.test(m[0])))) continue;
    bad.push(`${m[0]}   ...${at(m.index)}`);
  }
  if (bad.length) fail(`${f}: network URLs found outside comments, namespaces and <a href>:\n  ${bad.join("\n  ")}`);
}

// The legal pages and the documentation must work without JavaScript and on phones.
const index = read("index.html");
for (const f of ["impressum.html", "datenschutz.html", "lizenzen.html", "docs.html"]) {
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

// Documentation: the app links to it, every tooltip anchor exists in it, every screenshot it shows exists.
if (!/docs\.html/.test(index)) fail("index.html does not link to docs.html");
const docs = read("docs.html");
const ids = new Set([...docs.matchAll(/\sid\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]));
const helpSrc = readFileSync("src/ui/helpText.ts", "utf8");
const mapSrc = helpSrc.match(/export const HELP_DOC[^=]*=\s*\{([\s\S]*?)\n\};/);
if (!mapSrc) fail("HELP_DOC not found in src/ui/helpText.ts");
const mapping = [...mapSrc[1].matchAll(/^\s*(\w+):\s*"([^"]+)"/gm)];
if (mapping.length < 40) fail(`HELP_DOC has only ${mapping.length} entries`);
for (const [, key, anchor] of mapping) if (!ids.has(anchor)) fail(`tooltip "${key}" links to docs.html#${anchor}, but docs.html has no id="${anchor}"`);
for (const m of docs.matchAll(/\shref\s*=\s*["']#([^"']+)["']/g)) if (!ids.has(m[1])) fail(`docs.html links to #${m[1]}, which does not exist`);
const shown = [...docs.matchAll(/<img\b[^>]*\ssrc\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
for (const src of shown) {
  if (!/^docs-img\/[\w.-]+\.(png|jpg)$/.test(src)) fail(`docs.html: image "${src}" must be docs-img/<name>.png or .jpg`);
  if (!existsSync(`dist/${src}`)) fail(`docs.html shows ${src}, which is missing in dist/`);
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
  if (f.endsWith(".png")) continue;
  const t = read(f).toLowerCase();
  for (const s of TRACKERS) if (t.includes(s.toLowerCase())) fail(`${f}: contains "${s}" (analytics / tracking / external service)`);
  if (!f.endsWith(".txt")) for (const s of ["document.cookie", "sendbeacon", "xmlhttprequest", "new websocket", "new eventsource"]) if (t.includes(s)) fail(`${f}: contains "${s}"`);
}

// ---- SEO: every html page has title, description and canonical; sitemap, robots, social image, JSON-LD ----
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1];
const metaContent = (html, key) => {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) if ((attr(m[0], "name") ?? attr(m[0], "property")) === key) return attr(m[0], "content");
  return undefined;
};
const urlOf = (f) => (f === "index.html" ? `${SITE}/` : `${SITE}/${f}`);
const indexable = HTML.filter((f) => f !== "404.html");
for (const f of HTML) {
  const html = read(f);
  const title = html.match(/<title>([^<]+)<\/title>/)?.[1]?.trim();
  if (!title) fail(`${f}: <title> missing`);
  if (title.length > 80) fail(`${f}: <title> is ${title.length} characters (keep it at 80 or less)`);
  const desc = metaContent(html, "description");
  if (!desc || desc.length < 40 || desc.length > 200) fail(`${f}: meta description missing or not 40-200 characters`);
  if (!/<html lang="(en|de)"/.test(html)) fail(`${f}: <html lang> missing`);
  const robotsMeta = metaContent(html, "robots") ?? "";
  if (f === "404.html") {
    if (!/noindex/.test(robotsMeta)) fail("404.html must be noindex");
    continue;
  }
  if (/noindex|nofollow/.test(robotsMeta)) fail(`${f}: must stay indexable (robots meta: ${robotsMeta})`);
  const canon = html.match(/<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*>/i)?.[0];
  if (!canon) fail(`${f}: <link rel="canonical"> missing`);
  if (attr(canon, "href") !== urlOf(f)) fail(`${f}: canonical must be ${urlOf(f)}, found ${attr(canon, "href")}`);
  // index.html carries the app's script, so only its static fallback (the <noscript> block) is counted.
  const markup = f === "index.html" ? (html.match(/<noscript>[\s\S]*?<\/noscript>/g) ?? []).join("") : html;
  if ((markup.match(/<h1[\s>]/g) ?? []).length !== 1) fail(`${f}: needs exactly one <h1>`);
}
const ogHtml = indexable.filter((f) => f === "index.html" || f === "docs.html");
for (const f of ogHtml) {
  const html = read(f);
  for (const k of ["og:title", "og:description", "og:url", "og:image", "og:image:alt", "twitter:card", "twitter:image"]) if (!metaContent(html, k)) fail(`${f}: meta ${k} missing`);
  if (metaContent(html, "og:url") !== urlOf(f)) fail(`${f}: og:url must be ${urlOf(f)}`);
  if (metaContent(html, "og:image") !== `${SITE}/og-image.png`) fail(`${f}: og:image must be ${SITE}/og-image.png`);
}
const og = readFileSync("dist/og-image.png");
if (og.readUInt32BE(16) !== 1200 || og.readUInt32BE(20) !== 630) fail("og-image.png must be 1200 x 630");
if (og.length > 300 * 1024) fail(`og-image.png is ${(og.length / 1024).toFixed(0)} KiB (limit 300 KiB)`);
// JSON-LD of the app must parse and carry the main fields.
const ld = index.match(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/);
if (!ld) fail("index.html: JSON-LD block missing");
let ldData;
try {
  ldData = JSON.parse(ld[1]);
} catch (e) {
  fail(`index.html: JSON-LD does not parse: ${e.message}`);
}
if (ldData["@type"] !== "WebApplication" || ldData.url !== `${SITE}/` || ldData.offers?.price !== "0") fail("index.html: JSON-LD lacks @type WebApplication, url or offers.price 0");
if (!/<html lang="en"/.test(index)) fail('index.html: <html lang="en"> missing');
// Every image of the documentation needs a real alt text.
for (const m of docs.matchAll(/<img\b[^>]*>/gi)) if ((attr(m[0], "alt") ?? "").length < 15) fail(`docs.html: image without a descriptive alt text: ${m[0].slice(0, 100)}`);
// sitemap.xml lists exactly the indexable pages, as canonical URLs of files that exist; robots.txt points to it.
const sitemap = read("sitemap.xml");
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
if (new Set(locs).size !== locs.length) fail("sitemap.xml: duplicate <loc>");
for (const l of locs) {
  const f = l === `${SITE}/` ? "index.html" : l.startsWith(`${SITE}/`) ? l.slice(SITE.length + 1) : "";
  if (!f || !existsSync(`dist/${f}`)) fail(`sitemap.xml: ${l} does not match a file of dist/`);
}
for (const f of indexable) if (!locs.includes(urlOf(f))) fail(`sitemap.xml lacks ${urlOf(f)}`);
if (locs.includes(`${SITE}/404.html`)) fail("sitemap.xml must not list 404.html");
if (/<lastmod>(?!\d{4}-\d{2}-\d{2}<)/.test(sitemap)) fail("sitemap.xml: lastmod must be YYYY-MM-DD");
const robots = read("robots.txt");
if (!robots.includes(`Sitemap: ${SITE}/sitemap.xml`)) fail("robots.txt must reference the sitemap");
if (/^\s*Disallow:\s*\/\s*$/m.test(robots)) fail("robots.txt must not disallow the whole site");

const sizes = files.map((f) => `${f} ${(statSync(`dist/${f}`).size / 1024).toFixed(1)} KiB`).join(", ");
const imgKiB = images.reduce((n, i) => n + statSync(`dist/docs-img/${i}`).size, 0) / 1024;
console.log(`dist OK: ${sizes}; docs-img ${images.length} images ${imgKiB.toFixed(0)} KiB; ${mapping.length} tooltip links resolve; no external resources, no analytics`);
