import type { EntityV2 } from '../decode/payloads'

// THE app-wide NED→three basis (basis A): NED (n,e,d) → three [x=east, y=up=−down, z=north] = [e, −d, n].
// The ONE conversion every WORLD-FRAME surface that overlays the decoded flight shares — the flight trail
// (entityPosition below is the allocation-free, mutating twin of this exact mapping), the interactive drone /
// cone (Scene.Entities), the tour-camera anchors (Scene's SENSOR_THREE / OCCLUDER_THREE), AND the f2a sensing
// apparatus (sensingStageView). Exported so those sites cannot each re-derive a private, drift-prone transform:
// the basis-drift defect was exactly that failure — the sensing apparatus had drifted to a MIRRORED [n,−d,e] basis (an x↔z
// reflection), so its FOV cone opened +x perpendicular to the +z flight it was judging, and a drone dead-centre
// of the drawn cone read as "outside FOV". Any surface that draws the flight and the apparatus in one space MUST
// import this. (The positionless query stage, e0, is exempt: it overlays no flight, so it carries its own
// self-contained basis — see queryStageView's t3 boundary note.)
export const nedToThree = (p: readonly [number, number, number]): [number, number, number] => [p[1]!, -p[2]!, p[0]!]

export function entityPosition(out: [number, number, number], e: EntityV2, index: number): void {
  // The hot-path (frame-rate) twin of nedToThree above: the SAME [e, −d, n] mapping, written in place to stay
  // allocation-free. Keep the two in lockstep — a change to the basis must move both.
  if (e.pos.length === 3) { out[0] = e.pos[1]!; out[1] = -e.pos[2]!; out[2] = e.pos[0]! }
  else { out[0] = 2 * index; out[1] = 0; out[2] = 0 }
}
export function lerp3(out: [number, number, number], a: readonly number[], b: readonly number[], t: number): void {
  for (let i = 0; i < 3; i++) out[i] = a[i]! + (b[i]! - a[i]!) * t
}
