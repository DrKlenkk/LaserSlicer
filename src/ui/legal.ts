// Legal notice shown in every state of the app: copyright, licence, source code and the legal pages (German, with English translations of Impressum and Datenschutz).
// The pages are static files next to index.html (relative links work on the web and from file://); they open in a new
// tab so the loaded model and the settings in this page are not lost.
import { h } from "./dom";
import { DOCS_PAGE } from "./helpText";

export const REPO_URL = "https://github.com/DrKlenkk/LaserSlicer";

function link(href: string, text: string, external = false) {
  return h("a", { href, target: "_blank", rel: external ? "noopener noreferrer" : "noopener" }, text);
}

/** The links alone (also placed in the help overlay, which covers the footer). Documentation comes first. */
export function createLegalLinks(): HTMLElement {
  return h(
    "span",
    { class: "legal-links" },
    link(DOCS_PAGE, "Documentation"),
    link("impressum.html", "Impressum"),
    link("datenschutz.html", "Datenschutz"),
    link("lizenzen.html", "Lizenzen"),
    h("span", { class: "legal-en" }, link("legal-notice.html", "Legal notice (EN)"), link("privacy.html", "Privacy (EN)")),
  );
}

/** The persistent footer bar below the status bar. */
export function createLegalBar(): HTMLElement {
  return h(
    "footer",
    { class: "legalbar", id: "legal-bar" },
    h("span", { class: "legal-copy" }, "© 2026 Louis Adrian Spencer"),
    h("span", { class: "legal-licence" }, link("lizenzen.html", "GPL-3.0"), " · ", link(REPO_URL, "Source code", true)),
    createLegalLinks(),
  );
}
