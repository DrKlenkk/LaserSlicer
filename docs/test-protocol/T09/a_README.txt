Laser Slicer calibration sheet

Sheet size: 160 x 73.2 mm. Cut it from a scrap piece of the plywood you will use, with the same power and speed as the real job.
Files: calibration.dxf and calibration.svg (the same drawing). Layers: CUT (red) = outlines, holes and dowel holes; LABEL (green) = the numbers, engrave only.

1. Kerf test (top two rows)
  Top row: a strip with 7 square holes. Row below: 7 loose squares, one under each hole, 20 mm nominal.
  Each pair is drawn for a different kerf, in mm: 0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3. The number is engraved on the square and under the hole.
  The cut path of a square is enlarged by half that kerf and the path of its hole is reduced by half of it, the way the slicer compensates parts.
  Press each square into the hole with the same number. The pair that fits snugly (no gap, no force) shows your real kerf.
  Enter that number as Kerf in the Material group. Too loose everywhere: use a smaller value; too tight everywhere: a larger one.
  You can also measure a square and its hole with calipers: the real kerf is the label value plus (hole size - square size) / 2.

2. Dowel test (bottom strip)
  Round holes labelled 5.8, 5.9, 6, 6.1, 6.2 mm, around the current Dowel diameter of 6 mm.
  The circles are drawn 0.15 mm smaller than the label (the current Kerf setting), as the slicer does for dowel holes, so do the kerf test first
  and enter the result before downloading this sheet again. Try your rod in each hole: the label of the hole that fits is the value to enter as Dowel diameter.
  Choose a hole that lets the rod slide in by hand if you want an easy glue-up, or the tightest one for a press fit.
