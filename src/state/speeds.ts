// Canonical speed ladder. Home is state/ (not ui/) so the store can clamp to it without a
// ui→state import (state→state); ui consumers reach it via keyboard.ts's re-export.
export const SPEEDS = [0.25, 1, 4, 8] as const

// The resting default speed — the store's initial `speed` and the value a shared link collapses to when
// the current transport speed is a tour's off-ladder presentation artifact (shareSpeed below).
export const DEFAULT_SPEED = 1

// Single clamp used by both setSpeed and applyLink (deep-link speed): snap any number to the
// nearest ladder member. Non-finite input (Infinity/NaN, e.g. a malformed ?speed= or a divide) has
// no nearest member, so default to 1× rather than let the reduce return the first member by accident.
export function clampSpeed(n: number): number {
  if (!Number.isFinite(n)) return 1
  return SPEEDS.reduce((best, s) => (Math.abs(s - n) < Math.abs(best - n) ? s : best), SPEEDS[0])
}

// Membership in the user ladder. A tour's witness pacing writes an OFF-ladder rate (between notches) via
// store.setState — NOT setSpeed, which snaps to the ladder — so `!isLadderSpeed(speed)` is the exact
// "a tour is pacing playback right now" signal. Single source for Timeline's off-ladder dimming AND the
// share-link guard below, so the two can never disagree about what counts as a real user speed.
export function isLadderSpeed(n: number): boolean {
  return (SPEEDS as readonly number[]).includes(n)
}

// The speed to SERIALIZE into a shared / deep link for the current transport speed (W2). A real ladder
// member rides as-is; an OFF-ladder value is a tour's witness presentation pace, never a user choice, so
// it collapses to the resting default. This mirrors Timeline's off-ladder guard and its natural-end URL
// sync's deliberate isTourActive skip: a shared link reproduces the resting VIEW, never a transient tour
// artifact. (encodeLink omits speed === DEFAULT_SPEED, so the collapsed value simply drops from the URL.)
export function shareSpeed(n: number): number {
  return isLadderSpeed(n) ? n : DEFAULT_SPEED
}
