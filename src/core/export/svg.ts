// SVG writer (plan "SVG"): 1 user unit = 1 mm, Y flipped (y_svg = height - y), groups CUT / ENGRAVE / LABEL.
import type { Vec2 } from "../types";
import { num, polyline, type Drawing } from "./common";

export const SVG_COLORS = { CUT: "#ff0000", ENGRAVE: "#0000ff", LABEL: "#00a000" } as const;

export function writeSvg(d: Drawing): string {
  const pt = (p: Vec2) => `${num(p[0])} ${num(d.height - p[1])}`;
  const sub = (pts: Vec2[], closed: boolean) =>
    pts.length < 2 ? "" : `M${pts.map(pt).join(" L")}${closed ? " Z" : ""}`;
  const w = num(d.width), h = num(d.height);
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">`);
  const group = (id: keyof typeof SVG_COLORS, body: string[]) =>
    out.push(`<g id="${id}" stroke="${SVG_COLORS[id]}" fill="none" stroke-width="0.1">`, ...body, "</g>");

  // CUT: one path per shape, outer + holes as subpaths with evenodd so holes stay holes
  const cut: string[] = [];
  for (const sh of d.cut) cut.push(`<path fill-rule="evenodd" d="${sh.map((r) => sub(r, true)).join(" ")}"/>`);
  for (const c of d.circles)
    cut.push(`<circle cx="${num(c.c[0])}" cy="${num(d.height - c.c[1])}" r="${num(c.d / 2)}"/>`);
  group("CUT", cut);

  const lines = (ls: Vec2[][]) =>
    ls.map((l) => {
      const { pts, closed } = polyline(l);
      return `<path d="${sub(pts, closed)}"/>`;
    });
  group("ENGRAVE", lines(d.engrave));
  group("LABEL", lines(d.label));
  out.push("</svg>");
  return out.join("\n") + "\n";
}
