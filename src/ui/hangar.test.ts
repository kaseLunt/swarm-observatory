import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { ASSUMED_DT_US } from '../state/transport'
import {
  assumedClockTitle, breakSeal, CARD_NOTES, cardNote, cardVerdict, effectiveSealStatus, formatSimClock,
  hasRealSimClock, histogramRows, kindLabel, loadIsCurrent, PROFILE_CONFLATION_RE, readyTreeVisible,
  realSimDuration, recordSeal, sealFor, shouldBreakSeal, shouldSealRun, VOICE_GLYPH, type SealStatus,
} from './hangar'

// ── sim-clock predicate — the exact three-way partition ──────────────────────────────────────
describe('hasRealSimClock: real only when a manifest pins a dt distinct from the playback assumption', () => {
  test('f2a/f3a/f4 dt_us = 125000 → real clock', () => expect(hasRealSimClock(125000)).toBe(true))
  test('det-only (e0/f1) has no dt → assumed', () => expect(hasRealSimClock(undefined)).toBe(false))
  test('f0 dt_us equals the assumption (1000) → assumed, no false real-clock claim', () => {
    expect(ASSUMED_DT_US).toBe(1000)
    expect(hasRealSimClock(1000)).toBe(false)
  })
  test('a zero/negative dt never counts as a real clock', () => {
    expect(hasRealSimClock(0)).toBe(false)
    expect(hasRealSimClock(-5)).toBe(false)
  })
})

describe('formatSimClock: microseconds → m:ss.s', () => {
  test('12.0s (96 ticks × 125000µs)', () => expect(formatSimClock(96 * 125000)).toBe('0:12.0'))
  test('6.0s', () => expect(formatSimClock(6_000_000)).toBe('0:06.0'))
  test('zero', () => expect(formatSimClock(0)).toBe('0:00.0'))
  test('rolls into minutes', () => expect(formatSimClock(75_500_000)).toBe('1:15.5'))
  test('sub-second tenths', () => expect(formatSimClock(125_000)).toBe('0:00.1'))
})

describe('realSimDuration: card duration or null (assumed voice)', () => {
  test('a published run renders its true 12.0s duration', () =>
    expect(realSimDuration({ dtUs: 125000, ticks: 96 })).toBe('0:12.0'))
  test('a det-only run (no dtUs) yields null (assumed voice)', () =>
    expect(realSimDuration({ ticks: 75 })).toBeNull())
  test('f0 (dt == assumption) yields null — no false clock on the fixture', () =>
    expect(realSimDuration({ dtUs: 1000, ticks: 2 })).toBeNull())
})

// ── the assumed-clock tooltip never borrows a false reason ────────────────────────────────────────
describe('assumedClockTitle: the assumed-clock title states the run’s TRUE reason', () => {
  test('f0 (full-manifest, recorded dt == the 1× step) claims NEITHER det-only NOR no-recorded-dt', () => {
    const title = assumedClockTitle({ dtUs: ASSUMED_DT_US }) // f0: dtUs 1000, NOT det-only
    expect(title).not.toMatch(/det-only/i)
    expect(title).not.toMatch(/no recorded dt/i)
    expect(title).toMatch(new RegExp(`${ASSUMED_DT_US}µs`))
    expect(title).toMatch(/playback step/i)
  })
  test('e0 / f1 (det-only, no recorded dt) keep the honest det-only wording', () => {
    const title = assumedClockTitle({ detOnly: true })
    expect(title).toMatch(/det-only/i)
    expect(title).toMatch(/no recorded dt/i)
  })
  test('a non-det-only run with no recorded dt gets an honest generic (never a det-only claim)', () => {
    expect(assumedClockTitle({})).not.toMatch(/det-only/i)
  })
})

// ── kind histogram — declared display metadata ────────────────────────────────────────────────
describe('kindLabel: registry name, numeric fallback', () => {
  test('registered kind', () => expect(kindLabel(23)).toBe('GeometryQueryResolved'))
  test('F0 fixture kind', () => expect(kindLabel(0xf000)).toBe('F0_FIXTURE'))
  // The EXP-F1 motion substrate (0x0120/0x0121) carries its OWN registry names (spec-3a §6.5.2,
  // spec-3b §11.4 k=1 block) — the front door stops showing unnamed integers. These are the registry's
  // names verbatim (DATA, not taste), never invented copy.
  test('EXP-F1 motion kinds carry their registry names', () => {
    expect(kindLabel(288)).toBe('MotionSegmentStarted') // 0x0120
    expect(kindLabel(289)).toBe('MotionStepped')        // 0x0121
  })
  test('a kind outside the registry still falls back to "kind N", never blank', () => expect(kindLabel(9999)).toBe('kind 9999'))
})

describe('histogramRows: sorted by count desc, kind asc, with identity category', () => {
  test('f3a composition sorts dominant-first with deterministic ties', () => {
    const rows = histogramRows({ 1: 80, 2: 1, 3: 78, 4: 1, 288: 1, 289: 96 })
    expect(rows.map(r => r.kind)).toEqual([289, 1, 3, 2, 4, 288]) // 96,80,78, then count-1 ties by kind asc
    expect(rows.map(r => r.count)).toEqual([96, 80, 78, 1, 1, 1])
    // The two motion kinds render their registry names, not the bare '289'/'288' flagged in review.
    expect(rows[0]).toMatchObject({ kind: 289, name: 'MotionStepped' })
    expect(rows[5]).toMatchObject({ kind: 288, name: 'MotionSegmentStarted' })
    expect(rows[1]).toMatchObject({ kind: 1, name: 'DetectionMade', category: 'query' })
    expect(rows[2]).toMatchObject({ kind: 3, name: 'TrackUpdated', category: 'mutating' })
  })
  test('single-kind run (e0) yields one row', () => {
    expect(histogramRows({ 23: 75 })).toEqual([{ kind: 23, name: 'GeometryQueryResolved', count: 75, category: 'query' }])
  })
})

// ── verdict voice — session-earned checkmark economy, plus the broken-seal alarm ─────
describe('cardVerdict: attested by default, verified when sealed, alarm when the seal broke', () => {
  // cardVerdict is keyed on the runId (its GRADE resolved from the trusted catalog), never a RunEntry.
  // f0 is a full-manifest citizen; f1 is det-only. See the lying-index premise-first test below.
  test('unsealed manifest run wears the attested voice', () =>
    expect(cardVerdict('f0', 'none')).toEqual({ state: 'attested', label: 'certified · on record' }))
  test('sealed manifest run flips to the verified voice', () =>
    expect(cardVerdict('f0', 'sealed')).toEqual({ state: 'verified', label: 'recomputed this session' }))
  test('unsealed det-only run reads golden, self-checks on open', () =>
    expect(cardVerdict('f1', 'none')).toEqual({ state: 'attested', label: 'det-only golden · self-checks on open' }))
  // A det-only run has NO external oracle, so a self-check this session earns the ATTESTED voice
  // (•) with a sharpened label — never the manifest-grade green ✓ that would collapse it into a verified run.
  test('sealed det-only run reads self-verified this session in the ATTESTED voice (never state verified/✓)', () => {
    const v = cardVerdict('f1', 'sealed')
    expect(v.state).toBe('attested')
    expect(v.state).not.toBe('verified')
    expect(v.label).toBe('self-verified this session · no external oracle')
  })
  // A broken seal renders in the ALARM register — the ✗ mismatch voice — never ✓ and
  // never plain attested (which would quietly forget a witnessed mismatch).
  test('a BROKEN seal wears the mismatch alarm voice (✗) — provably NOT ✓ and NOT plain attested', () => {
    for (const runId of ['f0', 'f1'] as const) {
      const v = cardVerdict(runId, 'broken')
      expect(v.state).toBe('mismatch')
      expect(v.state).not.toBe('verified')
      expect(v.state).not.toBe('attested')
      expect(VOICE_GLYPH[v.state]).toBe('✗') // the exact glyph the card paints
      expect(v.label).toMatch(/seal broken/i)
      expect(v.label).toMatch(/mismatched this session/i)
    }
  })
})

// ── The trust GRADE is keyed on the TRUSTED catalog id, NEVER the unsigned RunEntry.detOnly ────────────
// runs/index.json is fetched over the network and unsigned. cardVerdict reconstructs the trust GRADE, so if it
// keyed on RunEntry.detOnly a lying entry (detOnly:false on a sealed det-only run) would render the manifest-
// grade ✓ / "recomputed this session" over a self-consistent run. The fix keys the grade on the runId resolved
// through the in-bundle catalog — no RunEntry field reaches cardVerdict at all.
describe('cardVerdict grades from the trusted catalog id — a lying RunEntry.detOnly cannot flip the grade', () => {
  // The PRE-FIX grade source, verbatim: keyed on the (spoofable) entry.detOnly flag. Encoded here so this test
  // DEMONSTRATES the hole it closes — fed a lying flag it flips the sealed grade to the manifest-grade ✓.
  const preFixSealedGrade = (detOnlyFlag: boolean) => (detOnlyFlag
    ? { state: 'attested', label: 'self-verified this session · no external oracle' }
    : { state: 'verified', label: 'recomputed this session' })

  test('PRE-FIX: a lying detOnly:false on a det-only run mints the manifest-grade ✓ (the false green being closed)', () => {
    expect(preFixSealedGrade(false)).toEqual({ state: 'verified', label: 'recomputed this session' })
  })
  test('THE FIX: a sealed det-only run (f1) renders the self-check • — no RunEntry reaches cardVerdict', () => {
    const v = cardVerdict('f1', 'sealed') // f1's catalog pin is det-only → self-check, whatever an index entry claims
    expect(v.state).toBe('attested')
    expect(v.state).not.toBe('verified')
    expect(v.label).toBe('self-verified this session · no external oracle')
  })
  test('THE FIX (mirror): a sealed full-manifest run (f0) keeps its ✓ — not demotable by a lying detOnly:true', () => {
    expect(cardVerdict('f0', 'sealed')).toEqual({ state: 'verified', label: 'recomputed this session' })
  })
  test('an uncertified/unknown id defaults to det-only-grade — the lowest-trust posture, never a false ✓', () => {
    const v = cardVerdict('totally-new-run', 'sealed')
    expect(v.state).toBe('attested')
    expect(v.state).not.toBe('verified')
  })
})

// ── profile-conflation prohibition — no OTHER-campaign wordmark touches the f3a card ──────────
// The published f3a is the CORRECT single-target-track KAT. The 50-seed statistical-acceptance ("robust")
// campaign is a DIFFERENT bundle whose story belongs to the v0.7 Wall; its claim must never be smuggled
// onto this card — not as /robust/, and not in the softer "statistical-acceptance / acceptance campaign"
// words the old /robust/i scan could not see. Scan the note AND every rendered verdict with the full tripwire.
describe('f3a card carries no OTHER-campaign wordmark (pinned)', () => {
  test('no cardVerdict label, in ANY seal status, smuggles a robust / statistical-acceptance verdict', () => {
    for (const status of ['none', 'sealed', 'broken'] as SealStatus[]) {
      for (const runId of ['f0', 'f1'] as const) {
        expect(cardVerdict(runId, status).label).not.toMatch(PROFILE_CONFLATION_RE)
      }
    }
  })
  test('the f3a note names ONLY its own identity (seed 42, single certified run) — no campaign claim', () => {
    expect(CARD_NOTES.f3a).not.toMatch(PROFILE_CONFLATION_RE)
    expect(CARD_NOTES.f3a).toMatch(/seed 42/i)            // case-id pin kept
    expect(CARD_NOTES.f3a).toMatch(/single certified run/i)
    expect(CARD_NOTES.f3a).not.toMatch(/campaign/i)       // the sidecar-campaign sentence is gone entirely
  })
  test('every card note rejects the profile-conflation tripwire', () => {
    for (const note of Object.values(CARD_NOTES)) expect(note).not.toMatch(PROFILE_CONFLATION_RE)
  })
})

// ── session-seal state machine ─────────────────────────
// The record claims byte-precision ("this ✓ names the exact bytes"), so the machine must honor it at the
// edges: a later verified load with DIFFERENT bytes renames the seal; a later MISMATCH breaks it (alarm,
// session-terminal); the happy path is unchanged and reference-stable.
describe('recordSeal / breakSeal / sealFor: the seal reconciliation machine', () => {
  const sealedE0 = { runId: 'e0', resultId: 'res-A', broken: false }

  test('happy path unchanged: a fresh verified load seals, a second run accumulates', () => {
    const one = recordSeal([], 'e0', 'res-A')
    expect(one).toEqual([sealedE0])
    expect(recordSeal(one, 'f0', 'res-F')).toEqual([sealedE0, { runId: 'f0', resultId: 'res-F', broken: false }])
  })
  test('happy path unchanged: same bytes re-verified → SAME reference (no churn on the ready re-fire)', () => {
    const list = [sealedE0]
    expect(recordSeal(list, 'e0', 'res-A')).toBe(list)
  })
  test('REGRESSION: same runId later verified with a DIFFERENT resultId → the record is REPLACED', () => {
    const list = [sealedE0, { runId: 'f0', resultId: 'res-F', broken: false }]
    const next = recordSeal(list, 'e0', 'res-B')
    expect(next).toEqual([{ runId: 'e0', resultId: 'res-B', broken: false }, { runId: 'f0', resultId: 'res-F', broken: false }])
    expect(sealFor(next, 'e0')!.resultId).toBe('res-B') // the ✓ now names the bytes it actually verified
  })
  test('REGRESSION: a mismatch after a seal BREAKS it — kept and flagged, never silently green', () => {
    const next = breakSeal([sealedE0], 'e0')
    expect(next).toEqual([{ runId: 'e0', resultId: 'res-A', broken: true }]) // original resultId kept as the revoked ✓'s name
  })
  test('…and the broken card provably stops showing ✓ (rendered form, end to end through cardVerdict)', () => {
    // The full pipeline a card walks: seal → break → sealFor → effectiveSealStatus → cardVerdict.
    const broken = breakSeal(recordSeal([], 'e0', 'res-A'), 'e0')
    const status = effectiveSealStatus(sealFor(broken, 'e0'), null, null)
    expect(status).toBe('broken')
    const v = cardVerdict('e0', status)
    expect(v.state).not.toBe('verified')
    expect(v.state).toBe('mismatch')
    expect(VOICE_GLYPH[v.state]).toBe('✗')
  })
  test('a break on a never-sealed run is a no-op (attested cards stay attested) — reference-stable', () => {
    const list = [sealedE0]
    expect(breakSeal(list, 'f0')).toBe(list)
    expect(breakSeal([], 'f0')).toEqual([])
  })
  test('breaking an already-broken seal is a no-op — reference-stable', () => {
    const list = [{ runId: 'e0', resultId: 'res-A', broken: true }]
    expect(breakSeal(list, 'e0')).toBe(list)
  })
  test('BROKEN is session-terminal: a later verified load (same or different bytes) does NOT heal it', () => {
    const list = [{ runId: 'e0', resultId: 'res-A', broken: true }]
    expect(recordSeal(list, 'e0', 'res-A')).toBe(list) // the original bytes re-verifying doesn't un-witness the mismatch
    expect(recordSeal(list, 'e0', 'res-B')).toBe(list) // nor does any other verified identity
  })
  test('sealFor finds a record by run id', () => {
    expect(sealFor([sealedE0], 'e0')).toBe(sealedE0)
    expect(sealFor([sealedE0], 'f0')).toBeUndefined()
  })
})

// ── the render-side identity guard — ✓ only for the bytes actually on stage ──────────────────
describe('effectiveSealStatus: verified holds only while the seal names the loaded bytes', () => {
  const seal = { runId: 'e0', resultId: 'res-A', broken: false }
  test('no record → none (attested)', () => expect(effectiveSealStatus(undefined, 'e0', 'res-A')).toBe('none'))
  test('broken record → broken, regardless of what is loaded', () => {
    expect(effectiveSealStatus({ ...seal, broken: true }, 'e0', 'res-A')).toBe('broken')
    expect(effectiveSealStatus({ ...seal, broken: true }, null, null)).toBe('broken')
  })
  test('the open run is loaded with the SEALED bytes → sealed (✓ holds)', () =>
    expect(effectiveSealStatus(seal, 'e0', 'res-A')).toBe('sealed'))
  test('the open run is loaded with DIFFERENT bytes → demoted to none for that paint (never a stale ✓)', () =>
    expect(effectiveSealStatus(seal, 'e0', 'res-B')).toBe('none'))
  test('a NON-open run’s seal holds (session history is valid while its bytes are not on stage)', () => {
    expect(effectiveSealStatus(seal, 'f0', 'res-F')).toBe('sealed')
    expect(effectiveSealStatus(seal, null, null)).toBe('sealed')
  })
})

// ── the identity-join primitive shared by the seal ✓, the break ✗, and the cold-open thesis verdict ──
describe('loadIsCurrent: the resident bytes belong to the current run iff loadedRunId === runId', () => {
  test('true only on an exact identity match', () => {
    expect(loadIsCurrent('e0', 'e0')).toBe(true)
    expect(loadIsCurrent('f0', 'f0')).toBe(true)
  })
  test('false during the one-commit switch window (loadedRunId still names the prior run)', () => {
    expect(loadIsCurrent('f0', 'e0')).toBe(false) // switched to f0; e0's data still resident
  })
  test('false before any run has reached ready (loadedRunId null)', () => {
    expect(loadIsCurrent('e0', null)).toBe(false)
  })
  test('the seal predicates are exactly loadIsCurrent AND the verdict (byte-identical composition)', () => {
    // Pin that the extraction did not change shouldSealRun/shouldBreakSeal behavior: each is the join
    // conjoined with its verdict test, for the full identity × verdict cross-product.
    for (const [runId, loadedRunId] of [['e0', 'e0'], ['f0', 'e0'], ['e0', null]] as const) {
      const cur = loadIsCurrent(runId, loadedRunId)
      expect(shouldSealRun(runId, loadedRunId, true)).toBe(cur && true)
      expect(shouldSealRun(runId, loadedRunId, false)).toBe(false)
      expect(shouldBreakSeal(runId, loadedRunId, false)).toBe(cur && true)
      expect(shouldBreakSeal(runId, loadedRunId, true)).toBe(false)
    }
  })
})

// ── the seal-race fix — seal by IDENTITY carried with the data, never by effect timing ────────────
describe('shouldSealRun: a card seals only for the CURRENT run’s own verified bytes', () => {
  // THE RACE. selectRun flips the store runId to the destination synchronously, but useRun still holds the
  // PRIOR run's model/hashes (matchesTrailer=true) for the commit right after the switch; loadedRunId is set
  // ONLY in useRun's ready state, so during that window it still names the PRIOR run.
  const RACE = { runId: 'f0', loadedRunId: 'e0', matchesTrailer: true as const } // switched to f0; e0's verified data still resident

  // The PRE-FIX seal condition, verbatim: `model && hashes?.matchesTrailer` — IDENTITY-BLIND. Encoded here
  // so this test DEMONSTRATES the regression it guards: on the race inputs it seals → a falsely-minted ✓.
  const preFixWouldSeal = (matchesTrailer: boolean) => matchesTrailer === true

  test('PRE-FIX logic falsely seals the destination from the PRIOR run’s verification (the bug being fixed)', () => {
    expect(preFixWouldSeal(RACE.matchesTrailer)).toBe(true) // ← the false ✓ the identity guard removes
  })
  test('the fix does NOT seal during the switch window (loadedRunId still names the prior run)', () => {
    expect(shouldSealRun(RACE.runId, RACE.loadedRunId, RACE.matchesTrailer)).toBe(false)
  })
  test('seals only once the destination itself reaches verified-ready (loadedRunId === runId)', () => {
    expect(shouldSealRun('f0', 'f0', true)).toBe(true)
  })
  test('never seals a trailer-inconsistent (✗) result, even when it IS the current run', () => {
    expect(shouldSealRun('f0', 'f0', false)).toBe(false)
  })
  test('never seals before any run has loaded (loadedRunId null) or when the verdict is absent', () => {
    expect(shouldSealRun('f0', null, true)).toBe(false)
    expect(shouldSealRun('f0', 'f0', null)).toBe(false)
    expect(shouldSealRun('f0', 'f0', undefined)).toBe(false)
  })
})

// ── the mismatch twin — the SAME identity join, opposite verdict ──────────────────────────────
describe('shouldBreakSeal: breaks only for the CURRENT run’s own failed verification', () => {
  test('mirror-image race: a stale ✗ from the PRIOR run never revokes the destination’s seal', () =>
    // Switched from a mismatched e0 to f0; e0's ✗ hashes still resident for one commit — f0 must keep its seal.
    expect(shouldBreakSeal('f0', 'e0', false)).toBe(false))
  test('breaks when the loaded run ITSELF failed verification', () =>
    expect(shouldBreakSeal('e0', 'e0', false)).toBe(true))
  test('never breaks on a verified load, an absent verdict, or before any run has loaded', () => {
    expect(shouldBreakSeal('e0', 'e0', true)).toBe(false)
    expect(shouldBreakSeal('e0', 'e0', null)).toBe(false)
    expect(shouldBreakSeal('e0', 'e0', undefined)).toBe(false)
    expect(shouldBreakSeal('e0', null, false)).toBe(false)
  })
})

// ── the identity join generalized to the WHOLE ready subtree (the delayed-destination-fetch scenario) ──
describe('readyTreeVisible: the ready subtree paints only when the resident model IS the current run', () => {
  // THE DELAYED-DESTINATION-FETCH SCENARIO. The operator switches from a ready run (e0) to a slow-fetching one
  // (f1). selectRun flips the store runId to f1 synchronously, but useRun still holds e0's model for the commit
  // right after — loadedRunId is set only in useRun's ready state, so during that gap it still names e0. The
  // ready tree (Provenance ✓ rows, the stage) must be WITHHELD then, or the prior run's verified glyphs paint
  // under f1's identity. A stand-in non-null model suffices: readyTreeVisible keys on presence + the identity join.
  const priorModel = { tickCount: 2 }

  // The PRE-FIX gate, verbatim: `Boolean(model)` — IDENTITY-BLIND. Encoded here so this test DEMONSTRATES the
  // regression it guards: on the switch-gap inputs it renders the ready tree → the prior run's ✓ under the new id.
  const preFixWouldRender = (model: unknown) => model !== null && model !== undefined

  test('PRE-FIX logic renders the ready tree from the PRIOR run’s resident model (the bug being fixed)', () => {
    expect(preFixWouldRender(priorModel)).toBe(true) // ← the prior-run ✓ glyphs the identity gate withholds
  })
  test('THE SWITCH GAP: a resident PRIOR model (loadedRunId=e0) under the NEW runId (f1) is WITHHELD', () => {
    expect(readyTreeVisible(priorModel, 'f1', 'e0')).toBe(false)
    // Exactly the model-present AND identity-join composition — one gate, not a per-widget join.
    expect(readyTreeVisible(priorModel, 'f1', 'e0')).toBe(priorModel !== null && loadIsCurrent('f1', 'e0'))
  })
  test('renders only once the destination itself reaches ready (model resident AND loadedRunId === runId)', () => {
    expect(readyTreeVisible(priorModel, 'f1', 'f1')).toBe(true)
  })
  test('a genuine load — no model yet, or ready not reached — stays on the loading posture', () => {
    expect(readyTreeVisible(null, 'f1', null)).toBe(false)  // decode in flight: real ceremony, not the ready tree
    expect(readyTreeVisible(priorModel, 'f1', null)).toBe(false) // model present but loadedRunId never set → withheld
  })

  // ── the PRODUCTION gate must BE the tested helper, never a hand-inlined drift twin ────────────────
  // readyTreeVisible was tested here, but App only referenced it in COMMENTS and hand-inlined `!model || !current`
  // — a copy of the helper's logic that could drift from it silently. This source-level pin (the mountGate-name
  // identity-pin precedent) fails if App stops routing its ready-tree gate through the actual function.
  test('App.tsx routes its ready-tree gate through readyTreeVisible(model, runId, loadedRunId) — no inlined twin', () => {
    const src = readFileSync('src/ui/App.tsx', 'utf8')
    expect(src).toMatch(/readyTreeVisible\(model, runId, loadedRunId\)/)
    expect(src).toMatch(/import \{[^}]*\breadyTreeVisible\b[^}]*\} from '\.\/hangar'/)
  })
})

// ── cardNote is an OWN-property lookup: an unsigned index id cannot resolve a prototype member ─────────
// entry.id comes from the UNSIGNED runs/index.json. A plain-object bracket lookup inherits from Object.prototype,
// so '__proto__' → the prototype and 'constructor' → the Object constructor — TRUTHY non-strings that crash the
// Hangar (which sits OUTSIDE the run ErrorBoundary → whole app down) when rendered as a React child.
describe('cardNote — safe against unsigned index ids', () => {
  test('a real note resolves; a known id with no note yields undefined', () => {
    expect(cardNote('f3a')).toBe(CARD_NOTES.f3a)
    expect(cardNote('f0')).toBeUndefined() // f0 ships no note
  })
  test('PREMISE: the raw bracket lookup returns a TRUTHY prototype member for __proto__ / constructor (the crash vector)', () => {
    const raw = CARD_NOTES as unknown as Record<string, unknown>
    expect(raw['__proto__']).toBeTruthy()                 // Object.prototype — a non-string React child crashes the render
    expect(typeof raw['constructor']).toBe('function')    // the Object constructor — likewise
  })
  test('THE FIX: cardNote returns undefined for every prototype-shaped id — a harmless card, no crash', () => {
    for (const id of ['__proto__', 'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty'])
      expect(cardNote(id), id).toBeUndefined()
  })
})

test('VOICE_GLYPH mirrors the panel grammar', () => {
  expect(VOICE_GLYPH.verified).toBe('✓')
  expect(VOICE_GLYPH.attested).toBe('•')
  expect(VOICE_GLYPH.mismatch).toBe('✗') // reachable via the broken-seal alarm voice
})
