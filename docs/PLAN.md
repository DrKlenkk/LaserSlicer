# Laser Slicer – Implementation Plan

Nov 12, 2026 · @\*

## Goal and scope

Build a standalone, offline browser app — one `index.html`, opened by double-click — that slices a 3D model into flat layers along a chosen axis and exports laser-ready files for stacked, glued plywood.

**In scope (v1)**

- Import STL (binary + ASCII), OBJ, 3MF.
- Scale to real size in mm; choose slicing axis (±X, ±Y, ±Z, plus 90° rotation buttons).
- Parallel slicing at a measured material thickness; three outline modes: mid-plane, oversize (sand down), undersize.
- Cleanup, island handling, optional hollowing of inner layers.
- Kerf compensation.
- Gluing aids: engraved outline of the next layer, engraved layer labels, optional dowel holes.
- Nesting of parts onto sheets of a given size.
- Export: DXF (primary), SVG, PNG and JPG at a set DPI, all bundled as ZIP.
- 3D preview of the stacked result.

**Non-goals**

- No interlocking/waffle slicing, radial or curved slicing.
- No server, no backend, no network access, no accounts, no CDN.
- No direct laser control (G-code, LightBurn device control).
- No mesh editing beyond automatic repair.

**Hard constraints**

- Must run from `file://` in current Chrome, Edge and Firefox with no internet connection.
- All heavy computation in a Web Worker so the UI never freezes.
- Only permissively licensed dependencies (MIT, ISC, BSD, Apache-2.0), all bundled into the single file.

## Tech stack and build

Vanilla TypeScript, bundled by Vite into one self-contained HTML file. No UI framework: the interface is one panel of inputs and three views, which plain DOM code handles well.

| Concern | Choice | Notes |
| --- | --- | --- |
| Language / build | TypeScript, Vite, `vite-plugin-singlefile` | Inlines all JS, CSS and the worker into `dist/index.html` |
| Web Worker | Vite `?worker&inline` import | Inline worker = no separate file, works from `file://` |
| 3D view + loaders | three.js (`STLLoader`, `OBJLoader`, `3MFLoader`, `OrbitControls`) | Loaders parse only; slicing uses our own typed arrays |
| Polygon maths | `clipper2-js` (pure TS port of Clipper2) | Union, intersection, difference, offset, simplify, PolyTree. Pure JS avoids inlining WASM |
| Label placement | `polylabel` (Mapbox, ISC) | Finds the most interior point of a polygon |
| Single-stroke font | Hershey Simplex glyph data, embedded as a TS module | Public domain; gives engrave-friendly line text in DXF |
| ZIP | `fflate` | Already required by `3MFLoader` |
| DXF / SVG / PNG writers | Hand-written (small) | Full control over layers, units and DPI metadata |
| Tests | Vitest (+ `dxf-parser` as dev dependency for round-trip tests) | Core runs headless in Node |

**Build rules**

- `npm run dev` for development, `npm run build` produces exactly one file: `dist/index.html`.
- No `fetch()` of local assets, no external fonts, no CDN links — `file://` blocks or breaks them.
- Use system UI fonts only.
- Target size of `dist/index.html`: under 2 MB.
- Clipper works in integers: convert mm to integer units with a fixed scale of 1000 (1 unit = 1 µm) in one wrapper module, nowhere else.

## Architecture

The code splits into a pure `core/` (no DOM, runs in the worker and in Node tests) and a thin `ui/` on the main thread. The UI sends settings to the worker; the worker runs the whole pipeline and returns plain data.

&#91;embedded content: slicing pipeline · 12 stages in the worker\]

Each stage is a pure function whose result is cached, so changing only the kerf re-runs stages 10–12 and never re-slices the mesh.

**File layout**

```
laser-slicer/
  index.html
  vite.config.ts
  package.json
  src/
    main.ts                 bootstrap, wires store ↔ worker ↔ UI
    state.ts                Settings + results, small observable store, localStorage persistence
    ui/
      panel.ts              parameter inputs, grouped
      viewport3d.ts         three.js scene: model + stacked layer preview
      layerView2d.ts        canvas view of one layer (slider)
      sheetView.ts          canvas view of nested sheets
      warnings.ts           warnings list
      exportDialog.ts
    core/                   pure functions, no DOM
      types.ts
      mesh.ts               loader output → indexed mesh, vertex welding, bbox
      transform.ts          axis rotation, scaling
      slice.ts              plane intersection + loop stitching
      poly.ts               ONLY place that calls Clipper (mm ↔ µm conversion)
      layers.ts             outline modes, cleanup, islands → parts
      hollow.ts
      kerf.ts
      registration.ts       next-layer engraving, dowels, labels
      font/hershey.ts       glyph data + text → polylines
      nest.ts
      pipeline.ts           runs all stages in order, reports progress
      export/
        dxf.ts  svg.ts  raster.ts  zip.ts
    worker/
      slicer.worker.ts      message handling, calls pipeline
  test/
    fixtures/               generated meshes (cube, sphere, torus, two spheres, broken mesh)
    *.test.ts
```

**Core types** (all lengths in mm, 2D coordinates in the sheet plane)

```ts
type Vec2 = [number, number];
type Ring = Vec2[];                         // closed, last point != first point
type Shape = { outer: Ring; holes: Ring[] }; // outer CCW, holes CW

type Mesh = { positions: Float32Array; indices: Uint32Array; bbox: Box3 };

type Layer = {
  index: number;          // 0 = bottom
  z0: number; z1: number; // bottom and top face heights
  shapes: Shape[];        // after mode, cleanup, hollowing (before kerf)
};

type Part = {
  id: string;             // "L012" or "L012-b" for a second island
  layer: number;
  cut: Shape;             // kerf-compensated cut outline
  engrave: Vec2[][];      // open or closed polylines: next-layer outline, label strokes
  holes: { c: Vec2; d: number }[]; // dowel holes (cut)
};

type Placement = { partId: string; sheet: number; x: number; y: number; angleDeg: number };

type Warning = { level: "info" | "warn" | "error"; layer?: number; partId?: string; message: string };
```

**Settings** (one flat object, defaults in brackets)

- Model: `axis` \[+Z\], `rotationSteps` \[0,0,0\], `scale` \[1\], `targetSize` (optional, one dimension, keeps proportions).
- Material: `thickness` \[4.0\], `sheetW` × `sheetH` \[600 × 400\], `kerf` \[0.15\], `partSpacing` \[3\], `sheetMargin` \[5\].
- Slicing: `mode` \[oversize\], `samplesPerLayer` \[3\], `roundHeightToLayers` \[off\], `simplifyTol` \[0.05\], `minPartArea` \[4 mm²\], `minFeature` \[0 = off\].
- Hollowing: `enabled` \[off\], `wall` \[15\], `solidCapLayers` \[1\].
- Registration: `engraveNextOutline` \[on\], `labels` \[on\], `labelHeight` \[6\], `dowels` \[off\], `dowelDiameter` \[6\], `dowelCount` \[2\].
- Export: `formats` \[dxf\], `dpi` \[300\], `rasterStyle` \[filled\], `perLayerFiles` \[off\].

**Worker protocol**

- main → worker: `{ type: "load", jobId, buffer, ext }` → reply `{ type: "loaded", jobId, stats: { triangles, bbox, openEdges } }` plus a transferable copy of the mesh for the 3D view.
- main → worker: `{ type: "run", jobId, settings }` → replies `{ type: "progress", jobId, stage, fraction }` then `{ type: "result", jobId, layers, parts, placements, sheets, warnings }`.
- main → worker: `{ type: "export", jobId, formats, dpi }` → reply `{ type: "file", name, mime, bytes }` (transferred, not copied).
- Every settings change starts a new `jobId`, debounced 300 ms; the worker drops results for stale jobs. Raster export can run in the worker via `OffscreenCanvas`.
- Cache stage results by the settings that affect them, so changing kerf does not re-slice the mesh.

## Algorithms

The pipeline runs these stages in order; each is a pure function in `core/` with its own unit tests.

### 1. Load and prepare the mesh

1. Parse with the three.js loader matching the file extension. For 3MF and OBJ with several objects, apply each object's transform and merge into one mesh.
2. Convert to an indexed mesh: weld vertices closer than 1e-5 × bbox diagonal (spatial hash). Welding is required for exact loop stitching in step 4.
3. Count open edges (edges used by one triangle) and non-manifold edges (used by more than two). Report them as warnings, do not fail.
4. STL has no units. Assume mm, show the bounding box size, and let the user set scale or a target size for one dimension.

### 2. Orient along the chosen axis

Build one rotation matrix that maps the chosen axis to +Z, then apply the extra 90° rotation steps. Apply it to a copy of the positions; from here on, slicing is always horizontal. Translate so the model's minimum Z is 0.

### 3. Layer heights

- Height `H` = bbox Z extent; layer count `N = ceil(H / t)` with `t` = measured thickness.
- Layer `i` spans `z0 = i·t` to `z1 = (i+1)·t`. The top layer may stick out above the model; show the overshoot in the UI.
- Option `roundHeightToLayers`: scale the model uniformly so `H = round(H / t)·t` exactly, and show the resulting scale factor.
- If a sample plane lies within 1e-6 mm of any vertex Z, shift it by 1e-4 mm. This removes the degenerate "plane through vertex" and "coplanar face" cases.

### 4. Cut one plane (core routine)

Input: mesh and plane height `z`. Output: closed rings.

1. **Find triangles crossing z.** Sort triangle indices once by their min Z. Sweep planes upward with an active list (add triangles whose min Z ≤ z, drop those whose max Z < z). This keeps the whole slice at about O(T log T + total intersections).
2. **Intersect.** A crossing triangle has exactly two edges that cross the plane. For each such edge (a, b), compute the point by linear interpolation, and key it by the edge itself: `key = min(a,b) * V + max(a,b)`. Edge keys make stitching exact; never stitch by comparing float coordinates.
3. **Orient the segment** using the triangle winding, so that the solid lies on the left side. Each triangle yields one directed segment `fromKey → toKey`.
4. **Stitch.** Build a map `fromKey → segment`, then walk segments until returning to the start key. Each walk = one closed ring.
5. **Broken meshes.** Walks that end without closing are open chains. Join chain ends whose endpoints are closer than `gapTol` (default 0.5 mm), nearest first. Close any still-open chain with a straight line and add a warning naming the layer.
6. Drop rings with fewer than 3 points or near-zero area.

### 5. Rings to shapes

Run a Clipper union with the **EvenOdd** fill rule over all rings of the plane and read the result as a PolyTree. That yields outer outlines with their holes and survives inverted normals or wrong winding in the source mesh. Normalise: outer CCW, holes CW.

### 6. Outline modes (one outline per layer)

Take `k = samplesPerLayer` planes inside the layer, evenly spaced from `z0 + ε` to `z1 − ε` (k = 3: bottom, middle, top).

- **Mid-plane**: one plane at `(z0 + z1) / 2`. Closest to the true shape on average.
- **Oversize** (default): union of all k samples. The part covers the model everywhere inside its layer, so the glued block can be sanded down to the exact shape. More samples catch bulges inside the layer (a sphere's equator).
- **Undersize**: intersection of all k samples. The part never sticks out of the model; gaps get filled.

### 7. Cleanup and islands

1. Simplify every ring with Clipper `SimplifyPaths` (`simplifyTol`, default 0.05 mm).
2. Optional `minFeature` (e.g. 1 mm): morphological opening (offset by −r, then +r, r = minFeature/2) removes slivers and necks the laser or the wood cannot hold.
3. Remove shapes with area < `minPartArea` and holes with area < `minPartArea`. Warn for each removal.
4. Each remaining shape in a layer becomes one part. Several shapes in a layer = islands, labelled `L012-a`, `L012-b`, and so on, ordered by area.

### 8. Hollowing (optional)

For each layer not within `solidCapLayers` of the bottom or top:

1. `support = intersect(layer[i-1], layer[i], layer[i+1])`, so the hole stays inside the material of both neighbours and every glue joint keeps a full-width wall.
2. `hole = offset(support, −wall)`, then drop pieces smaller than `minPartArea`.
3. `layer[i] = difference(layer[i], hole)`.
4. Re-run island detection (hollowing can split a part).

### 9. Registration aids

- **Next-layer outline (engrave)**: for part `p` in layer `i`, engrave `intersect(layer[i+1] outlines, p)` as lines. When gluing, part `i+1` goes exactly on the engraved line. Parts are cut face-up and stacked bottom-up without flipping, so no mirroring is needed. Document this in the UI.
- **Layer labels (engrave)**: text such as `L12` or `L12-b` in the Hershey single-stroke font. Place it at the pole of inaccessibility (`polylabel`) of the region covered by the next layer, so the label ends up hidden under the glue joint. Shrink the text to fit (minimum 3 mm); if it still does not fit, put it anywhere inside the part and add an info warning.
- **Dowel holes (cut, optional)**: group consecutive layers into runs where the intersection of all their shapes, shrunk by `dowelDiameter/2 + 3 mm`, is not empty. In each run's core, choose `dowelCount` points as far apart as possible (first the core point farthest from the core centroid, then repeatedly the point farthest from the points chosen so far, sampled on a 1 mm grid). Cut circles (64 segments) at those points in every layer of the run. With hollowing on, compute the core after hollowing. Warn when a run is shorter than 2 layers.

### 10. Kerf compensation

Offset each cut shape by `+kerf/2` with Clipper (join type Miter, miter limit 2). One offset of the whole shape grows the outer outline and shrinks the holes, as required. Dowel holes are holes, so their radius shrinks by kerf/2. Never offset engrave lines.

### 11. Nesting onto sheets

- **v1 (required)**: rotate each part to its minimum-area bounding rectangle (rotating calipers on the convex hull). Pack the rectangles with MaxRects (best-short-side-fit), allowing 0° and 90°, with `partSpacing` between parts and `sheetMargin` at the edges. Open a new sheet when one is full. Sort parts by layer index before packing, so related parts land near each other.
- A part larger than the usable sheet area is an **error** warning; list it and leave it out of the sheets (no automatic splitting in v1).
- **v2 (optional, later)**: true-shape nesting on a raster (bottom-left fill on a 1 mm occupancy grid, trying 4–8 rotations per part). Only if v1 wastes too much material on real models.
- Report the number of sheets and the material use in % per sheet.

## Export formats

DXF is the primary format for cutting; SVG is a second vector option; PNG and JPG are for engraving workflows and reference. Every export is available per sheet (default) or per layer, and "Download all" bundles everything as one ZIP.

### DXF (primary)

- ASCII DXF R12 (`$ACADVER = AC1009`), the version every laser program imports reliably. Write `$INSUNITS = 4` (mm) and `$MEASUREMENT = 1` in the header as well.
- Coordinates in mm, Y axis up (DXF convention). The sheet's lower-left corner is (0, 0).
- Closed outlines: `POLYLINE` with flag 70 = 1, then `VERTEX` entities, then `SEQEND`. Open engrave lines: the same with flag 70 = 0. Dowel holes: `CIRCLE`.
- Layers in the `TABLES` section, named for easy mapping in LightBurn and similar:

| DXF layer | ACI color | Content |
| --- | --- | --- |
| `CUT` | 1 (red) | Kerf-compensated outlines and dowel holes |
| `ENGRAVE` | 5 (blue) | Next-layer outlines |
| `LABEL` | 3 (green) | Label text strokes |
| `SHEET` | 8 (grey) | Sheet border, off by default |

- File names: `<model>_sheet01.dxf`, or `<model>_L012.dxf` per layer.
- Text is never a DXF `TEXT` entity; labels are always polylines, so no font is needed on the laser side.

### SVG

- Root: `width="600mm" height="400mm" viewBox="0 0 600 400"` so 1 user unit = 1 mm.
- Y axis down: flip the DXF Y coordinate (`y_svg = sheetH − y`). Add a test that SVG and DXF outlines match after the flip.
- One `<g id="CUT">`, `<g id="ENGRAVE">`, `<g id="LABEL">` with `stroke` red, blue and green, `fill="none"`, `stroke-width="0.1"`.
- Cut shapes as `<path>` with `fill-rule="evenodd"`, so holes stay holes.

### PNG and JPG

- Render on `OffscreenCanvas` at the chosen DPI: pixels = mm / 25.4 × DPI. Presets 254, 300, 600, 1000 DPI.
- Styles: **filled** (parts black on white, holes white; engrave lines drawn in grey, optional) or **outline** (1-pixel black lines).
- Write the DPI into the file so laser software imports it at true size: insert a PNG `pHYs` chunk (pixels per metre = DPI / 0.0254), and set JPG JFIF density (units = 1 DPI). Patch the bytes after `canvas.convertToBlob()`.
- Canvas limits: refuse sizes above 16 384 px on a side or 200 megapixels, and suggest a lower DPI. Example: a 600 × 400 mm sheet at 600 DPI = 14 173 × 9 449 px, which is fine.
- JPG quality 0.95, and a note in the UI that PNG is better for sharp edges.
- No raster image is suitable for cutting without tracing; the export dialog says so in one line.

### ZIP and project file

- `fflate` bundles all selected files plus a `README.txt` (settings used, layer count, sheet count, stacking order, warnings).
- Settings save/load as a small `.json` project file; the last settings also persist in `localStorage` (wrapped in try/catch, since `file://` storage can fail).

## UI and UX

One screen: a parameter panel on the left, a large view area on the right with three tabs (3D, Layer, Sheets), and a status bar with warnings at the bottom. Every change re-runs the pipeline automatically (debounced); there is no "Slice" button.

**Parameter panel** (collapsible groups, in this order)

1. **Model**: drop zone and file button; bounding box size in mm; scale % or target size for one dimension with locked proportions; axis selector (±X/±Y/±Z) and three 90° rotate buttons.
2. **Material**: measured thickness (with a hint: "measure with calipers, nominal 4 mm is often 3.7–3.9 mm"); sheet width × height; kerf; part spacing; sheet margin.
3. **Slicing**: mode (oversize / mid-plane / undersize, each with a one-line explanation); samples per layer; round height to whole layers; advanced (simplify tolerance, min part area, min feature).
4. **Hollowing**: on/off, wall width, solid cap layers.
5. **Gluing aids**: engrave next-layer outline, labels with height, dowel holes with diameter and count.
6. **Export**: formats (DXF / SVG / PNG / JPG checkboxes), DPI, raster style, per sheet or per layer, "Download all (ZIP)".

A summary line sits above the export button: `42 layers · 57 parts · 3 sheets · 68 % material use`.

**3D tab**

- three.js scene with orbit controls, grid floor, axis gizmo.
- Toggle between the original model (semi-transparent) and the stacked result: each layer's shapes extruded to the thickness (`ExtrudeGeometry` from the Shape holes), alternating two wood tones so the layers are visible.
- The layer selected in the Layer tab is highlighted in the 3D view.

**Layer tab**

- 2D canvas of one layer with a slider and arrow keys to step through layers.
- Draws: the cut outline (red), the next-layer outline (blue), the previous layer as a faint ghost, labels, dowel holes. Zoom and pan with wheel and drag.
- Shows layer index, Z range and part count.

**Sheets tab**

- All sheets side by side as they will be cut, same colours as the DXF layers.
- Hover a part to see its id; click it to jump to its layer.

**Warnings**

- Collapsible list in the status bar, grouped by level, each item clickable to jump to the layer or part. Examples: open mesh repaired in layer 12; part L03-c removed (2.1 mm²); part L20 larger than sheet.

**Progress and errors**

- Thin progress bar with the current stage name while the worker runs.
- Unsupported or corrupt files show one clear message; the app never shows a blank screen.

## Milestones

Execute in this order. Each milestone ends with passing tests, a working `dist/index.html`, and a commit. M1–M7 make the usable v1; M8–M10 are extensions.

| # | Milestone | Deliverable | Done when |
| --- | --- | --- | --- |
| M0 | Scaffold | Vite + TS project, single-file build, inline worker "ping", Vitest set up | `dist/index.html` opens from `file://` offline in Chrome, Edge, Firefox; worker answers; no console errors |
| M1 | Load and view | Loaders for STL/OBJ/3MF, mesh welding, bbox, 3D view, axis and scale controls | All fixtures load; bbox size shown correctly; axis change visibly re-orients the model |
| M2 | Core slicing | `slice.ts` + `poly.ts`: plane cut, edge-key stitching, rings → shapes, mid-plane mode; Layer tab | Cube, sphere and torus tests pass (see Testing); stepping through layers shows correct outlines |
| M3 | Modes and cleanup | Oversize/undersize sampling, simplify, min area, islands, warnings list | Sphere oversize areas ≥ true max section of each layer; two-spheres fixture gives 2 islands per layer |
| M4 | Kerf and DXF/SVG | Kerf offset, DXF R12 writer, SVG writer, per-layer export | 20 mm square + kerf 0.2 exports as 20.2 mm; DXF parses with `dxf-parser`; imports at true size in LightBurn or LibreCAD |
| M5 | Nesting | Min-area rect rotation, MaxRects, multiple sheets, Sheets tab, per-sheet export, ZIP | No overlaps, all parts inside margins; oversized part reported as error; ZIP contains all files + README |
| M6 | Gluing aids | Next-layer engraving, Hershey labels with polylabel placement | Every part has a label; labels sit inside the next layer's area where it exists |
| M7 | Raster export | PNG/JPG with DPI metadata, filled and outline styles | Read-back of `pHYs` / JFIF density matches DPI; pixel size matches mm × DPI / 25.4 |
| M8 | Hollowing and dowels | `hollow.ts`, dowel runs and hole placement | Hollowed sphere keeps solid caps and a wall ≥ setting everywhere; dowel holes line up across a run (same XY in every layer) |
| M9 | Polish | Stacked 3D preview, project save/load, localStorage, keyboard shortcuts, help text | 500k-triangle model, 100 layers: full run < 5 s in the worker, UI stays responsive |
| M10 | Optional .exe | Tauri wrapper around the same `dist/index.html` | Windows build < 15 MB runs offline; no code changes in `src/` needed |

## Testing and agent instructions

All of `core/` is covered by Vitest unit tests on generated fixtures; UI is checked by hand against the milestone criteria.

**Fixtures** (generated in code under `test/fixtures/`, no binary files in the repo except one real-world STL)

- Cube 20 mm; UV sphere r = 10 mm (high resolution); torus R = 20, r = 5; two separate spheres; a cube with one triangle removed (open mesh); a cube with inverted normals; a mesh with a vertex exactly on a slice plane.

**Required tests**

| Test | Expectation |
| --- | --- |
| Cube, t = 4 | 5 layers, each area 400 mm² ± 0.01 |
| Sphere, mid-plane | Each layer area within 1 % of π(r² − z²) at the mid-plane height |
| Torus, horizontal cut through the middle | One shape with exactly one hole |
| Two spheres | 2 islands per layer, ids `-a` and `-b` |
| Open mesh | Closed outline + one warning naming the layer |
| Inverted normals | Same areas as the normal cube |
| Vertex on plane | No crash, no zero-length segments, correct area |
| Kerf 0.2 on 20 mm square | Outer 20.2 mm; a 10 mm hole becomes 9.8 mm |
| DXF round-trip | `dxf-parser` reads layers CUT/ENGRAVE/LABEL and the same vertex coordinates (± 0.001 mm) |
| SVG vs DXF | Same outlines after the Y flip |
| Nesting | Pairwise intersection area of placed parts = 0; all parts inside sheet minus margin |
| PNG DPI | `pHYs` chunk decodes to the chosen DPI |
| Performance | 500k triangles, 100 layers, oversize mode: < 5 s in Node |

**Instructions for the coding agent**

- Work milestone by milestone, in order. Do not start a milestone before the previous one meets its "done when".
- Keep `core/` free of DOM and three.js scene code, so it runs in Node tests and in the worker. Loaders may use three.js parsing classes only.
- Call Clipper only from `core/poly.ts`; all other modules work in mm with the types from `core/types.ts`.
- No network access at runtime: no CDN, no remote fonts, no analytics. After each build, check `dist/index.html` for `http://` and `https://` references to anything but the SVG namespace and licence comments.
- Dependencies only under MIT, ISC, BSD or Apache-2.0. Add a `THIRD_PARTY_LICENSES.txt` and include the licence notices in the build.
- Never block the main thread with geometry work. Transfer typed arrays between worker and UI instead of copying them.
- Prefer clear, readable code over clever code; comment the non-obvious geometry (stitching, modes, hollowing support region).
- When something in this plan turns out wrong in practice, follow the intent, record the deviation in `DECISIONS.md`, and keep going.
- Ship a short `README.md`: how to build, how to use, and a stacking guide (cut face-up, stack bottom-up, align each part to the engraved line).
- Use Sonnet in Medium for most of the coding. Opus only for high level work and orchestration
