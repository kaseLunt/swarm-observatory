// Source-signaled tour-interrupt channel. The driver's delta detector (isForeignWrite) infers user
// input from store-state deltas, but several genuine user gestures leave no delta the detector can
// trust: a timeline scrub DURING a play step (tick writes are expected then — a scrub PAST the target
// even mimics natural arrival), speed-button / keyboard-speed changes, and focus keys (which never
// touch the store at all). Those callers instead signal at the SOURCE, BEFORE their store write, via
// notifyUserInput().
//
// Module-channel pattern, mirroring Scene.tsx's `focusRequest`: a single registered handler, no store,
// no React. The driver registers stop() on start and unregisters on every exit path, so
// notifyUserInput() is a no-op whenever no tour is active (handler === null).
let handler: (() => void) | null = null

export function registerTourInterrupt(fn: () => void): void {
  handler = fn
}

export function unregisterTourInterrupt(): void {
  handler = null
}

export function notifyUserInput(): void {
  handler?.()
}

// True iff a tour is currently active. The driver registers stop() for a tour's whole lifetime (start →
// every exit path unregisters), so a non-null handler is an exact, synchronous "a tour owns the
// transport right now" signal. Exposed for Timeline's end-of-run auto-sync, which must NOT deep-link
// the URL mid-tour: a tour play step reaches maxTick with the OFF-LADDER witness speed still in the
// store, so an auto-sync there would capture that presentation rate as if it were the user's choice.
// finish() does its own forced syncUrl AFTER restoring the ladder speed, so the tour-exit case is covered.
export function isTourActive(): boolean {
  return handler !== null
}
