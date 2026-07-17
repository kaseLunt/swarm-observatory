import { describe, expect, test } from 'vitest'
import {
  CAMPAIGN_CATALOG, ROBUST_F3A, getCampaign, resolveCampaignSeed,
  campaignBundlePath, resolveAppBase, campaignBundleUrl,
} from './campaignCatalog'

// ── The campaign catalog is the AUTHORITY (the runCatalog H1 lesson at birth). These prove its SHAPE and its
//    grammar/prototype safety; the drift gate (catalog ⇄ vendored manifest ⇄ vendored bytes) lives in
//    publication.test.ts, the house's conformance suite. ──

describe('ROBUST_F3A catalog: the pinned 50-seed ensemble', () => {
  test('pins the precommit plan_id and the ROBUST verdict', () => {
    expect(ROBUST_F3A.planId).toBe('c40caf859cdadc7eb986e083582983b06536c64ba4ef7acc56fc73d9a00bdca3')
    expect(ROBUST_F3A.verdictLevel).toBe(2)
    expect(ROBUST_F3A.verdictLevelName).toBe('ROBUST')
    expect(ROBUST_F3A.nSeeds).toBe(50)
    expect(ROBUST_F3A.attemptsPerVariant).toBe(3)
  })

  test('carries exactly 50 seeds, seeds 42..91, no gaps, no duplicates', () => {
    expect(ROBUST_F3A.seeds).toHaveLength(50)
    const seeds = ROBUST_F3A.seeds.map(s => s.seed)
    expect(seeds).toEqual(Array.from({ length: 50 }, (_, i) => 42 + i))
    expect(new Set(seeds).size).toBe(50)
    expect(ROBUST_F3A.nSeeds).toBe(ROBUST_F3A.seeds.length)
  })

  test('every pin is a 64-hex case_id / result_id / sha256 (well-formed identity fields)', () => {
    const hex64 = /^[0-9a-f]{64}$/
    for (const s of ROBUST_F3A.seeds) {
      expect(s.caseId, `seed ${s.seed} caseId`).toMatch(hex64)
      expect(s.resultId, `seed ${s.seed} resultId`).toMatch(hex64)
      expect(s.sha256, `seed ${s.seed} sha256`).toMatch(hex64)
      expect(s.len).toBeGreaterThan(0)
    }
  })

  test('case_id, result_id and sha256 are each unique across seeds (no accidental row copy)', () => {
    expect(new Set(ROBUST_F3A.seeds.map(s => s.caseId)).size).toBe(50)
    expect(new Set(ROBUST_F3A.seeds.map(s => s.resultId)).size).toBe(50)
    expect(new Set(ROBUST_F3A.seeds.map(s => s.sha256)).size).toBe(50)
  })

  test('the catalog is keyed by campaign id', () => {
    expect(Object.keys(CAMPAIGN_CATALOG)).toEqual(['robust-f3a'])
    expect(getCampaign('robust-f3a')).toBe(ROBUST_F3A)
    expect(getCampaign('nope')).toBeNull()
  })
})

describe('resolveCampaignSeed: a pinned seed resolves from the catalog, never from the manifest', () => {
  test('every pinned seed id (42..91) resolves to its own pin', () => {
    for (const s of ROBUST_F3A.seeds) {
      expect(resolveCampaignSeed('robust-f3a', String(s.seed))).toBe(s)
    }
  })
  test('an unknown campaign id resolves to null', () => {
    expect(resolveCampaignSeed('nope', '42')).toBeNull()
  })
  test('a seed outside the ensemble (41 / 92) resolves to null', () => {
    expect(resolveCampaignSeed('robust-f3a', '41')).toBeNull()
    expect(resolveCampaignSeed('robust-f3a', '92')).toBeNull()
  })
})

// ── Prototype-safety precedent (runCatalog): a non-conforming or prototype-shaped seed id resolves to NO pin ─────────
describe('resolveCampaignSeed: grammar + prototype safety (reuse the runCatalog precedents)', () => {
  test.each([
    '../42', 'campaigns/42', 'a/b', '42/', '/42', '42/..', './42', '4 2', '4a', '', '0x2a',
    '042', ' 42', '42 ', '+42', '-1', '4.2',
  ])('a non-conforming seed id (%j) resolves to null (no spoofable fetch path)', (id) => {
    expect(resolveCampaignSeed('robust-f3a', id)).toBeNull()
  })

  const PROTO = ['__proto__', 'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty'] as const
  test.each(PROTO)('a prototype-shaped id (%j) resolves to null — never an inherited member, never a fetch', (key) => {
    expect(resolveCampaignSeed('robust-f3a', key)).toBeNull()
  })
  test('a canonical decimal id in range still resolves (the grammar admits real seeds)', () => {
    expect(resolveCampaignSeed('robust-f3a', '42')).not.toBeNull()
    expect(resolveCampaignSeed('robust-f3a', '91')).not.toBeNull()
  })
})

describe('the base-resolution seam: main-thread resolveAppBase + worker-side campaignBundleUrl join', () => {
  const DOC = 'https://kaselunt.dev/swarm-observatory/index.html' // a Pages document base (document.baseURI)

  test('campaignBundlePath is the base-relative seed path — derived from base+seed, never a manifest field', () => {
    const s42 = resolveCampaignSeed('robust-f3a', '42')!
    expect(campaignBundlePath(ROBUST_F3A, s42)).toBe('campaigns/robust-f3a/42/bundle.det')
    const s91 = resolveCampaignSeed('robust-f3a', '91')!
    expect(campaignBundlePath(ROBUST_F3A, s91)).toBe('campaigns/robust-f3a/91/bundle.det')
  })

  // resolveAppBase runs on the MAIN THREAD (a worker cannot interpret a relative Vite base — its own fetch
  // would resolve against the worker script url). Each deploy-base shape resolves to the correct ABSOLUTE base,
  // and the worker-side join then yields the correct absolute campaigns url. '' and './' (relative Vite bases)
  // resolve to the DOCUMENT DIRECTORY; a missing / repeated trailing slash is normalised.
  test.each([
    ['/',                     'https://kaselunt.dev/'],
    ['/swarm-observatory/',   'https://kaselunt.dev/swarm-observatory/'],
    ['',                      'https://kaselunt.dev/swarm-observatory/'], // relative base → the document directory
    ['./',                    'https://kaselunt.dev/swarm-observatory/'], // relative base → the document directory
    ['/swarm-observatory',    'https://kaselunt.dev/swarm-observatory/'], // missing trailing slash → normalised
    ['/swarm-observatory///',  'https://kaselunt.dev/swarm-observatory/'], // repeated trailing slashes → collapsed
  ])('resolveAppBase(%j) → the correct absolute base, then the join → the correct absolute campaigns url', (base, absBase) => {
    expect(resolveAppBase(base, DOC)).toBe(absBase)
    const s42 = resolveCampaignSeed('robust-f3a', '42')!
    expect(campaignBundleUrl(ROBUST_F3A, s42, resolveAppBase(base, DOC)))
      .toBe(`${absBase}campaigns/robust-f3a/42/bundle.det`)
  })

  // The worker-side JOIN in isolation, pinned against a FAKE absolute base (no DOM). NOTE: this proves the join +
  // resolution units; the full built-worker fetch under a non-root Pages base is proven at DEPLOY (the smoke suite
  // runs at root base '/', so a non-root worker fetch is not exercised in-process).
  test('campaignBundleUrl joins the base-relative seed path onto a fake absolute base via URL semantics', () => {
    const s42 = resolveCampaignSeed('robust-f3a', '42')!
    expect(campaignBundleUrl(ROBUST_F3A, s42, 'https://example.test/repo/'))
      .toBe('https://example.test/repo/campaigns/robust-f3a/42/bundle.det')
    const s91 = resolveCampaignSeed('robust-f3a', '91')!
    expect(campaignBundleUrl(ROBUST_F3A, s91, 'https://example.test/'))
      .toBe('https://example.test/campaigns/robust-f3a/91/bundle.det')
  })

  test('the manifest url is discovery-only and distinct from any seed url', () => {
    expect(ROBUST_F3A.manifestUrl).toBe('campaigns/robust-f3a/campaign-manifest.json')
  })
})
