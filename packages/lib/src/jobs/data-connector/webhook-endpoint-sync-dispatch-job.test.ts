// packages/lib/src/jobs/data-connector/webhook-endpoint-sync-dispatch-job.test.ts
// The connector webhook-endpoint matcher (v7): a delivery matches webhook-sync connectors
// whose CONNECTOR-level `config.webhookTrigger.webhookEndpointId` matches, then routes each
// matched stream by mode — steerable (`{path}` set) → a per-stream steer job (targeted PARTIAL
// run); non-steerable cursor stream → the full `enqueueConnectorSync`. DB/redis/queue faked.

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

import { dispatchWebhookEndpointToConnectors } from './webhook-endpoint-sync-dispatch-job'
import { WEBHOOK_STEER_JOB } from './webhook-steer-job'

function job(data: Record<string, unknown>) {
  // Shaped like a JobContext: handlers read the real job off `ctx.job`.
  return { job: { data, id: 'job1' }, data } as never
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
  it('enqueues a steer job for a steerable stream (paths set), with the folded topic', async () => {
    findManyConnectors.mockResolvedValue([
      { id: 'dc1', config: { webhookTrigger: { webhookEndpointId: 'ep1' } } },
    ])
    findManyStreams.mockResolvedValue([
      {
        dataConnectorId: 'dc1',
        streamKey: 'orders',
        requestConfig: { webhookTrigger: { paths: ['id'] } },
      },
    ])
    const result = await dispatchWebhookEndpointToConnectors(job(base))
    expect(result).toEqual({ steerJobs: 1, connectorsFullSynced: 0 })
    expect(enqueueConnectorSync).not.toHaveBeenCalled()
    expect(queueAdd).toHaveBeenCalledTimes(1)
    expect(queueAdd.mock.calls[0]?.[0]).toBe(WEBHOOK_STEER_JOB)
    expect(queueAdd.mock.calls[0]?.[1]).toMatchObject({
      connectorId: 'dc1',
      streamKey: 'orders',
      organizationId: 'org1',
      webhookEndpointId: 'ep1',
      topic: 'orders/create',
      eventId: 'evt1',
      // the steer job receives the topic-folded payload so `resolveWebhookSteer` sees it
      triggerData: { id: 1, topic: 'orders/create' },
    })
  })

  it('full-syncs a non-steerable cursor stream (no paths)', async () => {
    findManyConnectors.mockResolvedValue([
      { id: 'dc1', config: { webhookTrigger: { webhookEndpointId: 'ep1' } } },
    ])
    findManyStreams.mockResolvedValue([
      {
        dataConnectorId: 'dc1',
        streamKey: 'orders',
        requestConfig: { webhookTrigger: { paths: [] } },
      },
    ])
    const result = await dispatchWebhookEndpointToConnectors(job(base))
    expect(result).toEqual({ steerJobs: 0, connectorsFullSynced: 1 })
    expect(queueAdd).not.toHaveBeenCalled()
    expect(enqueueConnectorSync).toHaveBeenCalledTimes(1)
    expect(enqueueConnectorSync.mock.calls[0]?.[0]).toMatchObject({
      connectorId: 'dc1',
      organizationId: 'org1',
      trigger: 'webhook',
    })
  })

  it('skips connectors bound to a different endpoint', async () => {
    findManyConnectors.mockResolvedValue([
      { id: 'dc1', config: { webhookTrigger: { webhookEndpointId: 'ep2' } } },
      { id: 'dc2', config: { webhookTrigger: undefined } },
    ])
    const result = await dispatchWebhookEndpointToConnectors(job(base))
    expect(result).toEqual({ steerJobs: 0, connectorsFullSynced: 0 })
    expect(findManyStreams).not.toHaveBeenCalled()
    expect(enqueueConnectorSync).not.toHaveBeenCalled()
    expect(queueAdd).not.toHaveBeenCalled()
  })

  it('matches a topic-scoped stream when the topic is only in the separate field (header/path source)', async () => {
    // Realistic generic-endpoint shape: the body carries NO `topic` key — the extracted
    // topic travels in the sibling `topic` field. The dispatch folds it into the payload
    // so the per-stream `filter: { topic: { in: [...] } }` can match.
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
    expect(result).toEqual({ steerJobs: 0, connectorsFullSynced: 1 })
    expect(enqueueConnectorSync).toHaveBeenCalledTimes(1)
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
    expect(result).toEqual({ steerJobs: 0, connectorsFullSynced: 0 })
    expect(enqueueConnectorSync).not.toHaveBeenCalled()
    expect(queueAdd).not.toHaveBeenCalled()
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
        requestConfig: { webhookTrigger: { paths: [], filter: { topic: 'orders/delete' } } },
      },
    ])
    const result = await dispatchWebhookEndpointToConnectors(job(base))
    expect(result).toEqual({ steerJobs: 0, connectorsFullSynced: 0 })
    expect(enqueueConnectorSync).not.toHaveBeenCalled()
    expect(queueAdd).not.toHaveBeenCalled()
  })
})
