declare module "polylabel" {
  /** polygon = [outer, ...holes] rings of [x, y]; the result also carries `distance` to the nearest edge. */
  export default function polylabel(polygon: number[][][], precision?: number, debug?: boolean): number[] & { distance: number };
}
