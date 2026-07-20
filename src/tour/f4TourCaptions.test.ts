import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, test, vi } from 'vitest'
import { TOURS } from './tours'
import type { TourStep } from './tourTypes'
import { decodeBundle } from '../decode/decodeBundle'
import { RunModel } from '../model/runModel'
import { asEventTick } from '../lib/brand'
import { buildCommsStage, ledgerAt, dropRevealAt, anchorLabel, type CommsData } from '../ui/commsStage'
import { encodeLink } from '../state/url'
import { shareSpeed } from '../state/speeds'
import { createDriver } from './useTour'
import { useViewStore } from '../state/viewStore'
import type { RunManifest } from '../decode/manifest'

// Force reduced motion for the driver-based share-claim proof below. Under reduced motion a play beat SNAPS — it
// writes tick/playing and NEVER installs an off-ladder witness speed — so a visitor's arriving ladder speed survives
// to the closing beat, which is exactly the runtime path the share claim must be honest about. The caption-honesty
// tests in this file are pure model reads that never read the reduced-motion signal, so this override touches only
// the driver test.
vi.mock('../ui/motion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ui/motion')>()),
  prefersReducedMotion: () => true,
}))

// ── THE CAPTION-HONESTY PIN — every number in every f4 caption is re-derived from the DECODED model AT THAT
// BEAT'S OWN REST PLAYHEAD, never from a design table. The ledger is written by the scrub, so it is playhead-
// scoped: at tick 29 it reads 14 sent · 14 delivered · 0 lost; at tick 30 it splits to 15 · 14 · 1. A caption
// resting BEFORE tick 30 must therefore never claim a loss, and one resting after must. Whole-run figures (the
// 32 recorded messages, the closing 32 / 31 / 1, the receipt's causation/endpoint tallies) are pinned to the
// whole-run model facts and scope-labelled "the whole run"; playhead-scoped figures are scope-labelled "so far".
// This makes the house caption-honesty law mechanical: a re-vendor that moves a number, or a scope, fails here.

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
// f4 ships a manifest (recorded dt 125000µs); the model tests pass one so they match production exactly.
const model = new RunModel(decodeBundle(detFixture('f4_seed42')), { dtUs: 125000 } as unknown as RunManifest)
const data: CommsData = buildCommsStage(model)

const tour = TOURS.f4!
// A beat's REST playhead: a play beat lands on its target tick, a scrub beat on its tick (matching the driver —
// onArrived snaps setTick(target), and under reduced motion startPlay snaps to the SAME target).
const restTick = (step: TourStep): number => (step.play ? step.play.to : step.tick!)
const captionOf = (i: number): string => tour.steps[i]!.caption
const led = (i: number) => ledgerAt(data, asEventTick(restTick(tour.steps[i]!)))

describe('f4 caption honesty — every quoted number matches the decoded model at that beat\'s playhead', () => {
  test('the hero is the one supported drop (msg 14 @ t30) — the fixed points the captions name', () => {
    expect(data.hero).not.toBeNull()
    expect(data.hero!.msg).toBe(14n)
    expect(data.hero!.send.tick).toBe(30)
    expect(data.hero!.outcomeTick).toBe(30)
    expect(anchorLabel(data.hero!)).toBe('t30 · LOSS')
  })

  test('beat 0 (tick 0) — the whole-run count, scope-labelled; the endpoints are two, staged not placed', () => {
    const c = captionOf(0)
    expect(new Set([data.link!.src, data.link!.dst]).size).toBe(2)
    expect(c).toContain('two endpoints')
    expect(c).toContain(`${data.sends.length} messages`) // whole-run sends = 32
    expect(c).toContain('the whole run')                 // the count names its scope
    expect(c).toContain('not placed by position')        // the endpoints are presentational — no geography claim
  })

  test('beat 1 (tick 20) — "nothing lost so far", pinned to lost === 0 at the rest playhead', () => {
    expect(led(1).lost).toBe(0)
    const c = captionOf(1)
    expect(c).toContain('nothing lost so far')
  })

  test('beat 2 (tick 29) — 14 sent · 14 delivered · not one lost, SO FAR; watch tick 30 (pre-t30, no loss yet)', () => {
    const l = led(2)
    expect(l).toEqual({ sent: 14, delivered: 14, lost: 0 }) // the metronome, the drop still NOT-YET
    const c = captionOf(2)
    expect(c).toContain(`${l.sent} sent`)
    expect(c).toContain(`${l.delivered} delivered`)
    expect(c).toContain('not one lost')
    expect(c).toContain('so far')
    expect(c).toContain(`tick ${data.hero!.send.tick}`) // "watch tick 30"
  })

  test('beat 3 (tick 31) — THE SPLIT: the fifteenth send (marked msg 14) is lost, 1 lost so far, the labelled anchor', () => {
    const l = led(3)
    expect(l).toEqual({ sent: 15, delivered: 14, lost: 1 }) // the ledger has split at the rest playhead
    expect(dropRevealAt(data, asEventTick(restTick(tour.steps[3]!)))).toBe('anchored')
    // The dropped message is the FIFTEENTH send, though its zero-based marker is msg 14 (ids 0–13 are the fourteen
    // delivered before it). The count of sends through the hero's OWN send tick IS that ordinal — 15 — so the
    // caption names BOTH the ordinal and the marker, and "14 delivered" never reads as the same message as "msg 14".
    const heroOrdinal = ledgerAt(data, asEventTick(data.hero!.send.tick)).sent
    expect(heroOrdinal).toBe(15)
    const c = captionOf(3)
    expect(c).toContain('fifteenth')                       // the ordinal — never one of the fourteen delivered
    expect(c).toContain(`msg ${data.hero!.msg}`)           // the marker: msg 14
    expect(c).toContain(`tick ${data.hero!.send.tick}`)    // sent at tick 30
    expect(c).toContain(`${l.lost} lost so far`)           // 1 lost, scope-labelled
    expect(c).toContain(anchorLabel(data.hero!))           // the persistent "t30 · LOSS" mark
  })

  test('beat 4 (tick 95) — the run closes 32 / 31 / 1, scope-labelled "the whole run"; the loss holds at 1', () => {
    const l = led(4)
    expect(l).toEqual({ sent: 32, delivered: 31, lost: 1 })
    const c = captionOf(4)
    expect(c).toContain(`${l.sent} sent`)
    expect(c).toContain(`${l.delivered} delivered`)
    expect(c).toContain(`holds at ${l.lost}`) // the lost count holds at 1
    expect(c.toLowerCase()).toContain('the whole run') // the closing tally names its scope (sentence-initial here)
    expect(c).toContain('never arrived')       // the quality register, never a failure/mismatch word
  })

  test('beat 5 (tick 95) — the receipt: 32 causation edges and 31 delivered receipts, both pointing at the one loss', () => {
    const causationReadings = data.resolvingAudits.length
    const endpointReadings = data.resolvingAudits.filter(a => a.outcome === 'delivered').length
    expect(causationReadings).toBe(32)
    expect(endpointReadings).toBe(31)
    const c = captionOf(5)
    expect(c).toContain(`${causationReadings} causation edges`)
    expect(c).toContain(`${endpointReadings} delivered receipts`)
    expect(c).toContain(`msg ${data.hero!.msg}`) // the marker msg 14…
    expect(c).toContain('fifteenth')             // …named alongside its ordinal, consistent with beat 3
    expect(c).toContain('the whole run')
    // the honest evidence grammar: the self-consistent ring (not a manifest seal), the loss in the quality
    // register (never the byte-mismatch ✗).
    expect(c).toContain('self-consistent')
    expect(c).toContain('never arrived')
    expect(c).toContain('not a byte-mismatch')
  })

  test('beat 5 share claim binds to the URL serializer field set — the guided view (tour beat / camera) never round-trips', () => {
    // encodeLink is the ONE share serializer; its emitted params are exactly what a shared link reproduces. Binding
    // the caption to this set means a serializer that GROWS or SHRINKS a field breaks THIS pin, forcing the share
    // claim to follow. The active tour beat and the authored camera are NOT in the set — a recipient opens the
    // resting view, never the guided one, so the caption may name only fields that round-trip (never the guided state).
    const keys = [...new URLSearchParams(encodeLink({ run: 'f4', tick: 95, sel: '1:0', ev: 5, speed: 8 })).keys()].sort()
    expect(keys).toEqual(['ev', 'run', 'sel', 'speed', 'tick']) // run · tick · selection (sel + ev) · speed — and NOTHING else
    // The caption names run + tick (both always round-trip) and over-promises nothing. WHICH of these fields the DRIVEN
    // tour actually emits at rest — the conditional runtime contract, including speed riding along — is proven below.
    const c = captionOf(5).toLowerCase()
    expect(c).toContain('run')
    expect(c).toContain('tick')
    expect(c, 'the retired overreach ("every view is a shareable URL") must be gone').not.toContain('shareable')
    expect(c).not.toContain('every view')
    for (const notShared of ['tour', 'step', 'framing', 'camera', 'guided']) {
      expect(c, `the share claim must not promise "${notShared}" round-trips`).not.toContain(notShared)
    }
  })

  test('NO pre-t30 beat claims a loss — the ledger is NOT-YET before the drop (the playhead-scope hazard)', () => {
    // Beats 0–2 rest at ticks 0, 20, 29 — all before the loss at t30, so lost === 0 there and NO "1 lost".
    for (const i of [0, 1, 2]) {
      expect(led(i).lost).toBe(0)
      expect(captionOf(i)).not.toContain('1 lost')
    }
    // Beats 3–5 rest at/after the loss, so lost === 1 there.
    for (const i of [3, 4, 5]) expect(led(i).lost).toBe(1)
  })

  test('COPY BANS — no contested/jam/attack/failure language; the loss speaks the quality register only', () => {
    for (const step of tour.steps) {
      const c = step.caption.toLowerCase()
      for (const banned of ['contested', 'jam', 'attack', 'failure', 'failed', 'corrupt', 'error']) {
        expect(c, `caption must not use "${banned}": ${step.caption}`).not.toContain(banned)
      }
    }
  })

  test('REDUCED-MOTION REST — the loss beat snaps to tick 31 and still lands the anchor + the split ledger (no bloom)', () => {
    // Under reduced motion the play beat snaps to its target (no sweep, the bloom skipped). The resting frame must
    // carry the whole conclusion on its own: the persistent anchor and the split ledger, both pure playhead facts.
    const rm = asEventTick(restTick(tour.steps[3]!)) // tick 31 — the snapped landing
    expect(dropRevealAt(data, rm)).toBe('anchored')               // the "t30 · LOSS" anchor is up at rest
    expect(ledgerAt(data, rm)).toEqual({ sent: 15, delivered: 14, lost: 1 }) // the split ledger is written
  })
})

// ── THE DRIVEN RESTING-VIEW CONTRACT — the share claim proven against the REAL tour driver, never fabricated ──────
// The caption's share claim must match what a visitor's own copy-link actually produces at the closing beat. Reduced
// motion is the load-bearing path (forced by the module mock above): a play beat SNAPS — it writes tick/playing but
// never an off-ladder witness speed — so a visitor arriving at ?run=f4&speed=4 reaches beat 5 STILL at ladder speed 4,
// and the copy path (shareSpeed passes a ladder speed through) emits run=f4&tick=95&speed=4. So the honest contract is
// CONDITIONAL, not "run + tick only":
//   • run + tick ALWAYS (run always; the closing tick 95 > 0),
//   • selection NEVER (this tour clears entity/event at beat 0 and never re-selects — sel/ev never serialize),
//   • speed CONDITIONALLY — it rides along exactly when the arriving ladder speed is non-default.
// This drives the ACTUAL createDriver against the real store (the useTour.test.ts idiom), never hand-built state.
describe('f4 beat 5 share claim — the driven resting view matches the caption (reduced motion, the copy path)', () => {
  // Drive the f4 tour to its closing beat from a given ladder speed and return the params a copy-link would carry.
  const driveToBeat5 = (startSpeed: number): URLSearchParams => {
    useViewStore.setState({
      runId: 'f4', tick: 0, fraction: 0, playing: false,
      selectedEntity: null, selectedEvent: null, finale: false, speed: startSpeed,
    })
    let stepIndex = -1
    const driver = createDriver((v) => { stepIndex = v.stepIndex }, { current: null })
    vi.useFakeTimers()
    try {
      driver.start(tour)
      // Under reduced motion each play beat snaps synchronously inside enterStep; only the reading holds pace the run.
      // Advance holds 0..4 to rest ON beat 5 (never its own hold — completing the tour would restore the pre-tour speed).
      for (let i = 0; i < 5; i++) vi.advanceTimersByTime(tour.steps[i]!.holdMs)
      expect(stepIndex, 'the driver reached the closing beat').toBe(5)
      const s = useViewStore.getState()
      expect(s.tick).toBe(95) // beat 5 rests at the run's last tick
      // EXACTLY the copy-link path (App's copy handler): shareSpeed passes a ladder speed through, collapses off-ladder.
      return new URLSearchParams(encodeLink({
        run: s.runId, tick: s.tick, sel: s.selectedEntity, ev: s.selectedEvent, speed: shareSpeed(s.speed),
      }))
    } finally {
      driver.dispose() // withSync=false — tears the tour down and restores the captured speed, with no URL write
      vi.useRealTimers()
    }
  }

  test('from a NON-DEFAULT ladder speed (4): run + tick + speed round-trip; selection never does', () => {
    const p = driveToBeat5(4)
    expect(p.get('run')).toBe('f4')
    expect(p.get('tick')).toBe('95')
    expect(p.get('speed')).toBe('4') // reduced motion kept the arriving ladder speed → it rides the share URL
    expect(p.has('sel')).toBe(false) // the tour holds no selection…
    expect(p.has('ev')).toBe(false)  // …so neither entity nor event ever serialize
  })

  test('from the DEFAULT ladder speed (1): run + tick only — speed is omitted at the default', () => {
    const p = driveToBeat5(1)
    expect([...p.keys()].sort()).toEqual(['run', 'tick'])
    expect(p.has('speed')).toBe(false)
  })
})
