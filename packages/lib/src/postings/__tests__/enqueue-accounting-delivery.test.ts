// packages/lib/src/postings/__tests__/enqueue-accounting-delivery.test.ts
//
// 🛑 REGRESSION COVER. Moving the QuickBooks export off the request path was
// meant to REMOVE a way for an acceptance to sit for minutes. The first cut
// added a new one instead: `add()` talks to Redis, ioredis retries a refused
// connection forever rather than failing, and the acceptance awaited it
// unbounded. With Redis down, eight integration tests hung to their 30s
// timeout - every one of them a test that successfully accepted a journal.
//
// The guarantee under test is the one the whole design rests on: the queue is
// an optimisation on WHEN a journal is exported, never the only path, so a sick
// queue must cost the caller a bounded pause and nothing more.
// `sweepAccountingDeliveries` picks up whatever the queue missed.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ add: vi.fn() }))
vi.mock('../../jobs/queues', () => ({
  Queues: { accountingDeliveryQueue: 'accounting-delivery' },
  getQueue: () => ({ add: h.add }),
}))

import { enqueueAccountingDelivery } from '../delivery'

const input = { organizationId: 'org', glPostingId: 'journal' }

beforeEach(() => vi.clearAllMocks())

describe('enqueueAccountingDelivery', () => {
  it('returns promptly when the queue never answers', async () => {
    h.add.mockImplementation(() => new Promise(() => {}))
    const started = Date.now()
    await expect(enqueueAccountingDelivery(input)).resolves.toBeUndefined()
    // Bounded by ENQUEUE_TIMEOUT_MS (2s), not by the queue.
    expect(Date.now() - started).toBeLessThan(5_000)
  }, 10_000)

  it('does not throw when the queue rejects', async () => {
    h.add.mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(enqueueAccountingDelivery(input)).resolves.toBeUndefined()
  })

  it('keys the job on the posting so a retried acceptance cannot double-send', async () => {
    h.add.mockResolvedValue({ id: '1' })
    await enqueueAccountingDelivery(input)
    expect(h.add).toHaveBeenCalledWith(
      'accounting-delivery',
      input,
      expect.objectContaining({ jobId: 'accounting-delivery:org:journal' })
    )
  })
})
