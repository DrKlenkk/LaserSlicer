// Help overlay: keyboard shortcuts and a short usage guide. Opened with "?" or the button in the tab bar.
import { h } from "./dom";

export const SHORTCUTS: [string, string][] = [
  ["1 / 2 / 3", "3D, Layer and Sheets tab"],
  ["← → ↑ ↓", "previous / next layer (any tab)"],
  ["Page Up / Page Down", "10 layers up / down"],
  ["Home / End", "first / last layer"],
  ["M", "3D tab: switch between original model and stacked result"],
  ["F", "3D tab: frame the model"],
  ["?", "show or hide this help"],
  ["Esc", "close help or the warnings list"],
];

export function createHelp() {
  const close = () => (overlay.hidden = true);
  const rows = SHORTCUTS.map(([k, d]) => h("tr", {}, h("td", {}, h("kbd", {}, k)), h("td", {}, d)));
  const box = h(
    "div",
    { class: "help-box", role: "dialog", "aria-modal": "true", "aria-label": "Help" },
    h("button", { type: "button", class: "btn small help-close", id: "help-close", onclick: close }, "Close"),
    h("h2", {}, "Laser Slicer"),
    h("p", {}, "Load an STL, OBJ or 3MF model, set the thickness you measured on your plywood, and download the ZIP. Every change re-slices automatically."),
    h("h3", {}, "Gluing"),
    h("ol", {},
      h("li", {}, "Cut every part face-up; do not flip any part."),
      h("li", {}, "Stack bottom-up (L0 first). Each part carries its label, e.g. L12."),
      h("li", {}, "Glue the next layer exactly on the blue engraved outline of the part below."),
      h("li", {}, "With dowels on, push a dowel through the holes; they line up layer to layer."),
      h("li", {}, "Oversize mode: sand the glued block down to the shape.")),
    h("h3", {}, "Keyboard"),
    h("table", { class: "help-keys" }, ...rows),
  );
  const overlay = h("div", { class: "help-overlay", id: "help", hidden: true }, box);
  overlay.addEventListener("pointerdown", (e) => {
    if (e.target === overlay) close();
  });
  return {
    el: overlay,
    toggle: () => (overlay.hidden = !overlay.hidden),
    close,
    get open() {
      return !overlay.hidden;
    },
  };
}
