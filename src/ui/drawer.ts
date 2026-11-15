// Phone / small-tablet layout: below NARROW_QUERY the parameter panel is an off-canvas drawer opened by a "Settings"
// button at the start of the tab bar. The open state is UI only (a class on the layout element): it is not a setting,
// not in the undo history and not saved. The CSS for it is the max-width media query in style.css; keep both in sync.
import { h } from "./dom";

export const NARROW_QUERY = "(max-width: 820px)";

export function isNarrow(): boolean {
  return window.matchMedia(NARROW_QUERY).matches;
}

export function createDrawer(layout: HTMLElement, panel: HTMLElement, tabBar: HTMLElement) {
  const mq = window.matchMedia(NARROW_QUERY);
  const openBtn = h("button", { type: "button", class: "settings-btn", id: "settings-btn", "aria-controls": "panel", "aria-expanded": "false" }, "☰ Settings");
  const closeBtn = h("button", { type: "button", class: "btn drawer-close", id: "drawer-close", "aria-label": "Close settings" }, "Close ✕");
  const backdrop = h("div", { class: "drawer-backdrop", id: "drawer-backdrop", "aria-hidden": "true" });
  tabBar.prepend(openBtn);
  panel.prepend(h("div", { class: "drawer-head" }, h("strong", {}, "Settings"), closeBtn));
  layout.append(backdrop);

  let open = false;
  function set(v: boolean, restoreFocus = true) {
    if (v && !mq.matches) v = false;
    if (v === open) return;
    open = v;
    layout.classList.toggle("drawer-open", v);
    openBtn.setAttribute("aria-expanded", String(v));
    if (v) closeBtn.focus({ preventScroll: true });
    else if (restoreFocus && panel.contains(document.activeElement)) openBtn.focus({ preventScroll: true });
  }
  openBtn.addEventListener("click", () => set(!open));
  closeBtn.addEventListener("click", () => set(false));
  backdrop.addEventListener("click", () => set(false));
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && open && !e.defaultPrevented) set(false);
  });
  // leaving the narrow layout (rotation, window resize) resets the state, so it never comes back open by surprise
  mq.addEventListener("change", () => set(false, false));
  return { open: () => set(true), close: () => set(false), get isOpen() { return open; } };
}
