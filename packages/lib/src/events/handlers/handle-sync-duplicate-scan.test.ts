// packages/lib/src/events/handlers/handle-sync-duplicate-scan.test.ts
//
// The dedup half of the `sync:records:changed` fan-out. Two claims carry the
// design and both are asserted here: the handler enqueues ONE scan per run with
// the manifest's ids, and it NEVER claims the manifest — the claim is the
// record-rules consumer's once-only latch, and a second claimant would starve it.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncChangeManifest } from '../../record-rules/sync-manifest-types'
import { createChainableDatabaseMock, createSchemaMock } from '../../test/database-mock'

const h = vi.hoisted(() => ({
  getRunManifest: vi.fn<() => Promise<SyncChangeManifest | null>>(),
  getImportManifest: vi.fn<() => Promise<SyncChangeManifest | null>>(),
  claimRunManifestConsumed: vi.fn(async () => true),
  claimImportManifestConsumed: vi.fn(async () => true),
  hasAccess: vi.fn(async () => true),
  enqueueDuplicateScanForRecords: vi.fn<
    (p: { organizationId: string; recordIds: string[]; scopeKey: string }) => Promise<string>
  >(async () => 'job_1'),
  getCachedRecordRules: vi.fn(async () => [] as unknown[]),
  fireRecordRulesBatch: vi.fn(async () => {}),
  fetchResourceSnapshots: vi.fn(async () => new Map()),
  getCachedResourceFields: vi.fn(async () => [] as unknown[]),
}))

vi.mock('@auxx/database', async () => ({
  database: createChainableDatabaseMock(),
  schema: createSchemaMock(),
}))
vi.mock('../../data-connectors/service', () => ({
  getRunManifest: h.getRunManifest,
  claimRunManifestConsumed: h.claimRunManifestConsumed,
}))
vi.mock('../../import', () => ({
  getImportManifest: h.getImportManifest,
  claimImportManifestConsumed: h.claimImportManifestConsumed,
}))
vi.mock('../../permissions/feature-permission-service', () => ({
  FeaturePermissionService: class {
    hasAccess = h.hasAccess
  },
}))
vi.mock('../../dedup/enqueue-scan', () => ({
  enqueueDuplicateScanForRecords: h.enqueueDuplicateScanForRecords,
}))
vi.mock('../../cache', () => ({
  getCachedRecordRules: h.getCachedRecordRules,
  getCachedResourceFields: h.getCachedResourceFields,
}))
vi.mock('../../record-rules/engine', () => ({ fireRecordRulesBatch: h.fireRecordRulesBatch }))
vi.mock('../../record-rules/snapshot-fetcher', () => ({
  fetchResourceSnapshots: h.fetchResourceSnapshots,
}))

import { handleSyncDuplicateScan } from './handle-sync-duplicate-scan'
import { handleSyncRecordRules } from './handle-sync-record-rules'

function manifest(over: Partial<SyncChangeManifest> = {}): SyncChangeManifest {
  return {
    version: 1,
    truncated: false,
    changes: {},
    createdRecordIds: [],
    archivedRecordIds: [],
    ...over,
  } as SyncChangeManifest
}

const connectorEvent = (runId = 'run_1') =>
  ({
    data: {
      type: 'sync:records:changed',
      data: { source: 'connector', organizationId: 'org_1', runId },
    },
  }) as never

/** The single enqueue this handler is allowed to make, asserted present. */
function firstEnqueue() {
  const call = h.enqueueDuplicateScanForRecords.mock.calls[0]
  if (!call) throw new Error('enqueueDuplicateScanForRecords was never called')
  return call[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  h.hasAccess.mockResolvedValue(true)
  h.claimRunManifestConsumed.mockResolvedValue(true)
  h.getCachedRecordRules.mockResolvedValue([])
})

describe('handleSyncDuplicateScan', () => {
  it('enqueues exactly one scan carrying the created + changed ids', async () => {
    h.getRunManifest.mockResolvedValue(
      manifest({
        createdRecordIds: ['def_1:a', 'def_1:b'] as never,
        changes: { 'def_1:c': { f1: { o: 1, n: 2 } } } as never,
      })
    )

    await handleSyncDuplicateScan(connectorEvent())

    expect(h.enqueueDuplicateScanForRecords).toHaveBeenCalledTimes(1)
    const arg = firstEnqueue()
    expect(arg.organizationId).toBe('org_1')
    expect(arg.recordIds.sort()).toEqual(['def_1:a', 'def_1:b', 'def_1:c'])
    // Stable per-RUN id — this is what makes a redelivered event a no-op.
    expect(arg.scopeKey).toBe('run_1')
  })

  it('leaves ARCHIVED ids out of scope', async () => {
    // An archived record is not a duplicate subject, and `archiveEntity` has
    // already deleted its open pairs.
    h.getRunManifest.mockResolvedValue(
      manifest({
        createdRecordIds: ['def_1:a'] as never,
        archivedRecordIds: ['def_1:z'] as never,
      })
    )
    await handleSyncDuplicateScan(connectorEvent())
    const arg = firstEnqueue()
    expect(arg.recordIds).toEqual(['def_1:a'])
  })

  it('NEVER claims the manifest', async () => {
    h.getRunManifest.mockResolvedValue(manifest({ createdRecordIds: ['def_1:a'] as never }))
    await handleSyncDuplicateScan(connectorEvent())
    expect(h.claimRunManifestConsumed).not.toHaveBeenCalled()
    expect(h.claimImportManifestConsumed).not.toHaveBeenCalled()
  })

  it('leaves the claim available to the record-rules handler', async () => {
    // The real failure mode this guards: both consumers run off ONE event, and
    // whichever claims first starves the other. Rules MUST win the claim.
    h.getRunManifest.mockResolvedValue(
      manifest({ changes: { 'def_1:c': { f1: { o: 1, n: 2 } } } as never })
    )
    h.getCachedRecordRules.mockResolvedValue([
      {
        id: 'rule_1',
        organizationId: 'org_1',
        entityDefinitionId: 'def_1',
        fieldId: 'f1',
        name: 'r',
        on: 'changed',
        condition: [],
        actions: [],
        enabled: true,
      },
    ])

    await handleSyncDuplicateScan(connectorEvent())
    await handleSyncRecordRules(connectorEvent())

    expect(h.claimRunManifestConsumed).toHaveBeenCalledTimes(1)
    expect(h.enqueueDuplicateScanForRecords).toHaveBeenCalledTimes(1)
  })

  it('bails before reading the manifest when the org lacks the feature', async () => {
    h.hasAccess.mockResolvedValue(false)
    await handleSyncDuplicateScan(connectorEvent())
    expect(h.getRunManifest).not.toHaveBeenCalled()
    expect(h.enqueueDuplicateScanForRecords).not.toHaveBeenCalled()
  })

  it('enqueues nothing when the manifest touched no records', async () => {
    h.getRunManifest.mockResolvedValue(manifest())
    await handleSyncDuplicateScan(connectorEvent())
    expect(h.enqueueDuplicateScanForRecords).not.toHaveBeenCalled()
  })

  it('bails on an unresolvable manifest instead of throwing', async () => {
    h.getRunManifest.mockResolvedValue(null)
    await expect(handleSyncDuplicateScan(connectorEvent())).resolves.toBeUndefined()
    expect(h.enqueueDuplicateScanForRecords).not.toHaveBeenCalled()
  })

  it('resolves an import manifest through the import reader', async () => {
    h.getImportManifest.mockResolvedValue(manifest({ createdRecordIds: ['def_1:a'] as never }))
    await handleSyncDuplicateScan({
      data: {
        type: 'sync:records:changed',
        data: { source: 'import', organizationId: 'org_1', importRef: 'imp_7' },
      },
    } as never)
    const arg = firstEnqueue()
    expect(arg.scopeKey).toBe('imp_7')
  })

  it('ignores events of other types', async () => {
    await handleSyncDuplicateScan({ data: { type: 'entity:created', data: {} } } as never)
    expect(h.getRunManifest).not.toHaveBeenCalled()
  })
})
