// AUTHORED PER-BEAT CAMERA (v0.7 T4). A step's optional `arrive` — the composed vantage the camera eases (or,
// under reduced motion, cuts) to when the step's actions land. Delivered through the EXISTING trail-frame channel
// on intent 'tour-arrival' (no new camera owner — the T0 arbitration guard; arch-lead ruling). GRAMMAR ONLY,
// never world coordinates: Scene resolves each shot to a Framing at consume time from LIVE scene data (the
// subject's live head, the sensing-lens scenario constants, the stage bounds), reusing camera.ts helpers — so an
// authored shot can never rot on a re-decode/re-certification (Tier-1 decoded-data honesty). `arrive` omitted =
// today's behavior byte-for-byte: a play beat frames the trajectory-so-far; a static (scrub/select) beat holds
// the current frame. The kinds are the shot list ruled by the design consult (miniwave §4.2 → T4):
//   • 'head'        — compose-around-head close-up (camera.finaleFraming): 'medium' mid-journey (f1 b1 / f2a b4),
//                     'close' the terminal finale framing (f1 b2 — byte-identical to the natural-end rest close-up).
//   • 'conjunction' — fit the sensor + the subject's live head [+ the occluder sphere when `occluder`]: the
//                     sensing-lens relationship shots that make the FOV gap / the crossing / the eclipse legible
//                     (f2a b1/b2, and b3 with the occluder). Resolves to null on a non-sensing run (falls through
//                     to the prefix-fit default).
//   • 'stage'       — the whole-instrument stage fit (the load / bookend vantage): the sensing scope (f2a b5).
export type TourShot =
  | { kind: 'head'; distance: 'medium' | 'close' }
  | { kind: 'conjunction'; occluder?: boolean }
  | { kind: 'stage' }

export interface TourStep {
  tick?: number                 // scrub here (paused) before the step body
  play?: { to: number; speed: number }  // or: play from current tick to this tick
  select?: {
    // undefined = leave current selection unchanged; null = explicitly clear.
    entity?: string | null
    // undefined = leave current event/deep-link unchanged; null = explicitly clear.
    event?: number | null
  }
  focus?: boolean               // fire the camera focus channel at the selection
  arrive?: TourShot             // authored per-beat camera arrive (T4); omitted = today's behavior
  caption: string
  holdMs: number                // dwell after actions complete (normal motion)
}
export interface Tour { id: string; runId: string; title: string; steps: TourStep[] }
