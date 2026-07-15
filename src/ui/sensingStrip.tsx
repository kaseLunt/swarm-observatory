import { sensingGates, fovClaim, type GateLine } from './sensingMath'
import { identityPlate, compactPlate, fullPlate } from './identityPlate'
import type { SensingDraw } from './sensingStage'

// ── The four-gate eligibility strip (Task v07-2) — f2a's INSTRUMENT voice (LAW 3) ──────────────────────
// The stage draws the drama (the eligible-tinted flight); this summarises the DECISION: the four gates the
// sensor ran this tick — in_range · in_fov · los_clear · eligible. It is the two-voice provenance grammar
// made a strip: in_range / los_clear / eligible are RECOMPUTED in-browser and wear the live ✓ / ✗; in_fov
// is the CLAIM voice — its threshold is a pinned vendored-libm angle and kind-22 stores no bearing to
// recompute, so it shows the decoded boolean and the pinned form, marked • attested, never a ✓ (the honesty
// this lens is built around). The header names the subject and the apparatus with their identity plates.

// The provenance mark a gate wears: recompute → live ✓/✗ (agreement); claim → • attested, never a ✓.
function gateMark(g: GateLine): { glyph: string; cls: string; title: string } {
  if (g.voice === 'claim') return { glyph: '•', cls: 'v-claim', title: g.note ?? 'claim voice — not recomputed here' }
  if (g.agree === null) return { glyph: '·', cls: 'v-claim', title: 'no decoded pose this tick — geometry recompute withheld' }
  return g.agree
    ? { glyph: '✓', cls: 'v-ok', title: 'recomputed in-browser and matched the engine' }
    : { glyph: '✗', cls: 'v-bad', title: 'recomputed in-browser and DISAGREED with the engine' }
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
          const m = gateMark(g)
          return (
            <tr key={g.id}>
              <td className="gate-label">{g.label}</td>
              <td className={g.decoded ? 'flag-true' : 'flag-false'}>{String(g.decoded)}</td>
              <td className={`gate-mark ${m.cls}`} title={m.title}>{m.glyph}</td>
              <td className="gate-form" title={g.note}>
                {g.form}{g.id === 'in_fov' ? ` · half_fov ≈ ${fov.deg.toFixed(2)}°` : ''}
              </td>
            </tr>
          )
        })}
      </tbody></table>
      {draw.tiebreak && <p className="gate-tiebreak">tiebreak — the engine flagged a boundary decision this tick</p>}
      <p className="gate-note">
        in range · los clear recomputed live; eligible is the live conjunction of those two legs with the
        decoded <span className="v-claim">in fov</span> claim (•) — a pinned vendored-libm angle, no bearing in
        the bundle to recompute
      </p>
    </section>
  )
}
