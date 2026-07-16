import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { sha256 } from '@noble/hashes/sha2.js'
import { verifyBundleAgainstExpected, type CampaignExpected } from './campaignVerify'
import { resolveCampaignSeed, ROBUST_F3A } from './campaignCatalog'
import { toHex } from '../lib/hashing'

// The certified seed-42 bytes, read from the FIXTURE (contract/fixtures/f3a_robust_seed42/<attempt>/bundle.det)
// — the byte source the publication gate trusts. The pins come from the in-bundle catalog (the authority).
function fixtureBytes(seed: number): Uint8Array {
  const base = `contract/fixtures/f3a_robust_seed${seed}`
  const dir = readdirSync(base, { withFileTypes: true }).find(d => d.isDirectory())!.name
  return new Uint8Array(readFileSync(`${base}/${dir}/bundle.det`))
}

const SEED42_PINS = resolveCampaignSeed('robust-f3a', '42')!

describe('verifyBundleAgainstExpected: the real seed-42 bytes verify against the catalog pins', () => {
  test('certified bytes + correct pins ⇒ verified (recomputed BOTH ways, all matched)', () => {
    const out = verifyBundleAgainstExpected(fixtureBytes(42), SEED42_PINS)
    expect(out.status).toBe('verified')
    expect(out.basis).toBe('campaign-manifest') // manifest-grade, never det-only self-consistency
    expect(out.sha256ok).toBe(true)
    expect(out.caseIdOk).toBe(true)
    expect(out.resultIdOk).toBe(true)
    expect(out.matchesTrailer).toBe(true)
    expect(out.caseIdHex).toBe(SEED42_PINS.caseId)
    expect(out.resultIdHex).toBe(SEED42_PINS.resultId)
    expect(out.sha256Hex).toBe(SEED42_PINS.sha256)
    expect(out.error).toBeUndefined()
  })

  test('a TAMPERED byte ⇒ mismatch (the sha256 flips; it is not the certified bytes)', () => {
    const bytes = fixtureBytes(42)
    bytes[40] = bytes[40]! ^ 0xff // flip a byte inside a frame
    const out = verifyBundleAgainstExpected(bytes, SEED42_PINS)
    expect(out.status).toBe('mismatch')
    expect(out.sha256ok).toBe(false)
    // Never a false 'verified' and never a green basis-less pass.
    expect(out.sha256Hex).not.toBe(SEED42_PINS.sha256)
  })

  test('a WRONG expected sha256 pin ⇒ mismatch (correct bytes, lying pin)', () => {
    const wrong: CampaignExpected = { ...SEED42_PINS, sha256: '00'.repeat(32) }
    const out = verifyBundleAgainstExpected(fixtureBytes(42), wrong)
    expect(out.status).toBe('mismatch')
    expect(out.sha256ok).toBe(false)
    expect(out.caseIdOk).toBe(true) // the fold still matches; only the byte pin lied
  })

  test('a WRONG expected case_id pin ⇒ mismatch (correct bytes + sha, lying identity pin)', () => {
    const wrong: CampaignExpected = { ...SEED42_PINS, caseId: 'de'.repeat(32) }
    const out = verifyBundleAgainstExpected(fixtureBytes(42), wrong)
    expect(out.status).toBe('mismatch')
    expect(out.sha256ok).toBe(true)
    expect(out.caseIdOk).toBe(false)
  })

  test('a WRONG expected result_id pin ⇒ mismatch', () => {
    const wrong: CampaignExpected = { ...SEED42_PINS, resultId: 'ab'.repeat(32) }
    const out = verifyBundleAgainstExpected(fixtureBytes(42), wrong)
    expect(out.status).toBe('mismatch')
    expect(out.resultIdOk).toBe(false)
  })

  test('undecodable bytes whose sha256 MATCHES the pin ⇒ error (a genuine fault, not a byte mismatch)', () => {
    // Garbage that is not a valid bundle. Pin the expected sha256 to the garbage's OWN sha256, so sha256ok is
    // true yet foldAndVerify throws — the one path that is 'error', not 'mismatch'.
    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25])
    const pins: CampaignExpected = { caseId: 'aa'.repeat(32), resultId: 'bb'.repeat(32), sha256: toHex(sha256(garbage)) }
    const out = verifyBundleAgainstExpected(garbage, pins)
    expect(out.status).toBe('error')
    expect(out.sha256ok).toBe(true)
    expect(out.caseIdHex).toBeNull()
    expect(out.error).toBeDefined()
  })

  test('undecodable bytes whose sha256 does NOT match ⇒ mismatch (wrong bytes, not a system fault)', () => {
    const garbage = new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9])
    const out = verifyBundleAgainstExpected(garbage, SEED42_PINS)
    expect(out.status).toBe('mismatch')
    expect(out.sha256ok).toBe(false)
  })
})

describe('verifyBundleAgainstExpected: every vendored seed verifies against its own catalog pin', () => {
  // A spot-check over the whole ensemble: each vendored public bundle, verified against its pinned identity,
  // must come back 'verified'. This is the campaign-wide analogue of the single-seed happy path.
  test.each(ROBUST_F3A.seeds.map(s => s.seed))('seed %d ⇒ verified', (seed) => {
    const bytes = new Uint8Array(readFileSync(`public/campaigns/robust-f3a/${seed}/bundle.det`))
    const pins = resolveCampaignSeed('robust-f3a', String(seed))!
    expect(verifyBundleAgainstExpected(bytes, pins).status).toBe('verified')
  })
})
