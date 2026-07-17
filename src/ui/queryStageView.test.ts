import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import {
  buildPrecomp, indexOfSeq, CONTACT_DIM, GHOST_OPACITY, CONTACT_HDR, SELECTED_HDR, SELECTED,
  selectedLineColor, ambientLineColor, ROLE_BY_HOP, HOP_DECAY, LINE_AMBIENT_YIELD, type LineItem,
  linePaintRange, writeCompositeComponentCorridors,
} from './queryStageView'
import { causalHops, HORIZON_HOPS } from './chain'
import { PALETTE, CATEGORY, BLOOM_LUMINANCE_THRESHOLD } from './theme'
import { decodeBundle } from '../decode/decodeBundle'
import { RunModel } from '../model/runModel'
import {
  buildQueryDraws,
  type QueryDraw, type LosComposite, type RayDraw, type SightlineDraw, type RangeBearingDraw, type Vec3,
} from './queryStage'

// Query-stage renderer tests (v0.6). Provable-without-a-Canvas concerns:
//   1. THE NOT-YET GHOST's geometry lookup — the selected event's own line / contact entry, drawn from the
//      SAME precomp the written path reads, so the ghost is byte-identical to the form it fills in to; and its
//      per-kind inventory matches the written form (k4 BLOCKED line ends at the blocker's hit point).
//   2. COMPONENT UN-SUPPRESSION — a selected/ghosted LOS component draws its OWN corridor (componentLines)
//      and its contact is selectable; suppression is a playback de-dup, not a "no answer".
//   3. THE INVARIANT — across ALL 75 real e0 events, selecting ANY seq yields ≥1 stage element.
//      "Nothing selectable is stage-silent." Run against the pure build/precomp logic.
//   4. THE BLOOM THRESHOLD — the dimmed verdict contacts (contacts[].dim, CONTACT_DIM) and the accent ghost
//      sit BELOW the renderer's own BLOOM_LUMINANCE_THRESHOLD, bound THROUGH buildPrecomp + the exported
//      HDR-boost constants so the pins track the renderer if a boost changes.

// ── Hand-built draws (only the fields buildPrecomp reads), one per kind + the two LOS shapes ─────────────
const pt = (seq: number): QueryDraw =>
  ({ kind: 1, seq, object: 1, point: [seq, 0, 0], verdict: 'INSIDE', tiebreak: false, d2: null, dist: null })
const range = (seq: number): QueryDraw =>
  ({ kind: 2, seq, o: [0, 0, 0], g: [100, 0, 0], rangeM: 100, bearingRad: 0, bearingDeg: 0, tiebreak: false })
const rayHit = (seq: number, hp: Vec3): QueryDraw =>
  ({ kind: 3, seq, object: 1, mode: 1, o: [0, 0, 0], target: [700, 0, 0], verdict: 'HIT', tiebreak: false, t: 0.5, hitPoint: hp, metricDist: 350 })
const rayMiss0 = (seq: number): QueryDraw =>
  ({ kind: 3, seq, object: 1, mode: 0, o: [0, 0, 0], target: [1, 0, 0], verdict: 'MISS', tiebreak: false, t: null, hitPoint: null, metricDist: null })
const blocked = (seq: number): QueryDraw =>
  ({ kind: 4, seq, o: [0, 0, 0], g: [700, 0, 0], verdict: 'BLOCKED', tiebreak: false, components: [seq - 3, seq - 2, seq - 1] })
const clear = (seq: number): QueryDraw =>
  ({ kind: 4, seq, o: [0, 0, 0], g: [700, 0, 0], verdict: 'LOS_CLEAR', tiebreak: false, components: [seq - 3, seq - 2, seq - 1] })

// seq inventory: 5 k1 (contact only) · 8 k2 (line only) · 10 k3 HIT standalone (line + contact) ·
// 12 k3 mode-0 MISS (line only) · 17 k3 HIT LOS-component (contact + OWN corridor in componentLines; ambient
// line suppressed) · 20 k4 BLOCKED (line only, dying at the blocker's hit point) · 24 k4 CLEAR (line only).
const BLOCKER_HIT: Vec3 = [350, 0, 0]
function fixture(): { draws: (QueryDraw | null)[]; componentSeqs: Set<number>; composites: Map<number, LosComposite> } {
  const draws: (QueryDraw | null)[] = new Array(25).fill(null)
  draws[5] = pt(5)
  draws[8] = range(8)
  draws[10] = rayHit(10, [420, 0, 0])
  draws[12] = rayMiss0(12)
  draws[17] = rayHit(17, BLOCKER_HIT) // a LOS component (block contact); its line is suppressed
  draws[20] = blocked(20)
  draws[24] = clear(24)
  const componentSeqs = new Set<number>([17])
  const composites = new Map<number, LosComposite>([
    [20, {
      seq: 20, los: draws[20] as SightlineDraw, components: [draws[17] as RayDraw],
      firstBlocker: draws[17] as RayDraw, blockerObject: 1,
    }],
  ])
  return { draws, componentSeqs, composites }
}

describe('ghost geometry lookup (buildPrecomp + indexOfSeq) — per-kind parity with the written form', () => {
  const { draws, componentSeqs, composites } = fixture()
  const precomp = buildPrecomp(draws, componentSeqs, composites)
  const hasLine = (seq: number): boolean => indexOfSeq(precomp.lineSeqs, seq) >= 0
  const hasContact = (seq: number): boolean => indexOfSeq(precomp.contactSeqs, seq) >= 0

  test('k1 POINT — a persistent contact, no line', () => {
    expect(hasContact(5)).toBe(true)
    expect(hasLine(5)).toBe(false)
  })
  test('k2 RANGE — a line, no contact', () => {
    expect(hasLine(8)).toBe(true)
    expect(hasContact(8)).toBe(false)
  })
  test('k3 standalone HIT — line to the hit point + a contact', () => {
    expect(hasLine(10)).toBe(true)
    expect(hasContact(10)).toBe(true)
  })
  test('k3 mode-0 MISS — a line (the reaching shaft), no contact', () => {
    expect(hasLine(12)).toBe(true)
    expect(hasContact(12)).toBe(false)
  })
  test('LOS component row — its AMBIENT line stays suppressed (the playback de-dup); the contact persists', () => {
    expect(hasContact(17)).toBe(true)
    expect(hasLine(17)).toBe(false) // out of the ambient `lines` packing — the composite carries the corridor at playback
  })
  test('un-suppression — a LOS component has its OWN corridor (componentLines) and a SELECTABLE contact', () => {
    // The suppression is a playback de-dup, not a "no answer" verdict: a selection/ghost draws the component's
    // own recorded ray, and its block contact pops to accent like every other selected contact.
    expect(precomp.componentLines.has(17)).toBe(true)   // its own corridor exists for the interrogation voice
    const ci = indexOfSeq(precomp.contactSeqs, 17)
    expect(precomp.contacts[ci]!.selectable).toBe(true) // amended from selectable:false (un-suppression)
    // A HIT component's corridor dies at its hit point (o→hitPoint): midpoint x == 175 (== the BLOCKED line's),
    // never the composite sightline end (700) — byte-identical to what the written/ghost path draws.
    expect(precomp.componentLines.get(17)!.elements[12]).toBeCloseTo((0 + BLOCKER_HIT[0]) / 2, 6)
  })
  test('k4 CLEAR — a full sightline, no contact', () => {
    expect(hasLine(24)).toBe(true)
    expect(hasContact(24)).toBe(false)
  })
  test('k4 BLOCKED — a line dying at firstBlocker.hitPoint (NOT the runaway sightline end), no contact', () => {
    expect(hasLine(20)).toBe(true)
    expect(hasContact(20)).toBe(false)
    // The line matrix centres on the midpoint of (o, end); prove end == the blocker hit point (350,0,0) →
    // midpoint x == 175, and NOT the sightline g (700,0,0) which would land the midpoint at x == 350.
    const mat = precomp.lines[indexOfSeq(precomp.lineSeqs, 20)]!.mat
    expect(mat.elements[12]).toBeCloseTo((0 + BLOCKER_HIT[0]) / 2, 6) // 175
    expect(mat.elements[12]).not.toBeCloseTo((0 + 700) / 2, 1)        // not 350 (the g-endpoint bug)
  })

  test('the ghost reads the SAME matrix the written path draws (byte-identical fill-in)', () => {
    const li = indexOfSeq(precomp.lineSeqs, 10)
    expect(li).toBeGreaterThanOrEqual(0)
    // The ghost draws precomp.lines[li].mat — the exact object the written line prefix packs for seq 10.
    expect(precomp.lines[li]!.seq).toBe(10)
    const ci = indexOfSeq(precomp.contactSeqs, 10)
    expect(precomp.contacts[ci]!.seq).toBe(10)
  })

  test('indexOfSeq returns -1 for a seq with no drawable (never a false ghost)', () => {
    expect(indexOfSeq(precomp.lineSeqs, 5)).toBe(-1)   // k1 has no line
    expect(indexOfSeq(precomp.contactSeqs, 8)).toBe(-1) // k2 has no contact
    expect(indexOfSeq(precomp.lineSeqs, 999)).toBe(-1)  // absent seq
  })
})

// three.js `luminance()` (Rec.709) — the exact weights the postprocessing Bloom's LuminanceMaterial uses
// (`#include <common>`). Bloom mask = smoothstep(threshold, threshold+smoothing, l); a pixel with luminance
// above BLOOM_LUMINANCE_THRESHOLD (the renderer's OWN cutoff, imported from theme) blooms. Renderer tone
// mapping is OFF before Bloom, so it sees these linear values.
const W = [0.2126729, 0.7151522, 0.0721750] as const
const lum = (c: THREE.Color): number => W[0] * c.r + W[1] * c.g + W[2] * c.b

describe('bloom threshold — dimmed contacts + the ghost never bloom, bound THROUGH buildPrecomp + the renderer cutoff', () => {
  // Build the verdict contacts through the REAL precompute so these pins track the renderer, not a transcript:
  // the affirm (k1 INSIDE) and negate (k1 OUTSIDE) contacts' unsel/dim colours are exactly what buildPrecomp
  // hands the instance buffer (base = verdict × CONTACT_HDR, dimmed by CONTACT_DIM). Change either boost or the
  // threshold and these luminance assertions move with it — the wave-2 pins hard-coded 2.0/0.4 and would not.
  const draws: (QueryDraw | null)[] = [
    { kind: 1, seq: 0, object: 1, point: [256, 0, 0], verdict: 'INSIDE', tiebreak: false, d2: null, dist: null },
    { kind: 1, seq: 1, object: 1, point: [999, 0, 0], verdict: 'OUTSIDE', tiebreak: false, d2: null, dist: null },
  ]
  const precomp = buildPrecomp(draws, new Set(), new Map())
  const affirm = precomp.contacts[indexOfSeq(precomp.contactSeqs, 0)]!
  const negate = precomp.contacts[indexOfSeq(precomp.contactSeqs, 1)]!

  test('the precomp applied CONTACT_HDR to the contact base (unsel == verdict × CONTACT_HDR)', () => {
    const base = new THREE.Color(PALETTE.verdictAffirm).multiplyScalar(CONTACT_HDR)
    expect(affirm.unsel.r).toBeCloseTo(base.r, 6)
    expect(affirm.unsel.g).toBeCloseTo(base.g, 6)
    expect(affirm.unsel.b).toBeCloseTo(base.b, 6)
  })
  test('the guard is meaningful: an UNSELECTED affirm contact (HDR) DOES bloom', () => {
    expect(lum(affirm.unsel)).toBeGreaterThan(BLOOM_LUMINANCE_THRESHOLD) // ≈1.43 — the durable constellation glows
  })
  test('a dimmed verdict contact (contacts[].dim, CONTACT_DIM) sits BELOW the threshold on BOTH hues', () => {
    expect(lum(affirm.dim)).toBeLessThan(BLOOM_LUMINANCE_THRESHOLD) // ≈0.36 (×0.4 left it ≈0.57 — bloomed)
    expect(lum(negate.dim)).toBeLessThan(BLOOM_LUMINANCE_THRESHOLD) // ≈0.08 — the ember is sub-threshold at any dim
    expect(affirm.dim.r).toBeCloseTo(affirm.unsel.r * CONTACT_DIM, 6) // dim IS the precomp's unsel × CONTACT_DIM
  })
  test('the selected written colour (the renderer\'s own SELECTED) CLEARS the bloom threshold', () => {
    // The other side of the bound: dimmed contacts must sit BELOW the threshold, but the selection pop
    // must sit ABOVE it — a raised threshold that silently killed selection bloom would pass every
    // below-threshold pin. Reads the renderer's actual colour, never a reconstruction.
    expect(lum(SELECTED)).toBeGreaterThan(BLOOM_LUMINANCE_THRESHOLD)
    expect(SELECTED.r).toBeCloseTo(new THREE.Color(PALETTE.accent).r * SELECTED_HDR, 6) // and it IS accent × SELECTED_HDR
  })
  test('the ghost wears accent at ×1.0 (never ×SELECTED_HDR) and does not bloom', () => {
    const ghost = new THREE.Color(PALETTE.accent) // the token, unscaled — the ghost material colour
    expect(lum(ghost)).toBeLessThan(lum(SELECTED)) // strictly dimmer than the HDR form it earns on arrival
    // A transparent wireframe (opacity GHOST_OPACITY) over the dark region beyond the frontier; its composited
    // luminance stays below threshold, so it never blooms — its glow is earned by the fill-in.
    expect(lum(ghost) * GHOST_OPACITY).toBeLessThan(BLOOM_LUMINANCE_THRESHOLD) // ≈0.15
  })
})

// ── EMPHASIS DECAY + THE AGGREGATION HORIZON ──────────────────────
// The selection LINE law, bound through the renderer's own exported colour helpers so the pins track the
// renderer, not a transcript. selectedLineColor returns SHARED module constants for the lit cases (subject /
// neighbourhood) — the allocation-free design — and writes `out` for the beyond-horizon ambient case.
const line = (seq: number, clear = false, tint = 1): LineItem => ({ seq, mat: new THREE.Matrix4(), clear, tint })
// A linear-chain hop map for `ev`, exactly as causalHops builds it on e0's degenerate chain (self 0, ±1/2/3).
const hopMap = (ev: number): Map<number, number> =>
  new Map([[ev, 0], [ev - 1, 1], [ev - 2, 2], [ev - 3, 3], [ev + 1, 1], [ev + 2, 2], [ev + 3, 3]])
const LINE_FADE_TICKS = 6 // mirror of the renderer's window width (queryScene.test.ts pins the fade math itself)

describe('emphasis decay — the HOP_DECAY registers (symmetric, direction-blind)', () => {
  test('HOP_DECAY is [1.0, 0.65, 0.4] and ROLE_BY_HOP = spine × each register', () => {
    expect([...HOP_DECAY]).toEqual([1.0, 0.65, 0.4])
    for (let i = 0; i < HOP_DECAY.length; i++) {
      const expected = new THREE.Color(PALETTE.spine).multiplyScalar(HOP_DECAY[i]!)
      expect(ROLE_BY_HOP[i]!.r).toBeCloseTo(expected.r, 6)
      expect(ROLE_BY_HOP[i]!.g).toBeCloseTo(expected.g, 6)
      expect(ROLE_BY_HOP[i]!.b).toBeCloseTo(expected.b, 6)
    }
  })
  test('the subject is the SOLE line bloom: SELECTED clears the threshold, every violet register sits below it', () => {
    expect(lum(SELECTED)).toBeGreaterThan(BLOOM_LUMINANCE_THRESHOLD)              // the accent subject blooms
    for (const c of ROLE_BY_HOP) expect(lum(c)).toBeLessThan(BLOOM_LUMINANCE_THRESHOLD) // hops 1..3 sub-bloom (incl. ×1.0)
  })
  test('the surviving beyond-horizon ambient window is sub-bloom at its brightest (CLEAR × 1.6 × 0.3 < 0.4)', () => {
    // The renderer's OWN ambientLineColor — the exact colour the buffer receives. An unselected head CLEAR
    // sightline blooms (≈1.14); the LINE_AMBIENT_YIELD drops it below 0.4 so the subject is the only line bloom.
    expect(LINE_AMBIENT_YIELD).toBe(0.3)
    const clearHeadUnsel = ambientLineColor(new THREE.Color(), true, 1, 1, 1)
    expect(lum(clearHeadUnsel)).toBeGreaterThan(BLOOM_LUMINANCE_THRESHOLD)        // ≈1.14 — blooms at rest
    const clearHeadSel = ambientLineColor(new THREE.Color(), true, 1, 1, LINE_AMBIENT_YIELD)
    expect(lum(clearHeadSel)).toBeLessThan(BLOOM_LUMINANCE_THRESHOLD)             // ≈0.34 — ceded under selection
  })
  test('ambientLineColor at yield 1 is byte-identical to the pre-horizon inline math (the rest is untouched)', () => {
    const fade = 0.5
    const clearC = ambientLineColor(new THREE.Color(), true, 1, fade, 1)
    const expectClear = new THREE.Color(PALETTE.verdictAffirm).multiplyScalar(1.6 * fade)
    expect(clearC.r).toBe(expectClear.r); expect(clearC.g).toBe(expectClear.g); expect(clearC.b).toBe(expectClear.b)
    const steelC = ambientLineColor(new THREE.Color(), false, 0.82, fade, 1)
    const expectSteel = new THREE.Color(CATEGORY.query.hue).multiplyScalar(0.82 * fade)
    expect(steelC.r).toBe(expectSteel.r); expect(steelC.g).toBe(expectSteel.g); expect(steelC.b).toBe(expectSteel.b)
  })
})

describe('selectedLineColor — the horizon law + ghost-ignition choreography', () => {
  test('subject → accent (SOLE bloom); hops 1/2/3 → the decay registers; hop 4+ → ambient × yield (fades to black)', () => {
    const ev = 40, hop = hopMap(ev), out = new THREE.Color()
    expect(selectedLineColor(out, line(40), ev, hop, 40)).toBe(SELECTED)          // subject — the shared accent const
    expect(selectedLineColor(out, line(39), ev, hop, 40)).toBe(ROLE_BY_HOP[0])    // hop 1 ×1.0
    expect(selectedLineColor(out, line(38), ev, hop, 40)).toBe(ROLE_BY_HOP[1])    // hop 2 ×0.65
    expect(selectedLineColor(out, line(37), ev, hop, 40)).toBe(ROLE_BY_HOP[2])    // hop 3 ×0.4
    // seq 36 is hop 4 — beyond the horizon: at its own head it wears a dim ambient × yield; once spent, black.
    const beyondHead = selectedLineColor(out, line(36), ev, hop, 36)             // fade 1 at its head
    expect(lum(beyondHead)).toBeGreaterThan(0)                                   // present, but
    expect(lum(beyondHead)).toBeLessThan(BLOOM_LUMINANCE_THRESHOLD)              // sub-bloom
    const spent = selectedLineColor(out, line(36), ev, hop, 36 + LINE_FADE_TICKS) // LINE_FADE_TICKS behind → fade 0
    expect([spent.r, spent.g, spent.b]).toEqual([0, 0, 0])                        // black — invisible under additive blend
  })
  test('GHOST ignition: nothing violet until the head closes within HORIZON_HOPS of the ghost, then hop by hop', () => {
    // ev = 74 selected as a ghost (ev > reveal). As the playhead advances 70→73 the revealed ancestor lights in
    // DECREASING hop order — the earned-approach wake; arrival at 74 is the accent fill-in. Each is a cut.
    const ev = 74, hop = hopMap(ev), out = new THREE.Color()
    expect(selectedLineColor(out, line(70), ev, hop, 70)).not.toBe(ROLE_BY_HOP[2])                  // seq 70 is hop 4 — not yet violet
    expect(lum(selectedLineColor(out, line(70), ev, hop, 70))).toBeLessThan(BLOOM_LUMINANCE_THRESHOLD)
    expect(selectedLineColor(out, line(71), ev, hop, 71)).toBe(ROLE_BY_HOP[2])                      // hop 3 ×0.4 ignites first
    expect(selectedLineColor(out, line(72), ev, hop, 72)).toBe(ROLE_BY_HOP[1])                      // hop 2 ×0.65
    expect(selectedLineColor(out, line(73), ev, hop, 73)).toBe(ROLE_BY_HOP[0])                      // hop 1 ×1.0
    expect(selectedLineColor(out, line(74), ev, hop, 74)).toBe(SELECTED)                            // arrival — the fill-in bloom
  })
})

// ── THE INVARIANT — nothing selectable is stage-silent, across ALL 75 e0 events ──────────────────────────
// Run against the pure build/precomp logic over the REAL decoded e0 bundle (the same load path App uses:
// buildQueryDraws → buildPrecomp). General by construction — hand any bundle's model to the same two functions.
// The center-click coincidence (seq 37/38) FOUND the hole; this makes the whole class unrepresentable.
describe('the invariant — nothing selectable is stage-silent, all 75 e0 events', () => {
  const load = (n: string): ArrayBuffer => {
    const b = readFileSync(`contract/fixtures/${n}`)
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
  }
  const model = new RunModel(decodeBundle(load('e0_seed42.det')), null)
  const stage = buildQueryDraws(model) // parses AND validates every LOS composition at publish
  const componentSeqs = new Set<number>()
  for (const comp of stage.losComposites.values()) for (const c of comp.components) componentSeqs.add(c.seq)
  const precomp = buildPrecomp(stage.draws, componentSeqs, stage.losComposites)

  // A "stage element" for a seq = ANY renderable primitive the precomp emits: an ambient line, its OWN
  // component corridor (the un-suppression), a persistent contact, or a tiebreak badge. Selecting the seq
  // draws ≥1 of these (WRITTEN; the ghost fills in the line/contact). Pure function of the precomp.
  const hasBadge = (seq: number): boolean => precomp.badges.some((b) => b.seq === seq)
  const stageElements = (seq: number): number =>
    (indexOfSeq(precomp.lineSeqs, seq) >= 0 ? 1 : 0) +
    (precomp.componentLines.has(seq) ? 1 : 0) +
    (indexOfSeq(precomp.contactSeqs, seq) >= 0 ? 1 : 0) +
    (hasBadge(seq) ? 1 : 0)

  test('every one of the 75 selectable events yields ≥1 stage element (the class is closed)', () => {
    const silent: number[] = []
    for (let seq = 0; seq < model.eventCount; seq++) {
      if (stage.draws[seq] === null) continue // not a selectable query event
      if (stageElements(seq) === 0) silent.push(seq)
    }
    expect(silent, `stage-silent selectable seqs: ${silent.join(', ')}`).toEqual([])
  })

  test('the taught center-click (seq 37/38, MISS LOS components) now draws its OWN corridor — the defect this closes', () => {
    // Before un-suppression these had NO line and NO contact (and no badge — tiebreak false), so selecting them
    // at tick 0 was the empty stage. Now each carries a component corridor (o→g) that both the written selection
    // and the
    // ghost draw; they are MISS components (no contact), so the corridor is the whole answer.
    for (const seq of [37, 38]) {
      expect(componentSeqs.has(seq)).toBe(true)
      expect(precomp.componentLines.has(seq)).toBe(true)      // its OWN corridor (the fix)
      expect(indexOfSeq(precomp.lineSeqs, seq)).toBe(-1)      // still OUT of the ambient packing (playback de-dup stands)
      expect(indexOfSeq(precomp.contactSeqs, seq)).toBe(-1)   // a MISS component — no contact
      expect(hasBadge(seq)).toBe(false)                        // no badge either → pre-fix this seq was stage-silent
    }
  })

  test('a HIT LOS component (seq 36) draws its corridor AND keeps its now-selectable hit contact', () => {
    expect(precomp.componentLines.has(36)).toBe(true)
    const ci = indexOfSeq(precomp.contactSeqs, 36)
    expect(ci).toBeGreaterThanOrEqual(0)
    expect(precomp.contacts[ci]!.selectable).toBe(true) // un-suppression: a selected component's contact pops to accent
  })

  // Honesty (disclosed, not hidden): the GHOST previews lines + contacts but NOT badges (the ghost grammar). Pin the one
  // event whose ONLY element is a badge — the degenerate zero-range self-measurement (seq 16, o==g, range 0:
  // geometrically no ray, no contact). It is non-silent WRITTEN (its tiebreak badge renders under selection) and
  // is the SOLE seq the ghost cannot preview. Pinned so this single blind spot is a KNOWN, tested fact.
  test('the sole badge-only event is the degenerate zero-range measurement (seq 16) — the one ghost blind spot', () => {
    const badgeOnly: number[] = []
    for (let seq = 0; seq < model.eventCount; seq++) {
      if (stage.draws[seq] === null) continue
      const line = indexOfSeq(precomp.lineSeqs, seq) >= 0 || precomp.componentLines.has(seq)
      const contact = indexOfSeq(precomp.contactSeqs, seq) >= 0
      if (!line && !contact && hasBadge(seq)) badgeOnly.push(seq)
    }
    expect(badgeOnly).toEqual([16])
    const d = stage.draws[16]!
    expect(d.kind).toBe(2) // RANGE_BEARING
    expect((d as RangeBearingDraw).rangeM).toBe(0) // a zero-length measurement — no ray to draw, written or ghost
  })
})

// ── The SELECTED line paint-range reducer (the untested stateful seam that hid the stale-band bug) ─────
// Under a standing selection the beyond-horizon lines carry a reveal-dependent ambient×yield×fade colour; the
// paint range must cover EVERY line whose fade changed across the reveal delta. The shipped `from` anchored on
// the NEW fade window alone, so a multi-tick FORWARD jump stranded the OLD window's lines (which crossed
// fade→0 mid-jump) at their pre-jump ambient×0.3. The reducer anchors `from` on min(prev,new) − LINE_FADE_TICKS
// so the old lower edge is always in range. Pinned directly on a contiguous seq array (seq == index → the
// window maths is transparent: lowerIndex(S) == S, prefixCount(R) == R+1).
describe('linePaintRange — the pure paint-range reducer', () => {
  const seqs = Int32Array.from({ length: 50 }, (_, i) => i) // seq == index
  const FADE = 6 // mirror of LINE_FADE_TICKS

  test('single-tick advance repaints the bounded trailing window + the one append', () => {
    // prev 20 → new 21; the buffer held [0,21) at reveal 20. Union window lower edge = 20 − 6 = 14.
    const { from, to } = linePaintRange(seqs, 20, 21, 21 /* prefixCount(20) */)
    expect(from).toBe(14)           // lowerIndex(14)
    expect(to).toBe(22)             // prefixCount(21)
    expect(to - from).toBeLessThanOrEqual(FADE + 2) // O(window), never O(revealed)
  })

  test('multi-tick FORWARD jump covers the OLD window — the stale-band bug this closes', () => {
    // prev 20 → new 30 (jump 10 > FADE). The pre-fix `from = min(lowerIndex(new−FADE=24)=24, extent=21) = 21`
    // skipped seqs 14..20 — the OLD window, now all fade→0 — leaving them at stale ambient×0.3. The reducer
    // anchors on min(prev,new)−FADE = 14, so those lines are repainted (to black) in the same pass.
    const { from, to } = linePaintRange(seqs, 20, 30, 21)
    expect(from).toBe(14)           // NOT 21 — the old window's lower edge is covered
    expect(to).toBe(31)             // prefixCount(30) — the appends
    expect(from).toBeLessThanOrEqual(20) // the pre-jump head (seq 20, now fade 0) is inside the repaint range
  })

  test('the exact fade→0 boundary: a jump of exactly LINE_FADE_TICKS still blacks the whole old window', () => {
    // prev 20 → new 26 (jump == FADE). At reveal 26 every seq ≤ 20 is behind ≥ 6 ⟹ fade 0; the old window
    // [15..20] must all be repainted. from = 20 − 6 = 14 ≤ 15, so the whole old window is in range.
    const { from } = linePaintRange(seqs, 20, 26, 21)
    expect(from).toBe(14)
  })

  test('backward scrub repaints the new window and shrinks the extent (to = the smaller prefix)', () => {
    // prev 30 → new 20. Union lower edge = min(30,20) − 6 = 14; to = prefixCount(20) = 21 (count shrinks so the
    // now-unrevealed lines 21..30 stop drawing).
    const { from, to } = linePaintRange(seqs, 30, 20, 31 /* prefixCount(30) */)
    expect(from).toBe(14)
    expect(to).toBe(21)
    expect(from).toBeLessThanOrEqual(to)
  })

  test('`from` is clamped to the painted extent (never past what the buffer holds)', () => {
    // A pathological small extent: from must not exceed prevExtent even if the window start would.
    const { from } = linePaintRange(seqs, 20, 21, 5)
    expect(from).toBe(5) // min(lowerIndex(14)=14, extent 5)
  })
})

// ── A SELECTED LOS COMPOSITE lights only its GEOMETRICALLY-DISTINCT component corridors ─
// THE DEFECT THIS CLOSES (confirmed by geometry): validateLosComposite pins each component's (o,g)
// IDENTICAL to the composite argv, and a CLEAR composite has NO HIT — so every MISS component's corridor is
// BYTE-THE-SAME o→g segment as the composite's own accent subject sightline. The earlier overlay drew all three,
// stacking three additive ROLE_BY_HOP instances ON the subject → the payoff CLEAR sightline read violet, not
// accent (one-segment-one-owner, violated). THE FIX — ownership by geometric distinctness: draw a component
// ONLY when its corridor DIFFERS from the composite's drawn subject segment, i.e. a HIT that is not the
// firstBlocker (a MISS corridor is the subject; the firstBlocker's hit point is exactly where the BLOCKED
// subject dies). So a CLEAR composite draws ZERO overlay corridors (subject alone), and a BLOCKED composite
// draws only the distinct HIT corridors the subject's single death point does not already show. Deselect ⟹ empty.
describe('writeCompositeComponentCorridors — ownership by geometric distinctness', () => {
  const mkMesh = (): THREE.InstancedMesh =>
    new THREE.InstancedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial(), HORIZON_HOPS)
  const readColor = (m: THREE.InstancedMesh, i: number): THREE.Color =>
    new THREE.Color().fromArray(m.instanceColor!.array, i * 3)
  const registerOf = (c: THREE.Color): number =>
    ROLE_BY_HOP.findIndex((r) => Math.abs(r.r - c.r) < 1e-6 && Math.abs(r.g - c.g) < 1e-6 && Math.abs(r.b - c.b) < 1e-6)
  // The instance buffer is Float32; a matrix read back from it is Float32-rounded vs the Float64 source
  // componentLines matrix — compare within a tolerance well above Float32 epsilon at these coordinate scales.
  const matClose = (a: THREE.Matrix4, b: THREE.Matrix4): boolean => a.elements.every((v, k) => Math.abs(v - b.elements[k]!) < 1e-2)

  // A component ray carrying only the fields the ownership predicate + register logic read (seq, verdict); the
  // corridor MATRIX itself comes from componentLines (keyed by seq), so verdict alone drives the distinctness.
  const rc = (seq: number, object: number, verdict: 'HIT' | 'MISS'): RayDraw =>
    ({ kind: 3, seq, object, mode: 1, o: [0, 0, 0], target: [700, 0, 0], verdict, tiebreak: false,
       t: verdict === 'HIT' ? 0.5 : null, hitPoint: verdict === 'HIT' ? [object * 100, 0, 0] : null,
       metricDist: verdict === 'HIT' ? object * 100 : null })
  // DISTINCT corridor matrices per seq so a drawn instance maps back to its seq → its register.
  const componentLines = new Map<number, THREE.Matrix4>(
    [17, 18, 19, 27, 28, 29].map((s) => [s, new THREE.Matrix4().makeTranslation(s, 0, 0)]))

  // CLEAR composite (all-MISS) — every corridor coincides with the o→g subject → the overlay must yield fully.
  const clearComposite = {
    seq: 20, los: clear(20) as SightlineDraw, components: [rc(17, 1, 'MISS'), rc(18, 2, 'MISS'), rc(19, 3, 'MISS')],
    firstBlocker: null, blockerObject: null,
  } as LosComposite
  const hopClear = new Map<number, number>([[20, 0], [19, 1], [18, 2], [17, 3]]) // nearest-first
  // BLOCKED composite — comp 27 (obj1) HIT = firstBlocker (subject dies here), 28 (obj2) MISS, 29 (obj3) HIT
  // distinct. Only 29 is distinct from the subject → only 29 draws.
  const b27 = rc(27, 1, 'HIT'), b28 = rc(28, 2, 'MISS'), b29 = rc(29, 3, 'HIT')
  const blockedComposite = {
    seq: 30, los: blocked(30) as SightlineDraw, components: [b27, b28, b29], firstBlocker: b27, blockerObject: 1,
  } as LosComposite
  const hopBlocked = new Map<number, number>([[30, 0], [29, 1], [28, 2], [27, 3]]) // 29 → hop 1 → register 0

  test('(b) a CLEAR composite (all-MISS) draws ZERO overlay corridors — the accent sightline alone owns the segment', () => {
    const mesh = mkMesh()
    const n = writeCompositeComponentCorridors(mesh, clearComposite, componentLines, hopClear, 30)
    expect(n).toBe(0)      // all three corridors ARE the subject line → they yield, no violet wash
    expect(mesh.count).toBe(0)
  })

  test('(c) a BLOCKED composite draws ONLY its distinct (non-firstBlocker) HIT corridor — the MISS + firstBlocker yield', () => {
    const mesh = mkMesh()
    const n = writeCompositeComponentCorridors(mesh, blockedComposite, componentLines, hopBlocked, 30)
    expect(n).toBe(1) // only comp 29 (obj3 HIT, distinct); 27 (firstBlocker == subject) + 28 (MISS) yield
    const m = new THREE.Matrix4(); mesh.getMatrixAt(0, m)
    expect(matClose(m, componentLines.get(29)!)).toBe(true) // byte-identical to the un-suppression geometry
    expect(registerOf(readColor(mesh, 0))).toBe(0)          // 29 is hop 1 → ROLE_BY_HOP[0] (×1.0)
  })

  test('(d) deselect / a non-composite selection empties the overlay (rest byte-identity holds)', () => {
    const mesh = mkMesh()
    writeCompositeComponentCorridors(mesh, blockedComposite, componentLines, hopBlocked, 30) // light it
    expect(mesh.count).toBe(1)
    expect(writeCompositeComponentCorridors(mesh, undefined, componentLines, hopBlocked, 30)).toBe(0)
    expect(mesh.count).toBe(0) // empty again — the overlay is a separate mesh, contributing nothing at rest
  })

  test('an unrevealed distinct HIT is not drawn; a beyond-horizon component is skipped', () => {
    // reveal 28 ⟹ the distinct HIT (seq 29 > 28) not yet written → nothing draws.
    expect(writeCompositeComponentCorridors(mkMesh(), blockedComposite, componentLines, hopBlocked, 28)).toBe(0)
    // 29 absent from the hop map (beyond the horizon) → skipped, not drawn in a phantom register.
    const hopNo29 = new Map<number, number>([[30, 0], [28, 2], [27, 3]])
    expect(writeCompositeComponentCorridors(mkMesh(), blockedComposite, componentLines, hopNo29, 30)).toBe(0)
  })

  // ── Real e0 pins (the wave's own test cases 51/74, plus the blocked cases) ────────────────────────────────
  const load = (nm: string): ArrayBuffer => { const b = readFileSync(`contract/fixtures/${nm}`); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }
  const model = new RunModel(decodeBundle(load('e0_seed42.det')), null)
  const stage = buildQueryDraws(model)
  const componentSeqs = new Set<number>()
  for (const comp of stage.losComposites.values()) for (const c of comp.components) componentSeqs.add(c.seq)
  const precomp = buildPrecomp(stage.draws, componentSeqs, stage.losComposites)

  test('(b) real e0: CLEAR composites 51 and 74 draw ZERO overlay corridors — the accent sightline sails clean, no wash', () => {
    for (const cs of [51, 74]) {
      const composite = stage.losComposites.get(cs)!
      expect(composite.los.verdict).toBe('LOS_CLEAR')
      const hopMap = causalHops(model, cs, HORIZON_HOPS)
      const n = writeCompositeComponentCorridors(mkMesh(), composite, precomp.componentLines, hopMap, model.eventCount)
      expect(n, `CLEAR composite ${cs} draws no overlay corridor`).toBe(0)
    }
  })

  test('(c) real e0: BLOCKED composite 70 draws ONLY its distinct HIT (comp 69) in register 0; firstBlocker 67 + MISS 68 yield', () => {
    const composite = stage.losComposites.get(70)!
    expect(composite.los.verdict).toBe('BLOCKED')
    expect(composite.firstBlocker!.seq).toBe(67) // sphere block — the subject line dies at hitPoint(67)
    const hopMap = causalHops(model, 70, HORIZON_HOPS)
    const mesh = mkMesh()
    const n = writeCompositeComponentCorridors(mesh, composite, precomp.componentLines, hopMap, model.eventCount)
    expect(n).toBe(1) // comp 69 (obj3 HIT) only — distinct occluder beyond the sphere; 67 (subject) + 68 (MISS) yield
    const m = new THREE.Matrix4(); mesh.getMatrixAt(0, m)
    expect(matClose(m, precomp.componentLines.get(69)!)).toBe(true) // byte-identical to the un-suppression geometry
    expect(registerOf(readColor(mesh, 0))).toBe(0) // 69 is hop 1 (70←69) → ROLE_BY_HOP[0]
  })

  test('(c) real e0: single-HIT BLOCKED composites draw ZERO — their lone HIT is the firstBlocker the subject already owns', () => {
    // 39/43/47/55/62/66 each have exactly one HIT = firstBlocker; its corridor IS the subject sightline, so it
    // yields. The block is still shown — by the accent SUBJECT line dying at that hit point — not by a stacked
    // overlay. Only composite 70 (two HITs) has a distinct second blocker to draw.
    for (const cs of [39, 43, 47, 55, 62, 66]) {
      const composite = stage.losComposites.get(cs)!
      const hits = composite.components.filter((c) => c.verdict === 'HIT')
      expect(hits.length, `blocked composite ${cs} is single-HIT`).toBe(1)
      expect(hits[0]!.seq).toBe(composite.firstBlocker!.seq)
      const hopMap = causalHops(model, cs, HORIZON_HOPS)
      const n = writeCompositeComponentCorridors(mkMesh(), composite, precomp.componentLines, hopMap, model.eventCount)
      expect(n, `single-HIT blocked composite ${cs} yields fully to the subject`).toBe(0)
    }
  })

  test('(a) real e0: no overlay corridor duplicates a main selected-line matrix (one-segment-one-owner)', () => {
    // "Main selected-line matrices" = every matrix the main line pass can paint under a composite selection
    // (precomp.lines; the suppressed component corridors are held OUT of this set by the de-dup). A duplicate
    // would mean an additive overlay instance STACKED on a subject/neighbour line — the wash. Across ALL e0
    // composites (2 CLEAR + 7 BLOCKED) the fix guarantees none.
    const mainMats = precomp.lines.map((l) => l.mat)
    for (const cs of stage.losComposites.keys()) {
      const composite = stage.losComposites.get(cs)!
      const hopMap = causalHops(model, cs, HORIZON_HOPS)
      const mesh = mkMesh()
      const n = writeCompositeComponentCorridors(mesh, composite, precomp.componentLines, hopMap, model.eventCount)
      for (let i = 0; i < n; i++) {
        const m = new THREE.Matrix4(); mesh.getMatrixAt(i, m)
        const dup = mainMats.find((mm) => matClose(mm, m))
        expect(dup, `composite ${cs} overlay corridor ${i} duplicates a main line matrix`).toBeUndefined()
      }
    }
  })

  test('(a) the pin is non-vacuous: a CLEAR composite\'s suppressed MISS corridors ARE byte-identical to its subject line', () => {
    // Prove the coincidence the guard defends against is real — were the overlay to draw the CLEAR components
    // (the pre-fix wave-1 behavior), each would land EXACTLY on the subject sightline matrix → a washed hue.
    for (const cs of [51, 74]) {
      const composite = stage.losComposites.get(cs)!
      const subject = precomp.lines[indexOfSeq(precomp.lineSeqs, cs)]!.mat
      for (const c of composite.components) {
        expect(precomp.componentLines.get(c.seq)!.equals(subject), `CLEAR ${cs}: comp ${c.seq} corridor == subject`).toBe(true)
      }
    }
  })
})
