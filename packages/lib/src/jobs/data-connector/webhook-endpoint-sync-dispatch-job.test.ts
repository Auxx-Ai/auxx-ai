// packages/lib/src/jobs/data-connector/webhook-endpoint-sync-dispatch-job.test.ts
// The connector webhook-endpoint matcher (v7): a delivery fans to webhook-sync connectors
// whose CONNECTOR-level `config.webhookTrigger.webhookEndpointId` matches, then to each of
// their streams whose per-stream `webhookTrigger.filter` passes. DB + queue + redis faked.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const findManyConnectors = vi.fn()
const findManyStreams = vi.fn()
vi.mock('@auxx/database', () => ({
  database: {
    query: {
      DataConnector: { findMany: (...a: unknown[]) => findManyConnectors(...a) },
      DataConnectorStream: { findMany: (...a: unknown[]) => findManyStreams(...a) },
    },
  },
  // Column refs are only fed to the (ignored) where-builder — any object works.
  schema: new Proxy({}, { get: () => new Proxy({}, { get: () => ({}) }) }),
}))

const queueAdd = vi.fn()
vi.mock('../queues', () => ({
  getQueue: () => ({ add: (...a: unknown[]) => queueAdd(...a) }),
  Queues: { appTriggerQueue: 'appTriggerQueue' },
}))

vi.mock('@auxx/redis', () => ({ getRedisClient: async () => null }))

import { dispatchWebhookEndpointToConnectors } from './webhook-endpoint-sync-dispatch-job'

function job(data: Record<string, unknown>) {
  return { data, id: 'job1' } as never
}

const base = {
  endpointId: 'ep1',
  topic: 'orders/create',
  triggerData: { id: 1, topic: 'orders/create' },
  eventId: 'evt1',
  organizationId: 'org1',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('dispatchWebhookEndpointToConnectors', () => {
  it('fans to a connector whose connector-level signal matches the endpoint', async () => {
    findManyConnectors.mockResolvedValue([
      { id: 'dc1', config: { webhookTrigger: { webhookEndpointId: 'ep1' } } },
    ])
    findManyStreams.mockResolvedValue([
      {
        dataConnectorId: 'dc1',
        streamKey: 'orders',
        requestConfig: { webhookTrigger: { tokens: {} } },
      },
    ])
    const result = await dispatchWebhookEndpointToConnectors(job(base))
    expect(result).toEqual({ childJobsEnqueued: 1 })
    expect(queueAdd).toHaveBeenCalledTimes(1)
    expect(queueAdd.mock.calls[0]?.[1]).toMatchObject({
      connectorId: 'dc1',
      streamKey: 'orders',
      webhookEndpointId: 'ep1',
    })
  })

  it('skips connectors bound to a different endpoint', async () => {
    findManyConnectors.mockResolvedValue([
      { id: 'dc1', config: { webhookTrigger: { webhookEndpointId: 'ep2' } } },
      { id: 'dc2', config: { webhookTrigger: undefined } },
    ])
    const result = await dispatchWebhookEndpointToConnectors(job(base))
    expect(result).toEqual({ childJobsEnqueued: 0 })
    expect(findManyStreams).not.toHaveBeenCalled()
  })

  it('matches a topic-scoped stream when the topic is only in the separate field (header/path source)', async () => {
    // Realistic generic-endpoint shape: the body carries NO `topic` key — the extracted
    // topic travels in the sibling `topic` field. The dispatch must fold it into the
    // payload so the per-stream `filter: { topic: { in: [...] } }` can match.
    findManyConnectors.mockResolvedValue([
      { id: 'dc1', config: { webhookTrigger: { webhookEndpointId: 'ep1' } } },
    ])
    findManyStreams.mockResolvedValue([
      {
        dataConnectorId: 'dc1',
        streamKey: 'orders',
        requestConfig: {
          webhookTrigger: { paths: [], filter: { topic: { in: ['orders/create'] } } },
        },
      },
    ])
    const result = await dispatchWebhookEndpointToConnectors(
      job({ ...base, triggerData: { id: 1 } }) // no `topic` in the body
    )
    expect(result).toEqual({ childJobsEnqueued: 1 })
    // The enriched payload (topic folded in) is what the child slice receives.
    expect(queueAdd.mock.calls[0]?.[1]).toMatchObject({
      triggerData: { id: 1, topic: 'orders/create' },
    })
  })

  it('does not match a stream scoped to a different topic than the delivery', async () => {
    findManyConnectors.mockResolvedValue([
      { id: 'dc1', config: { webhookTrigger: { webhookEndpointId: 'ep1' } } },
    ])
    findManyStreams.mockResolvedValue([
      {
        dataConnectorId: 'dc1',
        streamKey: 'orders',
        requestConfig: {
          webhookTrigger: { paths: [], filter: { topic: { in: ['orders/delete'] } } },
        },
      },
    ])
    const result = await dispatchWebhookEndpointToConnectors(
      job({ ...base, triggerData: { id: 1 } })
    )
    expect(result).toEqual({ childJobsEnqueued: 0 })
  })

  it('skips streams with no steering block and streams whose filter rejects the payload', async () => {
    findManyConnectors.mockResolvedValue([
      { id: 'dc1', config: { webhookTrigger: { webhookEndpointId: 'ep1' } } },
    ])
    findManyStreams.mockResolvedValue([
      { dataConnectorId: 'dc1', streamKey: 'a', requestConfig: {} }, // no webhookTrigger
      {
        dataConnectorId: 'dc1',
        streamKey: 'b',
        requestConfig: { webhookTrigger: { tokens: {}, filter: { topic: 'orders/delete' } } },
      },
    ])
    const result = await dispatchWebhookEndpointToConnectors(job(base))
    expect(result).toEqual({ childJobsEnqueued: 0 })
  })
})
