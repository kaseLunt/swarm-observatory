import type { RunModel } from '../model/runModel'
import { verdictAgainstManifest } from '../decode/verify'
import { PROV_GROUPS, provenanceFooter, provenanceRows, type ProvRow } from './provenanceFormat'
import { requireGlyph } from './voices'

// The row glyph is the row's THREADED semantic mark, sourced from the single voices module — NOT re-derived
// off the BadgeState through the badge seam. That seam maps every 'pending' to the ○ self-check, which is right
// for a trailer-reproduced hash row but WRONG for a det-only no-claim row (scenario/seed/registries/…): those
// carry `mark: null` and render NO glyph (an honest no-verdict), so a verdict ring never lands on an
// unadjudicated row. The tr keeps its BadgeState class as the CSS hook (this panel is the most load-bearing
// integrity surface and already wears the canonical attested token, `--pending`); every mark's hue matches
// its BadgeState, and a null-mark row's glyph cell is simply empty.

export function ProvenancePanel({ model, open = false }: { model: RunModel; open?: boolean }) {
  const m = model.manifest
  const verify = model.verify
  // The row set + footer are pure (provenanceFormat.ts — unit-tested there without a render). Rows badge every
  // manifest pin from comparableManifestPins (SINGLE-SOURCED against the seal fold, incl. the count rows); the
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
                // data-prov-key: the CEREMONY HANDOFF targets the two hash rows the load screen
                // ticked (event_hash / result_id) for the settle-in animation — the confirmed lines settling
                // into their rows. Inert (a plain data attribute) for every other consumer.
                <tr key={r.k} data-prov-key={r.k} className={r.b}>
                  <td className="prov-glyph">{r.mark === null ? '' : requireGlyph(r.mark)}</td>
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
