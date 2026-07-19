import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { gateManifest, parseManifest, type Identity } from './manifest'
import { decodeBundle } from './decodeBundle'
import { verdictAgainstManifest } from './verify'

const text = readFileSync('contract/fixtures/f0_seed42.manifest.json', 'utf8')
const identity: Identity = JSON.parse(readFileSync('contract/identity.json', 'utf8'))
// The .det bytes as an ArrayBuffer (the useRun.test idiom), for decodeBundle → its recomputed VerifyResult.
const load = (n: string): ArrayBuffer => { const b = readFileSync(`contract/fixtures/${n}`); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }

describe('golden F0 manifest', () => {
  const m = parseManifest(text)
  test('fields', () => {
    expect(m.eventSchemaVersion).toBe(9)
    expect(m.stateSchemaVersion).toBe(4)
    expect(m.scenarioId).toBe('f0-fixture')
    expect(m.dtUs).toBe(1000)
    expect(m.eventCount).toBe(2)
    expect(m.tickCount).toBe(2)
    expect(m.runComplete).toBe(true)
    expect(m.terminationReason).toBe(2)
    expect(m.resultId).toMatch(/^[0-9a-f]{64}$/)
    expect(m.caseId).toMatch(/^[0-9a-f]{64}$/)
  })
  test('gate passes against pinned identity', () => {
    expect(gateManifest(m, identity)).toEqual({ ok: true })
  })
  test('gate rejects a foreign state registry with the offending field named', () => {
    const evil = { ...m, stateRegistryHash: 'ff'.repeat(32) }
    const r = gateManifest(evil, identity)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe('state_registry_hash')
  })
  test('missing required field names the field', () => {
    const broken = JSON.parse(text)
    delete broken.outputs.hashes.result_id
    expect(() => parseManifest(JSON.stringify(broken))).toThrow(/result_id/)
  })
})

// provenance.dirty drives the alarm-voice row + its build-hygiene/citability note, so it MUST be a strict JSON
// boolean — a truthy/falsy non-boolean (0, "", "false", 1) would silently mis-voice the row. It is validated
// fail-closed at the parse boundary: any non-boolean is a malformed manifest and takes the rejection path.
describe('provenance.dirty is a strict JSON boolean (fail-closed at the parse boundary)', () => {
  const withDirty = (v: unknown): string => {
    const j = JSON.parse(text)
    if (v === undefined) delete j.provenance.dirty
    else j.provenance.dirty = v
    return JSON.stringify(j)
  }
  test('a genuine boolean round-trips (true and false both reach the row)', () => {
    expect(parseManifest(withDirty(false)).dirty).toBe(false)
    expect(parseManifest(withDirty(true)).dirty).toBe(true)
  })
  test.each([0, 1, '', 'false', 'true', null] as const)(
    'a non-boolean dirty (%p) is rejected as malformed — never a quiet default', (bad) => {
      expect(() => parseManifest(withDirty(bad))).toThrow(/dirty/)
    })
  test('a MISSING dirty names the field (the required-field path)', () => {
    expect(() => parseManifest(withDirty(undefined))).toThrow(/dirty/)
  })
})

// inputs.config.dt_us is a spec i64 µs tick period (integral, >0), JSON-encoded as a CANONICAL DECIMAL STRING (the
// u64/i64 stringification the schema uses for seed/sim_time — the fixtures carry "dt_us":"1000"/"125000"). It drives
// the Hangar sim-clock partition AND the comms pulse clock, so admission validates the SHAPE and never COERCES: the
// old Number(v) gate let true→1, [1]→1, 0.5, and the subnormal 5e-324 (→ 375×300/dt = Infinity) through. Same
// fail-closed idiom as dirty — only the spec shape is admitted.
describe('inputs.config.dt_us is a canonical positive-integer STRING (spec i64 µs, shape-validated, never coerced)', () => {
  const withDt = (v: unknown): string => {
    const j = JSON.parse(text)
    if (v === undefined) delete j.inputs.config.dt_us
    else j.inputs.config.dt_us = v
    return JSON.stringify(j)
  }
  test('the golden fixture already carries dt_us as a canonical string, and it round-trips', () => {
    expect(JSON.parse(text).inputs.config.dt_us).toBe('1000') // the shape the spec i64 convention writes
    expect(parseManifest(withDt('125000')).dtUs).toBe(125000)  // a canonical positive-integer string is admitted
  })
  // HOSTILE ADMISSION — every value that is NOT a canonical positive-integer string is refused, INCLUDING a JSON
  // number (no coercion): true→1, [1]→1, 0.5, and the subnormal 5e-324 (the Infinity trap) all slipped past the old
  // Number(v) gate; '1e5' is a string but exponent form (not canonical); '0'/'01'/'-1' are non-canonical/≤0.
  test.each([
    ['a bare JSON number (no coercion — the shape is a string)', 125000],
    ['a boolean true (Number(true)===1 must NOT be admitted)', true],
    ['an array [1] (Number([1])===1 must NOT be admitted)', [1]],
    ['an object {}', {}],
    ['a fraction 0.5', 0.5],
    ['the positive subnormal 5e-324 (→ 375×300/dt = Infinity)', 5e-324],
    ['exponent-form string 1e5', '1e5'],
    ['zero string 0', '0'],
    ['leading-zero string 01', '01'],
    ['signed string -1', '-1'],
    ['non-numeric string abc', 'abc'],
    ['empty string', ''],
  ] as const)('an invalid dt_us (%s) is refused as malformed at admission', (_label, bad) => {
    expect(() => parseManifest(withDt(bad))).toThrow(/dt_us is not a canonical positive-integer string/)
  })
  test('a MISSING dt_us names the field (the required-field path, before the shape gate)', () => {
    expect(() => parseManifest(withDt(undefined))).toThrow(/dt_us/)
  })
})

// run_complete carries a VALUE contract, not just a type: the publication contract (spec-3a §4.5) requires
// run_complete:true for a Published run. Driven from RAW manifest JSON exactly as useRun does — parseManifest(text)
// → gateManifest → the `if (!gate.ok) return` that short-circuits BEFORE stageDecode, so a
// refused run never reaches the verify fold: no manifest-verified verdict, no session seal. The refusal SURFACE
// (the rendered headline) is pinned separately in GateScreen.test.tsx.
describe('gateManifest — an incomplete run (run_complete=false) is refused at admission; no verdict, no seal', () => {
  const withRunComplete = (v: unknown): string => { const j = JSON.parse(text); j.outputs.run_complete = v; return JSON.stringify(j) }
  const f0Verify = decodeBundle(load('f0_seed42.det')).verify
  test('run_complete:false PARSES (a legal boolean) but the admission gate REFUSES with the not-published headline', () => {
    const m = parseManifest(withRunComplete(false)) // from RAW JSON: the parse succeeds — the value is a valid boolean
    expect(m.runComplete).toBe(false)
    const g = gateManifest(m, identity)
    expect(g.ok).toBe(false)
    if (!g.ok) {
      expect(g.field).toBe('run_complete')
      expect(g.expected).toBe('true')
      expect(g.actual).toBe('false')
      expect(g.headline).toMatch(/not published/)
      expect(g.headline).toMatch(/incomplete/)
    }
  })
  test('the GATE is the sole barrier: the verdict layer would MINT manifest-verified for the very same bytes', () => {
    // verdictAgainstManifest does NOT check completeness — fed the incomplete manifest + f0's OWN recomputed verify
    // it returns the manifest-grade verdict. The seal binds to THAT verdict (App's shouldSealRun on verdict !==
    // 'mismatch'), and useRun reaches it ONLY inside stageDecode, PAST the gate. So the upstream refusal is exactly
    // what stops an incomplete run from sealing green — without it, this same run would mint manifest-verified.
    const m = parseManifest(withRunComplete(false))
    expect(verdictAgainstManifest(f0Verify, m)).toBe('manifest-verified') // the dangerous verdict the gate prevents reaching
  })
  test('a run_complete:true manifest is ADMITTED (the golden path is unaffected)', () => {
    expect(gateManifest(parseManifest(withRunComplete(true)), identity).ok).toBe(true)
  })
  test('ordering — a manifest invalid in BOTH identity AND completeness: identity refuses FIRST (dialect wins)', () => {
    // NON-VACUOUS: both legs fail. If completeness moved ahead of identity, the field would be run_complete (with a
    // headline). It must be the identity field, headline-less → the surface shows the dialect wording, not incomplete.
    const j = JSON.parse(withRunComplete(false)); j.inputs.state_registry_hash = 'ff'.repeat(32)
    const g = gateManifest(parseManifest(JSON.stringify(j)), identity)
    expect(g.ok).toBe(false)
    if (!g.ok) { expect(g.field).toBe('state_registry_hash'); expect(g.headline).toBeUndefined() }
  })
})
