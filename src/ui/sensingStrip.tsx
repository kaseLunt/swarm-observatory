import { sensingGates, fovClaim, type GateLine, type GateId } from './sensingMath'
import { identityPlate, compactPlate, fullPlate } from './identityPlate'
import { F2A_REGISTRATION, type SensingDraw } from './sensingStage'
import { recomputedVerdict } from './lensContract'
import type { AgreeSource } from './agreeSource'
import { markClass, requireGlyph } from './voices'

// ── The four-gate eligibility strip (Task v07-2) — f2a's INSTRUMENT voice (LAW 3) ──────────────────────
// The stage draws the drama (the eligible-tinted flight); this summarises the DECISION: the four gates the
// sensor ran this tick — in_range · in_fov · los_clear · eligible. It is the two-voice provenance grammar
// made a strip: in_range / los_clear / eligible are RECOMPUTED in-browser and wear the live ✓ / ✗; in_fov
// is the CLAIM voice — its threshold is a pinned vendored-libm angle and kind-22 stores no bearing to
// recompute, so it shows the decoded boolean and the pinned form, marked • attested, never a ✓ (the honesty
// this lens is built around). The header names the subject and the apparatus with their identity plates.

// The DECLARED AgreeSource arm for each recompute gate — resolved ONCE from the f2a registration (the
// ask-any-pixel authority), so the mark a gate wears derives from ITS pixel-class's declared witness, not a
// bare boolean re-decided here (W3 F3). Fail-loud at module load if a class or its arm vanished (the registry
// discipline, at the render boundary): a recompute gate with no witness is a wiring bug, not a blank to paint.
const gateArmOf = (classId: string): AgreeSource => {
  const a = F2A_REGISTRATION.provenance.find(p => p.id === classId)?.agree
  if (!a) throw new Error(`sensingStrip: f2a class '${classId}' declares no AgreeSource — its gate mark cannot derive a witness`)
  return a
}
const GATE_ARM: Partial<Record<GateId, AgreeSource>> = {
  in_range: gateArmOf('in-range-recompute'),
  los_clear: gateArmOf('los-clear-recompute'),
  eligible: gateArmOf('eligible-conjunction'),
}

// The provenance mark a gate wears + its basis note, both sourced from the single voices module (no gate-local
// glyph literals) and the gate's DECLARED arm (W3 F3). The old v-ok/v-bad/v-claim classes are retired. A claim
// gate wears the ATTESTED • (a verdict-family mark — the `--pending` slate), never a ✓; a withheld recompute
// (no decoded pose this tick) wears the · WITHHELD state (a no-verdict mark — stays dim). A FORMED recompute
// derives its mark from the arm via recomputedVerdict — ✓ for a live-inputs agreement, ○ for a
// decoded-consistency agreement (the ring, NEVER the check), ✗ on disagreement — and carries the arm's note,
// so the union is WORN at the mark, not demoted to prose. `arm` is guaranteed for a recompute gate (GATE_ARM
// is total over the three); the throw is a fail-loud tripwire, unreachable under the real registration.
export function gateMark(g: GateLine, arm: AgreeSource | undefined): { glyph: string; cls: string; title: string; note: string } {
  if (g.voice === 'claim') return { glyph: requireGlyph('attested'), cls: markClass('attested'), title: g.note ?? 'claim voice — not recomputed here', note: '' }
  if (g.agree === null) return { glyph: requireGlyph('withheld'), cls: markClass('withheld'), title: 'no decoded pose this tick — geometry recompute withheld', note: '' }
  if (arm === undefined) throw new Error(`sensingStrip: recompute gate '${g.id}' has no declared arm — cannot resolve its verdict mark`)
  const rv = recomputedVerdict(arm, g.agree)
  return { glyph: requireGlyph(rv.mark), cls: markClass(rv.mark), title: rv.note, note: rv.note }
}

export function SensingStrip({ draw }: { draw: SensingDraw }) {
  const gates = sensingGates(draw)
  const subject = identityPlate(draw.subject, 'entity')
  const sensor = identityPlate(draw.sensor, 'apparatus')
  const fov = fovClaim()
  return (
    <section className="sensing-strip">
      <h3 title={`${fullPlate(sensor)} · ${fullPlate(subject)}`}>
        what {compactPlate(sensor)} admits about {compactPlate(subject)}
      </h3>
      <table className="gate-strip"><tbody>
        {gates.map(g => {
          const m = gateMark(g, GATE_ARM[g.id])
          return (
            <tr key={g.id}>
              <td className="gate-label">{g.label}</td>
              <td className={g.decoded ? 'flag-true' : 'flag-false'}>{String(g.decoded)}</td>
              <td className={`gate-mark ${m.cls}`} title={m.title}>{m.glyph}</td>
              <td className="gate-form" title={g.note}>
                {g.form}{g.id === 'in_fov' ? ` · half_fov ≈ ${fov.deg.toFixed(2)}°` : ''}
                {/* W3 F3 — the arm's basis note, visible where the mark renders (ev99's note convention): a
                    live-inputs row reads "recomputed from live decoded inputs"; a decoded-consistency row
                    would read "…no external oracle" beside its ○ ring, never a mislabelled ✓. */}
                {m.note && <span className="gate-basis">{m.note}</span>}
              </td>
            </tr>
          )
        })}
      </tbody></table>
      {draw.tiebreak && <p className="gate-tiebreak">tiebreak — the engine flagged a boundary decision this tick</p>}
      <p className="gate-note">
        in range · los clear recomputed live; eligible is the live conjunction of those two legs with the
        decoded <span className={markClass('attested')}>in fov</span> claim (
        <span className={markClass('attested')}>{requireGlyph('attested')}</span>) — a pinned vendored-libm
        angle, no bearing in the bundle to recompute
      </p>
    </section>
  )
}
