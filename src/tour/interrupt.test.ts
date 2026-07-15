import { afterEach, describe, expect, test, vi } from 'vitest'
import { registerTourInterrupt, unregisterTourInterrupt, notifyUserInput } from './interrupt'

// The interrupt channel holds a single module-level handler, so it persists across tests in this file —
// reset it after each so ordering can't leak a registration into the next test.
afterEach(() => unregisterTourInterrupt())

describe('tour interrupt channel — source-signaled user input', () => {
  test('register → notify fires the handler', () => {
    const fn = vi.fn()
    registerTourInterrupt(fn)
    notifyUserInput()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  test('unregister → notify is a no-op (handler dropped)', () => {
    const fn = vi.fn()
    registerTourInterrupt(fn)
    unregisterTourInterrupt()
    notifyUserInput()
    expect(fn).not.toHaveBeenCalled()
  })

  test('notify with nothing registered → no throw (no-op when no tour is active)', () => {
    expect(() => notifyUserInput()).not.toThrow()
  })

  test('register replaces the prior handler (restart-safe: last registration wins)', () => {
    const first = vi.fn()
    const second = vi.fn()
    registerTourInterrupt(first)
    registerTourInterrupt(second)
    notifyUserInput()
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})
