import { describe, expect, test } from 'vitest'
import { resolveLoadPlan, catalogDetOnly, RUN_CATALOG } from './runCatalog'

// ── H1 — runs/index.json is NOT authority; the trusted catalog decides the load plan ─────────────────────
// The vuln: index.json's `base` chose whose bytes load and `detOnly` chose whether a manifest was fetched, so
// a tampered entry {id:'f0', base:'runs/e0', detOnly:true} loaded e0's bytes, skipped f0's manifest, and sealed
// green AS f0. resolveLoadPlan resolves the base + manifest policy from the in-app catalog, keyed ONLY on the
// run id — the unsigned index can no longer redirect a load.

describe('resolveLoadPlan: a certified id resolves from the pinned catalog, never from the index', () => {
  test('every certified id resolves to its OWN pinned base and manifest policy', () => {
    expect(resolveLoadPlan('f0')).toEqual({ base: 'runs/f0', manifestRequired: true, certified: true })
    expect(resolveLoadPlan('f2a')).toEqual({ base: 'runs/f2a', manifestRequired: true, certified: true })
    expect(resolveLoadPlan('f3a')).toEqual({ base: 'runs/f3a', manifestRequired: true, certified: true })
    expect(resolveLoadPlan('f4')).toEqual({ base: 'runs/f4', manifestRequired: true, certified: true })
    expect(resolveLoadPlan('e0')).toEqual({ base: 'runs/e0', manifestRequired: false, certified: true })
    expect(resolveLoadPlan('f1')).toEqual({ base: 'runs/f1', manifestRequired: false, certified: true })
  })

  test('THE TAMPER: a lying index entry cannot redirect the base or drop the manifest', () => {
    // Simulate the attack entry. resolveLoadPlan takes ONLY the id — it never reads this entry — so f0 still
    // loads runs/f0 with the manifest REQUIRED, and the base-swap + silent det-only downgrade are both closed.
    const tampered = { id: 'f0', base: 'runs/e0', detOnly: true }
    const plan = resolveLoadPlan(tampered.id)!
    expect(plan.base).toBe('runs/f0')            // NOT the tampered 'runs/e0'
    expect(plan.base).not.toBe(tampered.base)
    expect(plan.manifestRequired).toBe(true)     // NOT the tampered det-only downgrade
  })

  test('a manifest-required run can never be resolved as det-only (no silent downgrade)', () => {
    for (const [id, entry] of Object.entries(RUN_CATALOG)) {
      if (entry.manifest === 'required') expect(resolveLoadPlan(id)!.manifestRequired).toBe(true)
    }
  })
})

describe('resolveLoadPlan: an UNKNOWN id gets the honest lowest-trust posture (det-only, never green)', () => {
  test('a future/dev id resolves to its own id-derived base as det-only, marked uncertified', () => {
    expect(resolveLoadPlan('z9')).toEqual({ base: 'runs/z9', manifestRequired: false, certified: false })
  })
  test('an unknown id can never mint a manifest-required plan — self-consistent at most (no manifest-grade green)', () => {
    const plan = resolveLoadPlan('totally-new-run')!
    expect(plan.manifestRequired).toBe(false)
    expect(plan.certified).toBe(false)
    // The base is derived from the id itself, NEVER pointed at another run's bytes.
    expect(plan.base).toBe('runs/totally-new-run')
  })
  test('the certified ids all conform to the id grammar (they resolve, never null)', () => {
    for (const id of Object.keys(RUN_CATALOG)) expect(resolveLoadPlan(id)).not.toBeNull()
  })
})

// ── F2 — the id grammar: a TRAVERSAL id resolves to NO plan (no spoofable fetch) ──────────────────────────
// The unknown-id arm derives its base as `runs/<id>`, so an id like 'x/../f0' would normalize under fetch to
// runs/f0 — f0's bytes served under a spoofed label (the identity display then lies). A run id must be a SINGLE
// path segment (/^[a-z0-9][a-z0-9-]*$/); a non-conforming id resolves to null and useRun surfaces the unknown-
// run error, never a fetch. (The catalog is in-bundle source; the descoped variant — an attacker adding a
// catalog alias — is editing the app, out of scope.)
describe('resolveLoadPlan: a path-traversal / non-conforming id resolves to NO plan (F2)', () => {
  test('a traversal id (x/../f0) resolves to null — never a base string a fetch could normalize to f0', () => {
    expect(resolveLoadPlan('x/../f0')).toBeNull()
  })
  test.each([
    '../f0', 'runs/f0', 'a/b', 'f0/', '/f0', 'f0/..', './f0', 'f 0', 'F0', 'f0%2e%2e', 'a\\b', '',
  ])('a non-conforming id (%j) resolves to null (no spoofable fetch path)', (id) => {
    expect(resolveLoadPlan(id)).toBeNull()
  })
  test('a conforming single segment (letters/digits/hyphens) still resolves to a det-only plan', () => {
    expect(resolveLoadPlan('f3a-robust')).toEqual({ base: 'runs/f3a-robust', manifestRequired: false, certified: false })
  })
})

// ── F5/F8 — prototype-chain keys never resolve to a plan (no certified entry, no fetch) ─────────────────────
// The vuln: RUN_CATALOG[runId] was indexed via bracket access BEFORE the grammar test, so a prototype key
// resolved to an INHERITED member as a truthy "certified entry": resolveLoadPlan('__proto__') returned
// Object.prototype with `.base` undefined → certified:true, base undefined → useRun fetched 'undefined/bundle.det';
// 'constructor' returned the Object constructor the same way. The grammar test (F5) rejects '__proto__'/'toString'/
// 'hasOwnProperty' (non-conforming); F8 adds the PROTOTYPE_DENYLIST so the two conforming prototype names —
// 'constructor' and 'prototype' — ALSO resolve to null instead of an uncertified 'runs/constructor' fetch. So the
// contract is now unambiguous: EVERY prototype-shaped id resolves to NO plan and NO fetch.
describe('resolveLoadPlan / catalogDetOnly: prototype-chain keys (F5/F8)', () => {
  const PROTO = ['__proto__', 'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty'] as const

  test.each(PROTO)('%j resolves to NULL — never a certified entry, never a fetch', (key) => {
    expect(resolveLoadPlan(key)).toBeNull()
  })
  test.each(PROTO)('%j is det-only-grade — never a manifest-grade green', (key) => {
    expect(catalogDetOnly(key)).toBe(true) // a null plan is the lowest-trust det-only default
  })
  test('F8 — the two GRAMMAR-CONFORMING prototype names (constructor, prototype) resolve to null, not a fetch', () => {
    // These pass RUN_ID_RE (all lowercase), so pre-F8 they took the uncertified det-only path and useRun fetched
    // 'runs/constructor'. The denylist closes that: `resolveLoadPlan(id) === null` is the exact seam useRun
    // branches on (`if (plan === null) throw unknown run`) BEFORE any fetchDet/fetchBundle.
    expect(resolveLoadPlan('constructor')).toBeNull()
    expect(resolveLoadPlan('prototype')).toBeNull()
  })
  test('the denylist does not touch real catalog ids or ordinary future/dev ids', () => {
    // Certified ids and ordinary conforming ids (even ones that merely CONTAIN a denied substring) still resolve.
    expect(resolveLoadPlan('f0')).not.toBeNull()
    expect(resolveLoadPlan('constructor-2')).toEqual({ base: 'runs/constructor-2', manifestRequired: false, certified: false })
  })
})
