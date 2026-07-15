import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { serializeIndex } from './runIndex.mjs'

const SRC = process.env.CERTUS_REPO
if (!SRC) {
  throw new Error('CERTUS_REPO is not set. Point it at the Certus engine repo (or a `git archive` extraction of the pinned commit) before syncing the contract.')
}
const GOLDEN = join(SRC, 'tools/reference-encoder/golden')
const SPECS = join(SRC, 'docs/v2/architecture')
const FIXTURES = [
  'f0_primitives.json', 'f0_seed42.det', 'f0_seed42.manifest.json', 'f0_seed42.json',
  'e0_seed42.det', 'e0_seed42.json', 'f1_seed42.det', 'f1_seed42.json',
]

mkdirSync('contract/fixtures', { recursive: true })
mkdirSync('public/runs/f0', { recursive: true })
mkdirSync('public/runs/e0', { recursive: true })
mkdirSync('public/runs/f1', { recursive: true })
mkdirSync('public/runs/f2a', { recursive: true })
mkdirSync('public/runs/f3a', { recursive: true })
mkdirSync('public/runs/f4', { recursive: true })

const files = {}
const vendor = (src, dst) => {
  cpSync(src, dst)
  files[dst.replaceAll('\\', '/')] = createHash('sha256').update(readFileSync(src)).digest('hex')
}
for (const f of FIXTURES) vendor(join(GOLDEN, f), join('contract/fixtures', f))
for (const f of ['spec-3a-event-schema.md', 'spec-3b-evidence-layer.md']) vendor(join(SPECS, f), join('contract', f))

const manifest = JSON.parse(readFileSync('contract/fixtures/f0_seed42.manifest.json', 'utf8'))
writeFileSync('contract/identity.json', JSON.stringify({
  eventSchemaVersion: manifest.inputs.event_schema_version,
  stateSchemaVersion: manifest.inputs.state_schema_version,
  schemaRegistryHash: manifest.inputs.schema_registry_hash,
  stateRegistryHash: manifest.inputs.state_registry_hash,
}, null, 2))

cpSync('contract/fixtures/f0_seed42.det', 'public/runs/f0/bundle.det')
cpSync('contract/fixtures/f0_seed42.manifest.json', 'public/runs/f0/manifest.json')
cpSync('contract/fixtures/e0_seed42.det', 'public/runs/e0/bundle.det')
cpSync('contract/fixtures/f1_seed42.det', 'public/runs/f1/bundle.det')

// v8 certified fixture drop (f2a/f3a/f4 seed-42 KAT) — published as FULL-manifest runs (like f0),
// gate-verified against contract/identity.json. Unlike f0/e0/f1 these are NOT re-vendored from the
// Certus golden dir: they arrived as a manual certified directory drop (commit e577e46), each an
// `<attempt_id>/` dir holding EXACTLY {bundle.det, manifest.json} beside its own IDENTITY.json (the
// anti-smuggling layout documented in contract/fixtures/README-2026-07-08-drop.md). So we publish
// from the already-vendored, byte-verified fixture dirs — the persistent source of truth — rather
// than from Certus golden. attemptDir finds the single attempt dir under each fixture (the one
// non-IDENTITY.json entry); its bytes are pinned to the sha256 in <fixture>/IDENTITY.json.
const attemptDir = (fixture) => {
  const base = join('contract/fixtures', fixture)
  const dirs = readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)
  if (dirs.length !== 1) throw new Error(`${fixture}: expected exactly one attempt dir, found ${dirs.length}`)
  return join(base, dirs[0])
}
for (const [id, fixture] of [['f2a', 'f2a_seed42'], ['f3a', 'f3a_seed42'], ['f4', 'f4_seed42']]) {
  const src = attemptDir(fixture)
  cpSync(join(src, 'bundle.det'), join('public/runs', id, 'bundle.det'))
  cpSync(join(src, 'manifest.json'), join('public/runs', id, 'manifest.json'))
}

// index.json is built by tools/runIndex.mjs (the run list + the publish-time enrichment: kind
// histogram + tick count decoded from the just-published bytes, and dt_us / supersedes_plan_id from
// the manifest). The Hangar (T5b) reads this file alone to render its cards; publication.test.ts
// proves every declared histogram against the real decoder. serializeIndex writes the exact committed
// bytes (2-space, no trailing newline) so this generator's output equals the tracked artifact.
writeFileSync('public/runs/index.json', serializeIndex())

// A contract sync pins a SPECIFIC Certus commit, not whatever a working tree happens to be on.
// When CERTUS_REPO points at a `git archive` extraction of the pinned commit (used because the
// real Certus checkout is on a different branch and must not be touched), that dir is not a git
// repo, so `git rev-parse`/`git status` there would fail. CERTUS_COMMIT supplies the pinned SHA
// explicitly; a committed/archived tree is inherently clean, so dirty=false in that mode.
const commit = process.env.CERTUS_COMMIT ?? execSync('git rev-parse HEAD', { cwd: SRC }).toString().trim()
const dirty = process.env.CERTUS_COMMIT ? false : execSync('git status --porcelain', { cwd: SRC }).toString().trim().length > 0
writeFileSync('contract/SOURCE.lock', JSON.stringify({ certus_commit: commit, certus_dirty: dirty, synced_at: new Date().toISOString(), files }, null, 2))
console.log(`synced from ${commit}${dirty ? ' (DIRTY)' : ''}`)
for (const f of ['f0_seed42.json', 'e0_seed42.json', 'f1_seed42.json'])
  console.log(f, Object.keys(JSON.parse(readFileSync(join('contract/fixtures', f), 'utf8'))).join(','))
