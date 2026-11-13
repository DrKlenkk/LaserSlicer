# Decisions and deviations from docs/PLAN.md

## clipper2-js licence (Boost Software License 1.0)
The plan restricts dependencies to MIT / ISC / BSD / Apache-2.0. `clipper2-js` is
published under the Boost Software License 1.0. It is permissive (no copyleft, no
attribution-in-binary requirement for object code), and it is the only maintained pure-TS
Clipper2 port, so it is **accepted**. Its licence text is included in
`THIRD_PARTY_LICENSES.txt` and embedded as a comment in `dist/index.html`
(the package ships no licence file; `scripts/gen-licenses.mjs` supplies the standard BSL-1.0 text).

## @types/node as dev dependency
Needed so `vite.config.ts` (node:fs) and tests type-check. Dev only, MIT.

## check-dist allow-list
`scripts/check-dist.mjs` accepts URLs inside comments and XML namespace identifiers
(`www.w3.org`, `schemas.microsoft.com`). These are names, never fetched. The latter appears
in three's `3MFLoader` as 3MF XML namespace strings.

## 3MF is parsed on the main thread (M1)
three's `3MFLoader` calls `DOMParser`, which does not exist in workers. STL and OBJ are parsed in
the worker; 3MF is parsed on the main thread (`src/ui/load3mf.ts`), all objects are flattened with
their transforms into a triangle soup, and that soup is sent to the worker with the `load`
message using `ext: "soup"` (buffer transferred). Welding, bbox and edge statistics then run in the
worker like for any other format. 3MF parsing is a one-off cost per file load.

## Orientation runs on the main thread for the 3D view (M1)
`core/transform.ts` is pure and cheap (O(vertices)). The UI calls it for the preview so axis/scale
changes feel instant, without a worker round trip. The slicing pipeline (M2+) will apply the same
function inside the worker from the settings it receives, so both sides agree.

## Settings naming
`Settings` is flat as in the plan; hollowing keys are `hollowEnabled` / `hollowWall` (plan: `enabled` / `wall`
under "Hollowing") to keep one flat namespace.

## Worker keeps a copy of the mesh
On `load` the worker keeps the welded mesh and transfers a `.slice()` copy of its typed arrays to the UI
(transfer empties the sender's buffer, and the worker needs its own for slicing).

## Not verified here
Only Chromium (Playwright) was available in the build environment. Firefox and Edge, and `file://` there,
have not been tested. The build uses an iife inline (Blob) worker, standard in all three.

## clipper2-js 1.2.4 bugs worked around in `core/poly.ts` (M2)
The pure-TS port has two defects that would have silently broken slicing; both are isolated in `poly.ts`
and covered by `test/poly.test.ts`.
1. **`executePolyTree` returns nothing.** `OutRec.bounds` / `OutRec.path` are never initialised, so `buildTree`
   throws inside a try/catch and the tree comes back empty (`false`). The plan asked for PolyTree; instead
   `poly.ts` runs the flat `execute` and builds the outer/hole nesting itself (Clipper's flat output is
   non-overlapping with outers positive and holes negative; each hole goes to the smallest outer that contains it,
   decided by a majority vote of hole vertices with a plain ray-cast). `Clipper.pointInPolygon` was not used
   either: it returned the same value for inside and outside points.
2. **`ClipperOffset.offsetPolygon` is wrong for polygons with more than 3 corners.** The C# original passes `ref k`
   and advances it; the port's `k = j` is a no-op on a local, so every vertex is joined to the last one.
   `poly.ts` replaces that method on the prototype with a corrected loop. Without this the kerf offset (M4) and the
   minFeature opening would produce garbage.

## Simplification uses Ramer-Douglas-Peucker, not `SimplifyPaths` (M2/M3)
Plan section 7 says "Clipper SimplifyPaths". On small round sections it removed about 1% of the area at 0.05 mm
(a 4.4 mm radius circle), twice what Clipper's RDP (`ramerDouglasPeucker`, also in clipper2-js) removes, and RDP
guarantees no vertex was removed further than `simplifyTol` from the result. `poly.simplify` uses RDP and then
re-resolves the rings with one union. Still, any simplification slightly shrinks convex outlines, so at the default
0.05 mm the oversize mode can undershoot the true maximum section by roughly 0.5% on a small round section
(oversize is "covers the model" up to `simplifyTol`). Set `simplifyTol` to 0 for a strict guarantee.

## Slice sample margin
Sample planes sit at `z0 + 1e-4` and `z1 - 1e-4` (`SAMPLE_EPS`), the same size as the vertex nudge. A margin of
1e-3 left 1 micrometre slivers next to the corners of box-like parts that the simplifier then turned into
corner-clipping (cube area 399.99 instead of 400).

## Edge keys for stitching
Keys are `min*V + max` as in the plan, in a `Map<number, number>` per plane. This is exact while `V*V < 2^53`
(V below about 9.4e7); `slicePlanes` throws a clear error above that. A mesh with that many vertices cannot
be held in browser memory anyway (about 1.1 GB for the positions alone), so no fallback keying was written.

## Open-chain repair details
Chains are joined end-to-start, nearest first, below `gapTol` = 0.5 mm; what is left is closed with a straight
line (the ring is implicitly closed). The pairing search is O(n^2) per join, so beyond 400 open chains in one
plane joining is skipped and everything is force-closed. One warning per layer (not per sample plane) names the
layer: level `warn` if a gap had to be closed with a straight line, level `info` if only sub-tolerance gaps were joined.

## Part ids
A layer with one shape is `L012`; several islands are `L012-a` (largest), `L012-b`, ... ordered by area. Removed
islands are reported under the id they would have had in that area order (a removed third island is `L012-c`).

## Mid-plane and layer overshoot
In mid-plane mode a top layer whose mid-plane lies above the model is empty (info warning "Layer N is empty",
no part). Oversize mode still covers it because its first samples lie inside the model. Undersize
mode is empty whenever any sample plane lies outside the model.

## minFeature opening uses miter joins
Erode and dilate both use miter joins (limit 2). A true disc opening would round convex corners by
`minFeature/2`; miter keeps the sharp corners of cube-like models and still removes necks and slivers.

## Worker run protocol (M2)
`progress.fraction` is overall progress 0..1 across all stages (not per stage). The worker records the newest
`run` jobId on receipt and the pipeline checks it at checkpoints (it yields to the event loop with a
`MessageChannel` at least every 25 ms), so an older run abandons itself within one slice chunk (4 layers) and its
result is never posted. The main thread additionally ignores any result whose sequence number is not the latest.
`WorkerClient.run` rejects a superseded run with `StaleJobError`. A new model starts a run immediately; setting
changes are debounced 300 ms.

## Orientation in the worker
`Pipeline` calls `orientMesh` itself (same function as the 3D preview), plus the height rounding factor when
`roundHeightToLayers` is on (a uniform scale so the height is a whole number of layers; the effective scale
reported to the UI includes it).

## Not verified here (M2/M3)
Layer tab and warnings list were checked in Chromium only (headless, software GL). Perf number was measured in
Node on this build machine, not in a browser worker.

## Simplification keeps the mode guarantees (M3 fix)
RDP simplification pulls convex outlines inwards by up to `simplifyTol`, so oversize could undershoot the true
section. `poly.simplify` now takes a `bias`: oversize uses `"outside"` and undersize `"inside"` (mid-plane `"none"`,
the previous Clipper RDP). The biased variant is a side-constrained RDP written in `poly.ts`: a run of vertices is
replaced by its chord only if all of them are within `simplifyTol` of it AND on the material side (oversize) or the
other side (undersize) of the chord, so the chord never cuts material away (oversize) / adds material (undersize).
Union/intersection with the unsimplified outline (the suggested approach) was tried first and abandoned:
clipper2-js returned a union smaller than either input for near-identical outlines (301.27 mm² from inputs of
301.31 and 301.31 mm²), a third clipper2-js defect to avoid; offsetting outward by `simplifyTol` was rejected because it
grows exact shapes (20 mm cube becomes 20.1 mm). Consequence: in oversize mode only concave stretches lose vertices,
convex arcs keep theirs (mid-plane simplifies as before).

## Part gets a `label` field (M4)
The plan's `Part` has only `engrave`, but the DXF needs ENGRAVE (next-layer outline) and LABEL (text strokes) on
separate layers. `Part.label: Vec2[][]` was added (empty until M6). Polyline closing convention for `engrave` and
`label`: a polyline whose first and last point coincide is closed (written as POLYLINE flag 70 = 1 without the
repeated vertex, SVG `Z`); anything else is open.

## Pipeline stages 5 and 6 (M4/M5)
Kerf (`kerf.ts`) and nesting (`nest.ts`) are cached stages with keys [cleanup key, kerf] and [kerf key, sheet size,
spacing, margin]. `RunResult.parts` holds the kerf-compensated parts; `layers[].shapes` stay uncompensated (the Layer
tab shows the model, not the cut). A kerf offset that splits a part keeps the largest piece with a warning; one that
makes it vanish drops the part with a warning. `Pipeline.last` keeps the latest result and its settings for export.
Because the per-sheet export needs nesting, the M4 commit already contains `nest.ts`; the M5 commit adds the Sheets
tab, the summary line and the nesting tests.

## DXF details
`$EXTMIN/$EXTMAX` are written as well (helps LibreCAD/LightBurn zoom to the drawing). Lines end with CRLF. Numbers
have up to 4 decimals. The SHEET layer exists in the table; the border is only drawn when `writeDxf(..., {sheetBorder: true})`
is called (plan: "off by default"); there is no UI toggle and no Settings key for it yet. Not verified in
LightBurn or LibreCAD here (not available); only parsed with `dxf-parser`.
Per-layer files place the layer's parts at their model coordinates moved so the lower-left corner is (0, 0); the
SVG per layer is sized to that bounding box.

## Export message and ZIP
The worker `export` message returns one ZIP (`<model>_laser.zip`), always, even for a single file; the formats and
"per layer" choice travel with the message, so they are never stale (they do not affect slicing). The plan's `dpi`
field is for M7. Raster formats are disabled in the UI until M7 (the DPI and raster style inputs were removed from the
panel for now). The ZIP is built in the worker and transferred, then saved from a Blob URL on the main thread.

## Nesting details
Each part is rotated to its minimum-area rectangle (rotating calipers over hull edges) with the long side horizontal;
MaxRects may additionally turn it by 90 degrees. Spacing is added to every rectangle and to the bin (so edges keep
`partSpacing` between parts and `sheetMargin` to the border). Parts are ordered by layer, then by rectangle area
(largest first), and each is tried on all open sheets in order before a new one is opened, which fills early sheets
better than only looking at the last sheet. `Placement.angleDeg` rotates CCW about the origin, then (x, y) translates;
`applyPlacement` in `nest.ts` applies it to cut, engrave, label and dowel holes. The tight rectangle is not a
true-shape nest: round parts waste material (a sphere uses about 13 % of a 600 x 400 sheet), v2 is optional in the plan.
Sheets tab colours are close to, not identical to, the ACI colours (readable on light and dark backgrounds).

## Registration aids (M6)
- **Stage position.** `core/registration.ts` is a cached stage between cleanup and kerf (key: cleanup key + `engraveNextOutline`,
  `labels`, `labelHeight`); a kerf change re-runs only kerf and nesting. It reads the uncompensated outlines; the kerf stage
  then offsets only `cut` (engrave and label lines are copied through), which only grows the outline, so labels stay inside.
- **Label form** is `L12` / `L12-b` (the part id `L012-b` without the zero padding); ids themselves keep the padding.
- **Font data is a reconstruction.** The glyphs in `core/font/hershey.ts` use the Hershey encoding (side bearings, R-offset pairs,
  `" R"` pen-up, cap height 21) and the Simplex style, but I could not copy the original table byte for byte offline; the outlines
  were authored by hand (polygonal curves on the integer grid) and checked visually by rendering digits, A-Z, `-`. Lower case letters
  were added in M9 (see below). Unknown characters become a space.
- **Placement.** The pole of inaccessibility (`polylabel`, precision 0.1 mm) of the best shape of `part ∩ next layer`; the
  text box (plus 0.25 mm clearance) must lie inside that region, checked first with the inscribed circle and then exactly with a
  polygon difference (box minus region has no area), horizontal first, then turned by 90 degrees. Height goes from `labelHeight`
  down in 8 % steps to 3 mm. Fallback: the same procedure on the part itself (info warning when a next layer exists); if even 3 mm does
  not fit, the text shrinks to the inscribed circle (warn) and is left out below 1 mm (warn). Top layer: inside the part, no warning.
- **Engrave lines** are the closed rings of `part ∩ next layer`. When the next layer covers the whole part (area within 0.1 %, the
  case on the growing half of a sphere) the intersection is the part's own edge, so no engrave line is written: it would retrace the cut
  and the glued part overhangs the edge anyway.
- Layer tab: next layer outline dashed blue (from `layers[i+1]`, the model outline), labels green (from the parts).

## Raster export (M7)
- **Where.** `core/export/rasterBytes.ts` holds the pure parts (pixel size, size limits, CRC-32, PNG `pHYs` insert/read, JFIF
  patch/read; all tested in Node); `core/export/raster.ts` draws on `OffscreenCanvas` (worker only) and is covered by a test with a
  recording mock context (draw calls, Y flip, even-odd). Real rendering was verified in Chromium only.
- **New setting `rasterEngrave`** (default on): grey engrave lines and labels in the images, the plan's "optional". Engrave and labels
  are 0.2 mm wide (at least 1 px) in `#808080`; in the outline style the cut lines are exactly 1 px black.
- **Limits** are checked for every image before the first one is rendered; the message names the image, the pixel size and a DPI that
  works (rounded down to a multiple of 10). The same limit also holds for the per-layer export, where images are small.
- **Pixel size** is `round(mm / 25.4 x DPI)`, so a 600 x 400 mm sheet at 300 DPI is 7087 x 4724 px (the drawing is scaled by DPI/25.4,
  the last pixel may be fractionally covered). The DPI is 1 to 4800 in the UI (presets 254, 300, 600, 1000 or custom).
- JPEG: Chromium writes a JFIF header with units 0 and density 1:1; it is patched in place. If a browser writes none (EXIF first), an
  18-byte JFIF APP0 is inserted directly after SOI. PNG: any existing `pHYs` is replaced and the new one placed right after IHDR.
- PNG and JPG are stored (not deflated) inside the ZIP. A 600 x 400 sheet at 1000 DPI is refused (23622 px wide), as the plan intends.
- The export runs asynchronously in the worker now (`exportJob`); errors, including the size refusal, come back as the normal
  `error` message and appear under the Download button.

## Hollowing and dowels (M8)
- **Stages.** `core/hollow.ts` is a cached stage between cleanup and registration (key: cleanup key + wall, cap layers,
  minPartArea; switched off it is a pass-through that does no geometry). It rebuilds the parts of hollowed layers (shapes sorted by
  area, ids re-assigned with `partIds`). `RunResult.layers` are the hollowed layers (the plan's "after hollowing"), so the Layer tab,
  next-layer outline and the 3D stack show the cavities. Dowels live in `registration.ts` and are part of the registration stage
  (key includes `dowels`, diameter, count), computed on the hollowed layers.
- **Cavity closed to the outside.** A cavity is always fully enclosed (a hole in the part, 15 mm from the edge by default), so
  the hollow model is sealed; there is no vent hole. The cap layers are solid by `solidCapLayers` (both ends), and a layer without a
  neighbour is never hollowed even with `solidCapLayers = 0`.
- **Engrave with hollowing.** When hollowing is on only the outer rings of `part ∩ next layer` are engraved (the cavity edges
  would only trace lines that are cut or hidden anyway). With hollowing off, hole rings (e.g. a torus) are engraved as before.
  Labels use the full joint region, so with hollowing a label sits in the wall ring.
- **Dowel runs.** Per layer the shapes are shrunk by `dowelDiameter/2 + 3 mm`; a run grows greedily while the intersection stays
  non-empty (area above 0.001 mm²). A run of **one layer gets no holes** (a hole in a single layer joins nothing) and a warning
  "shorter than 2 layers"; layers too small for any dowel are listed in one info warning. With hollowing, the core is computed after
  hollowing, so dowels land in the wall ring and only where consecutive wall rings overlap (on a sphere that is usually a short band
  of the ring, so expect few or no dowels on strongly curved hollow models).
- **Point choice.** Candidates are the 1 mm grid points (multiples of 1 mm in model coordinates) inside the core, found by scanline.
  Cores larger than 40 000 grid cells coarsen the grid to whole-mm multiples to stay fast. First point: farthest candidate from
  the mean of the candidates (the centroid); then farthest-point sampling. A core without any grid point (tiny) uses its polylabel point.
- **Labels avoid dowel holes**: the label region is the joint minus circles of radius `d/2 + 1 mm` around the part's holes. Engrave
  lines are not routed around holes (they may cross them).

## Hershey lower case (M9)
`a`-`z` were authored by hand in the same encoding and Simplex style (single strokes, polygonal bowls on the integer grid, x-height
14 units, ascenders to the cap height, descenders g j p q y down to y = 16/17); like the capitals they are a reconstruction, not
the original table. Checked by rendering a-z and sample labels (`L12-b`, `L47-aa`, "Hello gypsy jump") to PNG and looking at them.
`i` and `j` have a 1 unit long stroke as the dot. Known limit: label placement fits the box from baseline to cap height, so a
label containing a descender letter (only the 7th, 10th, 16th, 17th, 25th island of one layer: `-g`, `-j`, `-p`, `-q`, `-y`)
can poke up to about a third of its height below that box.

## Stacked 3D view (M9)
Built from `RunResult.layers` (outlines before kerf, after hollowing) as one `ExtrudeGeometry` per layer, built lazily only while the
"Stacked result" button is active, and disposed whenever the result changes. Two wood tones alternate; the layer selected in the
Layer tab is blue. The original model is drawn at 78 % opacity in the "Model" view.

## Project file, shortcuts (M9)
- Project file: `{format: "laser-slicer-project", version: 1, settings}`; loading validates every key (types, ranges, enums) and
  rejects a bad value with one sentence naming the key; missing keys take the default; unknown keys are ignored. The model is not stored.
- Shortcuts are global (not only in the Layer tab): 1/2/3 tabs, arrows / PgUp / PgDn / Home / End step layers, M toggles
  model/stacked, F fits the view, ? opens help. They are ignored while a text or number input, a select or the layer slider has
  focus. **Ctrl+S is deliberately not bound**: it is the browser's "save page" and the project buttons are in the panel.
- Window-level `error` / `unhandledrejection` handlers put the message in the status bar, so a failure is never silent.

## Performance and error handling (M9)
- Measured in headless Chromium from `file://dist/index.html` (software GL), 499k-triangle binary STL sphere, 100 layers, oversize x3:
  file input to result **2.3-2.5 s** (load, weld and edge statistics in the worker 0.9 s). Node: weld 0.62 s, edge stats 0.1 s, run 1.5 s.
  Welding first checks the vertex's own hash cell and only then the 26 neighbours; `edgeStats` sorts a `Float64Array` of edge keys
  instead of a `Map` (together 1.4 s -> 0.7 s).
- UI responsiveness: with the Layer tab open the largest requestAnimationFrame gap during the run was 83 ms. With the 3D tab open there is one
  stall of about 1 s right after the load, caused by the headless software GL rendering the 500k-triangle model; the same run with the 3D view
  hidden has none. On a real GPU this should be negligible but was not measured.
- Corrupt, empty, truncated, NaN and wrong-extension files each give one status-bar message and keep the app and the previous model.
  A run with no parts at all gives an error warning. Verified for 9 sample files in Chromium.

## Auto-update toggle and stale preview
`src/updateController.ts` is a DOM-free state machine (auto, stale, running, run ids) that main.ts drives; `uiPrefs.ts` keeps the
checkbox in `localStorage` key `laserslicer.ui.v1`, separate from the settings key and the project file (slicing settings only).
Run ids come from the controller, so a result of a superseded run or of an old model is ignored. Settings that only affect export
(formats, per layer, dpi, raster style) no longer trigger a run or mark the preview stale (`slicingKey`), in both modes. A model
load now also aborts a run in flight in the worker (`load` sets `latestRun`) and the client rejects its promise. Export awaits
`ensureFresh()`: it starts a run if stale (or waits for the one in flight) and the worker exports `pipeline.last`, which is that run.
With auto-update off, Download is enabled as soon as a model is loaded (it slices first).

## Outline artifacts on filleted low-poly parts: two more clipper2-js defects and a micro-edge fix
User report: rounded corners of a real model showed zig-zag steps, notches and kinks in the Sheets tab (oversize, 3 samples,
simplify 0.05, kerf 0.15). Diagnosed on synthetic filleted plates (`roundedPlate` in `test/fixtures/meshes.ts`: 60 x 60 x 24 mm, R12
vertical corners with 6 to 9 segments per 90 degrees, 5 mm fillets on the top and bottom edges, 16-gon hole, optional +-0.05 mm
noise, optional different tessellation per ring) with every mode / samples / simplify / kerf combination, measuring reflex
vertices (turning against the bend direction) and sub-0.2 mm edges per outline.
1. **Aliasing bug in clipper2-js (fixed in `poly.ts`).** `InternalClipper.getIntersectPoint` returns the segment's own endpoint
   object when the intersection falls on an end of the segment (and `getClosestPtOnSegment` can return `seg1`). In C# `Point64` is
   a struct (copied); in JS it is a reference, and `ClipperBase.addNewIntersectNode` then assigns `ip.x/ip.y`, i.e. it edits a polygon
   vertex in the middle of the run. The union / intersection of two near-identical outlines (the samples of one layer on a wall or on a
   slowly changing fillet) lost about 1.2 mm2 of a 3424 mm2 section and left hairline spikes and notches up to 0.5 mm long (a 163 degree
   reflex turn). This is the "third defect" that the M3 note blamed on union; it is also why oversize unions came out smaller than the
   inputs and why undersize intersections were wrong. In a 788 pair stress test about 25 % of the pairs failed the invariants
   (union >= max input, intersection <= min input, inclusion-exclusion); after the patch none do. The patch wraps the two static
   methods so they return fresh points. This was the main cause of the visible steps at default settings.
2. **Offset micro-edges (fixed in `poly.offset`).** Offsetting a nearly straight stretch writes two corner points 1 to 5 micrometres
   apart; on the integer grid their direction is arbitrary, so the kerf output contained 1.4 micrometre edges that turned by up to 119
   degrees. `offset` now merges points closer than 5 micrometres to the previous kept one (`TINY_EDGE`), a change of at most 5
   micrometres of outline. Reflex turns after the kerf offset dropped from 119 to 0.8 degrees.
3. **What remains is inherent** and is not a software bug: (a) the true section of a filleted part changes inside a layer, so the
   oversize union has real outward steps (and notches between differently tessellated samples, up to the facet sagitta, about 0.1 mm
   for R12 at 6 to 9 segments per 90 degrees; the default biased simplify already fills notches up to `simplifyTol`); (b) noisy
   vertices (+-0.05 mm, the size of the default `simplifyTol`) give small reflex kinks that survive the default settings; (c) a
   coarse tessellation is faceted by construction (a 16-gon hole is a 16-gon); (d) vertices of one source that differ by more
   than the weld tolerance (1e-5 of the bbox diagonal) are not welded, the section opens and the repair joins gaps with straight lines
   (a warning is shown); (e) undersize intersections leave 5 to 10 micrometre steps where two samples swap edges (invisible).

## Outline smoothing (`smoothRadius`)
Setting `smoothRadius` (mm, 0 = off, project key, in the Slicing group) is applied first in `cleanupLayer` (before simplify), so the cleanup
cache key contains it and nothing earlier re-runs; kerf, hollowing and nesting come after it, so a kerf change does not re-run it.
- **Method: mode-aware morphology with round joins** (`src/core/smooth.ts`). Oversize = closing (offset +r, then -r), undersize = opening
  (-r, +r), mid-plane = closing then opening. Closing only adds material and opening only removes it, so each mode's guarantee holds
  exactly; the result is shifted by 6 micrometres (arc tolerance + 1 micrometre grid) in the permitted direction because the round-join
  polygons cut up to the arc tolerance off a sharp tip. Arc tolerance is 5 micrometres (finer than the 10-20 micrometres asked for: the
  simplifier thins the fillets again anyway), then micro-edges under 15 micrometres are merged (`cleanShapes`, which now also removes
  hairline 180 degree spikes).
- **What it cannot do, and why this is the chosen trade-off.** Steps and facets on *convex* arcs are outward bumps. In oversize they are
  allowed material, so removing them would break "never inside the model"; a morphological filter only rounds the facet corners
  (a few micrometres for a 5 to 20 degree turn). A curve fit that stays outside the outline was tried and dropped: it needs
  an envelope over all samples with curvature limits, and it either bulges the part by the facet sagitta (up to 0.1 mm on R12) or
  leaves kinks where the fit touches. So smoothing removes notches, steps into the part, wobbly inside corners and (undersize / mid-plane)
  spikes and bumps. The tooltip says so.
- **Failed-test review.** Two tests of the first draft failed and were wrong expectations, not bugs: (1) the mid-plane "notch" was
  2 mm wide, wider than 2r = 1.5 mm, so a closing correctly keeps it; the notch is now 0.8 mm wide. (2) The pipeline guarantee test
  compared the smoothed result with an unsmoothed run that was itself simplified (by up to 0.05 mm, in the other direction for
  undersize); the guarantee is about the raw section, so the reference run now uses `simplifyTol: 0`, which is the stricter check.
- Recommended radius: 0.5 to 1 mm for 4 mm material; never above a fifth of the thinnest wall. Features narrower than 2r go away
  (slots in oversize, thin walls / islands in the others); a warning is issued if a whole layer vanishes.

## Trace visibility (view) and export layer selection
- **Two independent things.** The legend checkboxes (CUT, ENGRAVE, LABEL, SHEET on Sheets; CUT, ENGRAVE, LABEL, Previous on Layer) only
  change what is drawn. State lives in `traceVisibility.ts` (one instance, listeners redraw both views and sync both legends),
  persisted as `hiddenTraces` in the UI prefs (`laserslicer.ui.v1`, older prefs without the key load as "all visible"; saving merges
  with the stored prefs so the auto-update flag is not lost). It never touches settings or the pipeline (verified: no `run` message
  to the worker). The `Hover` row has no checkbox. Hidden rows are dimmed and the name struck through; the control is a native checkbox.
- **Export layers** are Settings `exportCut`, `exportEngrave`, `exportLabel`, `exportSheet` (defaults true, true, true, false), so
  they are in the project file (missing keys take the default) and in `EXPORT_ONLY` of `updateController.ts`: changing them neither
  marks the preview stale nor starts a run. They are sent with the worker `export` message (read from the store after `ensureFresh()`),
  so a click just before Download counts. No layer selected -> Download disabled with a hint; CUT off -> warning line; the README lists
  included/left-out layers and notes a missing CUT.
- **Writers.** Dowel holes count as CUT. DXF: the LAYER table always lists the four layers (harmless, keeps the colour mapping stable
  for LightBurn), excluded layers simply have no entities; extents cover only what is written (or the sheet when SHEET is on). SVG: no
  group for an excluded layer; SHEET is a `<rect>` in group SHEET. Raster: parts and dowel holes are skipped without CUT, a grey 1 px
  frame is drawn for SHEET.
- **`rasterEngrave` kept** (backward compatible with saved projects/prefs): it stays a raster-only extra switch, "Engrave lines and
  labels (grey)", and engrave lines / labels are drawn in images only if both it and the layer checkbox are on. The ZIP/README text
  follows that.

## Holding bridges (`core/bridges.ts`)
- **Stage and cache.** Pipeline stage `bridges` after kerf, keyed on kerf key + bridge settings; nesting does not depend on it (bridges
  never change a part's extent), so a bridge change re-runs only this stage. Disabled = parts pass through, not counted or cached.
- **Data.** `Part.cut` stays the closed shape (hit-testing, area, fills, material use unchanged). `Part.bridges` lists bridged rings
  with open `cut` polylines and `gaps` polylines, all in part-local coordinates; `applyPlacement` transforms them, so the plan is
  rotation invariant (it only reads ring geometry). Drawings carry `fill` (closed shapes), `cutOpen`, `bridge`.
- **Gap = bridgeWidth + kerf.** The cut ring is the beam-centre path; the beam burns kerf/2 past each end of an open path, so the web
  left is gap - kerf = bridgeWidth. The BRIDGE polyline covers exactly the gap. Clearance each side: max(1.5 mm, width).
- **Placement.** Candidates scored on a <= 0.5 mm grid: straightness 1/(1+(turning in window/6 deg)^2) times a corner factor
  (0.5..1, free distance from window to nearest > 25 deg vertex, saturating at max(12 mm, 4 clearance, spacing/4)). N bridges at
  offset + k P/N, 48 offsets, each sliding up to min(P/N/4, (P/N - minSep)/2) (minSep = gap + 2 clearance, so gaps can never
  overlap); offset score = (mean + worst)/2 - 0.05 slide, times a spatial-crowding factor. Circles fall back to even spacing on the curve.
  Too short for N: N reduced, one info warning per run. `bridgeMaxSpacing` raises N (max 64) so P/N <= spacing (nominal spacing; slide +-25 %).
- **Export.** New layer BRIDGE (DXF ACI 6, SVG #d000d0, screen #d000d0 / dark #f060f0), export checkbox `exportBridge` (default on, export-only,
  in the slicing key exclusion list), legend row + view toggle `bridge`. Without BRIDGE the CUT polylines stay open = uncut tabs. The DXF LAYER table
  always lists BRIDGE; README/SVG mention it only when bridges exist. Layer tab draws bridged parts from the (kerfed) part cut paths.
- **Not done / unverified.** Not tried in LightBurn. Bridges of the 3D stacked view are not shown (by design).

## Inner cuts first and the CUT_INNER layer (`exportInnerLayer`)
- **Order is unconditional.** Writers take the split `Drawing` fields (`outerClosed`, `outerOpen`, `innerClosed`, `innerOpen`, filled by `drawingOf` through
  `bridges.cutPathsByKind`) and write inner rings (closed, then bridged), dowel circles, outer outlines (closed, then bridged), then BRIDGE, ENGRAVE, LABEL.
  The order is global per drawing (all holes of the sheet before any outline), which includes the required per-part order and is better for a cutter that follows the file.
  Drawings built by hand (tests) have no split; `splitCut` derives it (first ring of a shape = outline, `cutOpen` = outlines).
- **SVG deviation: no more evenodd paths.** One `evenodd` path per shape cannot hold "holes, dowels, outline" in that order, and cannot move the holes to another group.
  Every ring is now its own stroke-only path (fill is none, so the picture is identical). The brief said the off output should equal today's apart from order;
  this is the one structural change, chosen over keeping evenodd and failing the order requirement. Anyone who filled the SVG would see holes filled; the file was never meant for filling.
- **Setting.** `exportInnerLayer`, default off, export-only (in `EXPORT_ONLY`, so no run and no stale preview). It is carried in `ExportLayers.innerLayer` (a routing flag, not a
  trace choice) so it flows through the existing worker message. It follows the CUT chip: with CUT excluded nothing of the cut family is written, inner cuts included.
- **Colours.** ACI 30 (orange, RGB 255/127/0) in DXF, `#ff8000` in SVG: not used by CUT 1, ENGRAVE 5, LABEL 3, BRIDGE 6, SHEET 8, and readable on white and black, unlike yellow (2) or cyan (4).
  Not tried in LightBurn, which maps ACI colours to its own palette.
- **LAYER table.** `CUT_INNER` is listed only when the option is on, so that with it off the DXF stays identical to before apart from entity order (an existing test pins the five layers).
  SVG writes the `CUT_INNER` group only when it has content.
- **Bridges.** Gaps of bridged inner rings stay on BRIDGE; the open polylines of bridged inner rings go to `CUT_INNER` with the rest of the inner cuts.
- **Raster formats ignore the option.** Images are one pixel picture where all cuts are black, so a second layer has no meaning there. Documented in help, README and TECHNICAL.
- **Legend.** One extra row `CUT_INNER` in the Sheets and Layer legends, without a visibility checkbox: the views never draw it (it is a routing of export files), and the text says
  "export only, if chosen". The ZIP README names the layer, its colour and "cut CUT_INNER first, then CUT" when on, and otherwise states that inner cuts are written first.

## Calibration sheet (`src/core/calibration.ts`)
- **Where it runs.** On the main thread, not in the worker: the sheet is a few hundred points, built in well under a millisecond, and the button must work with no model and no worker run.
  The geometry and the ZIP are pure core functions (`buildCalibration`, `buildCalibrationZip`), tested in Node. It reads `kerf` and `dowelDiameter` once at click time; nothing is stored and no cache is touched.
- **Decimal point, not hundredths.** Added a `.` glyph to the font (a closed 2 x 2 unit square on the baseline, same encoding) so labels read `0.15` and `5.9`; hundredths ("15") would
  have been unambiguous but unreadable next to the dowel labels. Side effect: the glyph is in the font for every label (layer labels never contain a dot).
- **Range.** Kerf 0 to 0.30 in 0.05 steps (7 pairs), dowel D-0.2 to D+0.2 in 0.1 steps (5 holes), as suggested. Squares are 20 mm as asked.
  Seven 20 mm pairs only fit about 150 mm wide with thin webs, so the layout is 160 x ~73 mm (a strip of 7 holes with 2 mm webs, the 7 squares directly under their holes at the same pitch, the dowel strip below). That is a little wider than the brief's "about 150 x 100".
- **Compensation.** Square outset by k/2, hole inset by k/2, as the slicer does; both come out 20 mm exactly when the true kerf is k. A test kerf of 0 draws plain 20 mm shapes.
- **Dowel holes use the current Kerf setting (deviation).** The brief said no compensation beyond the label. Taken literally the label would be the path size and the user would have to add the kerf in their head.
  Instead the label is the value to type into "Dowel diameter" and the drawn circle is label minus the Kerf setting, which is what the main pipeline draws for that setting. Consequence: do the kerf test first (stated in the README and tooltip). Circle size is clamped to at least 0.1 mm.
- **Parts are cut free.** Squares are separate parts with their outline on CUT; the holes are inner rings of one strip part and the dowel holes are `CIRCLE`s in a second strip. Labels are on LABEL inside the square and in a 7 mm band under each hole, never touching a cut (tested).
- **Layers.** Only CUT and LABEL; the calibration sheet ignores the export-layer chips, the CUT_INNER option and the formats setting (always DXF and SVG): it is meant to be cut as is.
- **Not verified:** not cut on a real laser, not opened in LightBurn.

## Estimates (`src/core/estimates.ts`)
- **Two steps.** Geometry measurements (`measureParts`: cut length, engrave length, part area, volume, sheet count) are computed in the pipeline after the last stage and returned as `RunResult.measure`; they depend only on geometry,
  so they are cheap (one pass over the parts) and are not cached separately. Pricing (`estimate`: weight, time, cost) is a pure function of the measurements and the four new settings and runs on the main thread, so those four are
  in the exclusion list of `slicingKey` like the export settings: no run, no stale preview, the summary follows at once. A test pins this; in the browser the worker saw one `run` message while the four values were changed.
- **Cut length** counts what the laser follows: kerf-compensated rings (outer and inner), dowel circles as pi x d (d is already the kerf-reduced diameter), bridged rings as their open polylines (gaps are on BRIDGE and not counted).
  **Engrave length** is engrave plus label polylines of all parts, regardless of the export layer chips (the numbers describe the job, not one export choice). A closed polyline repeats its first point, so the closing segment is included.
- **Volume** uses the area before kerf (outer minus holes and hollow cavities) of the parts that survive the kerf stage, times the thickness setting. Dowel holes and rods are ignored (a few cm3 at most); the kerf is not added, as asked.
- **Defaults.** Density 0.65 g/cm3 (plywood), cut and engrave speed 0, price 0. So weight shows out of the box, time and cost only once the user enters machine and material data (they differ too much to guess). A density of 0 hides the weight.
- **Time with one speed.** Time is shown when at least one speed is set; the part without a speed is left out and the text says "cutting not included" / "engraving not included", rather than hiding a useful number or inventing one. It is always labelled "rough" / prefixed with the approximation sign; travel moves, acceleration, passes and the BRIDGE speed are ignored.
- **Cost** = price per sheet x sheets used; partial sheets count whole (stated in the tooltip, the list and the README). No currency symbol.
- **Where it shows.** Summary line (top bar and Export section): cut length, rough time if set, cost if set; weight takes the third slot only when no cost is shown. The full list is the tooltip (`title`) of the top-bar summary, a small block under the Export summary and the "Estimates" block of the ZIP README (which also names the settings that are 0).
  The existing tooltip mechanism is for info icons only, so the plain `title` attribute is used for the summary.
- **Export path.** The worker builds the README from `pipeline.last.settings`, which are the settings of the last run, so a density or price changed afterwards would be missed (changing them starts no run). The four values therefore travel with the `export` message and override the stored ones, as the export layer flags already do.
- **Project file.** The four keys are optional and validated (finite numbers, >= 0); older files get the defaults. The project format version stays 1: the new keys are optional, so nothing changes for existing files.
- **Not verified:** the numbers were checked against hand-computed boxes in tests and against the summary in the browser, not against a real laser job.

## Import units (`src/core/units.ts`)
- **Setting.** `importUnit` (`micron | mm | cm | m | in | ft`, default `mm`) in the Model group, as a factor to mm. It is applied to every vertex in `orientMesh` before the scale and the target size, so extents are in mm
  from then on and a target size still means mm. `Oriented.scale` stays the user scale (excludes the unit), which is what keeps the Scale field at 100 % for a model that is only unit-converted. The unit is in the orient key
  in the pipeline and in the 3D preview's key (the preview calls the same `orientMesh`), and, being a normal setting, in `slicingKey`. No other code used the scale, so the readout, bounding box and fit logic follow with no change.
- **All six 3MF units in the dropdown (deviation).** The brief listed mm, cm, m, inch. Micron and foot are valid 3MF units; mapping them onto a scale percentage would break the "100 %" rule, and hiding options that appear only when set
  would make the dropdown change under the user. So the dropdown lists all six (micron first, foot last) and the project file accepts all six.
- **3MFLoader does not apply the unit.** three's `3MFLoader` reads the `unit` attribute into its model data but never uses it, so there is no double scaling: the file's numbers reach the worker as they are and the import unit does the conversion.
- **Reading the unit.** `read3mfUnit` (core, no DOM: unzip only `*.model` and `*.rels` with fflate, find the model part through the `3dmodel` relationship in `_rels/.rels`, fall back to the first `*.model`, regex on the `<model>` start tag)
  returns `mm` when the attribute is absent (the format's default), and `null` for an unreadable archive or a value the format does not allow, in which case the setting is left alone. Not DOM based, so it is tested in Node with
  generated archives. It reads the archive once more than the loader does (a few KB of XML is decompressed twice for small files; the model part, which can be large, is parsed by the regex only up to its first tag).
- **Persistence.** Loading a 3MF always sets the unit (the file is authoritative, even when it says millimeter and the setting was inch), in the same store update as the model so there is one orient and one run. STL and OBJ loads
  leave the setting as it is: it is a project setting, and a user converting several inch STL files should not have to repeat it. The status bar adds "3MF declares inches — import unit set to inch." only when the setting actually changed.
- **Not verified:** 3MF files from real CAD programs with a non-default unit (only generated archives were tried). Components with their own transforms are in model units like everything else in the file.

## Model in the project file and session restore (`src/core/base64.ts`, `src/sessionStore.ts`)
- **Format.** Version 2 adds an optional `model: { name, data }`; `data` is the base64 of the original file bytes, so the model reloads exactly as the user loaded it (STL, OBJ or 3MF, including the 3MF unit and anything the worker repairs). Writing always uses version 2 (the settings part is unchanged, so a version 1 reader that ignores `model` still works, but it does not check the version number anyway). Version 1 files load exactly as before, and a `model` key in one is ignored (it would not be a real project file). The reader never checked the version number, so "unknown future versions" keep that behaviour: settings are read, and a `model` is read like in version 2 (a guess that later versions stay additive).
- **Own base64 code.** `btoa`/`atob` need a binary string, and building one with `String.fromCharCode(...bytes)` overflows the stack for large files. `core/base64.ts` works in 48 KiB chunks with a lookup table, is DOM free and is tested against Node's encoder (all lengths 0-40, a multi-chunk odd length). The decoder is strict (padding required, white space ignored): a damaged file is better refused than loaded with a silently wrong model. Text of any other kind than an STL/OBJ/3MF name is refused too.
- **Where the settings and model meet.** `parseProjectFile` returns settings and the decoded model and throws one sentence for any problem; `parseProject` keeps its old signature (settings only, ignores `model`) so existing callers and tests stay as they were. Loading with a model goes through the shared `loadModelBytes` (the code `openFile` uses, now fed from bytes), and the project settings go into the same `store.set` as the model: one orient, one run, one settings change. Nothing is applied before the model has parsed in the worker, so a failure leaves the model and the settings as they were; the error message says so and appears in the status bar and the Project group (which is collapsed by default).
- **The project's unit wins.** A project saved with an embedded 3MF carries the `importUnit` the user ended with (possibly deliberately changed after the 3MF set it), so the 3MF's own unit does not override it when loading a project. A plain 3MF load is unchanged.
- **Original bytes.** `loadModelBytes` keeps `{ name, bytes }` of the last successful load in memory. The worker gets a copy, because a transferred ArrayBuffer is detached on the main thread (3MF already sent a freshly built soup). Cost: one extra copy of the file in memory for the session, and a short second copy during loading; acceptable for the sizes the app handles, and the only way to write the original bytes later. The checkbox is disabled without a model and is not remembered between sessions.
- **IndexedDB wrapper.** One database, one object store, one key (`last`), value `{ name, bytes, savedAt }`. Every call has try/catch and a 4 s timeout and answers null/false on any failure, including a `window.indexedDB` that is missing or throws on access (tested with a fake, a throwing and a hanging factory; checked in headless Chromium with the property deleted and with a throwing getter). A write that fails inside a transaction aborts it, so a full quota leaves the old record or none, never a half record.
- **Limit: 50 MB** (`SESSION_MAX_BYTES`). Typical STL files for this tool are a few MB; IndexedDB under `file://` has a small and unknown quota, and the bytes are cloned into the database on every load, so a bigger limit risks slow loads for little gain. A larger file is not stored and the previous record is deleted, so a restore never brings back an older model than the last one the user had.
- **Restore rules.** At start-up, after the worker has answered (a restore before that would only queue), if the preference is on, a record exists and no model has been loaded meanwhile, the bytes go through the normal path. The restore does not touch the settings, not even the unit of a 3MF: the settings are already persisted in `localStorage`, the user's last unit choice is among them, and a 3MF auto-unit would silently undo a deliberate change. On failure there is a warning in the status bar only and the record is deleted, so it does not fail on every start. Success says "Restored the last model." in the status bar.
- **Preference.** `restoreSession` in the UI prefs (`laserslicer.ui.v1`, default on), toggled in the Project group next to the checkbox for the model (the other place for persistence settings; the tab bar only has auto-update). Turning it off deletes the stored model (storing a model the user asked not to keep would be wrong); turning it on stores the current model if there is one. With it off nothing is written on load. The model and the settings are not tied: with it off the settings are still restored by the existing `localStorage` mechanism.
- **Not verified:** other browsers (Firefox, Safari) under `file://`; models near the 50 MB limit; a 3MF restored from real CAD output.
