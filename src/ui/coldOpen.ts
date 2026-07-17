// Pure decision layer for the ZERO-CLICK cold open. No DOM, no
// store, no React — the arming predicate and the storage probe are unit-testable without a render harness
// (the repo carries none), mirroring thesis.ts / hangar.ts's split of logic from glue. App owns the effect
// that reads these; the honesty rules live HERE where a test can pin them.

// The cold-open behavior scope — the SINGLE-POINT OWNER TOGGLE (App pins the shipped value). The plan fixed
// WHAT the zero-click open does but not its scope, so this is the one seam the owner tunes:
//   'first-visit' — auto-play + card fire on a BARE cold open, once per browser (the tour-nudge precedent).
//   'always'      — every bare cold open (the nudge marker AND storage availability are irrelevant).
//   'off'         — veto: neither the auto-play nor the card ever fires.
export type ZeroClickScope = 'first-visit' | 'always' | 'off'

// STORAGE-AVAILABILITY PROBE. 'first-visit' scope needs a store that can be both READ (has this browser
// seen the nudge?) AND WRITTEN (retire it so the NEXT bare load is calm). A denied/throwing store (private
// mode, disabled cookies) can do neither — and the old seed silently read that throw as nudgeSeen=false, so
// EVERY bare load looked like the first and auto-played, violating 'first-visit'. Probe read+write once with
// a throwaway key that is immediately removed (NO new persisted key enters the app's storage schema); the
// result gates the arming decision below. `store` is injectable so a throwing/working mock is unit-testable
// under the node-env runner (which has no localStorage); production passes the real localStorage.
// The store is resolved INSIDE the try: some privacy modes throw from the localStorage GETTER itself, and a
// default-parameter access would crash the caller's render instead of degrading to storageOk=false. The probe
// also READ-VERIFIES (getItem === '1'): a write-succeeds/read-throws store must classify as unavailable, or
// the unseeded marker re-arms the zero-click on every visit — the exact degradation this probe exists to stop.
export function probeStorage(store?: Storage | undefined): boolean {
  const probeKey = '__so.storageProbe'
  let s: Storage | undefined
  try {
    s = store ?? globalThis.localStorage
    if (!s) return false
    s.setItem(probeKey, '1')
    return s.getItem(probeKey) === '1'
  } catch {
    return false
  } finally {
    try { s?.removeItem(probeKey) } catch { /* cleanup is best-effort — a throwing remove must not mask the verdict */ }
  }
}

// THE ARMING DECISION — should the zero-click cold open (thesis card + auto-played first tour beat) fire?
// Pure over the whole predicate so the arming branches are pinned without a live effect:
//   • never on 'off', never on a deep link (a shared/deep URL is not a cold open), never without a tour.
//   • 'first-visit' additionally requires an UNSEEN marker AND an AVAILABLE store: if the store is
//     denied, the marker can be neither read nor persisted, so the conservative honest form is to SUPPRESS
//     entirely (never auto-play on every visit). 'always' ignores both the marker and storage by design.
export function shouldArmZeroClick(
  scope: ZeroClickScope, coldOpen: boolean, hasTour: boolean, nudgeSeen: boolean, storageOk: boolean,
): boolean {
  if (scope === 'off' || !coldOpen || !hasTour) return false
  if (scope === 'first-visit' && (nudgeSeen || !storageOk)) return false
  return true
}
