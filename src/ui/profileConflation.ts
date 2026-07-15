// The profile-conflation tripwire (D4 rider / W2) — THE single source of the scan pattern.
//
// No card note, rendered verdict, or index string may carry the OTHER campaign's wordmark: a
// tampered-or-careless surface must never smuggle the robust / statistical-acceptance claim onto the
// correct-campaign f3a card. Three suites scan with this exact binding — hangar.test.ts (the note +
// every rendered verdict label), publication.test.ts (the published index bytes), and e2e/smoke.spec.ts
// (the rendered f3a card) — so the tripwire can never drift between unit and e2e (closure item 2).
//
// DELIBERATELY A LEAF MODULE WITH ZERO IMPORTS: the e2e suite lives in the tsconfig.node.json project
// (module nodenext, extension-ful relative imports), while the app sources live in tsconfig.app.json
// (bundler resolution, extensionless). A zero-import file typechecks under BOTH programs, so the smoke
// spec can import the very same binding the unit suites use. Do not add imports here; src/ui/hangar.ts
// re-exports it for the app-side consumers.
export const PROFILE_CONFLATION_RE = /robust|statistical[- ]acceptance|acceptance campaign/i
