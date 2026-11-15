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
- **Engrave lines** are the rings of `part ∩ next layer`, filtered to the stretches that run inside the part (`core/engrave.ts`).
  The first rule (skip the whole line when the joint is at least 99.9 % of the part) failed when the next layer covered, say,
  98 % of the part (a chamfered corner, one hole fewer): all rings were engraved, including the long stretches that lie on the
  part's own cut edge and corner holes, so the engraving doubled the cut (reproduced in `registration.test.ts`: about 390 mm of
  engrave on an 80 mm plate whose next layer had one 6 mm chamfer). Now each edge is sampled and dropped where it is within
  `EDGE_TOL` = 0.2 mm of any ring of the part's own cut outline (outer and holes): closer than that the line is useless and only
  chars the edge, while laser and glue tolerances are larger. Kept edges are joined to open polylines (closed ring if all are kept);
  runs shorter than 1 mm are dropped. Full cover gives no line naturally; a clearly smaller next layer keeps its closed ring.
  Distance tests use a uniform grid over the boundary segments, no clipper.
- Layer tab: the dashed blue line is `part.engrave` (what is really engraved), no longer the whole next-layer outline, so the view
  and the export agree; it also disappears when "engrave next outline" is off. Labels green (from the parts).

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
- **Preference.** `restoreSession` in the UI prefs (`laserslicer.ui.v1`, default on at first; changed to opt-in, see the legal section below), toggled in the Project group next to the checkbox for the model (the other place for persistence settings; the tab bar only has auto-update). Turning it off deletes the stored model (storing a model the user asked not to keep would be wrong); turning it on stores the current model if there is one. With it off nothing is written on load. The model and the settings are not tied: with it off the settings are still restored by the existing `localStorage` mechanism.
- **Not verified:** other browsers (Firefox, Safari) under `file://`; models near the 50 MB limit; a 3MF restored from real CAD output.

## Undo / redo and material presets (`src/history.ts`, `src/presets.ts`)
- **What is a step.** The history lives in the `Store` and holds full snapshots of the settings object (structured clones, at most 100, oldest dropped); `Store.set` takes a commit kind. `edit` (default, used by every panel control): rapid changes to the same single setting merge into the open step. `step`: always its own step (project load, preset, `replaceSettings`, `resetSettings`). `silent`: not a step. Undo and redo are one store update, so the panel, `slicingKey`, the stale marker and `localStorage` follow exactly as for a manual edit; no special code in the update controller. Snapshots are whole settings (they are small), not diffs: simpler and no way to drift apart.
- **Merge rule.** Same single changed key as the open step and at most 1000 ms since the previous change to it (the window slides, so continuous typing or a held spinner stays one step). Two keys at once, a bulk step, any undo or redo, or a different key closes the step. A merged step that ends at the value it started from is removed (nothing to undo). A no-op change (all values equal by JSON comparison) is not recorded and does not clear redo. Time is passed in by the caller, so the tests need no fake clock.
- **Model load.** Not a step, and the history is kept (undoing a kerf change after loading another model is useful). The 3MF unit that feature 4 sets on load is the one settings change that rides along: it is committed `silent`, which writes the new `importUnit` into every stored snapshot (`History.rebase`). Without that, undoing an earlier edit would put the old unit back and the model would silently change size. Redo behaves the same. Session restore changes no settings. Loading a project with a model is one step (the project's settings, including its unit), loading one without a model is one step.
- **Keys.** Ctrl or Cmd + Z undo; Ctrl/Cmd + Y or Shift+Z redo. Not intercepted when focus is in an `input` of type text, number, search, email, url, password or tel, a `select`, a `textarea` or a contenteditable element, so the browser's text undo keeps working (the same list the single-key shortcuts use). Intercepted with focus on a checkbox, button, the range slider or the page: none of them use these keys, and a user who just ticked a box expects Ctrl+Z to untick it. A consequence: a number field commits on blur or Enter, and while it still has focus Ctrl+Z is the browser's; the buttons work from anywhere. Alt combinations are left alone.
- **Buttons.** Two small round buttons in the tab bar before "Auto-update preview" (same style as the help button), with titles that name the keys and disabled when empty. They update on every settings event.
- **Preset storage and shape.** Own key `laserslicer.presets.v1`, `[{ name, values }]`. `values` may be partial: on read a field that is not a finite number in range is dropped, an entry with no valid field, an empty name, a duplicate (case-insensitive) or a starter name is dropped. At most 50 entries and 60-character names, to keep the dropdown and the stored text bounded. All storage access is in try/catch; if it fails the presets still work for the page session and the panel says they will not be kept.
- **Starting points.** Three built-in presets (3, 4, 6 mm plywood: thickness, 600 x 400 sheet, kerf 0.15 / 0.15 / 0.2, spacing 3, margin 5, density 0.65), named "... (starting point)" and described as guesses in the tooltip and the docs. They leave speeds and price out, since those depend on the machine and the shop, so applying one does not wipe the user's own values. They are constants in code, not stored: always present, not deletable and so nothing to restore; their names are reserved so a user preset cannot shadow one. The 6 mm entry is a third preset beyond the "two or three" minimum that was suggested.
- **UI.** A select at the top of the Material group (grouped "Starting points" and "My presets"), Save and Delete buttons, a status line. Save uses `window.prompt` (name, prefilled with the selected preset of the user) and `window.confirm` for an overwrite and for a delete: the app has no dialog component and a custom one is not worth the code for two rare actions; the check in headless Chromium handles the dialogs. The select shows the preset whose values equal the current ones (the selected one first when two hold the same values, then mine before the starters) and is empty otherwise, so it also follows undo, manual edits and project loads without extra state. Delete is enabled only for a preset of the user. Applying a preset is `updateSettings(values, "step")`.
- **Not part of the project file.** As the brief says; the project holds the settings themselves, which already include the values a preset applies.
- **Not verified:** other browsers; behaviour of Cmd+Z on a Mac keyboard (only the Ctrl path was exercised); presets after the storage quota is full (the failure path was tested with a throwing `localStorage`).

## Legal compliance for laserslicer.com (Impressum, Datenschutz, GPL-3.0)
- **Project licence: GPL-3.0-only.** `LICENSE` holds the copyright line "Copyright (c) 2026 Louis Adrian Spencer" and a short notice above the unmodified GPL-3.0 text (taken from the Debian `common-licenses/GPL-3` file: 674 lines, 35149 bytes, starts "GNU GENERAL PUBLIC LICENSE / Version 3, 29 June 2007"; gnu.org was not reachable from the build environment). `package.json` has `license: GPL-3.0-only` and the author. All bundled licences (MIT, BSL-1.0, ISC) are GPL-3.0 compatible.
- **Deployment unit is the whole `dist/`.** The app stays one self-contained `index.html`; the three German legal pages are static files in `public/` (inline CSS, no JavaScript, no external resources, light/dark by `prefers-color-scheme`), and the build emits `LICENSE.txt` and `THIRD_PARTY_LICENSES.txt` into `dist/` (Vite plugin in `vite.config.ts`). The operator uploads all files by hand; CI uploads `dist/` as `laserslicer-site` and zips it for releases. `check-dist.mjs` fails on any other file set, any external resource, missing legal content or tracking strings.
- **Third-party notices.** `THIRD_PARTY_LICENSES.txt` is generated by `scripts/gen-licenses.mjs` (name, version, copyright line, full licence text), now including Vite's core licence (its module-preload helper is in the bundle) and the Hershey acknowledgement (A. V. Hershey, NBS; format by James Hurt, Cognition, Inc.; conditions). The Hershey wording is the commonly distributed usage notice reproduced from memory, to be compared with an original distribution if exact wording matters. `@angular/*`, `rxjs`, `zone.js` and `tslib` are declared by clipper2-js but none of their code is in the bundle (checked), so they are not listed as bundled.
- **Cloudflare analytics.** Cloudflare Web Analytics (the JS beacon) is switched off by the operator in the dashboard; the site has no analytics code. Cloudflare's server-side traffic statistics come from its connection logs, and the privacy policy describes them in the Cloudflare section (Art. 6(1)(f) GDPR). "No analytics or tracking tools" is phrased as "no tools on the website" so it stays true.
- **Session restore is opt-in.** `restoreSession` now defaults to false, so a user without the key gets no stored model. A record stored by an earlier version (default on) would otherwise stay on the device unnoticed, so with the preference off start-up calls `SessionStore.purge()` (`deleteDatabase`; it never creates the database). Turning the option off still deletes the record.
- **Legal links in every state.** A bar below the status bar (`src/ui/legal.ts`): "© 2026 Louis Adrian Spencer", GPL-3.0 (to the licence page), "Source code" (repository), Impressum, Datenschutz, Lizenzen. It is a footer in the page flow, so it is visible with or without a model and at phone width (wraps; below the status bar). The help overlay covers it, so the overlay repeats the three links (one click in each state). Links are relative and open in a new tab, so the loaded model and settings are not lost; the legal pages link to each other and back to `index.html`.
- **Impressum content.** Exactly: § 5 DDG / § 18 Abs. 1 MStV note, name, c/o address with #105667, email. No ODR platform link, VAT ID, trade register or arbitration statement.
- **Not verified:** the legal texts were not reviewed by a lawyer; the exact lifetime of `cf_clearance` depends on the Cloudflare configuration (stated carefully); (the earlier note that the app is wider than a phone is obsolete since the phone layout, see below).

## Export a layer range (`rangeFrom`, `rangeTo`)
- **Where the range acts: the nesting stage, and only there.** The nest key gets the *resolved* range (`from`, `to` after clamping to the layer count) and no earlier key does, so a range change re-runs nesting only (a test counts `Pipeline.runs`). Keying on the resolved values means `null..500` and `0..9` on a 10-layer model share one nesting. Bridges are computed for all parts regardless (they are independent of nesting and stay cached when the range moves); the cost of the unused ones is small.
- **`RunResult.parts` and `layers` stay the full model; only placements, sheets and measurements follow the range.** The brief wants labels and engrave lines computed on the full model, and the Layer and 3D tabs are about the model, not the export. So the pipeline hands the nesting only in-range parts, while consumers that count or write parts (summary, README, per-layer files, raster) filter with `partsInRange(parts, info.range)`. Alternative rejected: shrinking `result.parts`, which would have blanked the Layer tab for layers outside the range and broken the layer slider.
- **Estimates follow the range.** `measureParts` runs over the in-range parts (and the area before kerf over the same set), so cut length, weight and the material cost (sheets used) describe what will be cut. The brief asked for "estimates show exactly what will be exported".
- **Not an export-only setting.** It is not in `EXPORT_ONLY` of `slicingKey`: it changes the sheets, so the preview must be marked stale and re-run (nesting only, a few ms). The brief's rule "a setting that does not change geometry must not start a run" does not apply, since it changes the nesting result.
- **Numbering.** 0-based layer indices, as the Layer tab (`Layer 12 of 39`) and the part ids (`L012`) show. Stored as `number | null` (null = no limit), default null/null = all layers; a project file without the keys loads as all layers, `null` or an integer >= 0 is accepted. The range survives loading another model and is simply clamped to it.
- **Clamping rules (`src/core/range.ts`).** Round, clamp to `0..count-1`, swap when from > to. A range entirely beyond the model collapses to the last layer rather than exporting nothing; a reversed range is swapped rather than rejected (typing "to" before "from" in two fields passes through reversed states). Both cases set `clamped`, which the UI shows as a warning-coloured note under the fields ("... was adjusted"). A request that clamps to all layers says so ("covers all layers"). A range whose layers hold no parts gives a warning (`nothing will be exported`); parts too big for the sheet still give their usual error.
- **Where it is said.** Summary line (`only layers 3-5 (model: 0-8) · 3 parts ...`, also top bar), a note under the fields, a header in the Sheets tab (top left; the fit leaves room for it), and in the README a `LAYER RANGE:` line first in the summary, `Layers: 3 of 9`, and a line under "Stacking order". With all layers nothing changes in any text.
- **Per-layer files and raster** go through `exportDrawings`, the one place that chooses drawings, so DXF, SVG, PNG and JPG agree.
- **Fields.** Two number inputs (empty = no limit) and an "All layers" button, committed on change (blur or Enter) like other number fields. No `max` attribute, because values beyond the model are allowed and clamped.
- **Not verified:** touch/phone use; other browsers. Browser check was Chromium headless from `file://` with `stepped_tower.stl`; the pipeline-stage observation there used the progress text (no "Slicing" / "Cleanup" stage appeared after a range change), the exact stage counters are verified in Node tests only.

## Shorter cutting order (`src/core/export/order.ts`)
- **Not a setting.** The order is always on, like the inner-cuts-first order it extends: no key, no panel control, nothing in `slicingKey`. A switch would only offer the longer path; the geometry in the files is unchanged (rings rotated, open lines possibly reversed), so no one needs the old order. The existing tests that read entities by position or by first vertex were changed to look entities up by kind and to compare rings cyclically; no assertion on geometry was weakened.
- **Engrave and label before cut (decision asked for in the brief).** File order is ENGRAVE, LABEL, inner cuts, outer outlines, BRIDGE. Engraving first is the usual practice: a part that is cut free can move or fall, and the engraved outline of the next layer must be on it first. It also costs nothing in travel because every group continues from the end of the previous one. Earlier versions wrote the engrave and label entities last. `CUT_INNER` is unaffected: with `exportInnerLayer` the layer order in the file is ENGRAVE, LABEL, CUT_INNER, CUT, BRIDGE, so "cut CUT_INNER first, then CUT" still holds, and the guarantee "no outline before every inner cut of the sheet" is tested for both settings on a multi-sheet hollow, dowelled sphere. Software that ignores file order and sorts by layer (LightBurn) is not affected by any of this; it only matters for programs that cut in file order.
- **BRIDGE stays last.** Gap scoring is a low-power pass on webs that hold the part; it was written after the cuts before and moving it would change what a cutter does with held parts for no gain.
- **Groups.** Inner closed rings, bridged inner polylines and dowel circles are one group (the brief listed dowels as their own step; all of it still precedes every outline, and a joint path is shorter than two). Outer closed and bridged outlines are one group. ENGRAVE and LABEL are separate groups (SVG keeps one group per layer, and DXF and SVG must list the same order). Each group continues from the end of the previous one; the path starts at the sheet origin (0, 0).
- **Access points.** Closed ring: every vertex (rotate, same winding). Open polyline: either end. Circle: the angle-0 point (cx + r, cy), where a DXF `CIRCLE` and an SVG `<circle>` start; circles cannot be rotated without changing the files' entity type. Ring and polyline "end" is the start vertex for a ring and the far end for a line. Entities with fewer than two points are dropped, as the writers always did.
- **Algorithm.** Plain greedy nearest neighbour (no 2-opt): the brief asks for greedy, it is exact and fast, and the result is predictable. Nearest-point search uses a uniform grid in CSR form over all access points (cell size from the bounding box and point count, about two points per cell), scans rings of cells outward and stops when the next ring cannot hold anything closer; the grid is rebuilt over the surviving entities when half are used up, so late queries do not scan a mostly empty grid. A test compares travel with an O(n^2) reference on random layouts of 1 to 300 entities (equal), and 20000 mixed entities take about 0.1 s here. On a 200-layer sphere sheet set (15 sheets, 105 entities, and 88 sheets with hollowing, bridges and dowels, 1945 entities) ordering takes 7 ms and 22 ms in total; writing all DXF and SVG files 38 ms and 227 ms.
- **Travel figure.** `Measurements.travelLength` = sum of jumps over the sheets (each from its own origin), computed in the pipeline from `sheetDrawing` with every layer on and the bridge gaps included, regardless of the layer chips (like the engrave length, which also ignores them). A chip that leaves BRIDGE or ENGRAVE out makes the real file's travel slightly different; the figure is an estimate of the sheet order, not of one particular file. With per-layer files the drawings are layers, not sheets, so the real travel differs from the reported sheet figure; the README says "Travel between cuts" with the sheet-based number. It is cached by the identity of the bridged parts and the nesting result, so changing a setting that re-runs neither stage costs nothing. It stays out of the time estimate (the time estimate keeps its documented "lower bound" meaning).
- **Measured effect.** The test sphere (radius 40 mm, 4 mm layers, 200 x 150 mm sheets, hollow, dowels, labels, engrave lines; 7 sheets) goes from 8574 mm of travel in the old order to 4758 mm (45 % less); the test requires at least 40 % less.
- **Not verified:** that LightBurn or other software keeps the file order of a DXF (it probably reorders by layer and by its own optimiser), and any real cutting time saved.

## Material comparison (`src/core/compare.ts`, `src/ui/compareDialog.ts`)
- **Cache isolation: a forked pipeline in the same worker.** `Pipeline.fork()` makes a new `Pipeline` on the same mesh with empty caches; the comparison runs only on it. The main pipeline's caches, counters and `last` (what export reads) cannot be polluted, which is tested through the stage counters and identity of `last`. A second worker would give real parallelism but needs a second copy of the mesh and a second weld or a new load path; the comparison is short (0.15 s to a few seconds), so sharing the worker's thread is fine: both the comparison and main runs yield every 25 ms and a main run started meanwhile still progresses (about twice as slow while both run). The mesh is shared read-only (`orientMesh` always builds new arrays). The fork is dropped when the comparison ends, so its caches do not stay in memory.
- **Current-settings row.** The first row, "Current settings", is the user's settings run through the same path (so its numbers are comparable with the others, not taken from the preview, which may be stale or limited to a layer range). It has no Use button ("now"). When it equals a preset, both rows show the same numbers.
- **Layer range is ignored.** Layer numbers mean other layers at another thickness, and "which plywood" is about the whole model, so every entry runs with the range cleared; the dialog says so. Nothing is clamped or reinterpreted.
- **What a preset replaces.** Exactly the preset fields (thickness, sheet size, kerf, spacing, margin, density, speeds, price); a starting point leaves speeds and price out, so those stay the user's. `presets.compareEntries` is the one place that merges (reuses `applyPreset`).
- **Warnings column** counts warn and error notes, not info notes ("Layer N is empty" and the like), so rows are not penalised for notes. Errors turn the cell red.
- **Marking the best.** Lowest sheets, time and cost are bold green, only when two or more rows have a value and they are not all equal. Not a recommendation: layers (glue work), weight and sheet use are not ranked.
- **Columns appear when they have data.** Time, weight and cost columns show only if some finished row has a value (speeds, density, price set), instead of columns of dashes.
- **Cancel and model change.** `cancel { target }` and a `load` both set the worker's active comparison to none; the runner polls it at the pipeline's checkpoints and between rows and returns "cancelled". Finished rows stay and the dialog says "N of M finished". The main thread closes the dialog on a model change. A failing entry becomes a row with the error and the others still run.
- **Apply.** `store.updateSettings(applyPreset(...), "step")`, the same call as the preset list, so one undo step; the normal slicing-key logic then re-slices the preview. No new setting, so nothing in the project file, `slicingKey` or the cache keys changed, and the dialog never starts a main run (checked in the browser by counting `run` messages to the worker).
- **Not verified:** speed on very large models (an entry costs about one full run; the dialog shows live progress and Cancel), other browsers, touch use.

## Assembly guide (`src/core/export/guide.ts`)
- **A format entry, not a setting of its own.** "guide" is a value of `formats` (chip "Assembly guide (HTML)" beside DXF/SVG/PNG/JPG). `formats` is already export-only, so nothing enters a cache key, no slicing run starts and the preview is not marked stale. Project files accept `guide` in `formats`; older files load unchanged. The brief said "checkbox next to DXF/SVG/PNG/JPG", which this is. A guide alone is a valid export (the "nothing to export" error counts files).
- **Pure generator, built in the worker.** `buildAssemblyGuide(result, settings, model, date)` returns a string; the worker adds `assembly.html` after the vector and raster files, before the README, so the README lists it. The date is a parameter (default now) for deterministic tests; it is the UTC date.
- **Self-contained means no URL at all.** Inline CSS and SVG, no script, no handlers, and no `xmlns` on the SVG (not needed in HTML), so the test can forbid `http`, `//`, `url(`, `src=`, `href=`. Fonts are system sans-serif. All text from outside (model name, part ids) goes through `escapeHtml`.
- **Black-and-white friendly:** greys and black only; line kinds differ by pattern: solid thick = this layer's outline, dotted = engraved next-layer outline, dashed = layer below, thin solid = label strokes, white circles = dowel holes.
- **Scale: one per document, true size when it fits.** The window is the bounding box of everything shown (+2 mm) and is the same for every block, so every thumbnail has the same size and the same model position; the paper size is that window times one factor, at most 1 (printed at 100 % it is true size) and otherwise reduced to fit 118 x 74 mm. The header states it. Alternative considered: per-layer fitting (rejected, sizes would not compare). Cost: a small top layer of a tall cone is small.
- **What the thumbnails show:** the part's kerf-compensated cut outline and holes (what is cut, not the pre-kerf layer), dowel holes, `engrave` (the next layer's outline, as engraved) and `label` strokes, in model position seen from the stacking direction, not the nested position. Bridges are not drawn. The layer below is its cut outline dashed. The guide shows the engrave lines regardless of the "Layers in the files" choice (it explains the model), but the instruction text says "no engraved outline in these files" when engraving or labels are off or left out.
- **Layer range (feature A):** blocks only for layers in the range; header and a bordered note say so. The layer below the first shown layer is still drawn dashed (orientation for the first glue step) even when it is outside the range; it is not in the files.
- **Sheet references:** `sheet N` is the number in the file name (`_sheetNN`); a part without placement says it does not fit. With "one file per layer" the sheets are still those of the nesting in the app (a footer says so).
- **Page layout:** A4, 12 mm margins, `break-inside: avoid` per layer block (about three per page; the first page has the header and instructions). Blocks are not forced onto their own pages: 20+ layers would then need 20+ sheets of paper.
- **Size:** coordinates rounded to 0.1 mm, duplicates dropped, `vector-effect: non-scaling-stroke` for equal line widths at any scale. A 100-layer sphere gives about 400 KB (87 KB in the ZIP), so no thinning of outlines was needed.
- **Not verified:** other browsers, real printers (only Chromium's `page.pdf()` was checked: 9 layers gave 4 pages with no block split), and that people find a window common to all layers better than a per-layer fit on very tall models.

## Phone and tablet layout (`src/ui/drawer.ts`, end of `src/style.css`)
- **Breakpoint 820 px** (`max-width`, one constant `NARROW_QUERY` in `drawer.ts` that must match the CSS). Below it the 320 px panel would leave under 500 px for the views (iPad Mini portrait is 768, all phones are narrower); above it the desktop layout fits (iPad Mini landscape 1024, a 863 px Pixel 7 landscape keeps it). The old 760 px rule that stacked the panel above a 70 vh view (and the page scrolled) was replaced. Desktop above the breakpoint is pixel-identical (screenshots at 1400x900 of every tab and the help overlay compared before/after: no differing pixels outside the ping text).
- **Drawer, not a bottom sheet.** The panel keeps its DOM and all its code; it becomes `position: fixed` off-canvas, slid in with a transform (no animation under `prefers-reduced-motion`), `visibility: hidden` when closed so its controls are not tabbable. Opened by a filled "Settings" button at the start of the tab bar; closed by a Close button in a sticky drawer header, the backdrop, Esc, or a successful model load from the panel (the user wants to see the model). The drawer does not close after Export or after opening the compare dialog (dialogs cover it).
- **State is UI only:** a class on the layout, plus `aria-expanded`. Not a setting, not in the project file, history or `uiPrefs`. It resets when the media query stops matching so a rotation never leaves a hidden open drawer.
- **Tab bar.** It now always wraps (`flex-wrap`), which changes nothing on the desktop where it fits in one row, but fixes an overflow found at 863 px width (Pixel 7 landscape: the bar was 5 px too wide). Up to 560 px two rows via `order` and a break element: Settings plus controls on top, the tabs full width directly above the view. The auto-update text is visually hidden (still its accessible name) below 560 px.
- **Touch targets.** 40 px minimum (44 for group headers) for the narrow layout and for `(pointer: coarse)` screens above it, so an iPad in landscape gets big targets with the desktop layout. The 15 px info icons keep their look and get a 14 px larger invisible hit area. Inputs use 16 px font (no iOS focus zoom) only in the narrow phone layout; above the breakpoint dropdowns and number fields keep the desktop font size, also on touch screens.
- **Legend.** Collapsed by default when the user has not chosen yet and the window is narrow; limited to 55 % of the view height with its own scroll (also on touch screens above the breakpoint, where an open legend covered the tab bar on short screens). The stored choice still wins.
- **Floating controls:** the Update preview button moves below the 3D toggle / Fit view row. Status bar and legal bar wrap; on short landscape phones the legal bar is one line.
- **Resize.** No code change needed: 3D, Layer and Sheets canvases are driven by `ResizeObserver`; the drawer is an overlay so opening it does not resize anything, rotation does and was verified (canvas CSS width equals the viewport width in both orientations).
- **Checked** (Chromium, Playwright descriptors iPhone 13, Pixel 7, iPad Mini, both orientations): `scrollWidth == innerWidth` in every state (empty, drawer expanded, loaded, each tab, compare dialog), every panel control inside the drawer's bounds, model loaded through the file input, tabs, help, compare, legend, ZIP export, legal links, no console errors.
- **Not verified:** real devices, Safari/iOS (safe-area insets, dynamic toolbar, pinch zoom on the canvases), landscape phones are cramped (the view is about 190 px high with the status and legal bars).

## User documentation page and tooltip links
- **One static page, `public/docs.html`, plus `public/docs-img/` screenshots,** deployed next to `index.html` (Vite copies `public/`). It is not part of the single-file app: the app stays one self-contained `index.html` and needs no network; the page is only opened on demand, in a new tab. Same reasoning as the legal pages (static files, no JavaScript, works from `file://` when the whole `dist/` folder is kept together). Not verified: a user who saves only `index.html` gets a dead documentation link (the same holds for the legal links).
- **Tooltips link to sections, not the other way round:** `HELP_DOC` (typed `Record<HelpKey, string>`, in `helpText.ts`) maps each key to a section id. Several keys share a section (for example the six bridge settings), so the page is organised by topic, not by setting. A test and `npm run check` fail if an anchor is missing, so a renamed section cannot leave a dead link.
- **The bubble became interactive** (it used to be `pointer-events: none`). Hover keeps it open for 250 ms and while the pointer is on it; a tap pins it (already so before); Tab from the icon jumps into the link because the shared bubble is at the end of the DOM. The link opens in a new tab so the loaded model and settings are kept. Checked in Chromium (desktop hover, iPhone 13 tap, keyboard); not on real touch devices or Safari.
- **"Documentation" link** first in the legal links (footer bar and help overlay), plus a sentence in the help overlay. The legal pages are unchanged.

## Demo model loaded by default (`src/core/demo.ts`)
- **Generated, not an asset.** `buildDemoStl()` returns binary STL bytes (about 67 KB at run time, only a couple of KB of code) from a pure, deterministic function, so there is no binary in the repository and it goes through exactly the code path of a user file (`demo-part.stl`, worker parse, weld, stats).
- **Shape and dimensions (brief values kept):** rounded-square base 70 x 70 mm, corner radius 10, 12 mm high; round tower Ø 40 up to 32 mm; chamfer to Ø 28 at the top (40 mm total); through hole Ø 12 along the axis. 96 points per contour. With the default 4 mm layers that gives 10 layers, a hole in each, an engrave line at the step (layer 2 under the narrower tower) and a one-sheet nesting; slicing takes well under a second.
- **Closed by construction.** The surface is one closed cycle of seven contours (outer bottom, outer top of the base, tower foot, tower top, chamfer top, hole top, hole bottom); consecutive contours are joined by quad strips and the last joins the first, so every edge is shared by exactly two triangles and the winding is outward everywhere. The base's rounded square is sampled along the same 96 rays as the circles (exact ray / rounded-square intersection), so every contour is star-shaped around the axis. The test checks the welded mesh (no open or non-manifold edges, each directed edge once and its reverse once, positive volume, 70 x 70 x 40 bounding box) and the sliced result.
- **When it loads:** after the worker answers and the (opt-in) session restore had its chance: only if there is still no model. A model the user loads while this runs wins. Loading is not an undo step and the status line says "Demo model loaded — choose your own STL, OBJ or 3MF file" (a warning from a failed restore stays in front of it).
- **Never stored:** the session record is not written for the demo (a flag on the load), and switching "Restore the last model" on later does not save it either. It may go into a project file ("Include the model") like any model.
- **Persisted model settings are reset for the demo** (deviation worth knowing): import unit, scale, target size, axis and rotation live in the stored settings, so a returning user with "inch" or a target size would otherwise get a distorted demo. When any of them differs from the default the demo load puts the defaults back, silently (no undo step). Other settings (material, kerf, ...) are kept, because they are the user's.

## Panel groups collapsed by default
- **Only Model starts open** (Material was open before). There is no memory of the open or closed state of groups (it was never stored), so none was added: every page load starts with only Model open, and the default is applied once when the panel is built. Opening a group during the session is not saved.
