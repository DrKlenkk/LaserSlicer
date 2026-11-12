// Collapsible warnings list for the status bar: grouped by level, items jump to their layer.
import type { Warning } from "../core/types";
import { h } from "./dom";

const LEVELS: { level: Warning["level"]; title: string; open: boolean }[] = [
  { level: "error", title: "Errors", open: true },
  { level: "warn", title: "Warnings", open: true },
  { level: "info", title: "Info", open: false },
];

export function createWarnings(onJump: (w: Warning) => void) {
  const button = h("button", { type: "button", class: "warn-btn", id: "warn-btn", "aria-expanded": "false", "aria-controls": "warn-panel" }, "No warnings");
  const panel = h("div", { class: "warn-panel", id: "warn-panel", hidden: true });
  let items: Warning[] = [];

  const close = () => {
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
  };
  button.addEventListener("click", () => {
    if (!items.length) return;
    panel.hidden = !panel.hidden;
    button.setAttribute("aria-expanded", String(!panel.hidden));
  });
  document.addEventListener("pointerdown", (e) => {
    if (!panel.hidden && !panel.contains(e.target as Node) && e.target !== button) close();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  function render() {
    panel.replaceChildren();
    for (const g of LEVELS) {
      const list = items.filter((w) => w.level === g.level);
      if (!list.length) continue;
      const ul = h("ul", { class: "warn-list" });
      for (const w of list) {
        const jump = w.layer !== undefined;
        const el = h(
          jump ? "button" : "span",
          { class: `warn-item ${w.level}${jump ? " link" : ""}`, ...(jump ? { type: "button", title: `Go to layer ${w.layer}` } : {}) },
          w.message,
        );
        if (jump) el.addEventListener("click", () => onJump(w));
        ul.append(h("li", {}, el));
      }
      panel.append(h("details", { class: `warn-group ${g.level}`, open: g.open }, h("summary", {}, `${g.title} (${list.length})`), ul));
    }
  }

  return {
    button,
    panel,
    set(w: Warning[]) {
      items = w;
      const n = (l: Warning["level"]) => w.filter((x) => x.level === l).length;
      const parts: string[] = [];
      if (n("error")) parts.push(`${n("error")} error${n("error") > 1 ? "s" : ""}`);
      if (n("warn")) parts.push(`${n("warn")} warning${n("warn") > 1 ? "s" : ""}`);
      if (n("info")) parts.push(`${n("info")} note${n("info") > 1 ? "s" : ""}`);
      button.textContent = parts.length ? `${n("error") || n("warn") ? "⚠ " : "ⓘ "}${parts.join(", ")}` : "No warnings";
      button.className = `warn-btn ${n("error") ? "error" : n("warn") ? "warn" : ""}`;
      if (!w.length) close();
      render();
    },
  };
}
