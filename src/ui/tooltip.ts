// Reusable info icon with a tooltip. Opens on hover, keyboard focus and tap/click; closes on mouse leave, blur,
// Esc and outside clicks. The bubble is position: fixed (computed from the icon's rect) so the scrolling panel
// never clips it, and it flips above/below and clamps horizontally to stay inside the viewport.
import { h } from "./dom";
import { HELP, type HelpKey } from "./helpText";

const GAP = 8;
const MARGIN = 8;
let seq = 0;
let bubble: HTMLElement | null = null;
let current: HTMLElement | null = null;
let pinned: HTMLElement | null = null; // opened by click/tap

function getBubble(): HTMLElement {
  if (!bubble) {
    bubble = h("div", { class: "tip-bubble", role: "tooltip", id: "tip-bubble" });
    bubble.hidden = true;
    document.body.append(bubble);
    document.addEventListener("pointerdown", (e) => {
      if (pinned && e.target instanceof Node && !pinned.contains(e.target) && !bubble!.contains(e.target)) hide();
    }, true);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && current) {
        hide();
        e.stopPropagation();
      }
    }, true);
    window.addEventListener("resize", () => hide());
    document.addEventListener("scroll", (e) => {
      if (e.target === bubble || !current) return;
      const r = current.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) hide(); // icon scrolled out of view
      else show(current, HELP[current.dataset.help as HelpKey]); // follow the icon
    }, true);
  }
  return bubble;
}

/** Fixed position for a bubble of size (w, hgt) next to `r`: below by default, above if it does not fit. */
export function placeTooltip(r: { left: number; right: number; top: number; bottom: number }, w: number, hgt: number, vw: number, vh: number) {
  const roomBelow = vh - r.bottom - GAP - MARGIN;
  const roomAbove = r.top - GAP - MARGIN;
  const below = hgt <= roomBelow || roomBelow >= roomAbove;
  let top = below ? r.bottom + GAP : r.top - GAP - hgt;
  top = Math.max(MARGIN, Math.min(top, vh - MARGIN - hgt));
  const cx = (r.left + r.right) / 2;
  const left = Math.max(MARGIN, Math.min(cx - w / 2, vw - MARGIN - w));
  return { left, top, below, arrowX: Math.max(10, Math.min(cx - left, w - 10)) };
}

function show(icon: HTMLElement, text: string) {
  const b = getBubble();
  current = icon;
  b.textContent = text;
  b.hidden = false;
  b.style.left = "0px";
  b.style.top = "0px";
  b.style.maxWidth = `${Math.min(320, window.innerWidth - 2 * MARGIN)}px`;
  const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
  const bw = b.offsetWidth, bh = b.offsetHeight;
  const p = placeTooltip(icon.getBoundingClientRect(), bw, bh, vw, vh);
  b.style.left = `${Math.round(p.left)}px`;
  b.style.top = `${Math.round(p.top)}px`;
  b.style.setProperty("--arrow-x", `${Math.round(p.arrowX)}px`);
  b.classList.toggle("above", !p.below);
}

function hide() {
  if (bubble) bubble.hidden = true;
  current = null;
  pinned = null;
}

/** Info icon for a setting. Put it inside the setting's label. */
export function infoIcon(key: HelpKey): HTMLElement {
  const text = HELP[key];
  const id = `tip-${key}-${++seq}`;
  const icon = h("button", { type: "button", class: "tip-icon", "aria-label": "Help", "aria-describedby": id, "data-help": key }, "?");
  // The description for assistive tech lives in a visually hidden element; the bubble itself is shared.
  const sr = h("span", { class: "sr-only", id }, text);
  const wrap = h("span", { class: "tip" }, icon, sr);
  const open = () => show(icon, text);
  icon.addEventListener("mouseenter", () => {
    if (!pinned) open();
  });
  icon.addEventListener("mouseleave", () => {
    if (!pinned && current === icon) hide();
  });
  icon.addEventListener("focus", () => {
    if (!pinned) open();
  });
  icon.addEventListener("blur", () => {
    if (current === icon) hide();
  });
  icon.addEventListener("click", (e) => {
    e.preventDefault(); // do not toggle the checkbox / focus the input of the surrounding label
    e.stopPropagation();
    if (pinned === icon) hide();
    else {
      open();
      pinned = icon;
    }
  });
  return wrap;
}
