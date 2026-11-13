// Staged slicing pipeline with per-stage caching. Pure (no DOM): runs in the worker and in Node tests.
//
//   orient -> slice (planes + rings -> shapes) -> modes -> cleanup/islands -> registration -> kerf -> nesting
//                                                                                         \-> bridges (after kerf; nesting does not depend on it)
//
// Each stage result is cached under a key built from only the settings that affect it, so e.g.
// changing minPartArea re-runs cleanup only, and changing the mode never re-orients the mesh.
import type { Layer, Mesh, MeshStats, Part, Placement, Settings, Shape, Sheet, Warning } from "./types";
import { computeBBox, bboxSize } from "./mesh";
import { orientMesh } from "./transform";
import { combineSamples, cleanupLayer, partIds, planLayers, roundHeightFactor, type LayerPlan } from "./layers";
import { nudgeHeight, prepareMesh, slicePlanes, type PreparedMesh } from "./slice";
import { unionEvenOdd } from "./poly";
import { hollowLayers } from "./hollow";
import { addRegistration } from "./registration";
import { applyKerf } from "./kerf";
import { addBridges } from "./bridges";
import { nestParts, type NestResult } from "./nest";

export type RunInfo = {
  layerCount: number;
  thickness: number;
  /** model height after orientation and scaling (mm) */
  height: number;
  /** stack height minus model height (mm) */
  overshoot: number;
  /** effective uniform scale (user scale or target size, times height rounding) */
  scale: number;
  size: [number, number, number];
};

export type RunResult = {
  layers: Layer[];
  parts: Part[];
  placements: Placement[];
  sheets: Sheet[];
  warnings: Warning[];
  info: RunInfo;
};

export type Hooks = {
  /** `fraction` is the overall progress 0..1; `stage` names the current stage. */
  progress?(stage: string, fraction: number): void;
  /** polled at checkpoints; return true to abandon the run (stale job). */
  shouldAbort?(): boolean;
  /** give the event loop a turn (so the worker can receive newer jobs). */
  yieldNow?(): Promise<void>;
};

type Oriented = { mesh: Mesh; prep: PreparedMesh; scale: number; size: [number, number, number] };
type SliceStage = { plan: LayerPlan; planes: Shape[][][]; warnings: Warning[] };
type Cached<T> = { key: string; value: T };

const STAGE_WEIGHT = { orient: 0.05, slice: 0.6, modes: 0.1, cleanup: 0.25 };

export class Pipeline {
  private mesh: Mesh | null = null;
  private stats: MeshStats | null = null;
  private meshVersion = 0;
  private cOrient: Cached<Oriented> | null = null;
  private cSlice: Cached<SliceStage> | null = null;
  private cModes: Cached<Shape[][]> | null = null;
  private cClean: Cached<{ layers: Layer[]; parts: Part[]; warnings: Warning[] }> | null = null;
  private cHollow: Cached<{ layers: Layer[]; parts: Part[]; warnings: Warning[] }> | null = null;
  private cReg: Cached<{ parts: Part[]; warnings: Warning[] }> | null = null;
  private cKerf: Cached<{ parts: Part[]; warnings: Warning[] }> | null = null;
  private cNest: Cached<NestResult> | null = null;
  private cBridges: Cached<{ parts: Part[]; warnings: Warning[] }> | null = null;
  /** counters for tests: how many times each stage actually ran */
  readonly runs = { orient: 0, slice: 0, modes: 0, cleanup: 0, hollow: 0, registration: 0, kerf: 0, nest: 0, bridges: 0 };
  /** the most recent completed run and the settings it used (for export) */
  last: { result: RunResult; settings: Settings } | null = null;

  setMesh(mesh: Mesh | null, stats: MeshStats | null = null) {
    this.last = null;
    this.mesh = mesh;
    this.stats = stats;
    this.meshVersion++;
  }

  /** Returns null when the run was abandoned through `hooks.shouldAbort`. */
  async run(s: Settings, hooks: Hooks = {}): Promise<RunResult | null> {
    if (!this.mesh) throw new Error("No model loaded");
    let lastYield = now();
    const checkpoint = async (): Promise<boolean> => {
      if (hooks.yieldNow && now() - lastYield > 25) {
        await hooks.yieldNow();
        lastYield = now();
      }
      return hooks.shouldAbort?.() ?? false;
    };
    let base = 0;
    const report = (stage: string, weight: number, f: number) => hooks.progress?.(stage, Math.min(1, base + weight * f));
    const done = (weight: number) => (base += weight);

    // ---- stage 1: orient ----
    report("Orienting", STAGE_WEIGHT.orient, 0);
    const orientKey = JSON.stringify([
      this.meshVersion, s.axis, s.rotationSteps, s.scale, s.targetSize, s.roundHeightToLayers ? s.thickness : null,
    ]);
    if (this.cOrient?.key !== orientKey) {
      this.cOrient = { key: orientKey, value: this.orient(s) };
      this.runs.orient++;
    }
    const oriented = this.cOrient.value;
    done(STAGE_WEIGHT.orient);
    if (await checkpoint()) return null;

    // ---- stage 2: slice every sample plane, rings -> shapes ----
    const planKey = JSON.stringify([orientKey, s.thickness, s.mode, s.samplesPerLayer]);
    if (this.cSlice?.key !== planKey) {
      const value = await this.sliceStage(oriented, s, checkpoint, (f) => report("Slicing", STAGE_WEIGHT.slice, f));
      if (!value) return null;
      this.cSlice = { key: planKey, value };
      this.runs.slice++;
    }
    const sliced = this.cSlice.value;
    base = STAGE_WEIGHT.orient + STAGE_WEIGHT.slice;
    if (await checkpoint()) return null;

    // ---- stage 3: outline mode per layer ----
    if (this.cModes?.key !== planKey) {
      const raw: Shape[][] = [];
      for (let i = 0; i < sliced.plan.count; i++) {
        raw.push(combineSamples(s.mode, sliced.planes[i]));
        report("Outline modes", STAGE_WEIGHT.modes, (i + 1) / sliced.plan.count);
        if (i % 8 === 7 && (await checkpoint())) return null;
      }
      this.cModes = { key: planKey, value: raw };
      this.runs.modes++;
    }
    const raw = this.cModes.value;
    done(STAGE_WEIGHT.modes);

    // ---- stage 4: cleanup, islands -> parts ----
    const cleanKey = JSON.stringify([planKey, s.smoothRadius, s.simplifyTol, s.minPartArea, s.minFeature]);
    if (this.cClean?.key !== cleanKey) {
      const warnings: Warning[] = [];
      const layers: Layer[] = [];
      const parts: Part[] = [];
      for (let i = 0; i < sliced.plan.count; i++) {
        const spec = sliced.plan.specs[i];
        const shapes = cleanupLayer(i, raw[i], s, warnings);
        if (shapes.length === 0) {
          warnings.push({ level: "info", layer: i, message: `Layer ${i} is empty` });
        }
        layers.push({ index: i, z0: spec.z0, z1: spec.z1, shapes });
        const ids = partIds(i, shapes.length);
        shapes.forEach((cut, j) => parts.push({ id: ids[j], layer: i, cut, engrave: [], label: [], holes: [] }));
        report("Cleanup", STAGE_WEIGHT.cleanup, (i + 1) / sliced.plan.count);
        if (i % 4 === 3 && (await checkpoint())) return null;
      }
      this.cClean = { key: cleanKey, value: { layers, parts, warnings } };
      this.runs.cleanup++;
    }
    const clean = this.cClean.value;
    if (await checkpoint()) return null;

    // ---- stage 4b: hollowing (re-detects islands); a no-op that costs nothing when it is switched off ----
    const hollowKey = JSON.stringify([cleanKey, s.hollowEnabled, s.hollowEnabled ? [s.hollowWall, s.solidCapLayers, s.minPartArea] : null]);
    if (this.cHollow?.key !== hollowKey) {
      this.cHollow = { key: hollowKey, value: hollowLayers(clean.layers, clean.parts, s) };
      this.runs.hollow++;
    }
    const hollow = this.cHollow.value;
    if (await checkpoint()) return null;

    // ---- stage 5: registration aids (next-layer engraving, labels, dowel holes); before kerf, so a kerf change keeps it ----
    const regKey = JSON.stringify([hollowKey, s.hollowEnabled, s.engraveNextOutline, s.labels, s.labelHeight, s.dowels, s.dowels ? [s.dowelDiameter, s.dowelCount] : null]);
    if (this.cReg?.key !== regKey) {
      this.cReg = { key: regKey, value: addRegistration(hollow.layers, hollow.parts, s) };
      this.runs.registration++;
    }
    const registered = this.cReg.value;
    if (await checkpoint()) return null;

    // ---- stage 6: kerf compensation (own stage: changing the kerf never re-slices) ----
    const kerfKey = JSON.stringify([regKey, s.kerf]);
    if (this.cKerf?.key !== kerfKey) {
      this.cKerf = { key: kerfKey, value: applyKerf(registered.parts, s.kerf) };
      this.runs.kerf++;
    }
    const kerfed = this.cKerf.value;

    // ---- stage 7: nesting ----
    const nestKey = JSON.stringify([kerfKey, s.sheetW, s.sheetH, s.partSpacing, s.sheetMargin]);
    if (this.cNest?.key !== nestKey) {
      this.cNest = { key: nestKey, value: nestParts(kerfed.parts, s) };
      this.runs.nest++;
    }
    const nested = this.cNest.value;

    // ---- stage 8: holding bridges (cut geometry is final after kerf; part extents do not change, so nesting is independent) ----
    let bridged: { parts: Part[]; warnings: Warning[] };
    if (!s.bridgesEnabled) bridged = { parts: kerfed.parts, warnings: [] }; // nothing to compute or cache
    else {
      const bridgeKey = JSON.stringify([kerfKey, s.bridgeCount, s.bridgeWidth, s.bridgeMinLength, s.bridgeHoles, s.bridgeMaxSpacing]);
      if (this.cBridges?.key !== bridgeKey) {
        this.cBridges = { key: bridgeKey, value: addBridges(kerfed.parts, s) };
        this.runs.bridges++;
      }
      bridged = this.cBridges.value;
    }
    hooks.progress?.("Done", 1);

    const warnings: Warning[] = [...this.meshWarnings(), ...sliced.warnings, ...clean.warnings, ...hollow.warnings, ...registered.warnings, ...kerfed.warnings, ...nested.warnings, ...bridged.warnings];
    if (kerfed.parts.length === 0)
      warnings.push({ level: "error", message: "No parts were produced: every layer is empty (the model may be too thin for this thickness, or Min part area is too large)" });
    const result: RunResult = {
      layers: hollow.layers,
      parts: bridged.parts,
      placements: nested.placements,
      sheets: nested.sheets,
      warnings,
      info: {
        layerCount: sliced.plan.count,
        thickness: sliced.plan.thickness,
        height: sliced.plan.height,
        overshoot: sliced.plan.overshoot,
        scale: oriented.scale,
        size: oriented.size,
      },
    };
    this.last = { result, settings: s };
    return result;
  }

  private meshWarnings(): Warning[] {
    const st = this.stats;
    const w: Warning[] = [];
    if (!st) return w;
    if (st.openEdges) w.push({ level: "warn", message: `Mesh has ${st.openEdges} open edges (not watertight); outlines are repaired per layer` });
    if (st.nonManifoldEdges) w.push({ level: "warn", message: `Mesh has ${st.nonManifoldEdges} non-manifold edges` });
    if (st.degenerateRemoved) w.push({ level: "info", message: `${st.degenerateRemoved} degenerate triangles removed` });
    return w;
  }

  private orient(s: Settings): Oriented {
    const o = orientMesh(this.mesh!, s);
    let { mesh, scale, size } = o;
    if (s.roundHeightToLayers) {
      // Scale uniformly so the height is a whole number of layers (plan section 3).
      const f = roundHeightFactor(size[2], s.thickness);
      if (Math.abs(f - 1) > 1e-12) {
        const p = mesh.positions; // a fresh array owned by orientMesh
        for (let i = 0; i < p.length; i++) p[i] *= f;
        const bbox = computeBBox(p);
        mesh = { ...mesh, bbox };
        size = bboxSize(bbox);
        scale *= f;
      }
    }
    return { mesh, prep: prepareMesh(mesh), scale, size };
  }

  private async sliceStage(
    o: Oriented,
    s: Settings,
    checkpoint: () => Promise<boolean>,
    progress: (f: number) => void,
  ): Promise<SliceStage | null> {
    const plan = planLayers(o.size[2], s);
    const warnings: Warning[] = [];
    const planes: Shape[][][] = [];
    const CHUNK = 4; // layers per sweep call (each call restarts the active list: cheap)
    for (let l0 = 0; l0 < plan.count; l0 += CHUNK) {
      const l1 = Math.min(plan.count, l0 + CHUNK);
      const heights: number[] = [];
      let prev = -Infinity;
      for (let l = l0; l < l1; l++)
        for (const z of plan.specs[l].samples) {
          const h = Math.max(nudgeHeight(o.prep, z), prev);
          heights.push(h);
          prev = h;
        }
      const res = slicePlanes(o.prep, heights);
      let k = 0;
      for (let l = l0; l < l1; l++) {
        let forced = 0, joined = 0;
        const perSample: Shape[][] = [];
        for (let j = 0; j < plan.specs[l].samples.length; j++, k++) {
          forced = Math.max(forced, res[k].forcedClosed); // the samples hit the same gaps
          joined += res[k].gapJoined;
          perSample.push(unionEvenOdd(res[k].rings));
        }
        planes.push(perSample);
        if (forced > 0)
          warnings.push({ level: "warn", layer: l, message: `Open mesh repaired in layer ${l}: ${forced} gap${forced > 1 ? "s" : ""} closed with a straight line` });
        else if (joined > 0)
          warnings.push({ level: "info", layer: l, message: `Small gaps in the mesh joined in layer ${l}` });
      }
      progress(l1 / plan.count);
      if (await checkpoint()) return null;
    }
    return { plan, planes, warnings };
  }
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
