import { expect, test } from 'vitest'
import { mapKey, SPEEDS } from './keyboard'

test('grammar', () => {
  expect(mapKey('Space', ' ', false)).toEqual({ type: 'toggle' })
  expect(mapKey('KeyK', 'k', false)).toEqual({ type: 'toggle' })
  expect(mapKey('ArrowRight', 'ArrowRight', false)).toEqual({ type: 'step', delta: 1 })
  expect(mapKey('ArrowLeft', 'ArrowLeft', false)).toEqual({ type: 'step', delta: -1 })
  expect(mapKey('KeyJ', 'j', false)).toEqual({ type: 'speedNotch', dir: -1 })
  expect(mapKey('KeyL', 'l', false)).toEqual({ type: 'speedNotch', dir: 1 })
  expect(mapKey('Digit2', '2', false)).toEqual({ type: 'speed', value: SPEEDS[1] })
  expect(mapKey('Escape', 'Escape', false)).toEqual({ type: 'deselect' })
  expect(mapKey('Slash', '?', false)).toEqual({ type: 'help' })
  expect(mapKey('KeyF', 'f', false)).toEqual({ type: 'focus' })
  expect(mapKey('KeyO', 'o', false)).toEqual({ type: 'pov' }) // Observer's Eye POV (T4b)
})
test('editable targets swallow everything', () => {
  expect(mapKey('Space', ' ', true)).toBeNull()
  expect(mapKey('KeyJ', 'j', true)).toBeNull()
})
test('modifier chords (ctrl/meta/alt) null every mapping via the flag', () => {
  expect(mapKey('KeyF', 'f', false, true)).toBeNull()   // Ctrl+F
  expect(mapKey('Space', ' ', false, true)).toBeNull()  // Ctrl+Space
  expect(mapKey('Digit2', '2', false, true)).toBeNull() // Meta+Digit2
})
test('unmapped keys are null', () => { expect(mapKey('KeyZ', 'z', false)).toBeNull() })
