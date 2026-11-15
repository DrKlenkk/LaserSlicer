// Reusable info icon with a tooltip. Opens on hover, keyboard focus and tap/click; closes on mouse leave (after a short
// grace period so the pointer can cross onto the bubble), blur, Esc and outside clicks. The bubble ends with a
// "Read more" link to the matching section of docs.html (new tab, so the loaded model is kept); it is clickable
// (hover grace, tap pins it) and reachable with Tab from the icon. The bubble is position: fixed (computed from the icon's rect) so the scrolling panel
// never clips it, and it flips above/below and clamps horizontally to stay inside the viewport.
import { h } from "./dom";
import { HELP, docUrl, type HelpKey } from "./helpText";

const GAP = 8;
const MARGIN = 8;
let seq = 0;
let bubble: HTMLElement | null = null;
let current: HTMLElement | null = null;
let pinned: HTMLElement | null = null; // opened by click/tap
let hideTimer = 0;
let suppressFocus = false; // set while focus is moved back to an icon without reopening its bubble
const LEAVE_DELAY = 250; // ms the pointer may take to get from the icon onto the bubble
let textEl: HTMLElement;
let linkEl: HTMLAnchorElement;
let shownKey = "";

function getBubble(): HTMLElement {
  if (!bubble) {
    textEl = h("span", { class: "tip-text" });
    linkEl = h("a", { class: "tip-more", target: "_blank", rel: "noopener" }, "Read more \u2192") as HTMLAnchorElement;
    bubble = h("div", { class: "tip-bubble", role: "tooltip", id: "tip-bubble" }, textEl, linkEl);
    bubble.hidden = true;
    document.body.append(bubble);
    bubble.addEventListener("mouseenter", cancelHide);
    bubble.addEventListener("mouseleave", scheduleHide);
    // Keep focus where it is (the icon) when the bubble is pressed: Safari does not focus links, so a blur on the icon
    // would otherwise hide the bubble before the click lands. The link itself still follows on click.
    bubble.addEventListener("mousedown", (e) => e.preventDefault());
    linkEl.addEventListener("keydown", (e) => {
      if (e.key !== "Tab" || !current) return;
      const icon = current;
      suppressFocus = true;
      icon.focus();
      suppressFocus = false;
      hide();
      if (e.shiftKey) e.preventDefault(); // Shift+Tab: back on the icon; Tab: the browser continues after the icon
    });
    bubble.addEventListener("focusout", (e) => {
      const to = e.relatedTarget as Node | null;
      if (current && !(to && (bubble!.contains(to) || current.contains(to)))) hide();
    });
    document.addEventListener("pointerdown", (e) => {
      if (pinned && e.target instanceof Node && !pinned.contains(e.target) && !bubble!.contains(e.target)) hide();
    }, true);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && current) {
        const icon = current;
        const inBubble = bubble!.contains(document.activeElement);
        hide();
        if (inBubble) {
          suppressFocus = true;
          icon.focus();
          suppressFocus = false;
        }
        e.stopPropagation();
      }
    }, true);
    window.addEventListener("resize", () => hide());
    document.addEventListener("scroll", (e) => {
      if (e.target === bubble || !current) return;
      const r = current.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) hide(); // icon scrolled out of view
      else show(current); // follow the icon
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

function cancelHide() {
  clearTimeout(hideTimer);
}

function scheduleHide() {
  clearTimeout(hideTimer);
  if (pinned) return;
  hideTimer = window.setTimeout(hide, LEAVE_DELAY);
}

function show(icon: HTMLElement) {
  const b = getBubble();
  cancelHide();
  current = icon;
  const key = icon.dataset.help as HelpKey;
  if (shownKey !== key) {
    // only rebuild when the content changes, so a focused link survives repositioning on scroll
    textEl.textContent = HELP[key];
    linkEl.href = docUrl(key);
    shownKey = key;
  }
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
  clearTimeout(hideTimer);
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
  const open = () => show(icon);
  icon.addEventListener("mouseenter", () => {
    if (!pinned) open();
  });
  icon.addEventListener("mouseleave", () => {
    if (current === icon) scheduleHide();
  });
  icon.addEventListener("focus", () => {
    if (!pinned && !suppressFocus) open();
  });
  icon.addEventListener("blur", (e) => {
    if (current !== icon) return;
    if (bubble && e.relatedTarget instanceof Node && bubble.contains(e.relatedTarget)) return;
    hide();
  });
  icon.addEventListener("keydown", (e) => {
    // Tab moves into the bubble so its link can be reached (the bubble sits at the end of the page, not next to the icon)
    if (e.key === "Tab" && !e.shiftKey && current === icon && bubble && !bubble.hidden) {
      e.preventDefault();
      linkEl.focus();
    }
  });
  icon.addEventListener("click", (e) => {
    e.preventDefault(); // do not toggle the checkbox / focus the input of the surrounding label
    e.stopPropagation();
    if (pinned === icon) hide();
    else {
      open();
      pinned = icon;
      cancelHide();
    }
  });
  return wrap;
}
