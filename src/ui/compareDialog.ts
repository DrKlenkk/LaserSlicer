// "Compare materials" dialog: a table with one row per material preset (and the current settings), filled while the worker
// runs them one after another. Styled like the help overlay. The comparison never touches the main preview.
import { bestRows, type CompareEntry, type CompareRow } from "../core/compare";
import { fmtCost, fmtLength, fmtWeight, formatDuration } from "../core/estimates";
import { h } from "./dom";

export type CompareDeps = {
  /** the runs for the current settings and all presets (called when the dialog opens) */
  entries(): CompareEntry[];
  /** starts the worker comparison */
  start(entries: CompareEntry[], onRow: (i: number, row: CompareRow) => void, onProgress: (fraction: number, stage: string) => void): { done: Promise<{ cancelled: boolean }>; cancel(): void };
  /** applies the preset of that row (one undo step) */
  apply(name: string): void;
};

const num = (v: number) => String(+v.toFixed(2));

export function createCompareDialog(deps: CompareDeps) {
  let entries: CompareEntry[] = [];
  let rows: (CompareRow | undefined)[] = [];
  let job: ReturnType<CompareDeps["start"]> | null = null;
  let runId = 0;
  let activeIndex = -1;
  let stage = "";
  let fraction = 0;
  let finished: "done" | "cancelled" | "failed" | null = null;
  let failure = "";
  let startedAt = 0;
  let seconds = 0;

  const thead = h("thead");
  const tbody = h("tbody");
  const table = h("table", { class: "compare-table", id: "compare-table" }, thead, tbody);
  const bar = h("div", { class: "progress compare-bar", id: "compare-progress" }, h("div", { class: "progress-fill", id: "compare-progress-fill" }));
  const statusLine = h("p", { class: "compare-status", id: "compare-status", role: "status" });
  const cancelBtn = h("button", { type: "button", class: "btn small", id: "compare-cancel", onclick: () => cancel() }, "Cancel");
  const againBtn = h("button", { type: "button", class: "btn small", id: "compare-again", onclick: () => start() }, "Compare again");
  const closeBtn = h("button", { type: "button", class: "btn small help-close", id: "compare-close", onclick: () => close() }, "Close");
  const box = h(
    "div",
    { class: "help-box compare-box", role: "dialog", "aria-modal": "true", "aria-label": "Compare materials" },
    closeBtn,
    h("h2", {}, "Compare materials"),
    h("p", { class: "hint" }, "The model is run once with your current settings and once with each material preset (thickness, sheet size, kerf, spacing, margin, density, speeds and price from the preset; everything else, including the outline mode, from your current settings). A layer range is ignored. The preview is not changed."),
    h("div", { class: "compare-run" }, bar, cancelBtn, againBtn),
    statusLine,
    h("div", { class: "compare-scroll" }, table),
    h("p", { class: "hint" }, "Time and cost appear when speeds and a price are set (in the Material group or by the preset). Best values are marked; \"Use\" applies that preset, one undo step."),
  );
  const overlay = h("div", { class: "help-overlay", id: "compare", hidden: true }, box);
  overlay.addEventListener("pointerdown", (e) => {
    if (e.target === overlay) close();
  });

  function cell(text: string, cls = "", title = "") {
    return h("td", { class: cls || undefined, title: title || undefined }, text);
  }

  function render() {
    const done = rows.filter((r): r is CompareRow => !!r && !r.error);
    const showTime = done.some((r) => r.time !== null), showWeight = done.some((r) => r.weight !== null), showCost = done.some((r) => r.cost !== null);
    const best = bestRows(rows);
    const head = ["Material", "Thickness", "Layers", "Parts", "Sheets", "Sheet use", "Cut length"];
    if (showTime) head.push("Time (rough)");
    if (showWeight) head.push("Weight");
    if (showCost) head.push("Cost");
    head.push("Warnings", "");
    thead.replaceChildren(h("tr", {}, ...head.map((t) => h("th", { scope: "col" }, t))));
    tbody.replaceChildren(
      ...entries.map((en, i) => {
        const r = rows[i];
        const tr = h("tr", { class: en.current ? "current" : undefined, "data-row": String(i) });
        const name = h("td", { class: "name" }, h("span", {}, en.name), h("small", {}, ` ${num(en.settings.sheetW)} × ${num(en.settings.sheetH)} mm sheet`));
        tr.append(name);
        if (!r) {
          const span = head.length - 1;
          tr.append(h("td", { class: "pending", colspan: String(span) }, i === activeIndex && finished === null ? `running… ${stage}` : finished === "cancelled" || finished === "failed" ? "not run" : "waiting"));
          return tr;
        }
        if (r.error) {
          tr.append(h("td", { class: "bad", colspan: String(head.length - 1) }, `Failed: ${r.error}`));
          return tr;
        }
        tr.append(
          cell(`${num(r.thickness)} mm`),
          cell(String(r.layers), "", `ceil(model height / ${num(r.thickness)} mm)`),
          cell(String(r.parts)),
          cell(String(r.sheets), best.sheets.has(i) ? "best" : ""),
          cell(`${r.usePct.toFixed(0)} %`),
          cell(fmtLength(r.cutLength)),
        );
        if (showTime) tr.append(cell(r.time === null ? "–" : `≈ ${formatDuration(r.time)}`, best.time.has(i) ? "best" : ""));
        if (showWeight) tr.append(cell(r.weight === null ? "–" : fmtWeight(r.weight)));
        if (showCost) tr.append(cell(r.cost === null ? "–" : fmtCost(r.cost), best.cost.has(i) ? "best" : ""));
        tr.append(cell(r.warnings ? String(r.warnings) : "0", r.errors ? "bad" : r.warnings ? "warnc" : "", r.errors ? `${r.errors} error${r.errors > 1 ? "s" : ""}: e.g. no parts produced` : ""));
        tr.append(
          h("td", {}, en.current ? h("span", { class: "hint" }, "now") : h("button", { type: "button", class: "btn small", "data-apply": en.name, title: `Apply "${en.name}" to the settings`, onclick: () => applyRow(en.name) }, "Use")),
        );
        return tr;
      }),
    );
    const running = finished === null;
    bar.hidden = !running;
    (bar.firstElementChild as HTMLElement).style.width = `${Math.round(fraction * 100)}%`;
    cancelBtn.hidden = !running;
    againBtn.hidden = running;
    const n = rows.filter(Boolean).length;
    statusLine.textContent = running
      ? `Row ${Math.min(activeIndex + 1, entries.length)} of ${entries.length}: ${entries[Math.max(0, activeIndex)]?.name ?? ""} · ${stage} ${Math.round(fraction * 100)} %`
      : finished === "done" ? `All ${entries.length} runs finished in ${seconds.toFixed(1)} s.`
      : finished === "cancelled" ? `Cancelled: ${n} of ${entries.length} runs finished (the rows shown are complete).`
      : `The comparison failed: ${failure}`;
    statusLine.className = `compare-status${finished === "failed" ? " bad" : ""}`;
  }

  function start() {
    job?.cancel();
    const id = ++runId;
    entries = deps.entries();
    rows = entries.map(() => undefined);
    activeIndex = 0;
    stage = "Starting";
    fraction = 0;
    finished = null;
    failure = "";
    startedAt = performance.now();
    render();
    const j = deps.start(
      entries,
      (i, row) => {
        if (id !== runId) return;
        rows[i] = row;
        activeIndex = i + 1;
        render();
      },
      (f, s) => {
        if (id !== runId) return;
        fraction = f;
        stage = s;
        render();
      },
    );
    job = j;
    j.done.then(
      (r) => {
        if (id !== runId) return;
        seconds = (performance.now() - startedAt) / 1000;
        finished = r.cancelled ? "cancelled" : "done";
        render();
      },
      (e: unknown) => {
        if (id !== runId) return;
        finished = "failed";
        failure = e instanceof Error ? e.message : String(e);
        render();
      },
    );
  }

  function cancel() {
    if (finished !== null) return;
    job?.cancel();
  }

  function close() {
    if (overlay.hidden) return;
    cancel();
    runId++; // late messages of this run are ignored
    overlay.hidden = true;
  }

  function applyRow(name: string) {
    close();
    deps.apply(name);
  }

  return {
    el: overlay,
    show() {
      overlay.hidden = false;
      start();
      closeBtn.focus();
    },
    close,
    get open() {
      return !overlay.hidden;
    },
  };
}
