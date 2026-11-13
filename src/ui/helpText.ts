// All tooltip texts of the parameter panel, keyed by setting name (or by a control name where one control
// covers several settings). Edit the wording here; ui/tooltip.ts shows it. Lengths in mm.
//
// Keys that are Settings fields use the field name. Extra keys (no single Settings field) are listed in
// EXTRA_HELP_KEYS; test/helpText.test.ts checks that every key is used by the UI and that no text is empty.

export const HELP = {
  // ----- Model -----
  axis:
    "Layers are cut perpendicular to this axis, and the selected axis points up in the finished stack. Pick the direction that gives the best result: usually the model's natural 'up', or the way that keeps overhangs short, because every layer is a flat slice. +Z and -Z give the same layers in opposite order (the bottom layer becomes the top).",
  rotate:
    "Turns the model in 90 degree steps about the X, Y or Z axis, applied after the slicing axis is chosen. Each click adds one quarter turn; 'Reset' undoes all of them. Use it when the axis buttons alone do not give the orientation you want, for example to lay a model on its side.",
  importUnit:
    "The unit the model was drawn in. STL and OBJ files carry no units, so choose it yourself: the model is multiplied by the matching number of millimetres (inch 25.4, cm 10, m 1000, foot 304.8, micron 0.001) before the scale is applied. A model that loads tiny or huge is usually in the wrong unit. 3MF files declare their unit, and loading one sets this field for you (the status bar says so). The Scale field stays at 100 % for a model that is only unit-converted; the size readout shows the result in mm.",
  scale:
    "Resizes the whole model, in percent of its original size (proportions stay locked). It is applied on top of the Import unit (so a model in inches stays at 100 % when the unit is set to inch). The field shows the effective scale, including any change from the target size.",
  targetSize:
    "Scales the model so that its size along the chosen axis (X, Y or Z, after rotation) is exactly this many millimetres. The other dimensions follow so the proportions stay the same. Handy when you know the finished height or width you want. Typing a scale in percent instead cancels the target size.",

  // ----- Material -----
  thickness:
    "The thickness of one sheet of your material, which is also the height of one layer. Measure it with calipers: plywood sold as '4 mm' is often 3.7 to 3.9 mm, and the error adds up over many layers (50 layers of 3.8 mm are 10 mm shorter than 50 of 4.0 mm). The number of layers is the model height divided by this value, rounded up.",
  sheetSize:
    "Width and height of the material sheet (or of your laser bed if smaller), in mm. Parts are arranged on as many sheets of this size as needed, and a part bigger than the usable area (sheet minus margins) is reported and left out. Width and height are just the two directions in the exported file; swapping them does not change what is cut.",
  kerf:
    "The width of the material the laser burns away, typically 0.1 to 0.3 mm for a CO2 laser on plywood. The cut outlines are enlarged by half the kerf on each side (and holes shrink by it) so the finished parts come out the size the model has. Set it to 0 if your cutting software already compensates. A wrong value makes the layers slightly too big or too small, and the error is visible in a tall stack. Engraved lines are never offset.",
  partSpacing:
    "The minimum gap between neighbouring parts on a sheet. Too small and the heat from one cut can scorch or burn through the neighbouring part; too large wastes material. 2 to 5 mm is typical for plywood. Kerf is applied before nesting, so the gap is measured between the final cut lines.",
  sheetMargin:
    "A border around the sheet edge where no parts are placed. It keeps cuts away from warped or damaged edges and from the clamps or honeycomb limits of your laser bed. Typical value 3 to 10 mm. Larger margins reduce the usable area, so large parts may no longer fit.",

  // ----- Slicing -----
  mode:
    "How the outline of each layer is taken from the model, since the model's shape changes within the thickness of one layer. Oversize (default): every part covers the model everywhere inside its layer, so you glue the stack and sand it down to the shape. Mid-plane: the section at the middle of the layer, which is closest on average but leaves small steps both ways. Undersize: the part never sticks out of the model, so nothing needs sanding, but the result is slightly smaller and may lose thin details.",
  samplesPerLayer:
    "How many horizontal cross sections are looked at within each layer's thickness. In Oversize mode their union is used, in Undersize mode their intersection, so more samples find sloped or curved details that a single section would miss. Samples are spread evenly from the bottom to the top of the layer. 3 is a good default; use 5 or more for steep curves, 1 equals Mid-plane. More samples slow the slicing slightly. It has no effect in Mid-plane mode.",
  roundHeightToLayers:
    "Scales the whole model slightly (in all directions, so the proportions are kept) so that its height is an exact whole number of layers. Without it the top layer is only partly filled by the model and the stack ends up a bit taller than the model. Turn it on if the final height matters more than the exact size; the scale change is at most half a layer in height.",
  smoothRadius:
    "Cleans up ragged outlines (small steps, notches, wobbly inside corners) from rough or noisy meshes, with a rounding radius in mm. 0 = off; 0.5 to 1 is typical, never more than a fifth of your thinnest wall. It follows the outline mode, so the mode's promise holds: Oversize only adds material (notches, steps and inside corners are filled and rounded, outside corners stay sharp), Undersize only removes material (spikes, bumps and outside corners are shaved and rounded, inside corners stay), Mid-plane does both (sharp corners move by up to half the radius). Anything narrower than twice the radius is lost: slots and gaps in Oversize, thin walls, islands and spikes in the other modes. It does not turn the flat facets of a coarse arc into a curve; export a finer mesh for that.",
  simplifyTol:
    "Removes nearly-straight points from the outlines. No removed point is further from the outline than this many mm. Meshes often produce thousands of tiny segments that make DXF files large and make the laser stutter along smooth curves. Typical 0.02 to 0.1; 0 turns it off. In Oversize mode simplification never cuts into the model, in Undersize mode it never goes outside it, so the mode's guarantee stays true. Higher values give faceted curves.",
  minPartArea:
    "Pieces smaller than this area (in square mm) are deleted, and so are holes smaller than this. They are usually mesh noise or specks too small to cut or glue, and each removal is reported in the warnings. Typical 2 to 10. Set to 0 to keep everything. Raise it if you see tiny islands in a layer; lower it if real small details disappear.",
  minFeature:
    "Removes thin parts of an outline: any neck, spike or sliver narrower than this many mm vanishes, while corners and larger shapes keep their size and sharp corners. Use it for details too fragile to cut or glue (hair-thin tips, thin walls that would burn away). 0 turns it off. A typical value is 1 to 2 mm, or about the width of the thinnest piece you can cut and glue reliably. It permanently loses detail, and unlike 'Min part area' it affects thin parts of big shapes too.",

  // ----- Hollowing -----
  hollowEnabled:
    "Cuts a cavity out of the inner layers to save material, weight and cutting time, keeping a wall of solid material at the model's outline and at every glue joint, and solid cap layers at the bottom and top. Layers that are too narrow stay solid. The cavity is completely enclosed with no vent hole, so trapped air and glue fumes cannot escape; poke one if that matters. Good for big shapes like domes or spheres, pointless for thin ones.",
  hollowWall:
    "The thickness of the solid wall left around the cavity, in mm, measured inside the outlines of the layer below, the layer itself and the layer above. This keeps a ring at least this wide at every glue joint and leaves material to sand away in Oversize mode. Thick walls are stronger and leave more glue area but save less material; if the wall is too thick for a layer, that layer stays solid. If no layer has room, a notice is shown.",
  solidCapLayers:
    "How many layers at the bottom and at the top of the stack stay completely solid. The first and last layer are always solid. Caps give the model a flat base, a closed top and glue surface for the first hollow layer. 1 is the minimum useful value; use 2 or 3 if you want a stronger floor and lid or plan to drill or sand the ends.",

  // ----- Gluing aids -----
  engraveNextOutline:
    "Engraves a light line on top of each part showing where the next layer up goes (the outline of the next layer). You glue each part exactly on that line, which keeps the stack aligned. Strongly recommended. The line is engraved, not cut, so run the engrave layer at low power. The top layer has no next layer, so it has none.",
  labels:
    "Engraves the layer number (like L12, or L12-b for a second piece of the same layer) on each part so you can put the pieces back in order. The label is placed in the area the next layer will cover, so it is hidden inside the glued stack. Turn it off if you prefer clean parts, but you must then keep the order yourself.",
  labelHeight:
    "Height of the label letters in mm. If the letters do not fit in the joint area, they are shrunk step by step, down to 3 mm, and if they still do not fit they are placed anywhere on the part. Typical 5 to 8. Smaller than 3 mm is hard to read once engraved on plywood.",
  dowels:
    "Adds round holes at identical positions in a run of consecutive layers so you can thread a dowel (wooden rod) through the stack while gluing. This keeps the layers from sliding on each other. Holes stay at least 3 mm away from every outline and cavity; a run ends where the layers get too narrow, and a new run starts with its own holes. Runs of a single layer get no holes. Check the warnings if none were placed.",
  dowelDiameter:
    "The diameter of the dowel hole in mm: use the diameter of your actual rod or bamboo skewer. The hole is made smaller by the kerf in the cut path, so after burning it comes out at this size. Make it a hair larger (0.1 to 0.2 mm) for a loose fit that is easier to glue. Larger holes need more room, so fewer layers get holes.",
  dowelCount:
    "How many dowel holes per run of layers. They are placed as far apart from each other as possible. Use 2 to lock rotation; 1 only keeps position and lets the layers swivel. If the layers have room for fewer holes, you get fewer and a notice. More holes make assembling slower.",

  // ----- Holding bridges -----
  bridgesEnabled:
    "Leaves a few short uncut bridges (tabs) on every long outline so a cut part stays attached to the sheet and does not fall, tilt or get blown into the beam while the rest is still being cut; you break it out by hand afterwards and sand the small stub. The gap is a separate DXF layer, BRIDGE (magenta): run it at low power or high speed so it only scores the plywood and the web stays, or leave BRIDGE out of the export to get plain uncut tabs. Bridges go on straight edges where possible, spaced evenly along the outline. Off by default.",
  bridgeCount:
    "How many bridges each outline gets, 1 to 8, spread evenly along the outline (2 puts them on opposite sides, 4 on each side of a square) and moved onto straight edges away from corners. 2 or 3 hold a small part; use 4 or more for large or heavy parts that would tilt. An outline too short for that many bridges gets fewer, with a notice.",
  bridgeWidth:
    "How much material each bridge leaves, in mm, measured after the laser's kerf. The gap in the cut path is this width plus the kerf (the beam burns half a kerf past each end of the path), so the web that remains is exactly this wide. 0.5 mm is typical for 3 to 4 mm plywood: strong enough to hold the part, easy to snap. Wider bridges hold better but need more sanding; with BRIDGE scored instead of left out, you can use more.",
  bridgeMinLength:
    "Outlines with a perimeter shorter than this (mm) get no bridges, so small holes, dowel-sized cut-outs and tiny parts are not weakened or left hanging. Dowel holes never get bridges anyway. The perimeter is measured on the kerf-compensated cut line. 40 mm is about a 10 mm square or a 13 mm circle; raise it if small parts should be cut free.",
  bridgeHoles:
    "Also puts bridges on the inner outlines of a part (the scrap inside holes, such as hollow cavities), which keeps that scrap from dropping out and jamming or getting burned. Off by default because the scrap is waste anyway and the bridges then have to be broken out. Dowel holes never get bridges, and holes shorter than the minimum outline length are skipped.",
  bridgeMaxSpacing:
    "Optional (0 = off). If an outline is long, it gets more bridges than the count above so that the nominal spacing along the outline is at most this many mm (bridges may slide up to a quarter of the spacing to reach a straight edge). Use it so large plates do not end up with a few widely spaced bridges, for example 150 mm. Up to 64 bridges per outline.",

  // ----- Export -----
  formats:
    "Which files go in the ZIP. DXF is the file to cut with (mm, red CUT, blue ENGRAVE, green LABEL layers) and works in most laser software. SVG is the same drawing as 1 unit = 1 mm. PNG and JPG are pictures for engraving, previewing or tracing, not for cutting directly. You can pick several.",
  perLayerFiles:
    "One file per sheet (default) holds all parts nested together on a sheet of the size you set, which is what you cut, with the fewest sheets. One file per layer gives each layer its own file with only that layer's parts, not nested to the sheet; this suits cutting one layer at a time or making a layer's parts easy to find, but it uses material less efficiently.",
  dpi:
    "Resolution of PNG and JPG images, in dots per inch. The DPI is stored in the file so it opens at true size (1 pixel is 25.4 / DPI mm). 254 gives exactly 10 pixels per mm; 300 is a good default; 600 or more makes sharper edges and much bigger files. Very large sheets are refused above a size limit, and the message suggests a lower value.",
  rasterStyle:
    "Filled draws each part as a solid black shape with holes white, the form needed to engrave or raster-cut with some software. Outline draws only the cut lines as 1 pixel black lines, useful as a tracing reference or overlay. Either way, images are not suitable for cutting without tracing.",
  rasterEngrave:
    "Also draws the engraved next-layer outline and the labels, in grey, in PNG and JPG images, so they appear on the picture. Turn it off if you want only the black part shapes. It does not change the DXF or SVG, which always contain these lines on their own layers.",

  // ----- Views -----
  autoUpdate:
    "When on (default), every change to a setting re-slices the model after a short pause and the preview follows. Turn it off for large or slow models: changes are then collected, the preview shows an 'Update preview' button at the top right, and slicing only runs when you click it (or press U). Downloading the ZIP always updates first, so the files match the settings you see. Loading a model still shows it in 3D, but slices only on Update. Turning auto-update back on updates at once if anything changed.",
  viewToggle:
    "Switches the 3D view between the original model (what you loaded, in the size and orientation you set) and the stacked result, which shows the cut layers on top of each other as they will look glued. Use the stacked view to check steps, thin walls and hollowing before you export. The stacked view is available once slicing has finished. Shortcut: M.",
  viewTraces:
    "The checkbox in front of each legend row shows or hides that trace in the Sheets and Layer tabs, for example to look at the cut lines without the blue glue lines. The choice is shared by both tabs, remembered in this browser and only changes what you see: it does not re-slice and it does not change the export. What goes into the files is chosen separately under Export, 'Layers in the files'.",
  exportLayers:
    "Chooses which traces are written into the exported DXF, SVG, PNG and JPG files. CUT = part outlines and dowel holes, ENGRAVE = the next-layer outline for gluing, LABEL = the layer text, BRIDGE = the gaps of the holding bridges (without it the gaps stay uncut tabs), SHEET border = a frame around the sheet (off by default; DXF layer SHEET, SVG group SHEET, grey frame in images). Use it, for example, to make a file with the cut lines only and a second one with the engraving only. Without CUT the files do not cut the parts out. These boxes are independent of the legend checkboxes in the views, which only change what you see. At least one layer must stay selected.",
  exportInnerLayer:
    "Puts the inner cuts (holes, hollowing cavities and dowel holes) on their own layer CUT_INNER (orange) in DXF and SVG, so only the outer outlines stay on CUT. In LightBurn and similar software you can then cut CUT_INNER first and CUT last, so a part cannot drop or shift before its holes are cut. Inner cuts are always written before the outlines in the files, with or without this option. PNG and JPG ignore it. Bridge gaps on inner rings stay on BRIDGE. It does not re-slice.",
  density:
    "Density of your material in g/cm3, used only for the weight estimate (weight = glued volume x density). Plywood is about 0.6 to 0.7, birch plywood about 0.65 to 0.7, MDF about 0.75. 0 = not set: the weight is then not shown. The volume is the sum of the part areas (before kerf, holes and hollow cavities left out) times the thickness; dowel holes and the rods themselves are ignored. It does not re-slice.",
  cutSpeed:
    "Your laser's cutting speed in mm/s for this material, used only for the rough time estimate (cut length / speed). 0 = not set. The estimate ignores travel moves between parts, acceleration, corners, passes and the speed of the BRIDGE layer, so a real job takes longer; treat it as a lower bound, not a quote. Time shows as soon as a cut or engrave speed is set. It does not re-slice.",
  engraveSpeed:
    "Your laser's engraving speed in mm/s, used only for the rough time estimate (engrave length / speed, engrave lines and label strokes together). 0 = not set: engraving is then left out of the time. The same limits as for the cut speed apply (no travel moves, no acceleration). It does not re-slice.",
  pricePerSheet:
    "What one sheet of your material costs, in any currency (no symbol is shown). The material cost is this price times the number of sheets the nesting uses, and a partly used sheet counts as a whole one. 0 = not set: the cost is then not shown. It does not re-slice.",
  projectModel:
    "Also stores the model in the project file: the original STL, OBJ or 3MF file, copied byte for byte (base64 text, so the project file becomes about a third bigger than the model) together with its name. Loading such a file brings back the model and all settings in one step, including the import unit saved with them. Leave it off for a small settings-only file that works with any model. Needs a loaded model. A damaged model in a project file is reported and nothing is changed.",
  restoreSession:
    "When on (default), the last model you loaded is kept in this browser (IndexedDB, models up to 50 MB) and loaded again when the page opens, together with the settings the browser already remembers, so a reload brings you back to where you were. Turning it off also deletes the stored copy. If the browser blocks or fills its storage, nothing is restored and the app works as usual. The slicing result is not stored, it is computed again.",
  calibration:
    "Downloads a small ZIP (DXF, SVG and a README) to cut from a scrap of your plywood, about 160 x 80 mm; it works without a model. Kerf test: seven loose 20 mm squares and matching square holes, each pair drawn for a kerf from 0 to 0.30 mm and labelled. The pair that fits snugly shows your kerf: enter it in the Kerf field. Dowel test: five round holes around the current Dowel diameter (plus and minus 0.2 mm), labelled with the value to enter once your rod fits. The dowel holes are drawn smaller by the current Kerf, so do the kerf test first. Use the same laser settings as for the real job.",
  presets:
    "Saves the Material group (thickness, sheet size, kerf, part spacing, sheet margin, density, cut and engrave speed, price per sheet) under a name and brings it back from this list; picking one changes all of those fields at once and is a single undo step (Ctrl+Z). 'Save...' asks for a name; an existing name is replaced after you confirm. 'Delete' removes the selected preset of yours. Presets live in this browser only, not in the project file. 'Starting points' are only guesses for plywood: kerf, thickness and speeds depend on your laser and your sheets, so measure and run the calibration sheet. They leave speeds and price alone, and cannot be deleted. The list shows the preset that matches the current values.",
} as const;

export type HelpKey = keyof typeof HELP;

/** Keys that cover one control rather than a single Settings field. */
export const EXTRA_HELP_KEYS: readonly HelpKey[] = ["rotate", "sheetSize", "viewToggle", "autoUpdate", "viewTraces", "exportLayers", "calibration", "projectModel", "restoreSession", "presets"];
