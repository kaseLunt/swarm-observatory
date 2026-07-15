// ── THE LENS REGISTRY — the mechanism that holds registrations and answers ask-any-pixel (Task v07-6) ──
// lensContract.ts is the TYPES + the fail-loud per-lens validation (a leaf, zero runtime imports). This is
// the MECHANISM the standing rule (U11/S5) exists to produce: the one place that holds every lens's LAW-4
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

function fail(msg: string): never { throw new Error(`lensRegistry: ${msg}`) }

// The two live citizens (query stage + sensing gauntlet) — the registry is extracted FROM them, per the plan.
// A third lens joins by adding its registration here (and nowhere else): the load-time gate below then holds
// it to the same contract as these two. e0 first (the front door), f2a second, matching the ladder order.
const CITIZENS: readonly LensRegistration[] = [E0_REGISTRATION, F2A_REGISTRATION]

// Build the by-id index at module load, enforcing the cross-citizen invariants FAIL-LOUD (the queryStage
// precedent, at the registry tier). A duplicate lens id or a duplicate pixel-class id within a lens is not a
// degraded registry to file best-effort — it is an ambiguous ask-any-pixel key, so refuse loud at publish.
const REGISTRY: ReadonlyMap<string, LensRegistration> = (() => {
  const byId = new Map<string, LensRegistration>()
  for (const reg of CITIZENS) {
    validateRegistration(reg) // idempotent re-check — the per-lens contract, enforced again on aggregation
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
  return p ? voiceFor(p.tier, sealedThisSession) : undefined
}
