// AUTHORED PER-BEAT CAMERA (v0.7). A step's optional `arrive` — the composed vantage the camera eases (or,
// under reduced motion, cuts) to when the step's actions land. Delivered through the EXISTING trail-frame channel
// on intent 'tour-arrival' (no new camera owner — the split-arbitration guard, a design ruling). GRAMMAR ONLY,
// never world coordinates: Scene resolves each shot to a Framing at consume time from LIVE scene data (the
// subject's live head, the sensing-lens scenario constants, the stage bounds), reusing camera.ts helpers — so an
// authored shot can never rot on a re-decode/re-certification (Tier-1 decoded-data honesty). `arrive` omitted =
// today's behavior byte-for-byte: a play beat frames the trajectory-so-far; a static (scrub/select) beat holds
// the current frame. The kinds are the shot list ruled by the design consult:
//   • 'head'        — compose-around-head close-up (camera.finaleFraming): 'medium' mid-journey (f1 b1 / f2a b4),
//                     'close' the terminal finale framing (f1 b2 — byte-identical to the natural-end rest close-up).
//   • 'conjunction' — fit the sensor + the subject's live head [+ the occluder sphere when `occluder`]: the
//                     sensing-lens relationship shots that make the FOV gap / the crossing / the eclipse legible
//                     (f2a b1/b2, and b3 with the occluder). Resolves to null on a non-sensing run (falls through
//                     to the prefix-fit default).
//   • 'stage'       — the whole-instrument stage fit (the load / bookend vantage): the sensing scope (f2a b5),
//                     and the e0 query core theatre (e0 b5 — the runaway-excluded core keeps the closing CLEAR
//                     sightline's far runaway end OUTSIDE the framed theatre: "clean passage", the bookend).
//   • 'corridor'    — e0 (query stage): fit the FIRST BLOCKED sightline's origin→occluder→contact corridor, so
//                     the ray dying at the occluder is the frame's event (e0 b2). Resolves to null on a run with
//                     no query blocked sightline (falls through to the prefix-fit default).
//   • 'crane'       — e0 (query stage): the crane that STAGES the Observer's-Eye POV — behind + above the drawn
//                     observer, aimed at the interrogated theatre, so the eye reads in the foreground with the
//                     world it questions ahead, down the SAME axis the O key later dollies into (e0 b4). null on
//                     a run with no drawn observer / theatre.
export type TourShot =
  | { kind: 'head'; distance: 'medium' | 'close' }
  | { kind: 'conjunction'; occluder?: boolean }
  | { kind: 'stage' }
  | { kind: 'corridor' }
  | { kind: 'crane' }

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
  arrive?: TourShot             // authored per-beat camera arrive; omitted = today's behavior
  caption: string
  holdMs: number                // dwell after actions complete (normal motion)
}
export interface Tour { id: string; runId: string; title: string; steps: TourStep[] }
