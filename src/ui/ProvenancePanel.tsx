import type { RunModel } from '../model/runModel'
import { type BadgeState } from './badges'
import { verdictAgainstManifest } from '../decode/verify'
import { PROV_GROUPS, provenanceFooter, provenanceRows, type ProvRow } from './provenanceFormat'

// ○ (self-check ring) replaces the bare ⋯ for pending: a recomputed-but-unsealed voice, not "loading".
// • (v0.5d bench R2, two-voice discipline) is the ATTESTED mark: a manifest claim on record but not
// recomputed — filled (a claim exists) where pending's ring is open (nothing to seal against), and
// pointedly NOT the ✓, which is reserved for recomputed-and-matched rows only.
const GLYPH: Record<BadgeState, string> = { pending: '○', verified: '✓', mismatch: '✗', attested: '•' }

export function ProvenancePanel({ model, open = false }: { model: RunModel; open?: boolean }) {
  const m = model.manifest
  const verify = model.verify
  // The row set + footer are pure (provenanceFormat.ts — unit-tested there without a render). Rows badge every
  // manifest pin from comparableManifestPins (SINGLE-SOURCED against the seal fold, incl. the F4 count rows); the
  // footer voice comes from the aggregate verdict, so a manifest that lies only about a count reds ITS row AND
  // refuses in the footer, never green-beside-red.
  const rows: ProvRow[] = provenanceRows(m, verify)
  const footer = provenanceFooter(verify, verdictAgainstManifest(verify, m))
  const byKey = new Map(rows.map(r => [r.k, r]))
  return (
    <aside className={open ? 'provenance open' : 'provenance'}>
      <h2>provenance</h2>
      <div className="prov-groups">
        {PROV_GROUPS.map(g => (
          <div className="prov-group" key={g.label}>
            <p className="prov-group-label">{g.label}</p>
            <table><tbody>
              {g.keys.map(k => byKey.get(k)).filter((r): r is ProvRow => !!r).map(r => (
                // data-prov-key: the CEREMONY HANDOFF (T6, R6) targets the two hash rows the load screen
                // ticked (event_hash / result_id) for the settle-in animation — the confirmed lines settling
                // into their rows. Inert (a plain data attribute) for every other consumer.
                <tr key={r.k} data-prov-key={r.k} className={r.b}>
                  <td className="prov-glyph">{GLYPH[r.b]}</td>
                  <td>{r.k}</td>
                  <td title={r.title ?? r.val} className={r.cls ? `prov-val ${r.cls}` : 'prov-val'}>
                    {r.val}
                    {r.note && <span className="prov-note">{r.note}</span>}
                  </td>
                </tr>
              ))}
            </tbody></table>
          </div>
        ))}
      </div>
      <p className="counts prov-footer">{footer}</p>
    </aside>
  )
}
