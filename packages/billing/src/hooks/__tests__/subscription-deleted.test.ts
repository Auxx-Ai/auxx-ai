// packages/billing/src/hooks/__tests__/subscription-deleted.test.ts

import type { Database } from '@auxx/database'
import type Stripe from 'stripe'
import { describe, expect, it, vi } from 'vitest'
import { handleSubscriptionDeleted } from '../subscription-deleted'

vi.mock('@auxx/database', () => ({
  schema: {
    PlanSubscription: { id: 'id' },
  },
  eq: vi.fn(),
}))

function createMockDb(subscription?: Record<string, any>) {
  const setMock = vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  })
  const updateMock = vi.fn(() => ({ set: setMock }))

  return {
    db: {
      query: {
        PlanSubscription: {
          findFirst: vi.fn().mockResolvedValue(subscription ?? null),
        },
      },
      update: updateMock,
    } as unknown as Database,
    setMock,
    updateMock,
  }
}

describe('handleSubscriptionDeleted', () => {
  it('marks subscription as canceled when found', async () => {
    const { db, setMock } = createMockDb({
      id: 'sub_local',
      status: 'active',
      stripeSubscriptionId: 'sub_stripe_1',
    })

    const event = {
      type: 'customer.subscription.deleted',
      data: {
        object: { id: 'sub_stripe_1' },
      },
    } as unknown as Stripe.Event

    await handleSubscriptionDeleted(db, event)

    expect(setMock).toHaveBeenCalledTimes(1)
    const payload = setMock.mock.calls[0][0]
    expect(payload.status).toBe('canceled')
    expect(payload.canceledAt).toBeInstanceOf(Date)
    expect(payload.updatedAt).toBeInstanceOf(Date)
  })

  it('returns early with warning when subscription not found', async () => {
    const { db, setMock } = createMockDb(undefined)

    const event = {
      type: 'customer.subscription.deleted',
      data: {
        object: { id: 'sub_nonexistent' },
      },
    } as unknown as Stripe.Event

    await handleSubscriptionDeleted(db, event)

    expect(setMock).not.toHaveBeenCalled()
  })
})
