// Video-editor transport grammar. Pure mapping (code, key, isEditable) → intent; the App owns the
// single window keydown listener and dispatches these against the store.
export { SPEEDS, isLadderSpeed, shareSpeed } from '../state/speeds'
import { SPEEDS } from '../state/speeds'

export type KeyAction =
  | { type: 'toggle' } | { type: 'step'; delta: 1 | -1 }
  | { type: 'speed'; value: number } | { type: 'speedNotch'; dir: 1 | -1 }
  | { type: 'deselect' } | { type: 'help' } | { type: 'focus' } | { type: 'pov' }

// hasModifier = ctrl/meta/alt held. Those keys belong to the browser/OS (Ctrl+F find, Meta+2 tab
// switch, Alt shortcuts) — a chord must map to NOTHING so we never preventDefault a real shortcut.
// Shift is deliberately NOT a modifier here: Shift+Slash is how '?' arrives.
export function mapKey(code: string, key: string, isEditable: boolean, hasModifier = false): KeyAction | null {
  if (isEditable || hasModifier) return null
  switch (code) {
    case 'Space': case 'KeyK': return { type: 'toggle' }
    case 'ArrowRight': return { type: 'step', delta: 1 }
    case 'ArrowLeft': return { type: 'step', delta: -1 }
    case 'KeyJ': return { type: 'speedNotch', dir: -1 }
    case 'KeyL': return { type: 'speedNotch', dir: 1 }
    case 'Escape': return { type: 'deselect' }
    case 'KeyF': return { type: 'focus' }
    // Observer's Eye POV (v0.6): stand at the e0 query stage's drawn observer. A CAMERA gesture, the
    // sibling of 'focus' (KeyF) — not transport — so it extends the frozen transport grammar without touching
    // it; a no-op on runs with no observer (f0/f1), like focus is a no-op with no selection.
    case 'KeyO': return { type: 'pov' }
  }
  if (key === '?') return { type: 'help' }
  const d = /^Digit([1-4])$/.exec(code)
  if (d) return { type: 'speed', value: SPEEDS[Number(d[1]) - 1]! }
  return null
}
