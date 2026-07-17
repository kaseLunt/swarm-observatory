import { expect, test } from 'vitest'
import { INDEPENDENCE_LINE, thesisSubline, thesisVerdict, thesisVerdictFor, tourPastFirstBeat } from './thesis'
import { readyAnnouncementText } from './ceremonyFormat'

test('thesisVerdict is the REAL trust verdict — ✓ verified only for a manifest-verified run', () => {
  const v = thesisVerdict('manifest-verified')
  expect(v).toEqual({ glyph: '✓', headline: 'verified', cls: 'verified' })
})

test('thesisVerdict on a self-consistent (det-only) run reads ○ self-consistent — NEVER the manifest-grade green', () => {
  const v = thesisVerdict('self-consistent')
  expect(v.glyph).toBe('○')
  expect(v.cls).toBe('self')
  expect(v.cls).not.toBe('verified') // the pinned presentational split: no false external claim
  expect(v.headline).not.toContain('verified')
  expect(v.headline).toContain('self-consistent')
})

test('thesisVerdict shows the mismatch voice on a failed pin — never a false green', () => {
  const v = thesisVerdict('mismatch')
  expect(v.glyph).toBe('✗')
  expect(v.cls).toBe('mismatch')
  // The headline must NOT read "verified" when a pinned hash failed (three-voice grammar).
  expect(v.headline).not.toContain('verified')
})

test('thesisVerdict never says "certified" — det-only runs have no external oracle', () => {
  // The tour captions and the ceremony both hold this line: self-verification is "verified"/"self-consistent",
  // never "certified".
  expect(thesisVerdict('manifest-verified').headline).not.toContain('certified')
  expect(thesisVerdict('self-consistent').headline).not.toContain('certified')
  expect(thesisSubline('manifest-verified')).not.toContain('certified')
})

test('thesisSubline is verdict-bound — self-consistent claims no external check; a mismatch no clean re-check', () => {
  expect(thesisSubline('manifest-verified')).toContain('re-checked')
  expect(thesisSubline('self-consistent')).toContain('no external manifest')
  expect(thesisSubline('mismatch')).toContain('failed')
})

// ── The DET-ONLY self-check voice never over-claims "every byte" — the ceremony scope, carried to the app ──
test('det-only thesis + AT announcement never say "every byte" / "all bytes" / "end to end" — they name the trailer-checked scope', () => {
  // 8f1429c scoped the CEREMONY thesis (event & state hashes + frame counts vs the sealed trailer, NO "every
  // byte"); the app's thesis subline was missed. result_id is DERIVED from trailer-sourced case_id/
  // termination_reason with no in-bundle oracle, so "every byte" over-claims those fields. Pin the honest scope
  // here (cheap string pin) so the self-check voice can never drift back into an every-byte claim.
  const sub = thesisSubline('self-consistent')
  for (const overclaim of ['every byte', 'all bytes', 'end to end', 'end-to-end'])
    expect(sub.toLowerCase(), overclaim).not.toContain(overclaim)
  // …and it still names its real scope + the missing oracle (the honest self-check voice, the punch intact):
  expect(sub).toContain('sealed trailer')
  expect(sub).toContain('no external manifest')
  // The AT ready announcement's det-only branch is scoped the same way — never "verified", never "every byte".
  const at = readyAnnouncementText('demo-01', 75, 240, 'self-consistent')
  expect(at.toLowerCase()).not.toContain('every byte')
  expect(at).not.toContain('verified')
})

test('the independence line states the decoder was NOT written from the source', () => {
  // The load-bearing claim of the project: independent reimplementation reproducing hashes byte-for-byte.
  expect(INDEPENDENCE_LINE).toContain('not its source')
  expect(INDEPENDENCE_LINE).toContain('byte-for-byte')
})

// ── The thesis verdict WITHHOLDS on a failed identity join / absent hashes — fail-safe, never green ──
test('thesisVerdictFor WITHHOLDS (null) when the verdict is unknown — no glyph, no false green', () => {
  // null in ⟹ null out: App passes null when loadedRunId !== runId (the resident hashes belong to a prior
  // run) or hashes are absent. The card renders NO verdict glyph/subline then — a blank beats a lie.
  expect(thesisVerdictFor(null)).toBeNull()
})
test('thesisVerdictFor routes a concrete verdict to the three-voice grammar (✓ / ○ self / ✗)', () => {
  expect(thesisVerdictFor('manifest-verified')).toEqual(thesisVerdict('manifest-verified'))
  expect(thesisVerdictFor('manifest-verified')).toMatchObject({ glyph: '✓', cls: 'verified' })
  expect(thesisVerdictFor('self-consistent')).toMatchObject({ glyph: '○', cls: 'self' })
  expect(thesisVerdictFor('mismatch')).toEqual(thesisVerdict('mismatch'))
  expect(thesisVerdictFor('mismatch')).toMatchObject({ glyph: '✗', cls: 'mismatch' })
})

// ── The cold-open card collapses to a header chip once the auto-tour leaves beat 0 ──────
test('tourPastFirstBeat: the full card holds through beat 0 (establishing shot), collapses at beat 1', () => {
  // Beat 0 (the cold-open share moment, authored beside the establishing shot) keeps the FULL card up.
  expect(tourPastFirstBeat(true, 0)).toBe(false)
  // The first playback beat (stepIndex 1+) is the collapse signal — the card no longer hogs the tour.
  expect(tourPastFirstBeat(true, 1)).toBe(true)
  expect(tourPastFirstBeat(true, 2)).toBe(true)
})
test('tourPastFirstBeat: no collapse signal unless THIS run’s tour is the active one', () => {
  // A tour that is not active-for-this-run (or none active) never triggers the collapse — the caller passes
  // `tour.active?.runId === runId`, so a stale prior-run tour rendering for one commit can’t collapse the card.
  expect(tourPastFirstBeat(false, 1)).toBe(false)
  expect(tourPastFirstBeat(false, 3)).toBe(false)
})
