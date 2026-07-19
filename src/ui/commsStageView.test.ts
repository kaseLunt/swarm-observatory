import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { PULSE_DELIVERED, PULSE_DROP, ANCHOR_QUIET, PAD_SCAFFOLD, PAD_OPACITY, LABEL_FILL, pulseWorldInto, AFTERGLOW_MAX_INTENSITY, terminalFadeStep } from './commsStageView'
import {
  COMMS_PAD_SRC, COMMS_PAD_DST, COMMS_MID_SPAN, buildCommsStage,
  buildPulseInstances, pulseProgressAt, spatialAlong, heroPresentationAt,
  dropRevealAt, anchorLabel, dropReasonName,
  DROP_FLIGHT_TICKS, HERO_PRESENT_TICKS, MISSING_DELIVERED_FLIGHT_TICKS, type CommsSource,
} from './commsStage'
import { BLOOM_LUMINANCE_THRESHOLD, PALETTE, CATEGORY, hexToThree } from './theme'
import { asEventTick } from '../lib/brand'
import { decodeBundle } from '../decode/decodeBundle'
import { RunModel } from '../model/runModel'
import type { MessageSent, MessageDelivered, MessageDropped } from '../decode/payloads'
import type { RunManifest } from '../decode/manifest'

// ── THE "ONE BLOOM PER RUN" DISCIPLINE — the drop pulse is the SINGLE emphasis ──────────────────────────────
// three.js luminance (Rec.709 — the exact weights the postprocessing Bloom's LuminanceMaterial uses; the
// renderer's tone mapping is OFF before Bloom, so it sees these linear values). Bound THROUGH the shader's colour
// uniforms (uDelivered = PULSE_DELIVERED, uHero = PULSE_DROP) and the anchor colour: a delivered pulse and the
// persistent anchor must sit BELOW the cutoff (quiet, unbloomed), and ONLY the hero drop clears it — so the whole
// lens has exactly one bloom, on the thing that earned it. The fragment shader outputs these exact colours.
const W = [0.2126729, 0.7151522, 0.0721750] as const
const lum = (c: THREE.Color): number => W[0] * c.r + W[1] * c.g + W[2] * c.b

describe('the comms stage blooms exactly once — only the hero drop clears the threshold', () => {
  test('the DROP (hero) colour clears the bloom threshold (the one emphasis — the fizzle glows)', () => {
    expect(lum(PULSE_DROP)).toBeGreaterThan(BLOOM_LUMINANCE_THRESHOLD)
  })
  test('a DELIVERED pulse colour sits BELOW the threshold — every clean crossing is unbloomed', () => {
    expect(lum(PULSE_DELIVERED)).toBeLessThan(BLOOM_LUMINANCE_THRESHOLD)
  })
  test('the persistent ANCHOR sits BELOW the threshold — findable, but quiet once its moment has passed', () => {
    expect(lum(ANCHOR_QUIET)).toBeLessThan(BLOOM_LUMINANCE_THRESHOLD)
  })
  // THE AFTERGLOW IS SUB-BLOOM FROM ITS FIRST FRAME — the emphasis STEPS DOWN to the cap at the collapse→afterglow
  // boundary (never continuing from 1), so it never re-blooms. The cap is DERIVED from the real arithmetic: the
  // maximum afterglow output (cap × the hero colour's luminance) must sit below the bloom threshold. This pins that
  // against the actual PULSE_DROP luminance and BLOOM_LUMINANCE_THRESHOLD — not a magic number.
  test('the afterglow cap is genuinely sub-bloom: cap × luminance(hero) < threshold < 1 × luminance(hero) (the collapse)', () => {
    const heroLum = lum(PULSE_DROP)
    expect(heroLum).toBeGreaterThan(BLOOM_LUMINANCE_THRESHOLD)                    // the collapse (intensity 1) blooms
    // the FIRST afterglow frame (intensity = the cap) is the BRIGHTEST the afterglow ever gets — it must be sub-bloom.
    expect(AFTERGLOW_MAX_INTENSITY * heroLum).toBeLessThan(BLOOM_LUMINANCE_THRESHOLD)
    // …and the cap is genuinely derived from that ceiling (not a guess): it is 90% of threshold/heroLum.
    expect(AFTERGLOW_MAX_INTENSITY).toBeCloseTo(0.9 * BLOOM_LUMINANCE_THRESHOLD / heroLum, 9)
    // the model mirror agrees: at the afterglow's first frame heroPresentationAt returns exactly the cap (the step-down).
    const t0 = 30, dur = DROP_FLIGHT_TICKS
    expect(heroPresentationAt(t0, dur, t0 + dur, AFTERGLOW_MAX_INTENSITY)).toBeCloseTo(AFTERGLOW_MAX_INTENSITY, 9)
    // scaling the hero colour by the cap (what the fragment does) lands sub-bloom from that first frame through zero.
    expect(lum(PULSE_DROP.clone().multiplyScalar(AFTERGLOW_MAX_INTENSITY))).toBeLessThan(BLOOM_LUMINANCE_THRESHOLD)
  })
  // THE ANCHOR LABEL IS SUB-BLOOM TOO — the one-bloom law binds the label, not just the pulses/anchor. textPrimary's
  // OWN linear luminance clears the cut, and the renderer is untone-mapped before Bloom, so a raw textPrimary glyph
  // would GLOW continuously from t30 — a second bloom beside the hero's one. The fill is DERIVED down like the
  // afterglow cap (90% of the threshold, no magic number) and this binds the REAL fill LABEL_FILL the shader draws.
  test('the anchor LABEL fill sits BELOW the threshold — the decoded label names the loss without glowing', () => {
    // the raw textPrimary token WOULD bloom (the review's finding) — so the fill must be derived DOWN from it.
    expect(lum(new THREE.Color(hexToThree(PALETTE.textPrimary)))).toBeGreaterThan(BLOOM_LUMINANCE_THRESHOLD)
    // …the actual label fill does NOT clear the cut (no second glow beside the hero's one bloom).
    expect(lum(LABEL_FILL)).toBeLessThan(BLOOM_LUMINANCE_THRESHOLD)
    // …and the dimming is DERIVED from the threshold arithmetic (the afterglow-cap idiom), not a guess: 90% of the cut.
    expect(lum(LABEL_FILL)).toBeCloseTo(0.9 * BLOOM_LUMINANCE_THRESHOLD, 9)
  })
})

// ── THE TERMINAL RENDER CLOCK — terminalFadeStep: bounded, self-extinguishing, reset on scrub away ────────────
// A hero whose linger window extends past the run end would freeze (visible) when uPlayhead clamps at maxTick. This
// pure step advances a fade ONLY while clamped at the run end with a past-end hero, capped so the effective playhead
// never overshoots the window end (it self-extinguishes); it resets to 0 the moment the playhead leaves the end.
describe('terminalFadeStep — the bounded terminal render clock (advance at the end, reset on scrub away)', () => {
  const heroT0 = 29, maxTick = 30
  const heroWindowEnd = heroT0 + HERO_PRESENT_TICKS // 33 — the hero window [29, 33) extends 3 ticks past the run end
  test('at terminal rest with a past-end hero, the fade ADVANCES by the frame delta, bounded at the remaining linger', () => {
    // from 0, one frame of 0.5 ticks → 0.5; accumulates; and is CAPPED at heroWindowEnd − maxTick = 3 (self-extinguish).
    expect(terminalFadeStep({ playhead: maxTick, maxTick, heroWindowEnd, fade: 0, deltaTicks: 0.5 })).toBeCloseTo(0.5, 9)
    expect(terminalFadeStep({ playhead: maxTick, maxTick, heroWindowEnd, fade: 2.9, deltaTicks: 0.5 })).toBeCloseTo(3, 9) // clamped, not 3.4
    expect(terminalFadeStep({ playhead: maxTick, maxTick, heroWindowEnd, fade: 3, deltaTicks: 0.5 })).toBe(3)            // already complete — stops
  })
  test('a scrub AWAY from the run end RESETS the fade to 0 (returning restarts the decay — exact-current-honest)', () => {
    expect(terminalFadeStep({ playhead: maxTick - 1, maxTick, heroWindowEnd, fade: 2, deltaTicks: 0.5 })).toBe(0)
    expect(terminalFadeStep({ playhead: 5, maxTick, heroWindowEnd, fade: 3, deltaTicks: 0.5 })).toBe(0)
  })
  test('a run with NO past-end hero never advances the fade (heroWindowEnd null → always 0) — f4\'s inert case', () => {
    expect(terminalFadeStep({ playhead: maxTick, maxTick, heroWindowEnd: null, fade: 0, deltaTicks: 0.5 })).toBe(0)
    expect(terminalFadeStep({ playhead: maxTick, maxTick, heroWindowEnd: null, fade: 1, deltaTicks: 0.5 })).toBe(0)
  })
})

// ── THE POSITION MIRROR — pulseWorldInto is the CPU mirror of the vertex shader's mix(aFrom, aTo, frac) ───────
// A vitest cannot execute GLSL, so the position derivation the shader performs is pinned HERE against the same
// endpoints: along 0 → src pad, along 1 → dst pad, along 0.5 → mid-span (the drop's collapse point).
describe('pulseWorldInto — the CPU mirror of the shader\'s mix(from, to, frac) position', () => {
  test('along 0 → the src pad, along 1 → the dst pad, along 0.5 → mid-span (the drop\'s collapse point)', () => {
    const out = new THREE.Vector3()
    pulseWorldInto(out, 0)
    expect([out.x, out.y, out.z]).toEqual([...COMMS_PAD_SRC])
    pulseWorldInto(out, 1)
    expect([out.x, out.y, out.z]).toEqual([...COMMS_PAD_DST])
    pulseWorldInto(out, 0.5)
    expect(out.x).toBeCloseTo(COMMS_MID_SPAN[0], 9)
    expect(out.y).toBeCloseTo(COMMS_MID_SPAN[1], 9)
    expect(out.z).toBeCloseTo(COMMS_MID_SPAN[2], 9)
  })

  test('it writes IN PLACE into the caller\'s vector — the same object across calls, never a fresh allocation', () => {
    const out = new THREE.Vector3(999, 999, 999)
    const returned = pulseWorldInto(out, 0.25) as unknown
    expect(returned).toBeUndefined()     // no allocation returned — it mutates the out param
    expect(out.x).not.toBe(999)          // …and the caller's vector was written in place
  })
})

function detFixture(name: string): ArrayBuffer {
  try {
    const b = readFileSync(`contract/fixtures/${name}.det`)
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
  } catch {
    const base = `contract/fixtures/${name}`
    const dir = readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory())[0]!.name
    const b = readFileSync(`${base}/${dir}/bundle.det`)
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
  }
}
// A RECORDED manifest (dtUs 125000) — matching production; a manifestless model would fall to the shared assumed
// clock (ASSUMED_DT_US) and the delivered flight would use the fixed bound. f4 always ships a manifest.
const f4Data = buildCommsStage(new RunModel(decodeBundle(detFixture('f4_seed42')), { dtUs: 125000 } as unknown as RunManifest))

// ── THE PRECOMPILED INSTANCE ATTRIBUTES — every pinned pulse behaviour lives here now (the shader reads these) ──
// buildPulseInstances is the STAGE-BUILD spawn set: the attributes the vertex/fragment shader animate from the
// playhead uniform. A vitest cannot see into the shader, so it pins the ATTRIBUTE VALUES the shader consumes —
// the drop's collapse geometry (isDrop), the ONE bloom (isHero), the MISSING-clock fixed flight (dur), and the
// !renderable withhold (count 0). Motion/visibility are then pinned via pulseProgressAt (the shader's mirror).
describe('buildPulseInstances — the precompiled per-message attributes the shader animates', () => {
  test('f4: 32 instances; EXACTLY one hero (the t30 drop), its window + collapse pinned; deliveries run to dst', () => {
    const inst = buildPulseInstances(f4Data)
    expect(inst.count).toBe(32)
    // exactly ONE bloom across the whole run — the hero. Every other instance is sub-bloom (isHero 0).
    const heroIdx = [...inst.isHero].map((v, i) => (v === 1 ? i : -1)).filter(i => i >= 0)
    expect(heroIdx.length, 'exactly one hero instance — the one bloom').toBe(1)
    const h = heroIdx[0]!
    expect(inst.isDrop[h]).toBe(1)                 // the hero is the drop…
    expect(inst.t0[h]).toBeCloseTo(30, 9)          // …at t30…
    expect(inst.dur[h]).toBeCloseTo(DROP_FLIGHT_TICKS, 6) // …flying the declared drop duration (0.9 tick; Float32 attr)
    // its from/to are the pads (the presentational path the shader lerps along).
    expect([inst.from[h * 3], inst.from[h * 3 + 1], inst.from[h * 3 + 2]]).toEqual([...COMMS_PAD_SRC])
    expect([inst.to[h * 3], inst.to[h * 3 + 1], inst.to[h * 3 + 2]]).toEqual([...COMMS_PAD_DST])
    // every DELIVERED instance is sub-tick and sub-bloom (isDrop 0, isHero 0, dur < 1) — the ×300 stretch never
    // crosses a tick boundary, so two pulses never coexist and none blooms.
    for (let i = 0; i < inst.count; i++) {
      if (inst.isDrop[i] === 0) {
        expect(inst.isHero[i]).toBe(0)
        expect(inst.dur[i]).toBeGreaterThan(0)
        expect(inst.dur[i]).toBeLessThan(1)
      }
    }
  })

  test('a NON-RENDERABLE mapping yields ZERO instances (the withhold — degrade as one with the strip + chip)', () => {
    // an inconsistent (drop-then-deliver for one msg) mapping; an endpoint anomaly (1→9); a swap (2→1); a src-only
    // disagreement (9→2) — all non-renderable, so the stage spawns NO trajectory.
    const conflict: CommsSource = {
      eventCount: 3, tickCount: 6, ticks: [2, 2, 2],
      entityKeys: () => [],
      kindAt: (s) => (s === 0 ? 5 : s === 1 ? 7 : 6),
      messageSentAt: (s): MessageSent | null => (s === 0 ? { msg: 1n, src: 1n, dst: 2n, channel: 1, snrDb: 12, txPowerW: 256 } : null),
      messageDeliveredAt: (s): MessageDelivered | null => (s === 2 ? { msg: 1n, src: 1n, dst: 2n, latencyUs: 200n, snrDb: 12 } : null),
      messageDroppedAt: (s): MessageDropped | null => (s === 1 ? { msg: 1n, reason: 3, snrDb: 12, jamState: 0 } : null),
      parentOf: (s) => (s === 1 || s === 2 ? 0 : null),
      manifestDtUs: () => 125000,
    }
    expect(buildPulseInstances(buildCommsStage(conflict)).count, 'inconsistent → no trajectory').toBe(0)

    const endpoint = (outSrc: bigint, outDst: bigint): CommsSource => ({
      eventCount: 2, tickCount: 4, ticks: [2, 2],
      entityKeys: () => [],
      kindAt: (s) => (s === 0 ? 5 : 6),
      messageSentAt: (s): MessageSent | null => (s === 0 ? { msg: 1n, src: 1n, dst: 2n, channel: 1, snrDb: 12, txPowerW: 256 } : null),
      messageDeliveredAt: (s): MessageDelivered | null => (s === 1 ? { msg: 1n, src: outSrc, dst: outDst, latencyUs: 200n, snrDb: 12 } : null),
      messageDroppedAt: (): MessageDropped | null => null,
      parentOf: (s) => (s === 1 ? 0 : null),
      manifestDtUs: () => 125000,
    })
    for (const [outSrc, outDst] of [[1n, 9n], [2n, 1n], [9n, 2n]] as [bigint, bigint][]) {
      const d = buildCommsStage(endpoint(outSrc, outDst))
      expect(d.renderable).toBe(false)
      expect(buildPulseInstances(d).count, `contradicted delivery ${outSrc}→${outDst} → no trajectory`).toBe(0)
    }
  })

  test('the MISSING clock gives the delivered instance a BOUNDED fixed duration (< 1 tick) — no survival past the run', () => {
    const missing = buildCommsStage({
      eventCount: 2, tickCount: 4, ticks: [2, 2],
      entityKeys: () => [],
      kindAt: (s) => (s === 0 ? 5 : 6),
      messageSentAt: (s): MessageSent | null => (s === 0 ? { msg: 1n, src: 1n, dst: 2n, channel: 1, snrDb: 12, txPowerW: 256 } : null),
      messageDeliveredAt: (s): MessageDelivered | null => (s === 1 ? { msg: 1n, src: 1n, dst: 2n, latencyUs: 200n, snrDb: 12 } : null),
      messageDroppedAt: (): MessageDropped | null => null,
      parentOf: (s) => (s === 1 ? 0 : null),
      manifestDtUs: () => null, // MISSING clock — det-only
    })
    expect(missing.dtKnown).toBe(false)
    expect(missing.renderable).toBe(true) // a consistent single link — it DOES spawn a delivered instance…
    const inst = buildPulseInstances(missing)
    expect(inst.count).toBe(1)
    expect(inst.dur[0]).toBeCloseTo(MISSING_DELIVERED_FLIGHT_TICKS, 6) // …on the DECLARED fixed bound (Float32 attr), not the 60-tick assumed-clock stretch
    expect(inst.dur[0]).toBeLessThan(1)
    // the shader's window closes well before the run's end (tick 4), so a terminal/cold rest renders nothing.
    expect(pulseProgressAt(inst.t0[0]!, inst.dur[0]!, 4)).toBeNull()
    expect(pulseProgressAt(inst.t0[0]!, inst.dur[0]!, 3)).toBeNull()
  })
})

// ── THE SHADER'S VISIBILITY + COLLAPSE MIRROR — pulseProgressAt + spatialAlong (a vitest cannot run GLSL) ──────
// The vertex shader is visible ⇔ playhead ∈ [t0, t0+dur) and computes progress p = (playhead−t0)/dur; the drop's
// spatial fraction is easeOut(p)·0.5 (collapse at mid-span). These pure mirrors pin exactly what the shader does,
// so the migration to in-shader motion preserves the collapse geometry and the exact-current visibility.
describe('the shader mirror — exact-current visibility + the drop collapse', () => {
  test('pulseProgressAt: the drop pulse is visible ONLY inside its [30, 30.9) window (exact-current)', () => {
    const d = DROP_FLIGHT_TICKS
    expect(pulseProgressAt(30, d, 29.99)).toBeNull()          // before t30 — the link is quiet
    expect(pulseProgressAt(30, d, 30)).toBeCloseTo(0, 9)      // launches at the source (progress 0)
    expect(pulseProgressAt(30, d, 30 + d / 2)).toBeGreaterThan(0)
    expect(pulseProgressAt(30, d, 30 + d)).toBeNull()         // window closed — the anchor takes over
    expect(pulseProgressAt(30, d, 95)).toBeNull()             // the terminal rest shows nothing (nothing to latch)
  })

  test('spatialAlong: a delivered pulse runs the full span; the DROP collapses at mid-span (never past 0.5)', () => {
    expect(spatialAlong(0, false)).toBeCloseTo(0, 9)
    expect(spatialAlong(1, false)).toBeCloseTo(1, 9)     // delivered lands at dst
    expect(spatialAlong(0, true)).toBeCloseTo(0, 9)      // drop launches at src
    expect(spatialAlong(1, true)).toBeCloseTo(0.5, 9)    // drop collapses AT mid-span, never past it
    for (const p of [0.1, 0.37, 0.5, 0.9]) expect(spatialAlong(p, true)).toBeLessThanOrEqual(0.5)
  })

  test('a delivered instance mid-window sits halfway along the span (the shader lerps mix(from, to, p))', () => {
    const first = f4Data.pairs.find(p => p.outcome === 'delivered' && p.send.tick === 2)!
    const inst = buildPulseInstances(f4Data)
    const idx = f4Data.pairs.indexOf(first)
    const dur = inst.dur[idx]!
    expect(pulseProgressAt(2, dur, 2 + dur / 2)).toBeCloseTo(0.5, 9)
    const out = new THREE.Vector3()
    pulseWorldInto(out, spatialAlong(0.5, false))            // a delivered pulse at progress 0.5 → mid-span
    expect(out.x).toBeCloseTo(COMMS_MID_SPAN[0], 9)
  })
})

// ── THE ANCHOR NAMES THE LOSS — the decoded "t30 · LOSS" label (the resting-legibility win: the loss is named at rest) ──
// The persistent conclusion must NAME itself. The label text is DECODED off the hero pair (its outcome tick + its
// reason WORD via dropReasonName — the ONE source the strip shares), never a hardcoded string, so a re-decode
// moves the label. A vitest cannot see into the troika SDF text, so it pins the pure string derivation the view
// renders; the e2e smoke asserts the label is actually shown at rest.
describe('the anchor label — DERIVED from the decoded hero (t30 · LOSS, never a literal)', () => {
  test('dropReasonName maps the kind-7 reason CODE to its spec word — ONE source (JAMMED=1 | RANGE=2 | LOSS=3)', () => {
    expect(dropReasonName(1)).toBe('JAMMED')
    expect(dropReasonName(2)).toBe('RANGE')
    expect(dropReasonName(3)).toBe('LOSS')
    // an unknown/absent code never fabricates a shape — it degrades to a plain token.
    expect(dropReasonName(0)).toBe('DROP')
    expect(dropReasonName(99)).toBe('DROP')
    expect(dropReasonName(null)).toBe('DROP')
  })

  test('anchorLabel is DERIVED from the decoded hero pair (its outcomeTick + reason word), not a hardcoded string', () => {
    const hero = f4Data.hero!
    // the test derives the expected string the SAME way the label does — off the decoded pair, so a re-decode moves both.
    const expected = `t${hero.outcomeTick} · ${dropReasonName(hero.reason)}`
    expect(anchorLabel(hero)).toBe(expected)
    // …and on the frozen f4 bundle that decode is exactly "t30 · LOSS" (msg 14 @ t30, reason 3).
    expect(anchorLabel(hero)).toBe('t30 · LOSS')
    // the tick is the DECODED outcome tick and the word is the DECODED reason — change either and the label follows.
    expect(anchorLabel({ ...hero, outcomeTick: 42 })).toBe('t42 · LOSS')
    expect(anchorLabel({ ...hero, reason: 1 })).toBe('t30 · JAMMED')
  })
})

// ── THE LABEL RIDES THE REVEAL CLOCK — with the anchor, never before it (constitution §4) ───────────────────
// The view gates the anchor GROUP (octahedron + label) on dropRevealAt: withheld before the drop's tick, present
// at/after, and a cold deep-link straight to the tick lands anchored. The label string it then shows is the
// derived hero label. A no-hero mapping never anchors — no anchor, no label (the existing withhold, still held).
describe('the anchor label rides the reveal clock (absent before t30, present at/after, cold deep-link, no-hero → none)', () => {
  test('absent before t30 (not-yet), present at/after (anchored), and a cold deep-link to t30 lands anchored', () => {
    expect(dropRevealAt(f4Data, asEventTick(29))).toBe('not-yet')  // before the tick → the group (label) is withheld
    expect(dropRevealAt(f4Data, asEventTick(30))).toBe('anchored') // AT the tick → the label appears WITH the anchor
    expect(dropRevealAt(f4Data, asEventTick(64))).toBe('anchored') // holds through the silent tail / terminal rest
    // the anchored stage shows the DERIVED hero label (the same derivation the view uses), never a literal.
    expect(anchorLabel(f4Data.hero!)).toBe(`t${f4Data.hero!.outcomeTick} · ${dropReasonName(f4Data.hero!.reason)}`)
  })

  test('a NO-HERO mapping never anchors → no anchor, no label (the withhold holds)', () => {
    const cleanDelivery: CommsSource = {
      eventCount: 2, tickCount: 4, ticks: [2, 2],
      entityKeys: () => [],
      kindAt: (s) => (s === 0 ? 5 : 6),
      messageSentAt: (s): MessageSent | null => (s === 0 ? { msg: 1n, src: 1n, dst: 2n, channel: 1, snrDb: 12, txPowerW: 256 } : null),
      messageDeliveredAt: (s): MessageDelivered | null => (s === 1 ? { msg: 1n, src: 1n, dst: 2n, latencyUs: 200n, snrDb: 12 } : null),
      messageDroppedAt: (): MessageDropped | null => null,
      parentOf: (s) => (s === 1 ? 0 : null),
      manifestDtUs: () => 125000,
    }
    const noHero = buildCommsStage(cleanDelivery)
    expect(noHero.hero).toBeNull()                             // a clean run has no hero…
    expect(dropRevealAt(noHero, asEventTick(2))).toBe('none')  // …so the group never reveals — the view renders '' (no label)
    expect(dropRevealAt(noHero, asEventTick(3))).toBe('none')
  })
})

// ── THE STAGE CHROMA HIERARCHY — the pads recede, the anchor out-ranks them (chroma = hierarchy) ─────────────
// The re-weight is TOKEN-ROUTED (LAW 2 — no new hue): the pads take the neutral scaffold token (the same textDim
// the link baseline wears); the anchor keeps the comms category violet. Pinned at the token level so a regression
// that re-inverts the chroma (pads more chromatic than the conclusion) is caught. The one-bloom rule is untouched.
describe('the stage chroma re-weight — the data-true anchor out-ranks the presentational pads (token level)', () => {
  const hsl = (c: THREE.Color) => { const o = { h: 0, s: 0, l: 0 }; c.getHSL(o); return o }
  test('the pad token ≠ the anchor token: pads take the neutral textDim scaffold; the anchor keeps the comms violet', () => {
    // the pads recede to the SAME neutral grey the link baseline wears (textDim) — one quiet scaffolding system…
    expect(PAD_SCAFFOLD.getHex()).toBe(new THREE.Color(hexToThree(PALETTE.textDim)).getHex())
    // …distinct from the anchor's token (was the same comms-violet family — the inverted-chroma bug).
    expect(PAD_SCAFFOLD.getHex()).not.toBe(ANCHOR_QUIET.getHex())
  })

  test('chroma = hierarchy: the anchor carries MORE chroma than the receded scaffold, and IS the comms hue', () => {
    // the un-inversion: the data-true anchor is more saturated than the desaturated grey scaffolding.
    expect(hsl(ANCHOR_QUIET).s).toBeGreaterThan(hsl(PAD_SCAFFOLD).s)
    // the anchor takes the DISTINCTIVE comms category hue (identity), the pads do not.
    expect(hsl(ANCHOR_QUIET).h).toBeCloseTo(hsl(new THREE.Color(hexToThree(CATEGORY.comms.hue))).h, 5)
  })

  test('the pads RECEDE (dimmer than before) and never bloom — the one-bloom rule is untouched', () => {
    expect(PAD_OPACITY).toBeGreaterThan(0)
    expect(PAD_OPACITY).toBeLessThan(0.5) // dimmer than the prior full-chroma 0.5 wireframe
    // the pads' BLENDED contribution (the grey scaffold × the recede opacity) stays under the bloom cut —
    // only the hero drop clears it (proven above). lum/W are the module-scope Rec.709 helpers.
    expect(lum(PAD_SCAFFOLD) * PAD_OPACITY).toBeLessThan(BLOOM_LUMINANCE_THRESHOLD)
  })
})
