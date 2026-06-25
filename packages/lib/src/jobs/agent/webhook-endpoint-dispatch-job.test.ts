// packages/lib/src/jobs/agent/webhook-endpoint-dispatch-job.test.ts
// The agent webhook matcher: a delivery fans only to `kind: 'webhook'` agent triggers
// matching `(endpointId, topic)` that pass their filter. Cache + queue + redis are faked
// so the test is pure.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const getCachedAgents = vi.fn()
vi.mock('../../cache', () => ({ getCachedAgents: (...a: unknown[]) => getCachedAgents(...a) }))

const queueAdd = vi.fn()
vi.mock('../queues', () => ({
  getQueue: () => ({ add: (...a: unknown[]) => queueAdd(...a) }),
  Queues: { scheduledTriggerQueue: 'scheduledTriggerQueue' },
}))

// No redis in tests → dedup is skipped (returns null), dispatch proceeds.
vi.mock('@auxx/redis', () => ({ getRedisClient: async () => null }))

import { dispatchWebhookEndpointToAgents } from './webhook-endpoint-dispatch-job'

function trigger(overrides: Record<string, unknown>) {
  return {
    id: 't1',
    kind: 'webhook',
    enabled: true,
    triggerWebhookEndpointId: 'ep1',
    triggerTopic: 'orders/create',
    config: null,
    ...overrides,
  }
}

function job(data: Record<string, unknown>) {
  return { data, id: 'job1' } as never
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('dispatchWebhookEndpointToAgents', () => {
  const base = {
    endpointId: 'ep1',
    topic: 'orders/create',
    triggerData: { id: 1 },
    eventId: 'evt1',
    organizationId: 'org1',
  }

  it('enqueues a run for a matching webhook trigger', async () => {
    getCachedAgents.mockResolvedValue([{ id: 'a1', triggers: [trigger({})] }])
    const result = await dispatchWebhookEndpointToAgents(job(base))
    expect(result).toEqual({ agentSessionsEnqueued: 1 })
    expect(queueAdd).toHaveBeenCalledTimes(1)
    expect(queueAdd.mock.calls[0]?.[0]).toBe('executeAgentAppTrigger')
    expect(queueAdd.mock.calls[0]?.[1]).toMatchObject({
      agentTriggerId: 't1',
      agentId: 'a1',
      webhookEndpointId: 'ep1',
      topic: 'orders/create',
    })
  })

  it('ignores non-webhook kinds, wrong topic/endpoint, and disabled triggers', async () => {
    getCachedAgents.mockResolvedValue([
      { id: 'a1', triggers: [trigger({ kind: 'app' })] },
      { id: 'a2', triggers: [trigger({ triggerTopic: 'orders/delete' })] },
      { id: 'a3', triggers: [trigger({ triggerWebhookEndpointId: 'ep2' })] },
      { id: 'a4', triggers: [trigger({ enabled: false })] },
    ])
    const result = await dispatchWebhookEndpointToAgents(job(base))
    expect(result).toEqual({ agentSessionsEnqueued: 0 })
    expect(queueAdd).not.toHaveBeenCalled()
  })

  it('drops a match whose config filter rejects the payload', async () => {
    getCachedAgents.mockResolvedValue([
      { id: 'a1', triggers: [trigger({ config: { filter: { id: 999 } } })] },
    ])
    const result = await dispatchWebhookEndpointToAgents(job(base))
    expect(result).toEqual({ agentSessionsEnqueued: 0 })
  })
})
