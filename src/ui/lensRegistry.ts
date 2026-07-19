// ── THE LENS REGISTRY — the mechanism that holds registrations and answers ask-any-pixel ──
// lensContract.ts is the TYPES + the fail-loud per-lens validation (a leaf, zero runtime imports). This is
// the MECHANISM the standing rule exists to produce: the one place that holds every lens's LAW-4
// declaration, lets surfaces QUERY it (the honesty-chip line, the ask-any-pixel authority of a class), and
// re-validates every citizen at module load — fail-loud, so a lens that ships a false or duplicate claim
// crashes the app at boot rather than lying in an interaction. The registry's reason to exist is
// ask-any-pixel: hover anything → its data authority. That answer is now a LOOKUP through this module, not a
// retrofit against a comment.
//
// LEAF DISCIPLINE (where possible): the CONTRACT stays the pure leaf. This module cannot be a leaf — it must
// reference the two registration VALUES — but it is the ONE aggregation point, by EXPLICIT import (no
// side-effecting self-registration: order-independent, greppable, tree-shake-honest). The two citizens
// self-validate at their own module load (validateRegistration in queryStage.ts / sensingStage.ts); this
// re-validates on aggregation (idempotent — a citizen that somehow bypassed its own gate still cannot enter)
// and adds the CROSS-citizen invariants a single registration cannot see: no duplicate lens id, and no
// duplicate pixel-class id WITHIN a lens (the ask-any-pixel key must be unambiguous).
import {
  validateRegistration, voiceFor,
  type LensRegistration, type PixelClass, type Voice,
} from './lensContract'
import { E0_REGISTRATION } from './queryStage'
import { F2A_REGISTRATION } from './sensingStage'
import { F4_COMMS_REGISTRATION } from './commsStage'
import { F3A_TRACK_REGISTRATION } from './trackBelief'
import { VOICE_MARK, VOICE_GLYPHS, markGlyph, noVerdictHuesAreDim } from './voices'
import { SHOWMATH_AGREE_CAPABILITY } from './showMath'
import { SENSING_AGREE_CAPABILITY } from './sensingMath'
import { COMMS_AGREE_CAPABILITY } from './commsMath'
import type { AgreeCapability } from './agreeSource'

function fail(msg: string): never { throw new Error(`lensRegistry: ${msg}`) }

// SINGLE-VOICE-SOURCE GUARD (v0.8). Every voice a lens can render must resolve to a glyph the ONE
// voices module sanctions — a lens (or a drifted mapping) that mints a glyph outside the seven-mark alphabet
// is a false-authority claim, so refuse loud at boot rather than paint an un-owned mark in an interaction.
// This is DRIVEN BY the exhaustive Voice→mark map (voices.VOICE_MARK, `satisfies Record<Voice, MarkKey|null>`),
// which retires the hand-maintained RESOLVABLE_VOICES array whose three holes this finding named: (a) it never
// visited a hardcoded literal, (b) it passed a semantically-WRONG-but-sanctioned glyph (membership ≠ meaning),
// and (c) a Voice omitted from the array escaped the sweep entirely.
//   WHAT THE LAYERS PROVE — stated honestly:
//   • compile time (`satisfies`): EXHAUSTIVENESS — a new Voice with no VOICE_MARK entry fails tsc;
//   • this boot assertion: every DECLARED mapping resolves to a real, glyph-BEARING, sanctioned mark, and the
//     two-family law holds (no no-verdict mark borrows a verdict hue) — the SAME map voiceGlyph renders through;
//   • the app.css orphan-sweep test (voicesMigration.test.ts): no orphan voice CLASS survives in the stylesheet;
//   • the source glyph-literal sweep (voicesMigration.test.ts): no NEW component hardcodes a verdict glyph as
//     UI output outside voices.ts — the one hole boot-time CANNOT close (an un-registered literal), reduced from
//     unbounded authorship discipline to a greppable invariant with a sanctioned-exceptions list.
function assertVoiceAlphabetSingleSourced(): void {
  if (!noVerdictHuesAreDim()) fail('the two-family law is violated — a no-verdict mark carries a verdict hue')
  for (const [voice, mark] of Object.entries(VOICE_MARK)) {
    if (mark === null) continue // a wordless voice (live-check/declared-constant/derivation/presentational) — no glyph by law
    const g = markGlyph(mark)
    if (g === null) fail(`voice '${voice}' maps to mark '${mark}', which carries no DOM glyph — a rendered voice must resolve to a glyph-bearing mark`)
    if (!VOICE_GLYPHS.has(g)) fail(`voice '${voice}' resolves to glyph '${g}', which is outside the voices module — every rendered mark is single-sourced`)
  }
}

// ── THE WITNESS BOOT GUARD: declared arms resolved against the executor's capability ────
// A recomputed class WITNESSES its agreement with an AgreeSource (lensContract enforces its presence); this
// resolves the arm's declared TOKENS against the ACTUAL capability of the executor whose live legs mint its
// AgreementResult — an unknown / unbacked token fails LOUD at boot, the voice-guard idiom at the witness
// tier. The lens→executor map is here (the aggregation point that imports both executors' capabilities); a
// lens that paints recomputed classes but names no executor cannot be vouched, so that too is a boot failure.
const EXECUTOR_CAPABILITY: Readonly<Record<string, AgreeCapability>> = {
  'e0-query': SHOWMATH_AGREE_CAPABILITY,
  'f2a-sensing': SENSING_AGREE_CAPABILITY,
  'f4-comms': COMMS_AGREE_CAPABILITY,
}

// Two token collections name the SAME set (order-independent, duplicate-safe) — the equality the per-form
// witness guard demands: a declared arm's inputs must be EXACTLY its form's required tuple, so extra, missing,
// AND swapped inputs all fail (Set membership alone would have let a superset or a wrong pairing through).
function sameTokenSet(a: readonly string[], b: readonly string[]): boolean {
  const sa = new Set(a), sb = new Set(b)
  if (sa.size !== sb.size) return false
  for (const t of sa) if (!sb.has(t)) return false
  return true
}

// Resolve every recomputed class's AgreeSource against its executor capability. Pure + fail-loud: the registry
// runs it per citizen at module load; a test drives it in isolation on a hand-built pair. A live-inputs arm's
// FORM must be one the executor backs, AND its declared inputs must set-EQUAL that form's required tuple (the
// per-form check that closes the Cartesian hole: independent input/form membership let inputs pair with any
// backed form). A decoded-consistency arm's decoded token must be backed.
export function assertAgreeSourcesBacked(reg: LensRegistration, cap: AgreeCapability | undefined): void {
  const recomputed = reg.provenance.filter(p => p.tier === 'recomputed')
  if (recomputed.length === 0) return
  if (!cap) fail(`${reg.id} paints recomputed classes but names no executor capability — the witness boot guard cannot vouch its agreement`)
  const decoded = new Set<string>(cap.decoded)
  for (const p of recomputed) {
    const a = p.agree
    if (a === undefined) fail(`${reg.id}: recomputed class '${p.id}' declares no AgreeSource — validateRegistration must run before the witness boot guard`)
    if (a.basis === 'live-inputs') {
      const required = cap.forms[a.form]
      if (!required) fail(`${reg.id}: class '${p.id}' names form '${a.form}', which its executor does not back`)
      if (!sameTokenSet(a.inputs, required)) fail(`${reg.id}: class '${p.id}' declares inputs [${[...a.inputs].join(', ')}] for form '${a.form}', but that form's live leg consumes exactly [${[...required].join(', ')}] — extra, missing, or swapped inputs cannot witness this form's re-derivation`)
    } else if (!decoded.has(a.decoded)) {
      fail(`${reg.id}: class '${p.id}' names decoded-consistency token '${a.decoded}', which its executor does not back`)
    }
  }
}

// The live citizens — the registry is extracted FROM them, per the plan. A lens joins by adding its
// registration here (and nowhere else): the load-time gate below then holds it to the same contract as the
// others. e0 first (the front door), f2a second, f4 comms third (the contested link), f3a track belief fourth
// (the shrinking disc) — matching the wave ladder order (W5 comms before W6 belief). f3a-track paints NO recomputed
// class, so assertAgreeSourcesBacked returns early for it (no executor capability needed — it derives, never adjudicates).
const CITIZENS: readonly LensRegistration[] = [E0_REGISTRATION, F2A_REGISTRATION, F4_COMMS_REGISTRATION, F3A_TRACK_REGISTRATION]

// Build the by-id index at module load, enforcing the cross-citizen invariants FAIL-LOUD (the queryStage
// precedent, at the registry tier). A duplicate lens id or a duplicate pixel-class id within a lens is not a
// degraded registry to file best-effort — it is an ambiguous ask-any-pixel key, so refuse loud at publish.
const REGISTRY: ReadonlyMap<string, LensRegistration> = (() => {
  assertVoiceAlphabetSingleSourced() // fail-loud: the rendered voice alphabet is the ONE voices module's
  const byId = new Map<string, LensRegistration>()
  for (const reg of CITIZENS) {
    validateRegistration(reg) // idempotent re-check — the per-lens contract, enforced again on aggregation
    assertAgreeSourcesBacked(reg, EXECUTOR_CAPABILITY[reg.id]) // every recomputed witness resolves against its executor
    if (byId.has(reg.id)) fail(`duplicate lens id '${reg.id}' — every registered lens owns a unique id`)
    const classIds = new Set<string>()
    for (const p of reg.provenance) {
      if (classIds.has(p.id)) fail(`${reg.id}: duplicate pixel-class id '${p.id}' — the ask-any-pixel key must be unambiguous within a lens`)
      classIds.add(p.id)
    }
    byId.set(reg.id, reg)
  }
  return byId
})()

// The registered lenses, in ladder order (e0, f2a). Read-only; a surface iterating them (a future ask-any-
// pixel index, a provenance audit) sees exactly the citizens, never a mutable registry.
export const LENSES: readonly LensRegistration[] = CITIZENS

// Look up a lens's whole registration by id — undefined for an unregistered id (the honest "no such lens").
export function lensById(id: string): LensRegistration | undefined {
  return REGISTRY.get(id)
}

// The honesty-chip line a surface renders for a lens (the chip is the registration's projection — ONE source
// of honesty; App's scene chips read it HERE instead of importing each lens's const, so the honesty text and
// the ledger it must agree with can never drift apart). Fail-loud on an unknown id: a chip asking for a lens
// that does not exist is a wiring bug, not a blank to paint.
export function honestyChipFor(id: string): string {
  const reg = REGISTRY.get(id)
  if (!reg) fail(`honestyChipFor('${id}') — no such registered lens`)
  return reg.honestyChip
}

// ASK-ANY-PIXEL — the lookup the registry exists for: given a lens + a pixel-class id, return that class's
// authority (its tier, its contract/ anchor, and the one-sentence CLASS answer). The consuming surface
// appends instance facts (seq, tick, values) from its own readout machinery; the ledger carries the class
// sentence, never a templating engine. undefined when the lens or the class is unknown (the honest miss).
export function askPixel(lensId: string, classId: string): PixelClass | undefined {
  return REGISTRY.get(lensId)?.provenance.find(p => p.id === classId)
}

// The rendered VOICE for a pixel-class, given this session's seal state — ask-any-pixel's authority resolved
// through the contract's ONE tier→voice map (voiceFor). A `decoded` class inherits the run's session seal
// (sealed vs unsealed); every other tier is seal-independent. undefined when the class is unknown. This is
// the seam a hover surface would consume; no such UI is wired here (the mechanism, not a new surface).
export function pixelVoice(lensId: string, classId: string, sealedThisSession: boolean): Voice | undefined {
  const p = askPixel(lensId, classId)
  if (!p) return undefined
  // A QUALITY-caveat class wears the quality register — the • attested mark, NEVER the decoded seal's ✓/○.
  // This is what makes the registry's ask-any-pixel authority AGREE with the render (CommsStrip resolves the
  // SAME caveat through qualityPresentation), closing the split-source class: a plain `decoded` drop-anchor
  // resolved the sealed ✓ path here while the strip painted •; the caveat declaration gives it ONE voice.
  if (p.caveat !== undefined) return 'attested'
  return voiceFor(p.tier, sealedThisSession)
}
