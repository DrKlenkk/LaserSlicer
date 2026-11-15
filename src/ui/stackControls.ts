// Explode and Section sliders of the 3D view (stacked result only). View only: the values go to the viewport and nowhere else.
// They are not settings (not in the project file, not in the undo history, not saved); they start at 0 on every page load.
import type { SectionAxis } from "../core/stackView";
import { h } from "./dom";
import { infoIcon } from "./tooltip";

export type StackControls = {
  el: HTMLElement;
  /** show or hide the whole box (stacked result of the 3D tab only) */
  setVisible(v: boolean): void;
  /** back to 0 / 0 (a new model or result with other extent keeps the sliders, only Reset or the user changes them) */
  reset(): void;
};

export function createStackControls(onChange: (explode: number, section: number, axis: SectionAxis) => void): StackControls {
  const slider = (id: string, label: string) => {
    const input = h("input", { type: "range", min: 0, max: 100, step: 1, value: 0, id, "aria-label": label, "aria-valuetext": "0 %" });
    const val = h("output", { class: "sc-val", for: id }, "0 %");
    return { input, val };
  };
  const ex = slider("explode-slider", "Explode");
  const se = slider("section-slider", "Section");
  const axis = h("select", { id: "section-axis", "aria-label": "Section plane perpendicular to" }, h("option", { value: "x" }, "X axis"), h("option", { value: "y" }, "Y axis"));
  const reset = h("button", { type: "button", class: "btn small", id: "stack-reset", title: "Explode and Section back to 0" }, "Reset");
  const el = h(
    "div",
    { class: "stack-controls", id: "stack-controls", role: "group", "aria-label": "Explode and section of the stacked result", hidden: true },
    h("label", { class: "sc-row" }, h("span", { class: "sc-lbl" }, "Explode", infoIcon("stackView")), ex.input, ex.val),
    h("label", { class: "sc-row" }, h("span", { class: "sc-lbl" }, "Section"), se.input, se.val),
    h("div", { class: "sc-row sc-last" }, h("span", { class: "sc-lbl" }, "Plane ⟂"), axis, reset),
  );
  const emit = () => {
    ex.val.textContent = `${ex.input.value} %`;
    se.val.textContent = `${se.input.value} %`;
    ex.input.setAttribute("aria-valuetext", ex.val.textContent);
    se.input.setAttribute("aria-valuetext", se.val.textContent);
    onChange(Number(ex.input.value) / 100, Number(se.input.value) / 100, axis.value as SectionAxis);
  };
  for (const e of [ex.input, se.input]) e.addEventListener("input", emit);
  axis.addEventListener("change", emit);
  const doReset = () => {
    ex.input.value = se.input.value = "0";
    emit();
  };
  reset.addEventListener("click", doReset);
  return { el, setVisible: (v) => (el.hidden = !v), reset: doReset };
}
