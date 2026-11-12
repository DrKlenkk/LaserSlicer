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
  scale:
    "Resizes the whole model, in percent of its original size (proportions stay locked). STL and OBJ files carry no units, so millimetres are assumed: a model that loads tiny or huge usually needs a scale such as 25.4 (inches to mm) or 10 (cm to mm). The field shows the effective scale, including any change from the target size.",
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
} as const;

export type HelpKey = keyof typeof HELP;

/** Keys that cover one control rather than a single Settings field. */
export const EXTRA_HELP_KEYS: readonly HelpKey[] = ["rotate", "sheetSize", "viewToggle", "autoUpdate"];
