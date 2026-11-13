// Core types. All lengths in mm, 2D coordinates in the sheet plane.

export type Vec2 = [number, number];
export type Ring = Vec2[]; // closed, last point != first point
export type Shape = { outer: Ring; holes: Ring[] }; // outer CCW, holes CW

export type Box3 = { min: [number, number, number]; max: [number, number, number] };

export type Mesh = { positions: Float32Array; indices: Uint32Array; bbox: Box3 };

export type MeshStats = {
  triangles: number;
  vertices: number;
  bbox: Box3;
  /** edges used by exactly one triangle */
  openEdges: number;
  /** edges used by more than two triangles */
  nonManifoldEdges: number;
  /** triangles dropped because welding collapsed them (zero area) */
  degenerateRemoved: number;
};

export type Layer = {
  index: number; // 0 = bottom
  z0: number;
  z1: number; // bottom and top face heights
  shapes: Shape[]; // after mode, cleanup, hollowing (before kerf)
};

export type Part = {
  id: string; // "L012" or "L012-b" for a second island
  layer: number;
  cut: Shape; // kerf-compensated cut outline
  /** Engrave polylines (next-layer outline). A polyline whose first and last point coincide is closed. */
  engrave: Vec2[][];
  /** Label stroke polylines (DXF layer LABEL), same closing convention. Filled from M6. */
  label: Vec2[][];
  holes: { c: Vec2; d: number }[]; // dowel holes (cut)
  /**
   * Holding bridges (stage `bridges`, after kerf). Absent or empty = no bridges. All points are in the same coordinates as
   * `cut`, so applyPlacement transforms them like everything else. `cut` itself stays the closed shape (hit-testing, area,
   * fills); the writers draw the rings listed here as open polylines with gaps instead.
   */
  bridges?: BridgedRing[];
};

/**
 * One cut ring that carries bridges: `cut` are the open polylines of the ring without the gaps (what the laser cuts through),
 * `gaps` the gap polylines (what the BRIDGE layer holds). `ring` is 0 for the outer ring, 1.. for `cut.holes[ring - 1]`.
 * Walking `gaps[0]`, `cut[0]`, `gaps[1]`, `cut[1]`, ... in ring order closes the ring.
 */
export type BridgedRing = { ring: number; cut: Vec2[][]; gaps: Vec2[][] };

/** One cutting sheet with the parts nested on it. */
export type Sheet = {
  index: number; // 0-based
  w: number;
  h: number;
  partIds: string[];
  /** summed part areas (outer minus holes, mm2) */
  usedArea: number;
  /** usedArea / (w * h) in percent */
  usePct: number;
};

export type Placement = { partId: string; sheet: number; x: number; y: number; angleDeg: number };

export type Warning = { level: "info" | "warn" | "error"; layer?: number; partId?: string; message: string };

export type Axis = "+X" | "-X" | "+Y" | "-Y" | "+Z" | "-Z";
export type Dim = "x" | "y" | "z";

export type Settings = {
  // Model
  axis: Axis;
  /** number of 90 degree turns about X, Y, Z (applied in that order after axis alignment) */
  rotationSteps: [number, number, number];
  scale: number;
  /** if set, overrides `scale`: scale so that the oriented extent along `dim` equals `mm` */
  targetSize: { dim: Dim; mm: number } | null;
  // Material
  thickness: number;
  sheetW: number;
  sheetH: number;
  kerf: number;
  partSpacing: number;
  sheetMargin: number;
  // Estimates (do not affect geometry; 0 = not set, the estimate that needs it is not shown)
  /** material density in g/cm3 (plywood about 0.6 to 0.7) */
  density: number;
  /** cutting speed in mm/s */
  cutSpeed: number;
  /** engraving speed in mm/s */
  engraveSpeed: number;
  /** price of one sheet (any currency, no symbol) */
  pricePerSheet: number;
  // Slicing
  mode: "oversize" | "midplane" | "undersize";
  samplesPerLayer: number;
  roundHeightToLayers: boolean;
  /** smoothing radius in mm (0 = off): closing in oversize, opening in undersize, both in mid-plane */
  smoothRadius: number;
  simplifyTol: number;
  minPartArea: number;
  minFeature: number;
  // Hollowing
  hollowEnabled: boolean;
  hollowWall: number;
  solidCapLayers: number;
  // Registration
  engraveNextOutline: boolean;
  labels: boolean;
  labelHeight: number;
  dowels: boolean;
  dowelDiameter: number;
  dowelCount: number;
  // Holding bridges (tabs): keep each part attached to the sheet until it is broken out
  bridgesEnabled: boolean;
  /** bridges per outline (1..8) */
  bridgeCount: number;
  /** material left between the cut ends, measured after the beam's kerf (mm); the gap in the path is this plus the kerf */
  bridgeWidth: number;
  /** outlines with a shorter perimeter get no bridges (mm) */
  bridgeMinLength: number;
  /** also bridge the inner holes (the scrap inside); dowel holes never get bridges */
  bridgeHoles: boolean;
  /** if > 0, long outlines get more bridges so that no gap between neighbours exceeds this arc length (mm); 0 = off */
  bridgeMaxSpacing: number;
  // Export
  formats: ("dxf" | "svg" | "png" | "jpg")[];
  dpi: number;
  rasterStyle: "filled" | "outline";
  /** draw engrave lines and labels (grey) in raster images */
  rasterEngrave: boolean;
  /** layers written into the exported files (view-only toggles in the legend are separate, UI prefs) */
  exportCut: boolean;
  exportEngrave: boolean;
  exportLabel: boolean;
  /** the bridge gaps (DXF layer BRIDGE); left out, the gaps stay uncut material */
  exportBridge: boolean;
  /** sheet border (DXF layer SHEET, SVG group SHEET, grey frame in images), off by default */
  exportSheet: boolean;
  /** DXF and SVG only: inner rings (holes, cavities) and dowel circles on their own layer CUT_INNER, so only outer outlines stay on CUT. Export-only. */
  exportInnerLayer: boolean;
  perLayerFiles: boolean;
};
