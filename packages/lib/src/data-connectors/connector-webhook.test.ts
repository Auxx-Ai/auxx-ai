// packages/lib/src/data-connectors/connector-webhook.test.ts
// Guards the webhook-steered PARTIAL run. A `fetch` steer opens a run, steers the connector
// fetch with the resolved `triggerContext`, sinks the result, and closes the run as `partial`
// (never `completed` — a single steered record is a SUBSET, so no orphan reconciliation) while
// still stamping `lastSyncedAt` via finalizeConnector. A `delete` steer archives by externalId
// and never fetches. A throttle drops the run row (no panel spam) and re-throws. Heavy deps faked.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  loadConnector,
  resolveWebhookSteer,
  openRun,
  finalizeRun,
  finalizeConnector,
  countConnectorItems,
  prepareConnectorFetch,
  sinkSourceRecord,
  archiveExternalId,
  ConnectorRateLimitError,
  fetchFn,
  deleteWhere,
  resolveRelationships,
  foldRunManifest,
  publishSyncRecordsChanged,
} = vi.hoisted(() => {
  class ConnectorRateLimitError extends Error {
    retryAfterMs?: number
    constructor(retryAfterMs?: number) {
      super('throttled')
      this.name = 'ConnectorRateLimitError'
      this.retryAfterMs = retryAfterMs
    }
  }
  return {
    loadConnector: vi.fn(),
    resolveWebhookSteer: vi.fn(),
    openRun: vi.fn(),
    finalizeRun: vi.fn(),
    finalizeConnector: vi.fn(),
    countConnectorItems: vi.fn(),
    prepareConnectorFetch: vi.fn(),
    sinkSourceRecord: vi.fn(),
    archiveExternalId: vi.fn(),
    ConnectorRateLimitError,
    fetchFn: vi.fn(),
    deleteWhere: vi.fn(),
    resolveRelationships: vi.fn(),
    // Both are called with the real arity (`(db, runId, fragment)` /
    // `(db, args)`) — declare a rest param so the pass-through mock factory
    // below can forward whatever it receives.
    foldRunManifest: vi.fn(async (..._a: unknown[]) => {}),
    publishSyncRecordsChanged: vi.fn(async (..._a: unknown[]) => {}),
  }
})

const db = { delete: vi.fn(() => ({ where: (...a: unknown[]) => deleteWhere(...a) })) }
vi.mock('@auxx/database', () => ({
  schema: { DataConnectorRun: { id: 'id-col' } },
}))
// Partial mock: `@auxx/logger/run-log` imports sink-registration helpers from this
// barrel at module load, so a full replacement breaks whichever test file happens
// to load it first.
vi.mock('@auxx/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/logger')>()),
  createScopedLogger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}))
vi.mock('../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    async warmCache() {}
  },
}))
vi.mock('./connector-runtime', () => ({
  prepareConnectorFetch: (...a: unknown[]) => prepareConnectorFetch(...a),
}))
vi.mock('./connectors', () => ({ ConnectorRateLimitError }))
vi.mock('./connectors/types', () => ({ isConnectorCheckpoint: () => false }))
vi.mock('./reconciliation', () => ({
  archiveExternalId: (...a: unknown[]) => archiveExternalId(...a),
}))
vi.mock('./relationship-pass', () => ({
  resolveRelationships: (...a: unknown[]) => resolveRelationships(...a),
}))
vi.mock('./service', () => ({
  loadConnector: (...a: unknown[]) => loadConnector(...a),
  openRun: (...a: unknown[]) => openRun(...a),
  finalizeRun: (...a: unknown[]) => finalizeRun(...a),
  finalizeConnector: (...a: unknown[]) => finalizeConnector(...a),
  countConnectorItems: (...a: unknown[]) => countConnectorItems(...a),
  newRunCounters: () => ({ created: 0, updated: 0, deleted: 0, archived: 0 }),
  foldRunManifest: (...a: unknown[]) => foldRunManifest(...a),
  markRunManifestDegraded: vi.fn(async () => {}),
  publishSyncRecordsChanged: (...a: unknown[]) => publishSyncRecordsChanged(...a),
}))
vi.mock('./sink-source-record', () => ({
  sinkSourceRecord: (ctx: { touchedDefs: Set<string> }, ...a: unknown[]) => {
    ctx.touchedDefs.add('def1')
    return sinkSourceRecord(ctx, ...a)
  },
}))
vi.mock('./webhook-steer', () => ({
  resolveWebhookSteer: (...a: unknown[]) => resolveWebhookSteer(...a),
}))
// buildWebhookCtx builds a B2 manifest collector (cache/db) — stub to the no-op.
vi.mock('../record-rules/sync-manifest-collector', () => ({
  loadManifestCollector: async () => ({
    enabled: false,
    subscriptionsFor: () => undefined,
    recordChange: () => {},
    recordCreated: () => {},
    recordArchived: () => {},
    toJson: () => null,
  }),
}))

import { runWebhookSteeredRun } from './connector-webhook'

async function* oneRecord() {
  yield { externalId: '123', data: {} }
}

const loaded = {
  connector: { id: 'dc1', createdById: 'u1', config: {} },
  streams: [
    {
      stream: {
        streamKey: 'orders',
        requestConfig: {
          webhookTrigger: { paths: ['id'] },
          incremental: { watermarkField: 'updatedAt' },
        },
      },
      mappings: [{ entityDefinitionId: 'def1' }],
    },
  ],
}

const data = {
  connectorId: 'dc1',
  organizationId: 'org1',
  streamKey: 'orders',
  triggerData: { id: '123', topic: 'orders/create' },
  eventId: 'evt1',
}

beforeEach(() => {
  vi.clearAllMocks()
  loadConnector.mockResolvedValue(loaded)
  openRun.mockResolvedValue({ id: 'run1', startedAt: new Date(0) })
  finalizeRun.mockResolvedValue(undefined)
  finalizeConnector.mockResolvedValue(undefined)
  countConnectorItems.mockResolvedValue(5)
  prepareConnectorFetch.mockResolvedValue({ definition: { fetch: fetchFn }, credential: {} })
  fetchFn.mockResolvedValue({ records: oneRecord() })
})

describe('runWebhookSteeredRun', () => {
  it('opens a run, steers the fetch, sinks, and closes it PARTIAL (no reconcile)', async () => {
    resolveWebhookSteer.mockReturnValue({ kind: 'fetch', triggerContext: { id: '123' } })

    await runWebhookSteeredRun(db as never, data)

    expect(openRun).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ trigger: 'webhook', mode: 'incremental' })
    )
    // steered: the resolved triggerContext is threaded into the fetch
    expect(fetchFn).toHaveBeenCalledWith(
      expect.objectContaining({ streamKey: 'orders', triggerContext: { id: '123' } })
    )
    expect(sinkSourceRecord).toHaveBeenCalledTimes(1)
    expect(archiveExternalId).not.toHaveBeenCalled()
    // closes PARTIAL — the load-bearing bit: a subset run must NOT reconcile/archive the rest
    expect(finalizeRun).toHaveBeenCalledWith(
      db,
      'run1',
      expect.objectContaining({ status: 'partial' })
    )
    // still stamps lastSyncedAt so header freshness advances
    expect(finalizeConnector).toHaveBeenCalledWith(
      db,
      'dc1',
      expect.objectContaining({ ok: true, itemCount: 5 })
    )
  })

  it('archives by externalId on a delete steer and never fetches', async () => {
    resolveWebhookSteer.mockReturnValue({ kind: 'delete', externalId: '123' })

    await runWebhookSteeredRun(db as never, data)

    expect(archiveExternalId).toHaveBeenCalledWith(
      expect.anything(),
      loaded.streams[0]?.mappings,
      '123'
    )
    expect(prepareConnectorFetch).not.toHaveBeenCalled()
    expect(fetchFn).not.toHaveBeenCalled()
    expect(finalizeRun).toHaveBeenCalledWith(
      db,
      'run1',
      expect.objectContaining({ status: 'partial' })
    )
  })

  it('drops the run row and re-throws on a throttle (no panel spam)', async () => {
    resolveWebhookSteer.mockReturnValue({ kind: 'fetch', triggerContext: { id: '123' } })
    fetchFn.mockRejectedValue(new ConnectorRateLimitError(2000))

    await expect(runWebhookSteeredRun(db as never, data)).rejects.toBeInstanceOf(
      ConnectorRateLimitError
    )
    expect(db.delete).toHaveBeenCalledTimes(1)
    expect(deleteWhere).toHaveBeenCalledTimes(1)
    expect(finalizeRun).not.toHaveBeenCalled()
  })

  it('marks the run failed (not dropped) on a non-throttle error and re-throws', async () => {
    resolveWebhookSteer.mockReturnValue({ kind: 'fetch', triggerContext: { id: '123' } })
    fetchFn.mockRejectedValue(new Error('boom'))

    await expect(runWebhookSteeredRun(db as never, data)).rejects.toThrow('boom')
    expect(db.delete).not.toHaveBeenCalled()
    expect(finalizeRun).toHaveBeenCalledWith(
      db,
      'run1',
      expect.objectContaining({ status: 'failed' })
    )
  })

  it('is a no-op when the connector is gone (never opens a run)', async () => {
    loadConnector.mockResolvedValue(null)
    await runWebhookSteeredRun(db as never, data)
    expect(openRun).not.toHaveBeenCalled()
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
