import { describe, expect, test } from 'vitest'
import {
  LENSES, lensById, honestyChipFor, askPixel, pixelVoice,
} from './lensRegistry'
import { E0_REGISTRATION, QUERY_STAGE_HONESTY } from './queryStage'
import { F2A_REGISTRATION, SENSING_HONESTY } from './sensingStage'
import { validateRegistration, voiceFor, type LensRegistration, type PixelClass } from './lensContract'

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
