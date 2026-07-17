import { defineConfig } from '@playwright/test'
// Preview port is env-overridable (default 4173 — unchanged for the main checkout). A worktree running
// smoke alongside other instances passes SMOKE_PORT to avoid colliding on a shared port; --port threads
// it into `vite preview` and baseURL/url follow. Default behavior is identical to before.
//
// SMOKE_PORT is validated and NORMALIZED before it ever reaches an interpolation. The raw env string
// was previously spliced straight into webServer.command (a shell string) and into the URL — a shell-
// metacharacter surface, and any malformed value (e.g. "4325 && rm", "80x", "") would silently desync
// baseURL from the port vite actually binds. We now require pure digits in 1-65535 and interpolate ONLY
// the resulting number into BOTH the command and the url, so the two can never disagree and no unparsed
// string reaches the shell. An invalid value throws a clear error at config load rather than failing weird.
function resolveSmokePort(raw: string | undefined): number {
  if (raw === undefined) return 4173
  if (!/^\d+$/.test(raw)) {
    throw new Error(`SMOKE_PORT must be an integer 1-65535 (digits only), got ${JSON.stringify(raw)}`)
  }
  const port = Number(raw)
  if (port < 1 || port > 65535) {
    throw new Error(`SMOKE_PORT must be within 1-65535, got ${port}`)
  }
  return port
}
const port = resolveSmokePort(process.env.SMOKE_PORT)
const url = `http://localhost:${port}`
export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: url },
  // --strictPort: vite preview binds EXACTLY this port or fails loudly, so the auto-started server can
  // never land on the next free port and desync from baseURL (the same port/URL-coherence guards).
  webServer: { command: `npm run preview -- --port ${port} --strictPort`, url, reuseExistingServer: true },
  projects: [{ name: 'chromium', use: { browserName: 'chromium', launchOptions: { args: ['--use-angle=swiftshader'] } } }],
})
