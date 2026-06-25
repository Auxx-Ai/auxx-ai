// packages/lib/src/jobs/data-connector/app-trigger-sync-dispatch-job.test.ts
// The connector app-trigger matcher (v7): a delivery fans to webhook-sync connectors on the
// delivering connection whose CONNECTOR-level `config.webhookTrigger.triggerId` matches, then
// to each of their streams whose per-stream `webhookTrigger.filter` passes. DB/queue/redis faked.

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
  schema: new Proxy({}, { get: () => new Proxy({}, { get: () => ({}) }) }),
}))

const queueAdd = vi.fn()
vi.mock('../queues', () => ({
  getQueue: () => ({ add: (...a: unknown[]) => queueAdd(...a) }),
  Queues: { appTriggerQueue: 'appTriggerQueue' },
}))

vi.mock('@auxx/redis', () => ({ getRedisClient: async () => null }))

import { dispatchAppTriggerToConnectors } from './app-trigger-sync-dispatch-job'

function job(data: Record<string, unknown>) {
  return { data, id: 'job1' } as never
}

const base = {
  appInstallationId: 'inst1',
  appId: 'app1',
  triggerId: 'shopify.shopify-trigger',
  connectionId: 'cred1',
  triggerData: { resourceId: '1', topic: 'orders/create' },
  eventId: 'evt1',
  organizationId: 'org1',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('dispatchAppTriggerToConnectors', () => {
  it('fans to a connector whose connector-level signal matches the trigger', async () => {
    findManyConnectors.mockResolvedValue([
      { id: 'dc1', config: { webhookTrigger: { triggerId: 'shopify.shopify-trigger' } } },
    ])
    findManyStreams.mockResolvedValue([
      {
        dataConnectorId: 'dc1',
        streamKey: 'orders',
        requestConfig: { webhookTrigger: { tokens: {} } },
      },
    ])
    const result = await dispatchAppTriggerToConnectors(job(base))
    expect(result).toEqual({ childJobsEnqueued: 1 })
    expect(queueAdd.mock.calls[0]?.[1]).toMatchObject({
      connectorId: 'dc1',
      streamKey: 'orders',
      triggerId: 'shopify.shopify-trigger',
    })
  })

  it('returns early when the delivery carries no connection', async () => {
    const result = await dispatchAppTriggerToConnectors(job({ ...base, connectionId: undefined }))
    expect(result).toEqual({ childJobsEnqueued: 0 })
    expect(findManyConnectors).not.toHaveBeenCalled()
  })

  it('skips connectors bound to a different trigger on the same connection', async () => {
    findManyConnectors.mockResolvedValue([
      { id: 'dc1', config: { webhookTrigger: { triggerId: 'other.trigger' } } },
    ])
    const result = await dispatchAppTriggerToConnectors(job(base))
    expect(result).toEqual({ childJobsEnqueued: 0 })
    expect(findManyStreams).not.toHaveBeenCalled()
  })
})
