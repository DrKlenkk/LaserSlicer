// Sheets tab: all nested sheets side by side as they will be cut, in the DXF layer colours.
// Hover a part for its id, click it to jump to its layer. Wheel zoom, drag pan, double-click fits.
import type { Part, Ring, Vec2 } from "../core/types";
import type { RunResult } from "../core/pipeline";
import { applyPlacement } from "../core/nest";
import { h } from "./dom";
import { createLegend } from "./legend";

type View = { scale: number; ox: number; oy: number }; // screen = o + world * (scale, -scale)
type Placed = { part: Part; sheet: number; ox: number; path: Path2D; minX: number; minY: number; maxX: number; maxY: number };

const GAP = 20; // mm between sheets
export const COLORS = {
  light: { cut: "#e02020", engrave: "#2a55ff", label: "#009a2c", sheet: "#8a8a8a" },
  dark: { cut: "#ff5c50", engrave: "#6f8dff", label: "#37d067", sheet: "#9a9a9a" },
};

export function sheetColors() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? COLORS.dark : COLORS.light;
}

function inRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export class SheetView {
  private canvas = h("canvas", { class: "layer-canvas", tabindex: 0, "aria-label": "Nested sheets" });
  private tip = h("div", { class: "sheet-tip", hidden: true });
  private empty = h("div", { class: "layer-empty" }, "Load a model to see its sheets.");
  private result: RunResult | null = null;
  private placed: Placed[] = [];
  private view: View = { scale: 1, ox: 0, oy: 0 };
  private fitPending = true;
  private hover: Placed | null = null;
  private drag: { x: number; y: number; moved: number } | null = null;
  private sheetsW = 0;
  private sheetsH = 0;

  constructor(private root: HTMLElement, private onPart: (layer: number, partId: string) => void) {
    root.classList.add("layer-view");
    const col = () => sheetColors();
    const legend = createLegend(
      "legend-sheets",
      [
        { layer: "CUT", text: "kerf-compensated outlines, dowel holes: cut through", color: () => col().cut },
        { layer: "ENGRAVE", text: "next-layer outline, glue alignment line", color: () => col().engrave },
        { layer: "LABEL", text: "layer label text: engraved", color: () => col().label },
        { layer: "SHEET", text: "sheet border: not exported by default", color: () => col().sheet, thin: true },
        { layer: "Hover", text: "part under the pointer (click: open its layer)", color: () => col().cut, fill: true },
      ],
      "Colours map to the DXF layers, so you can assign them to cut / engrave in LightBurn and similar software.",
    );
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => legend.refresh());
    root.append(this.canvas, this.tip, this.empty, legend.el);
    const c = this.canvas;
    c.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    c.addEventListener("pointerdown", (e) => {
      this.drag = { x: e.clientX, y: e.clientY, moved: 0 };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener("pointermove", (e) => {
      if (this.drag) {
        const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
        this.drag.moved += Math.abs(dx) + Math.abs(dy);
        this.view.ox += dx;
        this.view.oy += dy;
        this.drag.x = e.clientX;
        this.drag.y = e.clientY;
        this.draw();
        return;
      }
      this.setHover(this.hit(e), e);
    });
    c.addEventListener("pointerleave", () => this.setHover(null));
    c.addEventListener("pointerup", (e) => {
      const wasClick = this.drag && this.drag.moved < 4;
      this.drag = null;
      if (wasClick) {
        const p = this.hit(e);
        if (p) this.onPart(p.part.layer, p.part.id);
      }
    });
    c.addEventListener("pointercancel", () => (this.drag = null));
    c.addEventListener("dblclick", () => this.fit());
    new ResizeObserver(() => this.draw()).observe(root);
  }

  setResult(r: RunResult | null, resetView: boolean) {
    this.result = r;
    this.hover = null;
    this.tip.hidden = true;
    this.placed = [];
    this.sheetsW = this.sheetsH = 0;
    if (r) {
      const byId = new Map(r.parts.map((p) => [p.id, p]));
      for (const pl of r.placements) {
        const base = byId.get(pl.partId);
        const sheet = r.sheets[pl.sheet];
        if (!base || !sheet) continue;
        const ox = pl.sheet * (sheet.w + GAP);
        const part = applyPlacement(base, pl);
        const path = new Path2D();
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const ring of [part.cut.outer, ...part.cut.holes]) trace(path, ring, ox);
        for (const [x, y] of part.cut.outer) {
          minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
        this.placed.push({ part, sheet: pl.sheet, ox, path, minX, minY, maxX, maxY });
      }
      for (const s of r.sheets) {
        this.sheetsW = s.index * (s.w + GAP) + s.w;
        this.sheetsH = Math.max(this.sheetsH, s.h);
      }
    }
    this.empty.hidden = !!r && r.sheets.length > 0;
    this.empty.textContent = r ? "No parts to place." : "Load a model to see its sheets.";
    if (resetView) this.fitPending = true;
    this.draw();
  }

  activate() {
    this.draw();
  }

  fit() {
    this.fitPending = false;
    const w = this.canvas.clientWidth, hgt = this.canvas.clientHeight;
    if (!this.sheetsW || w === 0 || hgt === 0) {
      this.fitPending = true;
      return;
    }
    const pad = 28; // room for the sheet captions
    const scale = Math.min((w - 2 * pad) / this.sheetsW, (hgt - 2 * pad) / this.sheetsH);
    this.view = { scale, ox: (w - this.sheetsW * scale) / 2, oy: (hgt + this.sheetsH * scale) / 2 };
    this.draw();
  }

  private toWorld(e: PointerEvent | MouseEvent): Vec2 {
    const r = this.canvas.getBoundingClientRect();
    const v = this.view;
    return [(e.clientX - r.left - v.ox) / v.scale, (v.oy - (e.clientY - r.top)) / v.scale];
  }

  private hit(e: PointerEvent | MouseEvent): Placed | null {
    const [x, y] = this.toWorld(e);
    for (let i = this.placed.length - 1; i >= 0; i--) {
      const p = this.placed[i];
      const px = x - p.ox;
      if (px < p.minX || px > p.maxX || y < p.minY || y > p.maxY) continue;
      if (inRing(px, y, p.part.cut.outer) && !p.part.cut.holes.some((hl) => inRing(px, y, hl))) return p;
    }
    return null;
  }

  private setHover(p: Placed | null, e?: PointerEvent) {
    if (p !== this.hover) {
      this.hover = p;
      this.draw();
    }
    if (p && e) {
      const r = this.root.getBoundingClientRect();
      this.tip.textContent = `${p.part.id} (layer ${p.part.layer})`;
      this.tip.style.left = `${e.clientX - r.left + 12}px`;
      this.tip.style.top = `${e.clientY - r.top + 12}px`;
      this.tip.hidden = false;
    } else this.tip.hidden = true;
    this.canvas.style.cursor = p ? "pointer" : "";
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const v = this.view;
    const ns = Math.max(0.05, Math.min(2000, v.scale * Math.exp(-e.deltaY * 0.0015)));
    const k = ns / v.scale;
    v.ox = mx - (mx - v.ox) * k;
    v.oy = my - (my - v.oy) * k;
    v.scale = ns;
    this.draw();
  }

  private draw() {
    const cv = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, hgt = cv.clientHeight;
    if (w === 0 || hgt === 0) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hgt * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(hgt * dpr);
    }
    if (this.fitPending && this.sheetsW) {
      this.fit();
      return;
    }
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    const r = this.result;
    if (!r) return;
    const css = getComputedStyle(this.root);
    const col = window.matchMedia("(prefers-color-scheme: dark)").matches ? COLORS.dark : COLORS.light;
    const paper = css.getPropertyValue("--surface").trim() || "#fff";
    const text = css.getPropertyValue("--muted").trim() || "#777";
    const v = this.view;
    // world (mm, Y up) -> screen
    ctx.setTransform(dpr * v.scale, 0, 0, -dpr * v.scale, dpr * v.ox, dpr * v.oy);
    const px = 1 / v.scale;
    for (const s of r.sheets) {
      const x0 = s.index * (s.w + GAP);
      ctx.fillStyle = paper;
      ctx.fillRect(x0, 0, s.w, s.h);
      ctx.strokeStyle = col.sheet;
      ctx.lineWidth = px;
      ctx.strokeRect(x0, 0, s.w, s.h);
    }
    ctx.lineJoin = "round";
    for (const p of this.placed) {
      if (p === this.hover) {
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = col.cut;
        ctx.fill(p.path, "evenodd");
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = col.cut;
      ctx.lineWidth = Math.max(px * 1.25, 0.1);
      ctx.stroke(p.path);
      ctx.lineWidth = Math.max(px, 0.1);
      ctx.strokeStyle = col.engrave;
      for (const l of p.part.engrave) strokeLine(ctx, l, p.ox);
      ctx.strokeStyle = col.label;
      for (const l of p.part.label) strokeLine(ctx, l, p.ox);
      ctx.strokeStyle = col.cut;
      for (const c of p.part.holes) {
        ctx.beginPath();
        ctx.arc(p.ox + c.c[0], c.c[1], c.d / 2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // captions in screen space
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = text;
    ctx.font = '12px system-ui, "Segoe UI", sans-serif';
    ctx.textBaseline = "bottom";
    for (const s of r.sheets) {
      const x = v.ox + s.index * (s.w + GAP) * v.scale;
      ctx.fillText(`Sheet ${s.index + 1} · ${s.partIds.length} parts · ${s.usePct.toFixed(1)} % used`, x, v.oy - s.h * v.scale - 4);
    }
  }
}

function trace(path: Path2D, ring: Ring, ox: number) {
  ring.forEach(([x, y], i) => (i ? path.lineTo(ox + x, y) : path.moveTo(ox + x, y)));
  path.closePath();
}

function strokeLine(ctx: CanvasRenderingContext2D, l: Vec2[], ox: number) {
  ctx.beginPath();
  l.forEach(([x, y], i) => (i ? ctx.lineTo(ox + x, y) : ctx.moveTo(ox + x, y)));
  ctx.stroke();
}
