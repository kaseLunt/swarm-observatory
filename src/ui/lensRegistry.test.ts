import { describe, expect, test } from 'vitest'
import {
  LENSES, lensById, honestyChipFor, askPixel, pixelVoice, assertAgreeSourcesBacked,
} from './lensRegistry'
import { E0_REGISTRATION, QUERY_STAGE_HONESTY } from './queryStage'
import { F2A_REGISTRATION, SENSING_HONESTY } from './sensingStage'
import { validateRegistration, voiceFor, type LensRegistration, type PixelClass } from './lensContract'
import { SHOWMATH_AGREE_CAPABILITY } from './showMath'
import { SENSING_AGREE_CAPABILITY, ELIGIBLE_CONJUNCTION_INPUTS } from './sensingMath'
import { makeWitnessInputs, type AgreeCapability, type WitnessInputs, type FormToken } from './agreeSource'

// The registry is the MECHANISM extracted from the two live lenses (query stage + sensing gauntlet). These
// pin: both citizens are held and reachable by id; the honesty-chip line is the registration's projection
// (ONE source, what App now renders); ask-any-pixel resolves a class's authority + its voice through the
// contract's tier→voice map; and the cross-citizen invariants (unique ids, unique class ids) are proven to
// FAIL LOUD — the registry refuses an ambiguous ask-any-pixel key rather than filing it best-effort.

describe('the registry holds exactly the two live citizens, reachable by id', () => {
  test('LENSES carries e0 + f2a in ladder order', () => {
    expect(LENSES.map(l => l.id)).toEqual(['e0-query', 'f2a-sensing'])
  })
  test('lensById returns the whole registration; an unknown id is undefined (the honest miss)', () => {
    expect(lensById('e0-query')).toBe(E0_REGISTRATION)
    expect(lensById('f2a-sensing')).toBe(F2A_REGISTRATION)
    expect(lensById('nope')).toBeUndefined()
  })
})

describe('honestyChipFor — the chip is the registration projection (one source of honesty)', () => {
  test('each lens returns its own honesty line, byte-identical to the exported const App used to import', () => {
    expect(honestyChipFor('e0-query')).toBe(QUERY_STAGE_HONESTY)
    expect(honestyChipFor('f2a-sensing')).toBe(SENSING_HONESTY)
  })
  test('an unknown id fails LOUD (a chip for a non-existent lens is a wiring bug, not a blank)', () => {
    expect(() => honestyChipFor('nope')).toThrow(/no such registered lens/)
  })
})

describe('askPixel + pixelVoice — the ask-any-pixel lookup the registry exists for', () => {
  test('askPixel returns a class\'s authority (tier + contract anchor + the class answer)', () => {
    const bearing = askPixel('e0-query', 'bearing-claim')!
    expect(bearing.tier).toBe('pinned-bits')
    expect(bearing.source).toMatch(/^contract\//)
    expect(bearing.answer.length).toBeGreaterThan(0)
    const inFov = askPixel('f2a-sensing', 'in-fov-claim')!
    expect(inFov.tier).toBe('pinned-bits')
  })
  test('an unknown lens or class is undefined (never a throw on a plain lookup)', () => {
    expect(askPixel('nope', 'bearing-claim')).toBeUndefined()
    expect(askPixel('e0-query', 'no-such-class')).toBeUndefined()
  })
  test('pixelVoice resolves the class tier through the contract voice map (voiceFor)', () => {
    // A recomputed class is a live check regardless of seal; a decoded class inherits the session seal.
    expect(pixelVoice('e0-query', 'region-verdict', true)).toBe(voiceFor('recomputed', true))
    expect(pixelVoice('e0-query', 'probe-geometry', true)).toBe('sealed')
    expect(pixelVoice('e0-query', 'probe-geometry', false)).toBe('unsealed')
    expect(pixelVoice('e0-query', 'bearing-claim', false)).toBe('attested')
    expect(pixelVoice('nope', 'x', true)).toBeUndefined()
  })
})

describe('the cross-citizen invariants fail LOUD (what a single registration cannot see)', () => {
  // The registry adds two checks a per-lens validateRegistration cannot make. We prove the check logic on a
  // pair of hand-built registrations (mirrors of the live shape) so a regression in the guard is caught here,
  // without needing to corrupt a live citizen. (The live REGISTRY already built cleanly at import — this file
  // loading at all is the module-load fail-loud gate passing.)
  const mk = (id: string, classIds: string[]): LensRegistration => {
    const provenance: PixelClass[] = classIds.map(cid => ({ id: cid, tier: 'decoded', source: 'contract/x.md §1', answer: 'a' }))
    provenance.push({ id: 'k', tier: 'scenario-constant', source: 'contract/x.md §2', answer: 'a' })
    return validateRegistration({
      id, question: { primary: 'q', adjacent: [] }, surfaces: { stage: 'S', instrument: 'I' },
      borrowedHues: ['accent'], dims: 'd', emptyState: 'e',
      honestyChip: 'geometry is decoded-real — bodies are scenario constants',
      tourId: null, mountGate: 'g', provenance,
    })
  }

  // The guard the registry runs, isolated (the live builder inlines the same two checks at module load).
  const build = (regs: LensRegistration[]): void => {
    const byId = new Map<string, LensRegistration>()
    for (const reg of regs) {
      if (byId.has(reg.id)) throw new Error(`lensRegistry: duplicate lens id '${reg.id}'`)
      const seen = new Set<string>()
      for (const p of reg.provenance) {
        if (seen.has(p.id)) throw new Error(`lensRegistry: ${reg.id}: duplicate pixel-class id '${p.id}'`)
        seen.add(p.id)
      }
      byId.set(reg.id, reg)
    }
  }

  test('a duplicate lens id throws', () => {
    expect(() => build([mk('dup', ['a']), mk('dup', ['b'])])).toThrow(/duplicate lens id/)
  })
  test('a duplicate pixel-class id within a lens throws (the ask-any-pixel key must be unambiguous)', () => {
    expect(() => build([mk('one', ['a', 'a'])])).toThrow(/duplicate pixel-class id/)
  })
  test('the two DISTINCT live citizens build cleanly (no false positive across lenses)', () => {
    expect(() => build([E0_REGISTRATION, F2A_REGISTRATION])).not.toThrow()
  })
})

describe('the witness boot guard resolves declared arms against the PER-FORM executor capability (W3 F2)', () => {
  // A recomputed class's declared arm must name a form the executor backs AND declare EXACTLY that form's
  // required input tuple. The token union is CLOSED at compile time; this is the RUNTIME vouching that the
  // declared (form + inputs) matches the executor's per-form truth — the hole a closed type cannot close (an
  // executor that dropped a leg, a token declared against the wrong FORM — the Cartesian hole below).
  const mkRecomputed = (inputs: WitnessInputs, form: FormToken = 'form:in-range'): LensRegistration => ({
    id: 'x-lens', question: { primary: 'q', adjacent: [] }, surfaces: { stage: 'S', instrument: 'I' },
    borrowedHues: ['accent'], dims: 'd', emptyState: 'e', honestyChip: 'c', tourId: null, mountGate: 'g',
    provenance: [{
      id: 'r', tier: 'recomputed', source: 'contract/x.md §1', answer: 'a',
      agree: { basis: 'live-inputs', inputs, form },
    }],
  })
  // An executor that backs form:in-range (consuming exactly [sensing:pose]) and form:eligible-conjunction.
  const cap: AgreeCapability = {
    forms: {
      'form:in-range': ['sensing:pose'],
      'form:eligible-conjunction': ['sensing:in-range-live', 'sensing:los-clear-live', 'sensing:in-fov-claim'],
    },
    decoded: [],
  }

  test('a fully-backed arm passes (form backed, inputs set-equal the form tuple)', () => {
    expect(() => assertAgreeSourcesBacked(mkRecomputed(makeWitnessInputs('sensing:pose')), cap)).not.toThrow()
  })
  test('a form the executor does not back fails loud', () => {
    expect(() => assertAgreeSourcesBacked(mkRecomputed(makeWitnessInputs('sensing:pose'), 'form:los-clear'), cap))
      .toThrow(/names form 'form:los-clear'/)
  })
  test('inputs that do not set-equal the form tuple fail loud (an extra leg, or a missing one)', () => {
    // form:in-range consumes exactly [sensing:pose] — an extra live leg is a mismatch, not a superset that passes.
    expect(() => assertAgreeSourcesBacked(mkRecomputed(makeWitnessInputs('sensing:pose', 'sensing:in-range-live')), cap))
      .toThrow(/but that form's live leg consumes exactly/)
    // a missing token (an empty witness that still names the form) likewise fails the set-equality.
    expect(() => assertAgreeSourcesBacked(mkRecomputed(makeWitnessInputs()), cap))
      .toThrow(/but that form's live leg consumes exactly/)
  })
  test('THE CARTESIAN COUNTEREXAMPLE — in-fov-claim paired with form:in-range fails the NEW guard [F2]', () => {
    // PREMISE-FIRST: BOTH 'sensing:in-fov-claim' (a backed input of this executor) and 'form:in-range' (a backed
    // form) are legitimate TOKENS, so the OLD guard — which checked input membership and form membership
    // INDEPENDENTLY — waved this pairing through, even though form:in-range re-derives from the pose and never
    // consumes in_fov. The per-form guard rejects it: form:in-range's tuple is [sensing:pose], not [in-fov-claim].
    expect(() => assertAgreeSourcesBacked(mkRecomputed(makeWitnessInputs('sensing:in-fov-claim'), 'form:in-range'), cap))
      .toThrow(/but that form's live leg consumes exactly \[sensing:pose\]/)
  })
  test('a recomputed lens with NO executor capability fails loud (it cannot be vouched)', () => {
    expect(() => assertAgreeSourcesBacked(mkRecomputed(makeWitnessInputs('sensing:pose')), undefined))
      .toThrow(/names no executor capability/)
  })
  test('both live citizens resolve against their real executor capabilities (registry boot green)', () => {
    expect(() => assertAgreeSourcesBacked(E0_REGISTRATION, SHOWMATH_AGREE_CAPABILITY)).not.toThrow()
    expect(() => assertAgreeSourcesBacked(F2A_REGISTRATION, SENSING_AGREE_CAPABILITY)).not.toThrow()
  })
})

describe('the recomputed classes migrated to the AgreeSource witness (W3, audit A1)', () => {
  test('every e0 recomputed class declares a live-inputs AgreeSource', () => {
    const recomputed = E0_REGISTRATION.provenance.filter(p => p.tier === 'recomputed')
    expect(recomputed.map(p => p.id).sort())
      .toEqual(['los-verdict', 'occluder-verdict', 'range-scalar', 'region-verdict'])
    for (const p of recomputed) {
      expect(p.agree, p.id).toBeDefined()
      expect(p.agree!.basis, p.id).toBe('live-inputs')
    }
  })
  test('every f2a recomputed class declares a live-inputs AgreeSource', () => {
    const recomputed = F2A_REGISTRATION.provenance.filter(p => p.tier === 'recomputed')
    expect(recomputed.map(p => p.id).sort())
      .toEqual(['eligible-conjunction', 'in-range-recompute', 'los-clear-recompute'])
    for (const p of recomputed) expect(p.agree!.basis, p.id).toBe('live-inputs')
  })
  test('the f2a eligible flagship arm set-EQUALS the executor\'s conjunction tuple (one truth — no drift)', () => {
    const flag = F2A_REGISTRATION.provenance.find(p => p.id === 'eligible-conjunction')!
    const agree = flag.agree
    expect(agree).toBeDefined()
    if (agree && agree.basis === 'live-inputs') {
      // The arm is MINTED (copied/frozen/validated by makeWitnessInputs) FROM sensingMath's OWN exported
      // constant, so it VALUE-equals it — the two LIVE legs + the DECODED in_fov claim (the fov leg expressed
      // honestly as a claim-voice input, never the engine's eligible bit, a comparand un-nameable here).
      expect([...agree.inputs]).toEqual([...ELIGIBLE_CONJUNCTION_INPUTS])
      expect([...agree.inputs]).toEqual(['sensing:in-range-live', 'sensing:los-clear-live', 'sensing:in-fov-claim'])
      expect(agree.form).toBe('form:eligible-conjunction')
      // The EXECUTOR capability's form tuple IS that same exported constant (reference identity); the per-form
      // boot guard set-compares the arm against it, so the declaration and the real conjunction cannot drift.
      expect(SENSING_AGREE_CAPABILITY.forms['form:eligible-conjunction']).toBe(ELIGIBLE_CONJUNCTION_INPUTS)
    } else {
      throw new Error('the flagship must declare a live-inputs arm')
    }
  })
})
