# Laser Slicer

Copyright (c) 2026 Louis Adrian Spencer. Free software under the GNU General Public License, version 3 only (GPL-3.0-only); see `LICENSE`. Source: https://github.com/DrKlenkk/LaserSlicer

Slices a 3D model (STL, OBJ, 3MF) into flat layers and exports laser-ready files (DXF, SVG, PNG, JPG in one ZIP) for
plywood that is stacked and glued into the shape. The tool itself is one offline HTML file (`index.html`): no server, no network, no install for users. The deployable site adds the legal pages and licence files (see Deployment).

![Layer tab: hollowed sphere with dowel holes, label and next-layer outline](docs/screenshots/layer-tab.png)
![Sheets tab with the colour legend](docs/screenshots/sheets-legend.png)
![Sheets tab zoomed in: holding bridges (magenta) on the straight edges of the parts](docs/screenshots/bridges.png)
![Stacked 3D result with the selected layer highlighted](docs/screenshots/stacked-3d.png)

Full technical documentation (features, settings, pipeline, output formats, architecture, limitations): [docs/TECHNICAL.md](docs/TECHNICAL.md).

## Build

```
npm install
npm run build      # type check + produces dist/ (index.html, about 1 MB, plus the documentation page, the legal pages and licence files)
npm run check      # verifies the dist/ file set, no external resources, the legal pages, no analytics
npm test           # unit tests (Vitest)
```

Open `dist/index.html` by double-click (`file://` works; nothing is fetched). `npm run dev` starts the Vite dev server.

## Deployment and legal pages

`dist/` is the whole site: `index.html` (the app), `docs.html` with its screenshots in `docs-img/` (the user documentation, static, no JavaScript; from `public/`), `impressum.html`, `datenschutz.html`, `lizenzen.html` (German, static, no JavaScript),
`LICENSE.txt` and `THIRD_PARTY_LICENSES.txt`. **Upload all files** to the host (Cloudflare for laserslicer.com); the legal links in the app
are relative, so the same files also work unzipped from a folder. GitHub Actions uploads the whole `dist/` as the artifact `laserslicer-site`
and, on `v*` tags, attaches `laserslicer-site.zip` (and `index.html`) to the release. The legal pages are in `public/`; `LICENSE.txt` and
`THIRD_PARTY_LICENSES.txt` are copied from `LICENSE` and `THIRD_PARTY_LICENSES.txt` (generated with `node scripts/gen-licenses.mjs`) at build time.
The app shows "© 2026 Louis Adrian Spencer", GPL-3.0, a link to the source and the links Documentation, Impressum, Datenschutz and Lizenzen in a bar at the bottom of every view (and in the help overlay). Every tooltip ends with a "Read more" link to the matching section of `docs.html` (new tab, so the loaded model is kept); the section for each tooltip is listed in `HELP_DOC` in `src/ui/helpText.ts`.

**Documentation:** open `docs.html` (next to `index.html`, or via the "Documentation" link in the app) for a full description of every setting, with screenshots.

## Use

0. On a first visit the page opens with a small **demo model** (a base, a stepped tower and a through hole), already sliced, so you can look around; it is not stored anywhere. Loading your own file replaces it.
1. Drop a model on the page (or "Choose file..."). STL and OBJ have no units, so choose the **Import unit** (mm, cm, m, inch, ...) if the model loads at the wrong size; a 3MF file sets it from its own unit. Use scale or target size for the rest.
2. Pick the slicing axis (the selected axis points up) and rotate in 90 degree steps.
3. Enter the **measured** plywood thickness (calipers; "4 mm" is often 3.7-3.9), sheet size and kerf.
4. Choose an outline mode, optionally hollowing and dowels, and look at the result in the tabs: **3D** (original model or
   stacked layers), **Layer** (one layer: cut red, next layer blue dashed, labels green, dowel holes) and **Sheets** (the nested sheets).
   The **Sheets** and **Layer** tabs have a small legend (bottom right, collapsible): the trace colours are the DXF layers
   `CUT` (red), `ENGRAVE` (blue), `LABEL` (green) and, with holding bridges, `BRIDGE` (magenta); the legend also lists the export-only `CUT_INNER` (orange), so they can be assigned to cut / engrave in LightBurn and similar software.
   The checkbox in front of each legend row shows or hides that trace in both tabs (view only: it does not re-slice and
   does not change the files; remembered in the browser).
   On a phone or small tablet (up to 820 px wide) the settings panel is a drawer: tap **Settings** in the tab bar.
   Not sure about kerf or dowel diameter? **Download calibration sheet** (Material group, works without a model) gives a small ZIP
   (DXF, SVG, README.txt) to cut from scrap: seven 20 mm squares with matching holes for kerf 0 to 0.30 mm, and five round holes around your dowel
   diameter. The pair that fits snugly shows your kerf; the hole that fits your rod gives the dowel diameter. Do the kerf test first.
   **Estimates**: with a model sliced, the summary line shows the cut length and, once you enter them in the Material group, a rough
   cutting time (**density, cut speed, engrave speed, price per sheet**; 0 = not set, that estimate is hidden) and the material cost
   (price x sheets used, a partly used sheet counts whole). Hover the summary for the full list (cut and engrave length, glued volume, weight,
   time, cost); the same list is in the Export section and in the ZIP's README.txt. The time ignores travel moves and acceleration, so a real job is longer; the list gives the **travel between cuts** (rapid moves in file order, in mm) separately.
   Changing these four values does not re-slice.
5. Optional **Holding bridges** (panel group of that name): short uncut tabs that keep each part attached to the sheet until you
   break it out, so it cannot fall or tilt mid-cut. Set bridges per outline (1-8), width, minimum outline length, optionally inner holes
   and a maximum spacing. They sit on straight edges, evenly spaced; the gaps are on the separate `BRIDGE` layer. In LightBurn give
   `BRIDGE` a low power / fast speed so it only scores the plywood (the web stays and snaps), or leave `BRIDGE` out of the export
   for plain uncut tabs. Width is the material left after the kerf (the gap in the path is width + kerf). The screenshot above uses
   a 1.5 mm width for visibility; the default is 0.5 mm.
6. **Layer range** (Export section): to recut one broken or lost layer, enter the first and last layer (same numbers as the Layer tab, layer 0 = bottom; empty = no limit, "All layers" resets). Only those layers are nested and exported, so the Sheets tab, the summary line and the estimates show exactly what will be cut, and the Sheets tab header and the ZIP's README.txt say that only layers X to Y are included. Labels and engrave lines stay those of the full model, so the recut layers fit the rest of the stack. A range outside the model is clamped (the note says so); files per layer follow the range too. Changing it only re-runs the nesting.
7. Export: pick formats (DXF, SVG, PNG, JPG and **Assembly guide (HTML)**: one `assembly.html` in the ZIP, an A4 gluing guide with a block per layer: part numbers, the sheet of each part, and a drawing of the layer in its model position with the layer below dashed, all at one scale; it needs no network or script and prints in black and white; it follows the layer range), the layers that go into the files (CUT, ENGRAVE, LABEL, BRIDGE and, off by default, a SHEET border; applies
   to DXF, SVG, PNG and JPG, independent of the legend checkboxes) and "Download all (ZIP)". Warnings are in the status bar; click one to jump to its layer.

**Auto-update preview** (checkbox in the tab bar, on by default) re-slices after every change. For large models turn it off:
changes are then collected, an **Update preview** button appears at the top right of every tab (or press U), and slicing
only runs when you click it. A newly loaded model is shown in 3D but not sliced until you update, and "Download all (ZIP)"
updates first, so the files always match the settings you see. The checkbox is remembered in the browser; it is not part of
the project file.

Press `?` in the app for the shortcuts: 1/2/3 tabs, arrows / PgUp / PgDn / Home / End step layers, M toggles model and stacked
result, F frames the model, U updates the preview (auto-update off), Ctrl+Z / Ctrl+Y (Cmd on a Mac; also Ctrl+Shift+Z) undo and redo settings changes (also the two buttons next to "Auto-update preview"; not while you type in a field, where the browser's own undo works). Loading a model is not an undo step, loading a project file is one.
**Material presets**: the Preset list in the Material group applies thickness, sheet size, kerf, spacing, margin, density, speeds and price at once (one undo step). "Save..." stores your current values under a name (an existing name is replaced after a confirm), "Delete" removes one of yours. Presets are kept in the browser, not in the project file. The three "starting point" presets are only guesses for plywood: measure your sheets and run the calibration sheet. **Compare materials…** (Material group, needs a model) answers "which plywood should I buy?": the model is sliced with your current settings and with every preset, one after another in the background, and a table shows thickness, layers, parts, sheets, sheet use, cut length, rough time (with speeds set), weight, cost (with a price set) and the number of warnings; the best values are marked and "Use" applies that row's preset (one undo step). Everything the preset does not hold, and the outline mode, come from your current settings; a layer range is ignored; your preview is not touched and "Cancel" stops the comparison. "Project" in the panel saves and loads the settings as a `.json` file; tick "Include the model in the project file" to embed the model too (the file grows by about a third of the model size), and loading it brings back model and settings together.
The last settings are kept in this browser. The last model is only kept if you switch on "Restore the last model when the page opens" (off by default; models over 50 MB are not remembered); switching it off deletes it.

### Modes

- **Oversize** (default): each part covers the model everywhere inside its layer (union of the sample planes); glue up, then sand down to shape.
- **Mid-plane**: the section at the middle of the layer; closest on average.
- **Undersize**: the part never sticks out of the model (intersection of the sample planes).

Hollowing removes a cavity from inner layers, keeping a wall of the set width at every glue joint and solid cap layers at both ends.
Dowels put holes at identical positions in every layer of a run so a rod aligns the stack.

## Stacking guide

1. Cut every part **face-up** and never flip a part.
2. Stack **bottom-up**: L0 first. Each part is labelled (e.g. `L12`, `L12-b` for a second island in layer 12).
3. Glue each part **exactly on the engraved outline** that the part below carries (the outline of the next layer).
4. With dowels, thread a dowel through the holes while gluing.
5. Oversize mode: sand the glued block to the final shape.

## Export notes

- **DXF** (R12, mm, Y up) is the file to cut with: layers `CUT` (red, outlines and dowel `CIRCLE`s), `ENGRAVE` (blue), `LABEL` (green, polylines, no text entities), `BRIDGE` (magenta, holding-bridge segments, only when bridges are on), `CUT_INNER` (orange, only with "Inner cuts on own layer") and `SHEET` (grey border, off by default). Choose which layers go into the files under "Layers in the files". In DXF and SVG each sheet is written in a short cutting order: engraving and labels first (so a part is marked before it can move), then all holes and dowel circles of the sheet, then all outlines; inside each of these groups the entities follow a greedy nearest-neighbour path from the sheet corner, closed rings start at the vertex nearest the previous end and open polylines may run in reverse (geometry unchanged), and the DXF and SVG list the same order. The travel between cuts (about half of the unordered figure on a multi-part sheet) is in the estimates and the ZIP README. No outline is ever written before every hole of its sheet; "Inner cuts on own layer" (off by default) moves them to `CUT_INNER`, so you can cut that layer first and `CUT` last and the part cannot drop before its holes are cut. PNG/JPG ignore it.
- **SVG**: 1 unit = 1 mm, same layers as `<g>` groups. **PNG/JPG**: rendered at the chosen DPI with the DPI stored in the file; for engraving or reference, not for cutting without tracing.
- Per sheet (default) or per layer. The ZIP also has a `README.txt` with the settings, stacking order and warnings.
- Bridged outlines are open polylines on `CUT` plus one short open polyline per gap on `BRIDGE`. PNG/JPG: outline style draws the gaps magenta (or leaves them open without BRIDGE); filled style always shows the whole part.
- The calibration sheet uses only `CUT` and `LABEL`; its labels use a decimal point glyph added to the font.
- Kerf is applied to the cut outlines only (holes shrink, outlines grow); engrave lines are never offset.

## Limitations

- Nesting packs each part's minimum-area **rectangle** (MaxRects); round parts waste sheet area. A part larger than the sheet is reported and left out.
- The phone and tablet layout was tested with emulated devices in Chromium only, not on real devices or with real touch gestures.
- Developed and tested in **Chromium** only (headless Playwright). Firefox and Edge, and LightBurn / LibreCAD import of the DXF, are not tested.
- The Hershey-style font is a hand-redrawn reconstruction, see `DECISIONS.md`. clipper2-js bugs and other deviations from `docs/PLAN.md` are listed there too.
- A hollow cavity is fully enclosed (no vent hole). Dowels need room: thin hollow walls usually leave no run of two layers.

## Licence

GPL-3.0-only, see `LICENSE`. Third-party licences: `THIRD_PARTY_LICENSES.txt` (also embedded in `dist/index.html`).
