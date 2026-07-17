// The stale-dist smoke footgun. `npm run smoke` starts `vite preview`, which SERVES dist/
// but NEVER builds it. Run smoke on a tree whose dist/ predates your source edits and the browser tests
// pass against OLD bytes — the "17/19 illusion" (a merge-verify that green-lit a change that never
// actually reached the previewed build). This guard runs BEFORE playwright and FAILS LOUD if dist/ is
// missing or older than any bundle input, naming the exact fix.
//
// WHY A FRESHNESS CHECK AND NOT A BUILD STEP: CI already runs `npm run build` immediately before
// `npm run smoke` (.github/workflows/ci.yml), so dist/ is always fresh there — a build baked into the
// smoke command would only add a second, redundant full build to every CI run. The gap this closes is
// LOCAL: forgetting to rebuild before smoke. So the guard is an ASSERTION that costs nothing when dist
// is fresh (the CI case) and stops the footgun when it is stale (the local case).
//
// SIGNAL: the newest mtime across the bundle inputs — index.html, src/** (minus test files), public/**,
// and the vite/ts/package configs — vs dist/index.html's mtime. vite rewrites index.html on every build,
// so its mtime stamps "when dist was last built". Test files (*.test.*) and e2e/ are excluded: they never
// enter the bundle vite preview serves, so editing them must not force a rebuild to run smoke.

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const DIST_STAMP = 'dist/index.html'
const CONFIG_INPUTS = ['index.html', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json', 'package.json',
  // contract/identity.json is BUNDLED (useRun imports it) -- an identity re-stamp after build is exactly
  // the stale class this guard exists for; hand-listed inputs must include every bundled out-of-src file.
  'contract/identity.json']
const INPUT_DIRS = ['src', 'public']
const isTestFile = (name) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(name)

function fail(reason) {
  console.error(
    `\n  stale-dist guard: ${reason}\n` +
    '  fix: run `npm run build` before `npm run smoke` — vite preview serves dist/ but never builds it.\n',
  )
  process.exit(1)
}

if (!existsSync(DIST_STAMP)) fail('dist/ is missing or has no index.html — nothing built to preview.')

// Newest mtime over a file/dir tree, skipping test files (which never reach the bundle).
function newestMtime(path, acc) {
  const st = statSync(path)
  if (st.isDirectory()) {
    for (const name of readdirSync(path)) acc = newestMtime(join(path, name), acc)
    return acc
  }
  const base = path.replaceAll('\\', '/').split('/').pop()
  return isTestFile(base) ? acc : Math.max(acc, st.mtimeMs)
}

let srcNewest = 0
for (const f of CONFIG_INPUTS) if (existsSync(f)) srcNewest = Math.max(srcNewest, statSync(f).mtimeMs)
for (const d of INPUT_DIRS) if (existsSync(d)) srcNewest = newestMtime(d, srcNewest)

const distStamp = statSync(DIST_STAMP).mtimeMs
if (srcNewest > distStamp) {
  const staleBy = Math.round((srcNewest - distStamp) / 1000)
  fail(`dist/ is STALE — a bundle input changed ${staleBy}s after the last build (newer than ${DIST_STAMP}).`)
}
console.log('stale-dist guard: dist/ is fresh (built after every bundle input).')
