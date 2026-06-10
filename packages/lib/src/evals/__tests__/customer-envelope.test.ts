// packages/lib/src/evals/__tests__/customer-envelope.test.ts

import { describe, expect, it } from 'vitest'
import { buildSimulationTriggerContext } from '../simulation/customer-envelope'

describe('buildSimulationTriggerContext', () => {
  it('builds a customer_message trigger context with the frozen clock', () => {
    const ctx = buildSimulationTriggerContext({
      channel: 'email',
      nowMs: Date.parse('2026-06-09T10:00:00.000Z'),
    })
    expect(ctx.kind).toBe('customer_message')
    expect(ctx.instructions).toBeNull()
    expect(ctx.payload).toEqual({
      channel: 'email',
      firedAt: '2026-06-09T10:00:00.000Z',
      simulated: true,
    })
  })

  it('falls back to the wall clock when no frozen time is configured', () => {
    const before = Date.now()
    const ctx = buildSimulationTriggerContext({ channel: 'chat' })
    const fired = Date.parse(ctx.payload.firedAt as string)
    expect(fired).toBeGreaterThanOrEqual(before)
    expect(fired).toBeLessThanOrEqual(Date.now())
  })
})
