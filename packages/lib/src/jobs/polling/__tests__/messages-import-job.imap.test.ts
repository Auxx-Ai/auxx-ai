// packages/lib/src/jobs/polling/__tests__/messages-import-job.imap.test.ts
//
// Two IMAP-specific behaviors of the polling import jobs (skip-events history
// §11 G1):
//
// 1. `imapImportBatchJob` (the folder walk) imports through
//    `importMessagesInSyncBatch` when the provider offers it — the walk is a
//    backfill, and per-message realtime must collapse into one
//    `inbox:syncCompleted` per touched inbox.
// 2. The `initialBackfillCompletedAt` stamp on the cache-drain path is gated
//    on the folder walk being complete for IMAP. An IMAP first walk carries
//    its work in `imapImportBatchJob` payloads, not the Redis cache, so
//    `messagesImportJob` can drain to IDLE mid-walk — stamping completion
//    there would reopen `message:received` for the rest of the historical
//    import. Non-IMAP providers keep the plain drain-to-IDLE stamp.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  updates: [] as Array<{ patch: Record<string, unknown>; condition: unknown }>,
  provider: {} as Record<string, unknown>,
  claimResult: [] as string[],
  cacheSize: 0,
}))

vi.mock('@auxx/database', () => {
  const makeSelectChain = () => {
    const chain: Record<string, unknown> = {}
    for (const method of ['from', 'where', 'leftJoin', 'innerJoin', 'orderBy', 'limit']) {
      chain[method] = () => chain
    }
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable query-builder mock
    chain.then = (onOk: (v: unknown[]) => unknown, onErr: (e: unknown) => unknown) =>
      Promise.resolve(h.selectResults.shift() ?? []).then(onOk, onErr)
    return chain
  }
  const column = (name: string) => ({ columnName: name })
  return {
    database: {
      select: () => makeSelectChain(),
      update: () => ({
        set: (patch: Record<string, unknown>) => ({
          where: async (condition: unknown) => {
            h.updates.push({ patch, condition })
          },
        }),
      }),
    },
    schema: {
      Integration: {
        id: column('Integration.id'),
        metadata: column('Integration.metadata'),
        syncStage: column('Integration.syncStage'),
        syncStatus: column('Integration.syncStatus'),
        syncStageStartedAt: column('Integration.syncStageStartedAt'),
        throttleFailureCount: column('Integration.throttleFailureCount'),
        throttleRetryAfter: column('Integration.throttleRetryAfter'),
        lastSyncedAt: column('Integration.lastSyncedAt'),
        lastSuccessfulSync: column('Integration.lastSuccessfulSync'),
        updatedAt: column('Integration.updatedAt'),
        deletedAt: column('Integration.deletedAt'),
      },
      Label: {
        id: column('Label.id'),
        integrationId: column('Label.integrationId'),
        enabled: column('Label.enabled'),
        syncCheckpoint: column('Label.syncCheckpoint'),
        updatedAt: column('Label.updatedAt'),
      },
    },
  }
})

vi.mock('../../../email/polling-import-cache', () => ({
  claimImportBatch: vi.fn(async () => h.claimResult),
  acknowledgeImportBatch: vi.fn(async () => {}),
  getImportCacheSize: vi.fn(async () => h.cacheSize),
  recoverProcessingBatch: vi.fn(async () => 0),
}))

vi.mock('../../../providers/provider-registry-service', () => ({
  ProviderRegistryService: class {
    async getProvider() {
      return h.provider
    }
  },
}))

vi.mock('../../queues', () => ({ getQueue: () => ({ add: vi.fn(async () => {}) }) }))

import { imapImportBatchJob, messagesImportJob } from '../messages-import-job'

/** Every literal string inside a built Drizzle SQL / condition object. */
function flatten(node: unknown, out: string[] = [], depth = 0): string {
  if (depth > 10 || node === null || node === undefined) return out.join(' ')
  if (typeof node === 'string') {
    out.push(node)
    return out.join(' ')
  }
  if (typeof node === 'object') {
    for (const value of Object.values(node as Record<string, unknown>)) {
      flatten(value, out, depth + 1)
    }
  }
  return out.join(' ')
}

const stampUpdates = () =>
  h.updates.filter((u) => flatten(u.patch.metadata).includes('initialBackfillCompletedAt'))

const activeCheckpoint = JSON.stringify({
  runId: 'run-1',
  phase: 'importing',
  activeWindowBatchCount: 5,
  activeWindowCompletedBatches: 0,
  snapshotHighestUid: 5000,
  importedMessageCount: 0,
  failedMessageCount: 0,
  candidateCursor: '1:5000',
})

const jobCtx = (data: Record<string, unknown>) =>
  ({
    job: { id: 'job-1', data, opts: { attempts: 1 }, attemptsMade: 0 },
    signal: undefined,
  }) as never

beforeEach(() => {
  h.selectResults.length = 0
  h.updates.length = 0
  h.claimResult = []
  h.cacheSize = 0
  h.provider = {}
})

describe('imapImportBatchJob — folder walk enters the sync batch', () => {
  const batchData = {
    runId: 'run-1',
    integrationId: 'int-1',
    organizationId: 'org-1',
    provider: 'imap',
    labelId: 'label-1',
    folderPath: 'INBOX',
    externalIds: ['uid-1', 'uid-2'],
  }

  it('prefers importMessagesInSyncBatch over importMessages', async () => {
    const importMessages = vi.fn(async () => ({ imported: 2, failed: 0 }))
    const importMessagesInSyncBatch = vi.fn(async () => ({ imported: 2, failed: 0 }))
    h.provider = { importMessages, importMessagesInSyncBatch }
    // Label checkpoint fetch (mid-walk), then the idle-transition label scan.
    h.selectResults.push(
      [{ syncCheckpoint: activeCheckpoint }],
      [{ syncCheckpoint: activeCheckpoint }]
    )

    await imapImportBatchJob(jobCtx(batchData))

    expect(importMessagesInSyncBatch).toHaveBeenCalledWith(['uid-1', 'uid-2'])
    expect(importMessages).not.toHaveBeenCalled()
  })

  it('falls back to importMessages when the batched method is absent', async () => {
    const importMessages = vi.fn(async () => ({ imported: 2, failed: 0 }))
    h.provider = { importMessages }
    h.selectResults.push(
      [{ syncCheckpoint: activeCheckpoint }],
      [{ syncCheckpoint: activeCheckpoint }]
    )

    await imapImportBatchJob(jobCtx(batchData))

    expect(importMessages).toHaveBeenCalledWith(['uid-1', 'uid-2'])
  })
})

describe('messagesImportJob — IMAP completion stamp is walk-gated', () => {
  const importData = { integrationId: 'int-1', organizationId: 'org-1', provider: 'imap' }

  it('does NOT stamp completion on a cache drain while the folder walk is mid-flight', async () => {
    h.claimResult = [] // cache drained -> IDLE transition
    // stampBackfillCompletedIfWalkDone's label scan: one folder still importing.
    h.selectResults.push([{ syncCheckpoint: activeCheckpoint }])

    await messagesImportJob(jobCtx(importData))

    expect(stampUpdates()).toEqual([])
  })

  it('stamps completion once the walk is done', async () => {
    h.claimResult = []
    h.selectResults.push([{ syncCheckpoint: null }])

    await messagesImportJob(jobCtx(importData))

    expect(stampUpdates()).toHaveLength(1)
  })

  it('keeps the plain drain-to-IDLE stamp for non-IMAP providers', async () => {
    h.claimResult = []
    // No label scan happens for google — any queued select result would go unused.

    await messagesImportJob(
      jobCtx({ integrationId: 'int-1', organizationId: 'org-1', provider: 'google' })
    )

    expect(stampUpdates()).toHaveLength(1)
  })
})
