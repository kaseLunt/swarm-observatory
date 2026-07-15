// Single source of truth for the visual system (spec §6). CSS mirror: theme.css.
export const PALETTE = {
  bgVoid: '#080b0f',        // planetarium base
  bgPanel: '#10151c',
  bgElevated: '#16202b',
  border: '#1c2733',
  borderBright: '#2a3b4d',
  textPrimary: '#d7e0ea',
  textDim: '#8899aa',
  textFaint: '#5a6b7a',
  accent: '#56b6ff',        // selection / primary UI accent
  timeCursor: '#ffd166',    // playhead — its own token, NOT the decision-category hue (rev-2 graded decision to copper, so now distinct in value too)
  verified: '#4ade80',
  mismatch: '#f87171',
  pending: '#64748b',
  // rev-3 R3 swatch (owner-approved 2026-07-09): un-borrow two double-spent hues. The query-verdict pulse
  // pair gets its OWN hues off the integrity green/red (so a routine query=false no longer flashes the
  // tamper red), and the causal-chain highlight gets its own causality violet off the amber time-cursor
  // (so time owns gold alone — the playhead cuts cleanly through the chain). Placement + ΔE/CVD receipts:
  // .superpowers/sdd/swatch-v06-rev3.html (Set 1). No reserved hue and no CATEGORY hue moved (LAW 2).
  verdictAffirm: '#3af2ff',  // query-verdict TRUE — HDR pulse / stage-contact affirm, own hue off `verified`
  verdictNegate: '#c2410c',  // query-verdict FALSE — lightness-graded ember, own hue off `mismatch`
  spine: '#b366f5',          // causal-chain highlight (spine role tones + timeline chain overlay) — off `timeCursor`
  gridCell: '#243444',      // world-dressing grid: minor cell lines (every 1u)
  gridMajor: '#31465b',     // world-dressing grid: major lines (every 5u), brighter
  vignetteCenter: '#0c1420', // backdrop vignette centre (under the scene) — also the scene fog colour
  vignetteEdge: '#05070a',   // backdrop vignette edge (frame corners)
} as const

// Event-category semantics (spec-3a §2.3). Hue is NEVER the only channel — glyph is the
// redundant, color-blind-safe encoding carried everywhere a category appears.
export const CATEGORY = {
  // rev-2 chroma-graded hierarchy: hue does identity, chroma does hierarchy; the reserved tokens
  // (accent #56b6ff, time-cursor #ffd166, mismatch #f87171) keep the brightest register for meaning,
  // so no category shares a reserved hex any longer (accent is now selection-owned).
  query:    { hue: '#82a8d2', glyph: '◆', label: 'query/observation' },   // E0 kind-23 — matte steel: ambient category recedes so selection pops
  decision: { hue: '#e2a05c', glyph: '▲', label: 'decision/intent' },     // copper, off the time-cursor gold corridor
  mutating: { hue: '#e072ae', glyph: '●', label: 'resolver-mutating' },   // rose-magenta: the hot pole that isn't mismatch-red
  fact:     { hue: '#2dd4bf', glyph: '◇', label: 'resolver-fact' },
  comms:    { hue: '#a78bfa', glyph: '✳', label: 'comms' },
} as const
export type CategoryKey = keyof typeof CATEGORY
// Palette token NAMES, as a type — the compile-time membership set for a lens registration's borrowed
// hues (LAW 2: a lens names existing tokens, never a value). Exported as a TYPE so a type-only importer
// (lensContract.ts) can constrain `borrowedHues` without a runtime edge to this module.
export type PaletteKey = keyof typeof PALETTE

// The postprocessing Bloom's luminance cutoff (Scene.tsx's EffectComposer). ONE source of truth: the renderer
// reads it, and the HDR-boost tests pin "does this hue bloom?" against it — so if the threshold moves, both the
// glow and its regression pins move together (never a transcribed copy that silently drifts from the renderer).
// Not a colour, so it has no theme.css mirror.
export const BLOOM_LUMINANCE_THRESHOLD = 0.4

export const hexToThree = (hex: string): number => parseInt(hex.slice(1), 16)
