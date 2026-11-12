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
