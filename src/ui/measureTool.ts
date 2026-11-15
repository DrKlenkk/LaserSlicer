// Measure tool shared by the Layer and Sheets views: a toggle button, two clicks (or taps) give a distance (mm) with dx, dy and
// angle and a drawn line. Points snap (priority: corner, circle centre, edge midpoint, nearest edge point) within a few screen
// pixels; a marker with a tiny label shows what the pointer would snap to, before and after the first click. Alt switches
// snapping off, Shift locks the line to horizontal or vertical. Near-circular rings (holes, round parts, dowel holes) report
// their diameter. View only: nothing here touches the settings, the pipeline or the export. Esc clears the measurement (a
// second Esc switches the tool off). The maths are in core/measure.ts.
import type { Vec2 } from "../core/types";
import { constrainAxis, findSnap, formatDelta, formatDiameter, formatMeasure, measure, snapRadius, type Circle, type Snap } from "../core/measure";
import { h } from "./dom";

/** Pointer tolerance for snapping, in screen pixels (mouse / pen, and touch where a finger is less exact). */
export const SNAP_PX = 10;
export const SNAP_PX_TOUCH = 18;

export type MeasureHost = {
  /** the closed rings currently drawn (world coordinates, mm) */
  rings(): Iterable<readonly Vec2[]>;
  /** circles drawn as circles (dowel holes), if any */
  circles?(): readonly Circle[];
  /** pixels per mm of the current view */
  scale(): number;
  /** the overlay changed: redraw */
  changed(): void;
  /** extra text for the readout (for example "different sheets") */
  note?(a: Vec2, b: Vec2): string;
};

/** Modifier state of a pointer event. */
export type Mods = { alt?: boolean; shift?: boolean; touch?: boolean };

type Pt = { p: Vec2; snap: Snap | null };

/** Modifier state of a pointer event: Alt = no snapping, Shift = horizontal / vertical, touch = bigger snap radius. */
export const mods = (e: PointerEvent | MouseEvent): Mods => ({ alt: e.altKey, shift: e.shiftKey, touch: (e as PointerEvent).pointerType === "touch" });

const same = (a: Vec2 | undefined, b: Vec2 | undefined) => !!a && !!b && a[0] === b[0] && a[1] === b[1];

export class MeasureTool {
  readonly button: HTMLButtonElement;
  readonly readout: HTMLElement;
  readonly el: HTMLElement;
  private on = false;
  private a: Pt | null = null;
  private b: Pt | null = null;
  /** where a click would land now (snapped, constrained): the live end of the line and the marker */
  private hover: Pt | null = null;
  private lastRaw: Vec2 | null = null;

  constructor(private root: HTMLElement, private host: MeasureHost, id: string) {
    this.button = h("button", { type: "button", class: "btn small measure-btn", id, "aria-pressed": "false", title: "Measure a distance: click two points. Snaps to corners, centres, midpoints and edges; hold Alt for no snapping, Shift for horizontal/vertical. Esc clears." }, "Measure");
    this.readout = h("div", { class: "measure-readout", role: "status", "aria-live": "polite", hidden: true });
    this.el = h("div", { class: "measure-box" }, this.button, this.readout);
    this.button.addEventListener("click", () => this.toggle());
    window.addEventListener("keydown", (e) => {
      if (!this.on || this.root.offsetParent === null) return;
      if (e.key === "Escape" && !e.defaultPrevented) {
        if (this.a || this.b) this.clear();
        else this.toggle(false);
      } else if ((e.key === "Shift" || e.key === "Alt") && this.lastRaw && this.hover) this.move(this.lastRaw, { alt: e.altKey, shift: e.shiftKey });
    });
    window.addEventListener("keyup", (e) => {
      if (this.on && (e.key === "Shift" || e.key === "Alt") && this.lastRaw && this.hover && this.root.offsetParent !== null) this.move(this.lastRaw, { alt: e.altKey, shift: e.shiftKey });
    });
  }

  get active() {
    return this.on;
  }

  toggle(on = !this.on) {
    if (on === this.on) return;
    this.on = on;
    this.button.setAttribute("aria-pressed", String(on));
    this.button.classList.toggle("active", on);
    this.clear();
    this.updateReadout();
    this.host.changed();
  }

  /** Drops the points (the tool stays on). */
  clear() {
    const had = !!(this.a || this.b || this.hover);
    this.a = this.b = this.hover = this.lastRaw = null;
    this.updateReadout();
    if (had) this.host.changed();
  }

  /** The pointer left the canvas: hides the snap marker and the live line. */
  leave() {
    if (!this.hover) return;
    this.hover = this.lastRaw = null;
    this.updateReadout();
    this.host.changed();
  }

  private resolve(raw: Vec2, m: Mods): Pt {
    const live = this.a && !this.b ? this.a.p : null;
    if (m.shift && live) return { p: constrainAxis(live, raw), snap: null };
    if (m.alt) return { p: raw, snap: null };
    const s = findSnap(raw, this.host.rings(), snapRadius(m.touch ? SNAP_PX_TOUCH : SNAP_PX, this.host.scale()), this.host.circles?.() ?? []);
    return s ? { p: s.p, snap: s } : { p: raw, snap: null };
  }

  /** Pointer moved without a button: shows the snap target, and the live line after the first click. */
  move(world: Vec2, m: Mods = {}) {
    if (!this.on) return;
    this.lastRaw = world;
    const old = this.hover;
    this.hover = this.resolve(world, m);
    if (!old || !same(old.p, this.hover.p) || old.snap?.type !== this.hover.snap?.type) {
      this.updateReadout();
      this.host.changed();
    }
  }

  /** A click or tap (not a drag). Returns true when the tool used it. */
  click(world: Vec2, m: Mods = {}): boolean {
    if (!this.on) return false;
    this.lastRaw = world;
    const pt = this.resolve(world, m);
    if (!this.a || this.b) {
      this.a = pt;
      this.b = null;
    } else this.b = pt;
    this.hover = pt;
    this.updateReadout();
    this.host.changed();
    return true;
  }

  /** The measured pair (for tests and the readout). */
  get points(): [Vec2, Vec2] | null {
    return this.a && this.b ? [this.a.p, this.b.p] : null;
  }

  /** The snap currently under the pointer (for tests). */
  get hoverSnap(): Snap | null {
    return this.hover?.snap ?? null;
  }

  private end(): Pt | null {
    return this.b ?? (this.a ? this.hover : null);
  }

  private updateReadout() {
    const r = this.readout;
    r.hidden = !this.on;
    if (!this.on) return;
    const dia = (...pts: (Pt | null)[]) => {
      const seen: Circle[] = [];
      for (const p of pts) if (p?.snap?.circle && !seen.includes(p.snap.circle)) seen.push(p.snap.circle);
      return seen.map((c) => ` · ${formatDiameter(c)}`).join("");
    };
    const e = this.end();
    if (!this.a) {
      const s = this.hover?.snap;
      r.textContent = s ? `${s.type}${dia(this.hover)} · click to start` : "Click the first point";
    } else if (!e || (!this.b && same(e.p, this.a.p))) r.textContent = "Click the second point" + dia(this.a);
    else r.textContent = formatMeasure(measure(this.a.p, e.p)) + (this.host.note?.(this.a.p, e.p) ?? "") + dia(this.a, e);
  }

  /** Draws the line, the end points, the snap marker and the labels. `ctx` is in screen pixels; `toScreen` maps a world point. */
  draw(ctx: CanvasRenderingContext2D, toScreen: (p: Vec2) => Vec2, color: string, text: string, bg: string) {
    if (!this.on) return;
    const W = ctx.canvas.clientWidth, H = ctx.canvas.clientHeight;
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    const stroke = (fn: () => void, w: number) => {
      ctx.setLineDash([]);
      ctx.strokeStyle = bg;
      ctx.lineWidth = w + 3;
      fn();
      ctx.stroke();
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      fn();
      ctx.stroke();
    };
    const e = this.end();
    if (this.a && e && !same(this.a.p, e.p)) {
      const [x0, y0] = toScreen(this.a.p), [x1, y1] = toScreen(e.p);
      const line = () => { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); };
      ctx.setLineDash([]);
      ctx.strokeStyle = bg;
      ctx.lineWidth = 4.5;
      line();
      ctx.stroke();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash(this.b ? [] : [6, 4]);
      line();
      ctx.stroke();
      ctx.setLineDash([]);
      // label: distance on top, dx / dy / angle below, beside the middle of the line
      const m = measure(this.a.p, e.p);
      const len = Math.hypot(x1 - x0, y1 - y0) || 1;
      let nx = (y1 - y0) / len, ny = -(x1 - x0) / len; // a normal of the screen line, pointing up
      if (ny > 0 || (ny === 0 && nx < 0)) { nx = -nx; ny = -ny; }
      const off = 30;
      this.pill(ctx, [`${formatMeasure(m).split(" (")[0]}`, formatDelta(m)], (x0 + x1) / 2 + nx * off, (y0 + y1) / 2 + ny * off, 13, color, text, bg, W, H);
    }
    // end points and snap marker
    for (const pt of [this.a, this.b]) {
      if (!pt) continue;
      const [x, y] = toScreen(pt.p);
      stroke(() => { ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); }, 2);
      ctx.fillStyle = color;
      ctx.fill();
      if (pt.snap?.circle) this.pill(ctx, [formatDiameter(pt.snap.circle)], x, y + 20, 12, color, text, bg, W, H);
    }
    const hv = this.hover;
    if (hv?.snap) {
      const [x, y] = toScreen(hv.snap.p);
      this.marker(ctx, hv.snap.type, x, y, stroke);
      const label = hv.snap.type + (hv.snap.circle ? ` · ${formatDiameter(hv.snap.circle)}` : "");
      this.pill(ctx, [label], x + 8, y - 18, 11, color, text, bg, W, H, "left");
    }
    ctx.restore();
  }

  /** corner: square, centre: circle with a cross, midpoint: triangle, edge: diamond. All 14 px, whatever the zoom. */
  private marker(ctx: CanvasRenderingContext2D, type: Snap["type"], x: number, y: number, stroke: (fn: () => void, w: number) => void) {
    const s = 6;
    stroke(() => {
      ctx.beginPath();
      if (type === "corner") ctx.rect(x - s, y - s, 2 * s, 2 * s);
      else if (type === "centre") {
        ctx.arc(x, y, s, 0, Math.PI * 2);
        ctx.moveTo(x - s - 3, y); ctx.lineTo(x + s + 3, y);
        ctx.moveTo(x, y - s - 3); ctx.lineTo(x, y + s + 3);
      } else if (type === "midpoint") {
        ctx.moveTo(x, y - s); ctx.lineTo(x + s, y + s * 0.8); ctx.lineTo(x - s, y + s * 0.8); ctx.closePath();
      } else {
        ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s, y); ctx.closePath();
      }
    }, 1.75);
  }

  /** A text pill (one or more lines) centred (or left-aligned) on cx, cy, kept inside the canvas. */
  private pill(ctx: CanvasRenderingContext2D, lines: string[], cx: number, cy: number, size: number, border: string, fg: string, bg: string, W: number, H: number, align: "centre" | "left" = "centre") {
    ctx.save();
    ctx.setLineDash([]);
    ctx.font = `${size}px system-ui, "Segoe UI", sans-serif`;
    ctx.textBaseline = "middle";
    const lh = size + 4, pad = 5;
    const tw = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const w = tw + 2 * pad, hgt = lines.length * lh + 2 * pad - 2;
    let x = align === "left" ? cx : cx - w / 2, y = cy - hgt / 2;
    x = Math.max(2, Math.min(W - w - 2, x));
    y = Math.max(2, Math.min(H - hgt - 2, y));
    ctx.beginPath();
    ctx.roundRect(x, y, w, hgt, 5);
    ctx.fillStyle = bg;
    ctx.globalAlpha = 0.93;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = fg;
    lines.forEach((l, i) => ctx.fillText(l, x + pad, y + pad - 1 + lh / 2 + i * lh));
    ctx.restore();
  }
}
