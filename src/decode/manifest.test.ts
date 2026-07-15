import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { gateManifest, parseManifest, type Identity } from './manifest'

const text = readFileSync('contract/fixtures/f0_seed42.manifest.json', 'utf8')
const identity: Identity = JSON.parse(readFileSync('contract/identity.json', 'utf8'))

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
