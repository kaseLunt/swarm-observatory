import { expect, test } from 'vitest'
import { entityPosition, lerp3 } from './placement'
import type { EntityV2 } from '../decode/payloads'

const ent = (pos: number[]): EntityV2 => ({ value: 0n, alive: true, pos, vel: [], headingRad: 0, speedMps: 0, turnRateRadps: 0, fuel: 0, setpoint: [] })

test('NED pos maps to three.js x=E, y=up(-D), z=N', () => {
  const out: [number, number, number] = [0, 0, 0]
  entityPosition(out, ent([100, 200, -50]), 0) // N=100 E=200 D=-50
  expect(out).toEqual([200, 50, 100])
})
test('empty pos falls back to deterministic grid by index', () => {
  const out: [number, number, number] = [0, 0, 0]
  entityPosition(out, ent([]), 3)
  expect(out).toEqual([6, 0, 0])
})
test('lerp3', () => {
  const out: [number, number, number] = [0, 0, 0]
  lerp3(out, [0, 0, 0], [10, 20, 30], 0.5)
  expect(out).toEqual([5, 10, 15])
})
