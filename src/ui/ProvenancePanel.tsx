import type { RunModel } from '../model/runModel'
import { verdictAgainstManifest } from '../decode/verify'
import { PROV_GROUPS, provenanceFooter, provenanceRows, type ProvRow } from './provenanceFormat'
import { qualityPresentation, requireGlyph } from './voices'

// The row glyph is the row's THREADED semantic mark, sourced from the single voices module — NOT re-derived
// off the BadgeState through the badge seam. That seam maps every 'pending' to the ○ self-check, which is right
// for a trailer-reproduced hash row but WRONG for a det-only no-claim row (scenario/seed/registries/…): those
// carry `mark: null` and render NO glyph (an honest no-verdict), so a verdict ring never lands on an
// unadjudicated row. A plain row keeps its BadgeState class as the CSS hook (this panel is the most load-bearing
// integrity surface and already wears the canonical attested token, `--pending`); its mark's hue matches its
// BadgeState, and a null-mark row's glyph cell is simply empty.
//
// A QUALITY-REGISTER row (r.caveat set) is the ONE exception: its WHOLE rendered voice — the glyph char, the
// row CLASS the CSS paints the glyph's hue through, and the note treatment — comes from the ONE register
// presentation (qualityPresentation), NEVER the badge seam. So glyph and hue can never split (a change to
// QUALITY_MARK moves both together), and the caveat's slate • can never become a badge-class ✗ painted wrong.

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
              {g.keys.map(k => byKey.get(k)).filter((r): r is ProvRow => !!r).map(r => {
                // A caveat row's WHOLE rendered voice comes from the ONE register presentation: the glyph char,
                // the row CLASS (which the CSS paints the glyph's hue through), and the note treatment — so glyph
                // and hue can never split. A plain row keeps the badge-derived class + its threaded mark; the
                // badge-class path deliberately does NOT apply to a caveat row.
                const q = r.caveat ? qualityPresentation(r.caveat) : undefined
                const rowClass = q ? q.cls : r.b
                const glyph = q ? requireGlyph(q.mark) : r.mark === null ? '' : requireGlyph(r.mark)
                const noteCls = q ? q.treatment : undefined
                return (
                  // data-prov-key: the CEREMONY HANDOFF targets the two hash rows the load screen
                  // ticked (event_hash / result_id) for the settle-in animation — the confirmed lines settling
                  // into their rows. Inert (a plain data attribute) for every other consumer.
                  <tr key={r.k} data-prov-key={r.k} className={rowClass}>
                    <td className="prov-glyph">{glyph}</td>
                    <td>{r.k}</td>
                    <td title={r.title ?? r.val} className={r.cls ? `prov-val ${r.cls}` : 'prov-val'}>
                      {r.val}
                      {r.note && <span className={noteCls ? `prov-note ${noteCls}` : 'prov-note'}>{r.note}</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody></table>
          </div>
        ))}
      </div>
      <p className="counts prov-footer">{footer}</p>
    </aside>
  )
}
