// packages/lib/src/jobs/data-connector/app-trigger-sync-dispatch-job.test.ts
// The connector app-trigger matcher (v7): a delivery matches webhook-sync connectors on the
// delivering connection whose CONNECTOR-level `config.webhookTrigger.triggerId` matches, then
// steers a full run-based sync for each connector with ≥1 stream whose `filter` passes.
// DB/redis/enqueue faked.

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

const enqueueConnectorSync = vi.fn()
vi.mock('../../data-connectors/data-connector-queue', () => ({
  enqueueConnectorSync: (...a: unknown[]) => enqueueConnectorSync(...a),
}))

vi.mock('@auxx/redis', () => ({ getRedisClient: async () => null }))

import { dispatchAppTriggerToConnectors } from './app-trigger-sync-dispatch-job'

function job(data: Record<string, unknown>) {
  // Shaped like a JobContext: handlers read the real job off `ctx.job`.
  return { job: { data, id: 'job1' }, data } as never
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
  it('steers a webhook sync for a connector whose signal + a stream filter match', async () => {
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
    expect(result).toEqual({ connectorsSynced: 1 })
    expect(enqueueConnectorSync).toHaveBeenCalledTimes(1)
    expect(enqueueConnectorSync.mock.calls[0]?.[0]).toMatchObject({
      connectorId: 'dc1',
      organizationId: 'org1',
      trigger: 'webhook',
    })
  })

  it('syncs a connector once even when several of its streams match', async () => {
    findManyConnectors.mockResolvedValue([
      { id: 'dc1', config: { webhookTrigger: { triggerId: 'shopify.shopify-trigger' } } },
    ])
    findManyStreams.mockResolvedValue([
      { dataConnectorId: 'dc1', streamKey: 'orders', requestConfig: { webhookTrigger: {} } },
      { dataConnectorId: 'dc1', streamKey: 'customers', requestConfig: { webhookTrigger: {} } },
    ])
    const result = await dispatchAppTriggerToConnectors(job(base))
    expect(result).toEqual({ connectorsSynced: 1 })
    expect(enqueueConnectorSync).toHaveBeenCalledTimes(1)
  })

  it('returns early when the delivery carries no connection', async () => {
    const result = await dispatchAppTriggerToConnectors(job({ ...base, connectionId: undefined }))
    expect(result).toEqual({ connectorsSynced: 0 })
    expect(findManyConnectors).not.toHaveBeenCalled()
    expect(enqueueConnectorSync).not.toHaveBeenCalled()
  })

  it('skips connectors bound to a different trigger on the same connection', async () => {
    findManyConnectors.mockResolvedValue([
      { id: 'dc1', config: { webhookTrigger: { triggerId: 'other.trigger' } } },
    ])
    const result = await dispatchAppTriggerToConnectors(job(base))
    expect(result).toEqual({ connectorsSynced: 0 })
    expect(findManyStreams).not.toHaveBeenCalled()
    expect(enqueueConnectorSync).not.toHaveBeenCalled()
  })
})
