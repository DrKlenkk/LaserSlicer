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
  engrave: Vec2[][]; // open or closed polylines: next-layer outline, label strokes
  holes: { c: Vec2; d: number }[]; // dowel holes (cut)
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
  // Slicing
  mode: "oversize" | "midplane" | "undersize";
  samplesPerLayer: number;
  roundHeightToLayers: boolean;
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
  // Export
  formats: ("dxf" | "svg" | "png" | "jpg")[];
  dpi: number;
  rasterStyle: "filled" | "outline";
  perLayerFiles: boolean;
};
