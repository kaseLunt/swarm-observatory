// Pure header-condensation model — the priority ladder that keeps the app chrome ONE row at every
// width. No DOM, no store, no React: the tier classification and the per-tier layout are unit-testable
// without a render harness (the repo carries none), mirroring coldOpen.ts / thesis.ts's split of the
// decision from the glue. App owns the effect that reads the live width (useHeaderTier); the ladder's
// rules live HERE, where a test can pin them, and are the SINGLE source both the header JSX and the CSS
// read from — never a hand-maintained twin.
//
// THE LADDER (widest → narrowest). Chrome sheds from the outside in, in a fixed priority order, by
// dropping label weight — never by wrapping to a second row:
//   • full      — everything at full weight: the six run buttons, the labeled hangar / copy-link, the
//                 full "certification wall".
//   • condensed — the run switcher collapses to a `run ▾` picker (the largest offender, and the picker
//                 scales past six runs the button row cannot); the low-priority chrome (hangar, copy-
//                 link, evidence table) sheds its labels to icons; the wall label condenses to "wall".
//   • overflow  — the low-priority chrome (hangar, copy-link, evidence table) folds into a single `⋯`
//                 menu; the wordmark word recedes to just the radar mark; the panel-toggles shed labels.
//   • mobile    — the phone floor (≤640px): the panel-toggles ALSO fold into the `⋯` menu and the row
//                 tightens its gaps/padding, so the picker + the two brand CTAs + the `⋯` + help still
//                 fit a 360px viewport.
// INVARIANT across every tier: the two brand CTAs — the ▶ tour launcher and the certification-wall
// entry — never fold and never leave the row. The wall CTA may condense its LABEL ("certification
// wall" → "wall"), but it never disappears into the `⋯` overflow. The run switcher always stays
// reachable (as buttons or as the picker). These are the priority-(b)/(c) guarantees the ladder exists
// to protect; the tier only decides the FORM of the protected controls, never whether they render.
export type HeaderTier = 'full' | 'condensed' | 'overflow' | 'mobile'

// The condensation thresholds, in CSS px (a `max-width` semantics: a width AT a threshold is already on
// the narrower side of it). CONDENSED_MAX coincides with the existing side-panel breakpoint (app.css —
// below it the panels leave the grid and become overlays, and the panel-toggles enter the header): the
// same narrow band that adds the two panel-toggles is the band that collapses the six-button run
// switcher, so the added weight is paid for by the removed weight and the row still fits. OVERFLOW_MAX
// is where the low-priority chrome must fold; MOBILE_MAX is the phone floor where even the panel-toggles
// fold and the spacing tightens.
export const CONDENSED_MAX = 1080
export const OVERFLOW_MAX = 960
export const MOBILE_MAX = 640

// The live width → tier classifier. `max-width` semantics: ≤ a threshold is on the narrower side of it.
export function headerTier(width: number): HeaderTier {
  if (width <= MOBILE_MAX) return 'mobile'
  if (width <= OVERFLOW_MAX) return 'overflow'
  if (width <= CONDENSED_MAX) return 'condensed'
  return 'full'
}

// The per-tier layout — the whole ladder in one table, so the header JSX branches on named intents
// (never on the tier string or a raw width). Each field is one condensation axis:
//   • runSwitcher  — 'buttons' (the six-run row) vs 'picker' (the `run ▾` disclosure). Always reachable.
//   • chrome       — how the LOW-PRIORITY controls (hangar, copy-link, evidence table) present: 'labels' →
//                    'icons' → 'overflow' (folded into the `⋯` menu). This is the only axis that ever hides a
//                    control from the row; it hides ONLY the low-priority chrome. The evidence-table entry
//                    is a new occupant of this axis — an instrument front door, not a brand CTA, so it folds
//                    with the hangar/copy-link and never with the two protected CTAs (the tour + wall).
//   • wallLabel    — the certification-wall CTA's visible+accessible label. Condenses but never folds.
//   • wordmark     — 'full' (mark + word) vs 'mark' (the word recedes; the mark keeps its accent cyan).
//   • chip         — the cold-open verdict chip (a real header occupant on a bare cold open). It is
//                    'glyph' at EVERY tier: the collapsed chip shows just the verdict glyph, keeping its
//                    wide headline ("self-consistent — no external manifest") as an sr-only reading. The
//                    full headline is never carried in the row — even at the full tier's narrow end
//                    (1081px) the six-button chrome + a full-headline chip would overflow, and the full
//                    cold-open CARD already delivered that headline for seconds before it collapsed here,
//                    so the header chip is a compact verdict reminder, not a second copy of the sentence.
//   • panelToggles — the side-panel toggles (present only ≤CONDENSED_MAX, where the panels are overlays):
//                    'icons' whenever inline (they carry ☰ + an aria-label — the labeled form is the widest
//                    single non-wordmark element, so it never rides the row) → 'overflow' (folded into the
//                    `⋯` menu at the phone floor). ('labels' remains only for the full tier, where CSS
//                    hides the toggles entirely, so it never renders.)
//   • dense        — the phone-floor spacing (tighter gap + button padding) so the protected controls
//                    fit a 360px viewport.
export interface HeaderLayout {
  runSwitcher: 'buttons' | 'picker'
  chrome: 'labels' | 'icons' | 'overflow'
  wallLabel: 'certification wall' | 'wall'
  wordmark: 'full' | 'mark'
  chip: 'full' | 'glyph'
  panelToggles: 'labels' | 'icons' | 'overflow'
  dense: boolean
}

export function headerLayout(tier: HeaderTier): HeaderLayout {
  switch (tier) {
    case 'full':
      return { runSwitcher: 'buttons', chrome: 'labels', wallLabel: 'certification wall', wordmark: 'full', chip: 'glyph', panelToggles: 'labels', dense: false }
    case 'condensed':
      return { runSwitcher: 'picker', chrome: 'icons', wallLabel: 'wall', wordmark: 'full', chip: 'glyph', panelToggles: 'icons', dense: false }
    case 'overflow':
      return { runSwitcher: 'picker', chrome: 'overflow', wallLabel: 'wall', wordmark: 'mark', chip: 'glyph', panelToggles: 'icons', dense: false }
    case 'mobile':
      return { runSwitcher: 'picker', chrome: 'overflow', wallLabel: 'wall', wordmark: 'mark', chip: 'glyph', panelToggles: 'overflow', dense: true }
  }
}
