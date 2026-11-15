// Measure tool shared by the Layer and Sheets views: a toggle button, two clicks give a distance (mm) with dx and dy and a
// drawn line, vertices of the shown polygons are snapped to within a few screen pixels. View only: nothing here touches the
// settings, the pipeline or the export. Esc clears the measurement (a second Esc switches the tool off).
import type { Vec2 } from "../core/types";
import { formatMeasure, measure, nearestVertex, snapRadius } from "../core/measure";
import { h } from "./dom";

/** Pointer tolerance for snapping to a vertex, in screen pixels. */
export const SNAP_PX = 8;

export type MeasureHost = {
  /** the vertex lists currently drawn (world coordinates, mm) */
  vertices(): Iterable<readonly Vec2[]>;
  /** pixels per mm of the current view */
  scale(): number;
  /** the overlay changed: redraw */
  changed(): void;
  /** extra text for the readout (for example "different sheets") */
  note?(a: Vec2, b: Vec2): string;
};

export class MeasureTool {
  readonly button: HTMLButtonElement;
  readonly readout: HTMLElement;
  readonly el: HTMLElement;
  private on = false;
  private a: Vec2 | null = null;
  private b: Vec2 | null = null;
  /** cursor position after the first click (snapped when near a vertex): the live end of the line */
  private cursor: Vec2 | null = null;
  private snapped = false;

  constructor(private root: HTMLElement, private host: MeasureHost, id: string) {
    this.button = h("button", { type: "button", class: "btn small measure-btn", id, "aria-pressed": "false", title: "Measure a distance: click two points (snaps to corners). Esc clears." }, "Measure");
    this.readout = h("div", { class: "measure-readout", role: "status", "aria-live": "polite", hidden: true });
    this.el = h("div", { class: "measure-box" }, this.button, this.readout);
    this.button.addEventListener("click", () => this.toggle());
    window.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || e.defaultPrevented || !this.on || this.root.offsetParent === null) return;
      if (this.a || this.b) this.clear();
      else this.toggle(false);
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
    const had = !!(this.a || this.b || this.cursor);
    this.a = this.b = this.cursor = null;
    this.snapped = false;
    this.updateReadout();
    if (had) this.host.changed();
  }

  private snap(p: Vec2): Vec2 {
    const v = nearestVertex(p, this.host.vertices(), snapRadius(SNAP_PX, this.host.scale()));
    this.snapped = !!v;
    return v ?? p;
  }

  /** Pointer moved without a button: shows the snap target, and the live line after the first click. */
  move(world: Vec2) {
    if (!this.on) return;
    const wasSnapped = this.snapped, old = this.cursor;
    this.cursor = this.snap(world);
    if (this.snapped !== wasSnapped || !old || old[0] !== this.cursor[0] || old[1] !== this.cursor[1]) {
      if (this.a && !this.b) this.updateReadout();
      this.host.changed();
    }
  }

  /** A click (not a drag). Returns true when the tool used it. */
  click(world: Vec2): boolean {
    if (!this.on) return false;
    const p = this.snap(world);
    if (!this.a || this.b) {
      this.a = p;
      this.b = null;
    } else this.b = p;
    this.cursor = p;
    this.updateReadout();
    this.host.changed();
    return true;
  }

  /** The measured pair (for tests and the readout). */
  get points(): [Vec2, Vec2] | null {
    return this.a && this.b ? [this.a, this.b] : null;
  }

  private updateReadout() {
    const r = this.readout;
    r.hidden = !this.on;
    if (!this.on) return;
    const end = this.b ?? (this.a ? this.cursor : null);
    if (!this.a) r.textContent = "Click the first point";
    else if (!end || (end[0] === this.a[0] && end[1] === this.a[1] && !this.b)) r.textContent = "Click the second point";
    else r.textContent = formatMeasure(measure(this.a, end)) + (this.host.note?.(this.a, end) ?? "");
  }

  /** Draws the line, the end points and the snap marker. `ctx` is in screen pixels; `toScreen` maps a world point. */
  draw(ctx: CanvasRenderingContext2D, toScreen: (p: Vec2) => Vec2, color: string, text: string, bg: string) {
    if (!this.on) return;
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    const end = this.b ?? (this.a ? this.cursor : null);
    if (this.a && end) {
      const [x0, y0] = toScreen(this.a), [x1, y1] = toScreen(end);
      ctx.setLineDash(this.b ? [] : [5, 4]);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const [x, y] of [[x0, y0], [x1, y1]]) {
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      const label = formatMeasure(measure(this.a, end));
      ctx.font = '12px system-ui, "Segoe UI", sans-serif';
      ctx.textBaseline = "middle";
      const tw = ctx.measureText(label).width;
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2 - 14;
      ctx.fillStyle = bg;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(mx - tw / 2 - 5, my - 10, tw + 10, 20);
      ctx.globalAlpha = 1;
      ctx.strokeRect(mx - tw / 2 - 5, my - 10, tw + 10, 20);
      ctx.fillStyle = text;
      ctx.fillText(label, mx - tw / 2, my);
    } else if (this.a) {
      const [x, y] = toScreen(this.a);
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    if (this.cursor && this.snapped && !this.b) {
      const [x, y] = toScreen(this.cursor);
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}
