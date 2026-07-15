export interface LinkState { run: string; tick: number; sel: string | null; ev: number | null; speed: number }

export function encodeLink(s: LinkState): string {
  const p = new URLSearchParams()
  p.set('run', s.run)
  if (s.tick > 0) p.set('tick', String(s.tick))
  if (s.sel) p.set('sel', s.sel)
  if (s.ev !== null) p.set('ev', String(s.ev))
  if (s.speed !== 1) p.set('speed', String(s.speed))
  return p.toString()
}

// The copy-link share weapon (v0.6 T6, P2): build the FULL shareable URL for the current view from the
// encoded query grammar. encodeLink always emits at least `run=…`, so the '?' is never dangling. The
// LinkState carries ONLY run/tick/sel/ev/speed — verification state NEVER rides the URL (the NEVER-list),
// so a shared link reproduces the VIEW, never a trust claim (the recipient's own browser re-verifies).
export function buildShareUrl(origin: string, pathname: string, s: LinkState): string {
  return `${origin}${pathname}?${encodeLink(s)}`
}

export function parseLink(qs: string): Partial<LinkState> {
  const p = new URLSearchParams(qs)
  const out: Partial<LinkState> = {}
  const run = p.get('run'); if (run) out.run = run
  // tick/ev index discrete arrays — floor to an integer after the finite/non-negative gate so a
  // fractional deep link (?tick=1.9) can never seat a non-integer seq/tick in the store. speed is a
  // continuous value clamped separately downstream, so it is not routed through num().
  const num = (k: string) => { const v = Number(p.get(k)); return Number.isFinite(v) && v >= 0 ? Math.floor(v) : null }
  const tick = p.get('tick') !== null ? num('tick') : null; if (tick !== null) out.tick = tick
  const ev = p.get('ev') !== null ? num('ev') : null; if (ev !== null) out.ev = ev
  // speed is continuous (0.25×, …) — parse it directly, NOT through num() (which now floors), so a
  // fractional speed survives; the store clamps it to the nearest ladder member on apply.
  const speedRaw = p.get('speed'); if (speedRaw !== null) { const sv = Number(speedRaw); if (Number.isFinite(sv) && sv > 0) out.speed = sv }
  const sel = p.get('sel'); if (sel) out.sel = sel
  return out
}
