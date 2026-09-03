// packages/lib/src/records/name-case/__tests__/hook.test.ts

import { describe, expect, it } from 'vitest'
import type { FieldPreHookEvent } from '../../../field-hooks/types'
import { repairNameCasing } from '../hook'

/** Only the fields `repairNameCasing` reads; the rest of the event is irrelevant here. */
function event(newValue: FieldPreHookEvent['newValue']): FieldPreHookEvent {
  return { newValue } as FieldPreHookEvent
}

describe('repairNameCasing', () => {
  it('repairs the value inside the typed envelope', async () => {
    const result = await repairNameCasing(event({ type: 'text', value: 'BRUCE' }))
    expect(result).toEqual({ type: 'text', value: 'Bruce' })
  })

  // 🛑 The trap this hook exists downstream of: `newValue` is the COERCED envelope,
  // never the bare string the caller typed. A version of this hook that read
  // `event.newValue` as a string would be inert in production and still pass a test
  // that fed it one — which is exactly how three earlier guards shipped broken.
  it('reads the envelope, not a bare string', async () => {
    const result = await repairNameCasing(event({ type: 'text', value: 'MACIVER' }))
    expect(result).toEqual({ type: 'text', value: 'MacIver' })
    // A bare string is not a shape this hook can act on, and it must not throw.
    const bare = 'MACIVER' as unknown as FieldPreHookEvent['newValue']
    expect(await repairNameCasing(event(bare))).toBe(bare)
  })

  it('returns the ORIGINAL envelope object when nothing changes', async () => {
    // Identity, not equality — the caller compares to decide whether a write happened.
    const value = { type: 'text', value: 'MacIver' } as const
    expect(await repairNameCasing(event(value))).toBe(value)
  })

  it('passes a null clear straight through', async () => {
    expect(await repairNameCasing(event(null))).toBeNull()
  })

  it('leaves a multi-value array untouched', async () => {
    // Neither name field is multi. If one ever arrives, doing nothing beats guessing
    // which element is the name.
    const value = [
      { type: 'text', value: 'BRUCE' },
      { type: 'text', value: 'ROBERT' },
    ] as FieldPreHookEvent['newValue']
    expect(await repairNameCasing(event(value))).toBe(value)
  })

  it('leaves a non-text envelope untouched', async () => {
    const value = { type: 'option', optionId: 'opt_1' } as unknown as FieldPreHookEvent['newValue']
    expect(await repairNameCasing(event(value))).toBe(value)
  })

  it('declines mixed case, uncased script and email addresses', async () => {
    for (const raw of ['MacIver', '李', 'mikedavidson@live.com']) {
      const value = { type: 'text', value: raw } as const
      expect(await repairNameCasing(event(value))).toBe(value)
    }
  })
})
