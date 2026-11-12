// Layer tab: canvas view of one layer with a slider and arrow keys, wheel zoom and drag pan.
import type { Layer, Shape } from "../core/types";
import type { RunResult } from "../core/pipeline";
import { h } from "./dom";

type View = { scale: number; ox: number; oy: number }; // screen = o + world * scale (y flipped)

export class LayerView2D {
  private canvas = h("canvas", { class: "layer-canvas", tabindex: 0, "aria-label": "Layer outline view" });
  private slider = h("input", { type: "range", min: 0, max: 0, step: 1, value: 0, "aria-label": "Layer" });
  private info = h("div", { class: "layer-info" });
  private empty = h("div", { class: "layer-empty" }, "Load a model to see its layers.");
  private result: RunResult | null = null;
  private layer = 0;
  private view: View = { scale: 1, ox: 0, oy: 0 };
  private bounds: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
  private fitPending = true;
  private drag: { x: number; y: number } | null = null;

  constructor(private root: HTMLElement, private onLayer: (i: number) => void) {
    root.classList.add("layer-view");
    const hint = h("div", { class: "layer-hint" }, "←/→ step · wheel zoom · drag pan · double-click fit");
    const bar = h("div", { class: "layer-bar" }, this.slider, hint);
    root.append(this.canvas, this.info, this.empty, bar);

    this.slider.addEventListener("input", () => this.step(Number(this.slider.value) - this.layer));
    this.canvas.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    this.canvas.addEventListener("pointerdown", (e) => {
      this.drag = { x: e.clientX, y: e.clientY };
      this.canvas.setPointerCapture(e.pointerId);
      this.canvas.focus();
    });
    this.canvas.addEventListener("pointermove", (e) => {
      if (!this.drag) return;
      this.view.ox += e.clientX - this.drag.x;
      this.view.oy += e.clientY - this.drag.y;
      this.drag = { x: e.clientX, y: e.clientY };
      this.draw();
    });
    const end = () => (this.drag = null);
    this.canvas.addEventListener("pointerup", end);
    this.canvas.addEventListener("pointercancel", end);
    this.canvas.addEventListener("dblclick", () => this.fit());
    window.addEventListener("keydown", (e) => this.onKey(e));
    new ResizeObserver(() => this.draw()).observe(root);
    this.updateUi();
  }

  /** `resetView`: frame the new geometry (new model). Otherwise zoom and pan are kept. */
  setResult(r: RunResult | null, resetView: boolean) {
    this.result = r;
    this.bounds = r ? layersBounds(r.layers) : null;
    if (resetView) this.fitPending = true;
    this.layer = r ? Math.min(this.layer, r.layers.length - 1) : 0;
    this.updateUi();
    this.draw();
  }

  setLayer(i: number) {
    if (!this.result) return;
    const n = Math.max(0, Math.min(this.result.layers.length - 1, i));
    if (n === this.layer) return;
    this.layer = n;
    this.updateUi();
    this.draw();
  }

  /** Call when the tab becomes visible: the canvas has no size while hidden. */
  activate() {
    this.draw();
  }

  fit() {
    this.fitPending = false;
    const w = this.canvas.clientWidth, hgt = this.canvas.clientHeight;
    const b = this.bounds;
    if (!b || w === 0 || hgt === 0) {
      this.fitPending = true;
      return;
    }
    const bw = Math.max(b.maxX - b.minX, 1e-6), bh = Math.max(b.maxY - b.minY, 1e-6);
    const scale = Math.min(w / bw, hgt / bh) * 0.85;
    this.view = { scale, ox: w / 2 - ((b.minX + b.maxX) / 2) * scale, oy: hgt / 2 + ((b.minY + b.maxY) / 2) * scale };
    this.draw();
  }

  private step(d: number) {
    if (!this.result || d === 0) return;
    const n = Math.max(0, Math.min(this.result.layers.length - 1, this.layer + d));
    if (n === this.layer) {
      this.slider.value = String(n);
      return;
    }
    this.layer = n;
    this.updateUi();
    this.draw();
    this.onLayer(n);
  }

  private onKey(e: KeyboardEvent) {
    if (this.root.offsetParent === null || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return; // slider handles its own keys
    const n = this.result?.layers.length ?? 0;
    let d = 0;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") d = -1;
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") d = 1;
    else if (e.key === "PageDown") d = -10;
    else if (e.key === "PageUp") d = 10;
    else if (e.key === "Home") d = -n;
    else if (e.key === "End") d = n;
    else return;
    e.preventDefault();
    this.step(d);
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const f = Math.exp(-e.deltaY * 0.0015);
    const v = this.view;
    const ns = Math.max(0.01, Math.min(5000, v.scale * f));
    const k = ns / v.scale;
    v.ox = mx - (mx - v.ox) * k;
    v.oy = my - (my - v.oy) * k;
    v.scale = ns;
    this.draw();
  }

  private updateUi() {
    const r = this.result;
    this.empty.hidden = !!r;
    this.slider.disabled = !r;
    this.slider.max = String(r ? r.layers.length - 1 : 0);
    this.slider.value = String(this.layer);
    if (!r) {
      this.info.textContent = "";
      return;
    }
    const l = r.layers[this.layer];
    const parts = r.parts.filter((p) => p.layer === l.index).length;
    this.info.textContent = `Layer ${l.index} of ${r.layers.length - 1} · Z ${l.z0.toFixed(2)} to ${l.z1.toFixed(2)} mm · ${parts} part${parts === 1 ? "" : "s"}`;
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
    if (this.fitPending && this.bounds) {
      this.fit(); // calls draw again
      return;
    }
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    const r = this.result;
    if (!r) return;
    const css = getComputedStyle(this.root);
    const cut = css.getPropertyValue("--cut").trim() || "#d32f2f";
    const ghost = css.getPropertyValue("--ghost").trim() || "#8a7f72";
    const v = this.view;
    const trace = (shapes: Shape[]) => {
      ctx.beginPath();
      for (const s of shapes)
        for (const ring of [s.outer, ...s.holes]) {
          ring.forEach(([x, y], i) => (i ? ctx.lineTo(v.ox + x * v.scale, v.oy - y * v.scale) : ctx.moveTo(v.ox + x * v.scale, v.oy - y * v.scale)));
          ctx.closePath();
        }
    };
    this.drawGrid(ctx, w, hgt, css);
    if (this.layer > 0) {
      trace(r.layers[this.layer - 1].shapes);
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = ghost;
      ctx.fill("evenodd");
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = ghost;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    const cur = r.layers[this.layer].shapes;
    trace(cur);
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = cut;
    ctx.fill("evenodd");
    ctx.globalAlpha = 1;
    ctx.strokeStyle = cut;
    ctx.lineWidth = 1.75;
    ctx.lineJoin = "round";
    ctx.stroke();
  }

  /** Light 10 mm / 50 mm grid so zoom level is readable. */
  private drawGrid(ctx: CanvasRenderingContext2D, w: number, hgt: number, css: CSSStyleDeclaration) {
    const v = this.view;
    let stepMm = 10;
    while (stepMm * v.scale < 14) stepMm *= 5;
    while (stepMm * v.scale > 140) stepMm /= 5;
    const minor = css.getPropertyValue("--grid-minor").trim() || "#ddd";
    const major = css.getPropertyValue("--grid-major").trim() || "#bbb";
    const x0 = Math.floor((0 - v.ox) / v.scale / stepMm) * stepMm;
    const x1 = (w - v.ox) / v.scale;
    const yTop = (v.oy - 0) / v.scale, yBot = (v.oy - hgt) / v.scale;
    ctx.lineWidth = 1;
    for (let x = x0; x <= x1; x += stepMm) {
      ctx.strokeStyle = Math.abs(x) < 1e-9 ? major : minor;
      const sx = Math.round(v.ox + x * v.scale) + 0.5;
      ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, hgt); ctx.stroke();
    }
    const y0 = Math.floor(yBot / stepMm) * stepMm;
    for (let y = y0; y <= yTop; y += stepMm) {
      ctx.strokeStyle = Math.abs(y) < 1e-9 ? major : minor;
      const sy = Math.round(v.oy - y * v.scale) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(w, sy); ctx.stroke();
    }
    ctx.fillStyle = css.getPropertyValue("--muted").trim() || "#888";
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillText(`grid ${stepMm} mm`, 10, hgt - 40);
  }
}

function layersBounds(layers: Layer[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const l of layers)
    for (const s of l.shapes)
      for (const [x, y] of s.outer) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  return minX <= maxX ? { minX, minY, maxX, maxY } : null;
}
