import type { GateResult } from '../decode/manifest'

// THE MANIFEST-REFUSAL SURFACE. A manifest that fails admission (gateManifest) never reaches the verify fold —
// so no verdict is minted and no session seal is earned; this screen is all the viewer sees. The headline states
// the RIGHT reason: a schema/registry mismatch is a dialect refusal (the default headline), while an incomplete
// run (run_complete=false, spec-3a §4.5: published requires run_complete:true) carries its own not-published
// headline. Extracted from App so the exact rendered refusal — the honest reason a bundle was turned away — is
// unit-testable without mounting the r3f app (App.tsx renders <GateScreen gate={gate} /> in the gate branch).
export function GateScreen({ gate }: { gate: Extract<GateResult, { ok: false }> }) {
  return (
    <div className="screen gate">
      <h1>{gate.headline ?? 'this bundle speaks a newer dialect'}</h1>
      <p><code>{gate.field}</code></p>
      <p>expected <code>{gate.expected}</code></p>
      <p>found <code>{gate.actual}</code></p>
    </div>
  )
}
