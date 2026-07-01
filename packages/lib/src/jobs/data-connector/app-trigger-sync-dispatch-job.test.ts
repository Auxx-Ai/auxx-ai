// packages/lib/src/jobs/data-connector/app-trigger-sync-dispatch-job.test.ts
// The connector app-trigger matcher (v7): a delivery matches webhook-sync connectors on the
// delivering connection whose CONNECTOR-level `config.webhookTrigger.triggerId` matches, then
// routes each matched stream by mode — steerable (`{path}` set) → a per-stream steer job
// (targeted PARTIAL run); non-steerable cursor stream → the full `enqueueConnectorSync`.
// DB/redis/queue/enqueue faked.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const findManyConnectors = vi.fn()
const findManyStreams = vi.fn()
vi.mock('@auxx/database', () => ({
  database: {
    query: {
      DataConnector: { findMany: (...a: unknown[]) => findManyConnectors(...a) },
      DataConnectorStream: { findMany: (...a: unknown[]) => findManyStreams(...a) },
    },
    // `markWebhookEventReceived` stamps `lastWebhookEventAt` for every touched connector.
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  },
  schema: new Proxy({}, { get: () => new Proxy({}, { get: () => ({}) }) }),
}))

const enqueueConnectorSync = vi.fn()
vi.mock('../../data-connectors/data-connector-queue', () => ({
  enqueueConnectorSync: (...a: unknown[]) => enqueueConnectorSync(...a),
}))

const queueAdd = vi.fn()
vi.mock('../queues', () => ({
  getQueue: () => ({ add: (...a: unknown[]) => queueAdd(...a) }),
  Queues: { appTriggerQueue: 'app-trigger-queue' },
}))

vi.mock('@auxx/redis', () => ({ getRedisClient: async () => null }))

import { dispatchAppTriggerToConnectors } from './app-trigger-sync-dispatch-job'
import { WEBHOOK_STEER_JOB } from './webhook-steer-job'

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
  it('enqueues a steer job for a steerable stream (paths set)', async () => {
    findManyConnectors.mockResolvedValue([
      { id: 'dc1', config: { webhookTrigger: { triggerId: 'shopify.shopify-trigger' } } },
    ])
    findManyStreams.mockResolvedValue([
      {
        dataConnectorId: 'dc1',
        streamKey: 'orders',
        requestConfig: { webhookTrigger: { paths: ['resourceId'] } },
      },
    ])
    const result = await dispatchAppTriggerToConnectors(job(base))
    expect(result).toEqual({ steerJobs: 1, connectorsFullSynced: 0 })
    expect(enqueueConnectorSync).not.toHaveBeenCalled()
    expect(queueAdd).toHaveBeenCalledTimes(1)
    expect(queueAdd.mock.calls[0]?.[0]).toBe(WEBHOOK_STEER_JOB)
    expect(queueAdd.mock.calls[0]?.[1]).toMatchObject({
      connectorId: 'dc1',
      streamKey: 'orders',
      organizationId: 'org1',
      triggerId: 'shopify.shopify-trigger',
      eventId: 'evt1',
    })
    // No jobId opts ⇒ steered runs never coalesce (each delivery is a distinct record).
    expect(queueAdd.mock.calls[0]?.[2]).toBeUndefined()
  })

  it('full-syncs a non-steerable cursor stream (no paths)', async () => {
    findManyConnectors.mockResolvedValue([
      { id: 'dc1', config: { webhookTrigger: { triggerId: 'shopify.shopify-trigger' } } },
    ])
    findManyStreams.mockResolvedValue([
      {
        dataConnectorId: 'dc1',
        streamKey: 'orders',
        requestConfig: { webhookTrigger: { paths: [] } },
      },
    ])
    const result = await dispatchAppTriggerToConnectors(job(base))
    expect(result).toEqual({ steerJobs: 0, connectorsFullSynced: 1 })
    expect(queueAdd).not.toHaveBeenCalled()
    expect(enqueueConnectorSync).toHaveBeenCalledTimes(1)
    expect(enqueueConnectorSync.mock.calls[0]?.[0]).toMatchObject({
      connectorId: 'dc1',
      organizationId: 'org1',
      trigger: 'webhook',
    })
  })

  it('full-syncs a connector with ANY non-steerable matched stream (superset wins)', async () => {
    findManyConnectors.mockResolvedValue([
      { id: 'dc1', config: { webhookTrigger: { triggerId: 'shopify.shopify-trigger' } } },
    ])
    findManyStreams.mockResolvedValue([
      {
        dataConnectorId: 'dc1',
        streamKey: 'orders',
        requestConfig: { webhookTrigger: { paths: ['resourceId'] } },
      },
      {
        dataConnectorId: 'dc1',
        streamKey: 'customers',
        requestConfig: { webhookTrigger: { paths: [] } },
      },
    ])
    const result = await dispatchAppTriggerToConnectors(job(base))
    expect(result).toEqual({ steerJobs: 0, connectorsFullSynced: 1 })
    expect(queueAdd).not.toHaveBeenCalled()
    expect(enqueueConnectorSync).toHaveBeenCalledTimes(1)
  })

  it('enqueues a steer job per matched steerable stream of a connector', async () => {
    findManyConnectors.mockResolvedValue([
      { id: 'dc1', config: { webhookTrigger: { triggerId: 'shopify.shopify-trigger' } } },
    ])
    findManyStreams.mockResolvedValue([
      {
        dataConnectorId: 'dc1',
        streamKey: 'orders',
        requestConfig: { webhookTrigger: { paths: ['resourceId'] } },
      },
      {
        dataConnectorId: 'dc1',
        streamKey: 'lineItems',
        requestConfig: { webhookTrigger: { paths: ['resourceId'] } },
      },
    ])
    const result = await dispatchAppTriggerToConnectors(job(base))
    expect(result).toEqual({ steerJobs: 2, connectorsFullSynced: 0 })
    expect(queueAdd).toHaveBeenCalledTimes(2)
  })

  it('returns early when the delivery carries no connection', async () => {
    const result = await dispatchAppTriggerToConnectors(job({ ...base, connectionId: undefined }))
    expect(result).toEqual({ steerJobs: 0, connectorsFullSynced: 0 })
    expect(findManyConnectors).not.toHaveBeenCalled()
    expect(enqueueConnectorSync).not.toHaveBeenCalled()
    expect(queueAdd).not.toHaveBeenCalled()
  })

  it('skips connectors bound to a different trigger on the same connection', async () => {
    findManyConnectors.mockResolvedValue([
      { id: 'dc1', config: { webhookTrigger: { triggerId: 'other.trigger' } } },
    ])
    const result = await dispatchAppTriggerToConnectors(job(base))
    expect(result).toEqual({ steerJobs: 0, connectorsFullSynced: 0 })
    expect(findManyStreams).not.toHaveBeenCalled()
    expect(enqueueConnectorSync).not.toHaveBeenCalled()
    expect(queueAdd).not.toHaveBeenCalled()
  })

  describe('steer-burst debounce (v9 §8)', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(0)
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('carries a deterministic jobId + delay + removeOn* opts when debounceMs is set', async () => {
      findManyConnectors.mockResolvedValue([
        { id: 'dc1', config: { webhookTrigger: { triggerId: 'shopify.shopify-trigger' } } },
      ])
      findManyStreams.mockResolvedValue([
        {
          id: 'stream1',
          dataConnectorId: 'dc1',
          streamKey: 'variant',
          requestConfig: { webhookTrigger: { paths: ['resourceId'], debounceMs: 10_000 } },
        },
      ])
      await dispatchAppTriggerToConnectors(job(base))
      const opts = queueAdd.mock.calls[0]?.[2]
      expect(opts).toMatchObject({ delay: 10_000, removeOnComplete: true, removeOnFail: true })
      expect(opts.jobId).toContain('dc1')
      expect(opts.jobId).toContain('variant')
      expect(opts.jobId).toContain('resourceId%3D1') // token value ('1', from base.triggerData) URI-encoded
    })

    it('coalesces two deliveries for the SAME record into one jobId', async () => {
      findManyConnectors.mockResolvedValue([
        { id: 'dc1', config: { webhookTrigger: { triggerId: 'shopify.shopify-trigger' } } },
      ])
      findManyStreams.mockResolvedValue([
        {
          id: 'stream1',
          dataConnectorId: 'dc1',
          streamKey: 'variant',
          requestConfig: { webhookTrigger: { paths: ['resourceId'], debounceMs: 10_000 } },
        },
      ])
      await dispatchAppTriggerToConnectors(job({ ...base, eventId: 'evt1' }))
      await dispatchAppTriggerToConnectors(job({ ...base, eventId: 'evt2' }))
      const jobId1 = queueAdd.mock.calls[0]?.[2]?.jobId
      const jobId2 = queueAdd.mock.calls[1]?.[2]?.jobId
      expect(jobId1).toBe(jobId2)
    })

    it('does NOT coalesce deliveries about DIFFERENT records', async () => {
      findManyConnectors.mockResolvedValue([
        { id: 'dc1', config: { webhookTrigger: { triggerId: 'shopify.shopify-trigger' } } },
      ])
      findManyStreams.mockResolvedValue([
        {
          id: 'stream1',
          dataConnectorId: 'dc1',
          streamKey: 'variant',
          requestConfig: { webhookTrigger: { paths: ['resourceId'], debounceMs: 10_000 } },
        },
      ])
      await dispatchAppTriggerToConnectors(
        job({ ...base, eventId: 'evt1', triggerData: { resourceId: '1', topic: 'orders/create' } })
      )
      await dispatchAppTriggerToConnectors(
        job({ ...base, eventId: 'evt2', triggerData: { resourceId: '2', topic: 'orders/create' } })
      )
      const jobId1 = queueAdd.mock.calls[0]?.[2]?.jobId
      const jobId2 = queueAdd.mock.calls[1]?.[2]?.jobId
      expect(jobId1).not.toBe(jobId2)
    })
  })
})
