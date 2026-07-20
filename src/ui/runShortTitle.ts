// ── AUTHORED SHORT RUN NAMES (the run switcher's human label) ─────────────────────────────────────
// The run switcher used to show the bare run id (`f4`, `f3a`) as its button/menu label — a key that
// teaches a first-time reader nothing. The full index titles ("F4 comms link (seed 42)", 20–35 chars)
// are too long for the condensed one-row picker. This module holds the honest middle: a short, authored
// name per run that names WHAT THE RUN IS — its subject/lens — never the story a guided tour uncovers.
// It is authored, owner-approved copy, so it lives HERE in the shipped bundle (a design act, like a
// caption): single-sourced and imported by every switcher renderer, NEVER duplicated into the unsigned
// run index. index.json keeps its discovery/ordering role only — a presentation string placed there
// could be tampered off-signature, and the switcher label must not be attacker-controllable that way.
//
// Fallback chain (honest degradation, never a crash or a blank label): shortTitle(id) ?? title ?? id.
// A future/unknown run with no authored short name degrades to its full title, then to its id — so the
// switcher always shows something legible, and a run added to the catalog without a short name is caught
// by the presence pin in runShortTitle.test.ts, not by a blank label reaching production.
//
// The incoming title is UNSIGNED index data, cast blindly on load, so it may be missing, empty, whitespace,
// or not even a string (a corrupt or tampered index). The header renders OUTSIDE the app's error boundary,
// so a non-string title flowing into a React child would throw and blank an otherwise-valid certified run,
// and a blank/whitespace title would render a visually empty control. Presentation therefore MUST fail
// soft: the title is treated as `unknown` and used ONLY when it is a non-empty string after trimming;
// otherwise there is nothing legible to show and the fallback proceeds to the id. This normalizes at the
// presentation boundary only — it does not change which entries the loader admits.
//
// Lookup is prototype-safe: Object.hasOwn keeps a prototype-shaped id ('__proto__', 'constructor',
// 'toString', …) from resolving an inherited Object.prototype member as a "name" — such an id falls
// through to the title/id fallback exactly like any other unauthored id, never a function or the prototype.
export const RUN_SHORT_TITLES: Readonly<Record<string, string>> = {
  f0: 'Determinism',
  f1: 'Motion',
  e0: 'Geometry',
  f2a: 'Sensing',
  f3a: 'Target track',
  f4: 'Comms link',
}

// Normalize an unsigned string field to a clean, renderable value, or undefined when there is nothing
// legible (not a string, empty, or whitespace-only). The single fail-soft boundary EVERY rendered-string
// render path passes through — the switcher label + tooltip, the Hangar plate title, and the Hangar
// supersedes line — so no unsigned string reaches a React child directly. The header and the Hangar both
// render outside the app's error boundary, so a malformed string that slipped through would blank the app;
// this boundary makes that impossible by construction. A malformed PRESENTATIONAL string degrades here and
// never omits an otherwise-usable run (structural omission is isRenderableEntry's job, in useRun).
export function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

// The run's short switcher label: the authored short name when one exists, else the (cleaned) full title,
// else the id. `title` is `unknown` because it arrives from the unsigned index — a malformed/blank title is
// treated as absent and resolves to the id, never a throw or an empty control.
export function runShortTitle(id: string, title?: unknown): string {
  if (Object.hasOwn(RUN_SHORT_TITLES, id)) return RUN_SHORT_TITLES[id]!
  return cleanString(title) ?? id
}

// The run's FULL display title (the Hangar plate), cleaned: the full title when legible, else the id. Unlike
// runShortTitle this never substitutes a short name — the plate shows the whole title by design — but it
// still fails soft on a malformed/blank unsigned title so the Hangar cannot be blanked by a corrupt index.
export function runTitle(id: string, title?: unknown): string {
  return cleanString(title) ?? id
}

// The switcher's accessible detail (native tooltip): the id kept discoverable for URL/power users, set
// beside the full title — `f4 · F4 comms link (seed 42)`. The visible label stays the short name; this
// rides the title attribute (an accessible description), so the id survives even though the visible row
// no longer shows it. Degrades to the bare id when the title is missing, blank, or malformed.
export function runTooltip(id: string, title?: unknown): string {
  const t = cleanString(title)
  return t ? `${id} · ${t}` : id
}
