import { describe, expect, test } from 'vitest'
import { recomputedVerdict } from './lensContract'
import { gateMark } from './sensingStrip'
import { showMathMark } from './Inspector'
import { sensingGates } from './sensingMath'
import type { SensingDraw } from './sensingStage'
import { showMath } from './showMath'
import { SPHERE, type PointDraw, type SightlineDraw } from './queryStage'
import { makeWitnessInputs, type AgreeSource } from './agreeSource'
import { requireGlyph, markClass, BASIS_NOTE } from './voices'

// ── W3 F3 — the witness union is WORN at the mark, not demoted to prose ─────────────────────────────────
// PREMISE-FIRST: before this wave, every recomputed row was stamped by a bare boolean → ✓/✗, discarding
// agree.basis (voiceFor gave the recomputed tier the live-check voice unconditionally, and the components
// re-decided the mark from a boolean). A decoded-consistency arm would therefore have WORN THE CHECK (✓) — the
// W1 ring smuggled up to a manifest-grade mark. These pin the fix: the production mark resolver consumes the
// class's DECLARED arm, so a live-inputs agreement wears the ✓, a decoded-consistency agreement wears ONLY the
// ○ ring (never the check), a disagreement is the ✗ on either arm, and the basis NOTE renders from the same tag.

// Two synthetic arms — one per basis. The decoded-consistency arm is the case HEAD never renders (both real
// executors publish decoded: []); it is exactly the arm that used to slip through wearing the check.
const liveArm: AgreeSource = { basis: 'live-inputs', inputs: makeWitnessInputs('sensing:pose'), form: 'form:in-range' }
const decodedArm: AgreeSource = { basis: 'decoded-consistency', decoded: 'sensing:eligibility-vs-decoded-legs' }

// A poseful sensing verdict at the origin (in range per recomputeInRange([0,0,0])) — its in_range gate carries
// a BRANDED, known-true agreement (agrees(true === true)); the disagreeing twin flips the decoded bit → false.
const baseDraw: SensingDraw = {
  seq: 0, tick: 0, subject: '1:0', sensor: '0',
  inRange: true, inFov: true, losClear: true, eligible: true, tiebreak: false, g: [0, 0, 0],
}
const inRangeGate = (d: SensingDraw) => sensingGates(d).find(g => g.id === 'in_range')!

// A point-in-ball card that AGREES (recomputeBall(center).inside === true === verdict INSIDE) — its card.agree
// is the executor's BRANDED per-row outcome, the only kind the mark resolver accepts (F4).
const agreeingCard = showMath(
  { kind: 1, seq: 0, object: 1, point: SPHERE.center, verdict: 'INSIDE', tiebreak: false, d2: 0, dist: 0 } as PointDraw,
  null,
)

describe('recomputedVerdict — a decoded-consistency agreement earns the ○ ring, NEVER the ✓', () => {
  test('the resolver honors agree.basis on agreement, and renders the arm\'s note', () => {
    // We drive the resolver through the two components (below) with real branded outcomes; here we confirm the
    // shared contract directly, threading the SAME branded agreement a component would.
    const agreed = inRangeGate(baseDraw).agree! // branded true
    const live = recomputedVerdict(liveArm, agreed)
    const dc = recomputedVerdict(decodedArm, agreed)
    expect(live.mark).toBe('verified')          // ✓ — the external-oracle check
    expect(dc.mark).toBe('selfConsistent')      // ○ — the ring, no external oracle
    expect(dc.mark).not.toBe('verified')        // the whole point: NEVER the check
    expect(live.note).toBe(BASIS_NOTE['live-inputs'])
    expect(dc.note).toBe(BASIS_NOTE['decoded-consistency'])
  })
  test('a disagreement is the ✗ (mismatch) on EITHER arm', () => {
    const disagreed = inRangeGate({ ...baseDraw, inRange: false }).agree! // branded false
    expect(recomputedVerdict(liveArm, disagreed).mark).toBe('mismatch')
    expect(recomputedVerdict(decodedArm, disagreed).mark).toBe('mismatch')
  })
})

describe('SensingStrip.gateMark — the strip wears the arm\'s mark + note (W3 F3)', () => {
  const g = inRangeGate(baseDraw)
  test('a live-inputs arm wears the ✓ with the live-inputs note', () => {
    const m = gateMark(g, liveArm)
    expect(m.glyph).toBe(requireGlyph('verified'))
    expect(m.cls).toBe(markClass('verified'))
    expect(m.note).toBe(BASIS_NOTE['live-inputs'])
  })
  test('a decoded-consistency arm wears the ○ ring + its note — NEVER the ✓ (the premise defeat)', () => {
    const m = gateMark(g, decodedArm)
    expect(m.glyph).toBe(requireGlyph('selfConsistent'))
    expect(m.glyph).not.toBe(requireGlyph('verified'))
    expect(m.cls).toBe(markClass('selfConsistent'))
    expect(m.note).toBe(BASIS_NOTE['decoded-consistency']) // "…no external oracle", visible beside the mark
  })
  test('a disagreeing gate wears the ✗ on either arm', () => {
    const d = inRangeGate({ ...baseDraw, inRange: false })
    expect(gateMark(d, liveArm).glyph).toBe(requireGlyph('mismatch'))
    expect(gateMark(d, decodedArm).glyph).toBe(requireGlyph('mismatch'))
  })
  test('a claim gate wears the attested • regardless of arm (never a ✓)', () => {
    const fov = sensingGates(baseDraw).find(g2 => g2.id === 'in_fov')!
    const m = gateMark(fov, undefined) // a claim gate names no arm
    expect(m.glyph).toBe(requireGlyph('attested'))
  })
})

describe('Inspector.showMathMark — the ShowTheMath card wears the arm\'s mark + note (W3 F3)', () => {
  test('a live-inputs arm resolves the ✓ with the live-inputs note', () => {
    const s = showMathMark(agreeingCard, liveArm)
    expect(s.mark).toBe('verified')
    expect(s.note).toBe(BASIS_NOTE['live-inputs'])
  })
  test('a decoded-consistency arm resolves the ○ ring + its note — NEVER the ✓ (the premise defeat)', () => {
    const s = showMathMark(agreeingCard, decodedArm)
    expect(s.mark).toBe('selfConsistent')
    expect(s.mark).not.toBe('verified')
    expect(s.note).toBe(BASIS_NOTE['decoded-consistency'])
  })
  test('a missing-composite card (agree null) resolves to the unverifiable mark, never a verdict — regardless of arm (F1)', () => {
    // PREMISE-FIRST (F1): pre-fix a missing LOS composite minted agrees(false) — a BRANDED outcome that would
    // have flowed into recomputedVerdict as a ✗ MISMATCH. Now agree is null (unbrandable), so showMathMark's
    // null-narrowing forces the '?' unverifiable branch FIRST — the no-comparison state can never wear a verdict
    // mark, and the arm is irrelevant (the null short-circuits before recomputedVerdict is ever consulted).
    const noComposite = showMath(
      { kind: 4, seq: 0, o: [0, 0, 0], g: [100, 0, 0], verdict: 'LOS_CLEAR', tiebreak: false, components: [0, 0, 0] } as SightlineDraw,
      null, // the 3-component composite deliberately withheld
    )
    expect(noComposite.agree).toBeNull()
    expect(noComposite.unverifiable).toBe(true)
    expect(showMathMark(noComposite, liveArm).mark).toBe('unverifiable')
    expect(showMathMark(noComposite, decodedArm).mark).toBe('unverifiable')
  })
})
