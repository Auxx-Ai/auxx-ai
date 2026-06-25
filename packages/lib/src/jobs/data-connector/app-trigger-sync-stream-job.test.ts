// packages/lib/src/jobs/data-connector/app-trigger-sync-stream-job.test.ts
// Guards the per-(connector, stream) webhook-steered fetch handler. The worker passes a
// JobContext (whose `.job` is the real BullMQ Job); the handler must read native fields
// (`opts.attempts`, `attemptsMade`) off `ctx.job`, NOT off the context — reading them off
// the context yields `undefined` and the "Cannot read properties of undefined (reading
// 'attempts')" crash that once masked the real fetch error. DB/queue/redis/data-connectors faked.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { runWebhookEventSlice, ConnectorRateLimitError, queueAdd, redis } = vi.hoisted(() => {
  class ConnectorRateLimitError extends Error {
    retryAfterMs?: number
    constructor(retryAfterMs?: number) {
      super('throttled')
      this.name = 'ConnectorRateLimitError'
      this.retryAfterMs = retryAfterMs
    }
  }
  return {
    runWebhookEventSlice: vi.fn(),
    ConnectorRateLimitError,
    queueAdd: vi.fn(),
    redis: { lpush: vi.fn(), ltrim: vi.fn(), expire: vi.fn() },
  }
})

vi.mock('@auxx/database', () => ({ database: {} }))
vi.mock('@auxx/redis', () => ({ getRedisClient: async () => redis }))
vi.mock('../../data-connectors', () => ({ runWebhookEventSlice, ConnectorRateLimitError }))
vi.mock('../queues', () => ({
  getQueue: () => ({ add: (...a: unknown[]) => queueAdd(...a) }),
  Queues: { appTriggerQueue: 'appTriggerQueue' },
}))
vi.mock('../../logger', () => ({
  createScopedLogger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}))

import { runConnectorAppTriggerStream } from './app-trigger-sync-stream-job'

const baseData = {
  connectorId: 'dc1',
  streamKey: 'orders',
  organizationId: 'org1',
  triggerData: { topic: 'orders/create' },
  eventId: 'evt1',
  appInstallationId: 'inst1',
  triggerId: 'shopify.shopify-trigger',
}

/** A JobContext (has `throwIfCancelled`) whose `.job` carries the native fields. */
function ctx(opts?: { attempts?: number; attemptsMade?: number; data?: Record<string, unknown> }) {
  const data = { ...baseData, ...opts?.data }
  return {
    throwIfCancelled: () => {},
    data,
    job: { data, opts: { attempts: opts?.attempts ?? 5 }, attemptsMade: opts?.attemptsMade ?? 0 },
  } as never
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('runConnectorAppTriggerStream', () => {
  it('runs the slice and returns ok on success', async () => {
    runWebhookEventSlice.mockResolvedValue(undefined)
    const result = await runConnectorAppTriggerStream(ctx())
    expect(result).toEqual({ ok: true })
    expect(runWebhookEventSlice).toHaveBeenCalledOnce()
    expect(queueAdd).not.toHaveBeenCalled()
  })

  it('re-enqueues with the Retry-After delay on a rate-limit error', async () => {
    runWebhookEventSlice.mockRejectedValue(new ConnectorRateLimitError(2000))
    const result = await runConnectorAppTriggerStream(ctx())
    expect(result).toMatchObject({ deferred: true })
    expect(queueAdd).toHaveBeenCalledOnce()
    const [, payload, options] = queueAdd.mock.calls[0] as [
      string,
      Record<string, unknown>,
      { delay: number },
    ]
    expect(payload).toMatchObject({ connectorId: 'dc1', rateLimitRetries: 1 })
    expect(options.delay).toBe(2000)
    expect(redis.lpush).not.toHaveBeenCalled()
  })

  it('dead-letters and re-throws a generic error on the final attempt', async () => {
    // Final attempt: attemptsMade (4) >= opts.attempts (5) - 1. Reads both off ctx.job —
    // if the unwrap regressed this would throw a TypeError instead of "boom".
    runWebhookEventSlice.mockRejectedValue(new Error('boom'))
    await expect(
      runConnectorAppTriggerStream(ctx({ attempts: 5, attemptsMade: 4 }))
    ).rejects.toThrow('boom')
    expect(redis.lpush).toHaveBeenCalledOnce()
    const [key] = redis.lpush.mock.calls[0] as [string, string]
    expect(key).toBe('app-trigger-test:inst1:shopify.shopify-trigger:dlq')
  })

  it('re-throws without dead-lettering when attempts remain', async () => {
    runWebhookEventSlice.mockRejectedValue(new Error('boom'))
    await expect(
      runConnectorAppTriggerStream(ctx({ attempts: 5, attemptsMade: 0 }))
    ).rejects.toThrow('boom')
    expect(redis.lpush).not.toHaveBeenCalled()
  })

  it('routes the dead-letter to the WebhookEndpoint list when present', async () => {
    runWebhookEventSlice.mockRejectedValue(new Error('boom'))
    await expect(
      runConnectorAppTriggerStream(
        ctx({ attempts: 1, attemptsMade: 0, data: { webhookEndpointId: 'whe1' } })
      )
    ).rejects.toThrow('boom')
    const [key] = redis.lpush.mock.calls[0] as [string, string]
    expect(key).toBe('webhook-endpoint:whe1:dlq')
  })
})
