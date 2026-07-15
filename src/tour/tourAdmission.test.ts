import { describe, expect, test } from 'vitest'
import { hasTour, tourAdmitted, tourHandoffAction, TOURS } from './tours'
import type { TrustVerdict } from '../decode/verify'

// ── F1 — the ONE tour-admission predicate, consumed by all three tour entry points ─────────────────────────
// A tour may start iff a model is resident AND it belongs to the CURRENT run (loadIsCurrent) AND the verdict is
// not a mismatch AND an authored tour exists (own-property). The Hangar handoff — the third entry point that had
// neither the identity nor the verdict guard — is dispatched through tourHandoffAction, whose switch-gap behavior
// (does not start, does not consume pendingTour) is pinned below.

describe('hasTour — an OWN-property check (never an inherited member)', () => {
  test('a real authored tour resolves true; the ids are exactly the TOURS keys', () => {
    for (const id of Object.keys(TOURS)) expect(hasTour(id)).toBe(true)
    expect(hasTour('e0')).toBe(true)
    expect(hasTour('f2a')).toBe(true)
  })
  test('a run without an authored tour resolves false', () => {
    expect(hasTour('f0')).toBe(false) // f0 ships no tour
    expect(hasTour('nope')).toBe(false)
  })
  test('a prototype key never resolves an INHERITED member as a "tour exists"', () => {
    for (const k of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) expect(hasTour(k)).toBe(false)
  })
})

describe('tourAdmitted — model + identity + verdict + tour-exists (F1)', () => {
  const SELF: TrustVerdict = 'self-consistent'
  const MISMATCH: TrustVerdict = 'mismatch'

  test('HAPPY PATH: resident model, current run, honest verdict, tour exists → admitted', () => {
    expect(tourAdmitted('e0', true, 'e0', SELF)).toBe(true)
    expect(tourAdmitted('f2a', true, 'f2a', 'manifest-verified')).toBe(true)
  })
  test('STALE MODEL DURING THE SWITCH GAP: a non-current model (loadedRunId names the PRIOR run) is NOT admitted', () => {
    expect(tourAdmitted('e0', true, 'f1', SELF)).toBe(false)
  })
  test('NO MODEL: nothing resident → not admitted', () => {
    expect(tourAdmitted('e0', false, 'e0', SELF)).toBe(false)
  })
  test('MISMATCH DESTINATION: refused (det-only captions would claim a self-check the bytes did not earn)', () => {
    expect(tourAdmitted('e0', true, 'e0', MISMATCH)).toBe(false)
  })
  test('NO TOUR: a run without an authored tour is not admitted, even for a prototype-shaped id', () => {
    expect(tourAdmitted('f0', true, 'f0', SELF)).toBe(false)
    expect(tourAdmitted('__proto__', true, '__proto__', SELF)).toBe(false)
  })
  test('null/undefined verdict fails OPEN on the verdict leg (model + identity + tour still gate)', () => {
    expect(tourAdmitted('e0', true, 'e0', null)).toBe(true)
    expect(tourAdmitted('e0', true, 'e0', undefined)).toBe(true)
    expect(tourAdmitted('e0', false, 'e0', null)).toBe(false) // …but no model → still refused
  })
})

describe('tourHandoffAction — the Hangar → tour handoff, as a pure action (F1/F6)', () => {
  const SELF: TrustVerdict = 'self-consistent'
  const MISMATCH: TrustVerdict = 'mismatch'
  const OK = false // no terminal load error

  test('IDLE: no pending tour → idle (never consume)', () => {
    expect(tourHandoffAction(null, 'e0', true, 'e0', SELF, OK)).toBe('idle')
  })
  test('CANCEL on NAVIGATION AWAY: a pending tour for a DIFFERENT run → cancel (F6 — the arrival intent is abandoned)', () => {
    // The intent was "tour f1 ON ARRIVAL at f1", but the current run is e0. Leaving it parked would let a LATER
    // plain-open of f1 start a tour on a non-tour visit (the stale-replay bug). App consumes pendingTour.
    expect(tourHandoffAction('f1', 'e0', true, 'e0', SELF, OK)).toBe('cancel')
    expect(tourHandoffAction('f1', 'e0', false, null, SELF, OK)).toBe('cancel') // even mid-load elsewhere
  })
  test('CANCEL on TERMINAL ERROR: the pending destination\'s OWN load failed → cancel (F6 — no arrival will come)', () => {
    expect(tourHandoffAction('e0', 'e0', false, null, SELF, true)).toBe('cancel')
    // error outranks the still-loading gap: a failed load must not sit parked as 'wait' forever.
    expect(tourHandoffAction('e0', 'e0', true, 'f1', SELF, true)).toBe('cancel')
  })
  test('STALE-MODEL-DURING-GAP (no error): our pending run but its bytes are not resident+current → WAIT (unchanged)', () => {
    // model !== null (the stale PRIOR run's) but loadedRunId still names the prior run → the destination is loading.
    expect(tourHandoffAction('e0', 'e0', true, 'f1', SELF, OK)).toBe('wait')
    // no model yet either → still wait, never consume.
    expect(tourHandoffAction('e0', 'e0', false, null, SELF, OK)).toBe('wait')
  })
  test('START: resident + current + admitted → start (and App consumes pendingTour) — unchanged', () => {
    expect(tourHandoffAction('e0', 'e0', true, 'e0', SELF, OK)).toBe('start')
  })
  test('REFUSE: a MISMATCH destination is resident+current → refuse (consume pendingTour, never start) — unchanged', () => {
    expect(tourHandoffAction('e0', 'e0', true, 'e0', MISMATCH, OK)).toBe('refuse')
  })
  test('REFUSE: a parked run with no authored tour → refuse (drop the doomed request) — unchanged', () => {
    expect(tourHandoffAction('f0', 'f0', true, 'f0', SELF, OK)).toBe('refuse')
  })
})
