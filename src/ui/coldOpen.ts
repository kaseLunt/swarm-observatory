// Pure decision layer for the two zero-click AUTO-ARM surfaces — the bare-root cold open and the bare run deep
// link. No DOM, no store, no React — the arming predicates, the URL classifier, and the storage probe are
// unit-testable without a render harness (the repo carries none), mirroring thesis.ts / hangar.ts's split of
// logic from glue. App owns the effects that read these; the honesty rules live HERE where a test can pin them.

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

// THE TOUR-DISMISSAL MEMORY gate, shared by BOTH auto-arm surfaces (the bare-root cold open and the bare run
// deep link) so a returning visitor who retired the tour is never re-armed on EITHER. May an auto-arm fire on
// this bare load, given the owner scope and the first-visit marker?
//   • 'off'         — never (auto-arm vetoed).
//   • 'first-visit' — only while the marker is UNSEEN and the store can persist that it was seen: a denied
//                     store can neither read nor retire the marker, so it SUPPRESSES (never auto-play every visit).
//   • 'always'      — always (marker and storage irrelevant by design).
export function autoArmMemoryAllows(scope: ZeroClickScope, nudgeSeen: boolean, storageOk: boolean): boolean {
  if (scope === 'off') return false
  if (scope === 'first-visit' && (nudgeSeen || !storageOk)) return false
  return true
}

// THE ARMING DECISION — should the zero-click cold open (thesis card + auto-played first tour beat) fire?
// Pure over the whole predicate so the arming branches are pinned without a live effect:
//   • never on a deep link (a shared/deep URL is not a cold open — the bare run deep link has its OWN arm
//     decision below), never without a tour.
//   • the tour-dismissal memory then governs it (scope + the first-visit marker + storage), the SAME rule the
//     bare-link arm decision consults, so the two surfaces can never drift on who gets re-armed.
export function shouldArmZeroClick(
  scope: ZeroClickScope, coldOpen: boolean, hasTour: boolean, nudgeSeen: boolean, storageOk: boolean,
): boolean {
  if (!coldOpen || !hasTour) return false
  return autoArmMemoryAllows(scope, nudgeSeen, storageOk)
}

// Classify a URL query as a BARE run deep link: it names a run and NOTHING else — no tick, selection, event,
// speed, capture, or any other param. Returns the run id, or null when the query carries additional view state
// (a shared link that must land exactly where it points) or names no run. A bare run link points at "run X's
// story", not a precise shared moment, so the caller may auto-arm that run's tour; ANY extra param makes it a
// shared view instead, untouched. The empty query (the bare root) names no run, so it returns null and the
// caller keeps its own cold-open handling. A repeated run= is not a clean single-run link either.
export function bareRunDeepLink(search: string): string | null {
  const params = new URLSearchParams(search.replace(/^\?/, ''))
  const keys = Array.from(params.keys())
  if (keys.length !== 1 || keys[0] !== 'run') return null
  const run = params.get('run')
  return run !== null && run !== '' ? run : null
}

// THE BARE-LINK ARM DECISION — which run's tour (if any) a bare run deep link should PARK for the arrival
// machine to admit. Three gates: the link names a bare run (bareRunId), an authored tour EXISTS for it, and the
// shared tour-dismissal memory permits an auto-arm — so a tour-less run never parks at all (this decision
// returns null). The remaining admission — the run is resident + current and its verdict is not a mismatch —
// is NOT decided here; the arrival machine owns it, so a mismatch bare link parks and is REFUSED there (it
// lands on the frozen stage with no tour), never started. Returns the run id to park, or null to park nothing.
export function bareLinkTourToArm(
  bareRunId: string | null, hasTour: boolean, scope: ZeroClickScope, nudgeSeen: boolean, storageOk: boolean,
): string | null {
  if (bareRunId === null || !hasTour) return null
  return autoArmMemoryAllows(scope, nudgeSeen, storageOk) ? bareRunId : null
}
