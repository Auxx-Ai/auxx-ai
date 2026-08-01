// packages/lib/src/events/handlers/handle-sync-record-rules.test.ts
// The B2 sync manifest consumer: manifest → transition-matched firings with source
// 'sync', partial-snapshot fast path vs bulk-fetch fallback, lifecycle, source
// resolution, no-manifest bail. Boundaries (db/cache/engine/fetcher) mocked; the pure
// transition + condition-ref + resolver helpers run for real.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { legacyActionTextToDoc } from '../../record-rules/client'
import type { SyncChangeManifest } from '../../record-rules/sync-manifest-types'
import type {
  CachedRecordRule,
  RecordRuleBatchContext,
  RecordRuleBatchEvent,
} from '../../record-rules/types'

const h = vi.hoisted(() => ({
  getRunManifest: vi.fn<() => Promise<SyncChangeManifest | null>>(),
  claimRunManifestConsumed: vi.fn(async () => true),
  getImportManifest: vi.fn<() => Promise<SyncChangeManifest | null>>(),
  claimImportManifestConsumed: vi.fn(async () => true),
  getCachedRecordRules: vi.fn<() => Promise<CachedRecordRule[]>>(),
  getCachedResourceFields: vi.fn(async () => [
    { id: 'fld_status', key: 'fld_status', systemAttribute: null },
    { id: 'fld_priority', key: 'fld_priority', systemAttribute: null },
  ]),
  fireRecordRulesBatch: vi.fn<
    (rules: CachedRecordRule[], ctx: RecordRuleBatchContext) => Promise<void>
  >(async () => {}),
  fetchResourceSnapshots: vi.fn(async () => new Map()),
}))

vi.mock('@auxx/database', () => ({ database: {} }))
vi.mock('../../data-connectors/service', () => ({
  getRunManifest: h.getRunManifest,
  claimRunManifestConsumed: h.claimRunManifestConsumed,
}))
vi.mock('../../import', () => ({
  getImportManifest: h.getImportManifest,
  claimImportManifestConsumed: h.claimImportManifestConsumed,
}))
vi.mock('../../cache', () => ({
  getCachedRecordRules: h.getCachedRecordRules,
  getCachedResourceFields: h.getCachedResourceFields,
}))
vi.mock('../../record-rules/engine', () => ({ fireRecordRulesBatch: h.fireRecordRulesBatch }))
vi.mock('../../record-rules/snapshot-fetcher', () => ({
  fetchResourceSnapshots: h.fetchResourceSnapshots,
}))

import { handleSyncRecordRules } from './handle-sync-record-rules'

function rule(overrides: Partial<CachedRecordRule> = {}): CachedRecordRule {
  return {
    id: 'rule_1',
    organizationId: 'org_1',
    entityDefinitionId: 'def_1',
    fieldId: 'fld_status',
    name: 'r',
    on: 'changed',
    condition: [],
    actions: [{ type: 'notify', userIds: ['u1'], message: legacyActionTextToDoc('hi') }],
    enabled: true,
    ...overrides,
  }
}

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

function connectorEvent(): { data: any } {
  return {
    data: {
      type: 'sync:records:changed',
      data: {
        source: 'connector',
        organizationId: 'org_1',
        runId: 'run_1',
      },
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.fetchResourceSnapshots.mockResolvedValue(new Map())
  h.claimRunManifestConsumed.mockResolvedValue(true)
  h.claimImportManifestConsumed.mockResolvedValue(true)
})

/** Arguments of the first fireRecordRulesBatch call, asserted present. */
function firstCall(): [CachedRecordRule[], RecordRuleBatchContext] {
  const call = h.fireRecordRulesBatch.mock.calls[0]
  if (!call) throw new Error('fireRecordRulesBatch was never called')
  return call
}

/** First event of the first fireRecordRulesBatch call. */
function firstEvent(): RecordRuleBatchEvent {
  const event = firstCall()[1].events[0]
  if (!event) throw new Error('fireRecordRulesBatch was called with an empty event batch')
  return event
}

describe('handleSyncRecordRules', () => {
  it('bails (no fire) when the manifest is unresolvable', async () => {
    h.getRunManifest.mockResolvedValue(null)
    h.getCachedRecordRules.mockResolvedValue([rule()])
    await handleSyncRecordRules(connectorEvent() as never)
    expect(h.fireRecordRulesBatch).not.toHaveBeenCalled()
  })

  it('fires a matched field transition with source: sync and {o,n}', async () => {
    h.getRunManifest.mockResolvedValue(
      manifest({ changes: { 'def_1:i1': { fld_status: { o: 'a', n: 'b' } } } as never })
    )
    h.getCachedRecordRules.mockResolvedValue([rule({ on: 'changed' })])
    await handleSyncRecordRules(connectorEvent() as never)

    expect(h.fireRecordRulesBatch).toHaveBeenCalledTimes(1)
    const [rules, ctx] = firstCall()
    expect(rules).toHaveLength(1)
    expect(ctx).toMatchObject({ source: 'sync', entityDefinitionId: 'def_1' })
    expect(ctx.events).toHaveLength(1)
    expect(ctx.events[0]).toMatchObject({
      entityInstanceId: 'i1',
      fieldId: 'fld_status',
      oldValue: 'a',
      newValue: 'b',
    })
  })

  it('does not fire when the transition does not match', async () => {
    h.getRunManifest.mockResolvedValue(
      manifest({ changes: { 'def_1:i1': { fld_status: { o: 'a', n: 'a' } } } as never })
    )
    h.getCachedRecordRules.mockResolvedValue([rule({ on: 'changed' })])
    await handleSyncRecordRules(connectorEvent() as never)
    expect(h.fireRecordRulesBatch).not.toHaveBeenCalled()
  })

  it('conditionless rule fires with no snapshot fetch', async () => {
    h.getRunManifest.mockResolvedValue(
      manifest({ changes: { 'def_1:i1': { fld_status: { o: 'a', n: 'b' } } } as never })
    )
    h.getCachedRecordRules.mockResolvedValue([rule({ condition: [] })])
    await handleSyncRecordRules(connectorEvent() as never)
    expect(h.fetchResourceSnapshots).not.toHaveBeenCalled()
    expect(firstEvent().snapshot).toBeUndefined()
  })

  it('partial-snapshot fast path: condition refs all within changed keys → no fetch', async () => {
    h.getRunManifest.mockResolvedValue(
      manifest({ changes: { 'def_1:i1': { fld_status: { o: 'a', n: 'b' } } } as never })
    )
    h.getCachedRecordRules.mockResolvedValue([
      rule({
        condition: [
          {
            id: 'g',
            logicalOperator: 'AND',
            conditions: [{ id: 'c', fieldId: 'fld_status', operator: 'is', value: 'b' }],
          },
        ] as never,
      }),
    ])
    await handleSyncRecordRules(connectorEvent() as never)
    expect(h.fetchResourceSnapshots).not.toHaveBeenCalled()
    expect(h.fireRecordRulesBatch).toHaveBeenCalledTimes(1)
    expect(firstEvent().snapshot).toMatchObject({
      id: 'i1',
      fieldValues: { fld_status: 'b' },
    })
  })

  it('bulk-fetch fallback: condition references an unchanged field → fetch once', async () => {
    h.getRunManifest.mockResolvedValue(
      manifest({ changes: { 'def_1:i1': { fld_status: { o: 'a', n: 'b' } } } as never })
    )
    h.fetchResourceSnapshots.mockResolvedValue(
      new Map([['def_1:i1', { id: 'i1', entityDefinitionId: 'def_1', fieldValues: {} }]]) as never
    )
    h.getCachedRecordRules.mockResolvedValue([
      rule({
        condition: [
          {
            id: 'g',
            logicalOperator: 'AND',
            conditions: [{ id: 'c', fieldId: 'fld_priority', operator: 'is', value: 'high' }],
          },
        ] as never,
      }),
    ])
    await handleSyncRecordRules(connectorEvent() as never)
    expect(h.fetchResourceSnapshots).toHaveBeenCalledTimes(1)
  })

  it('lifecycle created: fires created rules for created ids', async () => {
    h.getRunManifest.mockResolvedValue(manifest({ createdRecordIds: ['def_1:i9'] as never }))
    h.getCachedRecordRules.mockResolvedValue([rule({ fieldId: null, on: 'created' })])
    await handleSyncRecordRules(connectorEvent() as never)
    expect(h.fireRecordRulesBatch).toHaveBeenCalledTimes(1)
    expect(h.fireRecordRulesBatch.mock.calls[0]?.[1]).toMatchObject({ source: 'sync' })
    expect(firstEvent()).toMatchObject({ entityInstanceId: 'i9' })
  })

  it('lifecycle archived: always bulk-fetches a snapshot for deleted rules', async () => {
    h.getRunManifest.mockResolvedValue(manifest({ archivedRecordIds: ['def_1:i8'] as never }))
    h.fetchResourceSnapshots.mockResolvedValue(
      new Map([['def_1:i8', { id: 'i8', entityDefinitionId: 'def_1', fieldValues: {} }]]) as never
    )
    h.getCachedRecordRules.mockResolvedValue([rule({ fieldId: null, on: 'deleted' })])
    await handleSyncRecordRules(connectorEvent() as never)
    expect(h.fetchResourceSnapshots).toHaveBeenCalledTimes(1)
    expect(firstEvent().snapshot).toMatchObject({ id: 'i8' })
  })

  it('import source: reads the manifest off the ImportJob row via importRef', async () => {
    h.getCachedRecordRules.mockResolvedValue([rule()])
    h.getImportManifest.mockResolvedValue(
      manifest({ changes: { 'def_1:i1': { fld_status: { o: 'a', n: 'b' } } } as never })
    )
    const evt = {
      data: {
        type: 'sync:records:changed',
        data: { source: 'import', organizationId: 'org_1', importRef: 'job_1' },
      },
    }
    await handleSyncRecordRules(evt as never)
    expect(h.getRunManifest).not.toHaveBeenCalled()
    expect(h.getImportManifest).toHaveBeenCalledWith({}, 'job_1')
    expect(h.claimImportManifestConsumed).toHaveBeenCalledWith({}, 'job_1')
    expect(h.fireRecordRulesBatch).toHaveBeenCalledTimes(1)
  })

  // F3: exactly one delivery may fire — a lost claim means a duplicate (re-published
  // finalize or redelivered handler job) and must no-op without firing anything.
  it('does not fire when the consume claim is already taken', async () => {
    h.getRunManifest.mockResolvedValue(
      manifest({ changes: { 'def_1:i1': { fld_status: { o: 'a', n: 'b' } } } as never })
    )
    h.getCachedRecordRules.mockResolvedValue([rule({ on: 'changed' })])
    h.claimRunManifestConsumed.mockResolvedValue(false)
    await handleSyncRecordRules(connectorEvent() as never)
    expect(h.fireRecordRulesBatch).not.toHaveBeenCalled()
  })

  it('claims before firing on the happy path', async () => {
    h.getRunManifest.mockResolvedValue(
      manifest({ changes: { 'def_1:i1': { fld_status: { o: 'a', n: 'b' } } } as never })
    )
    h.getCachedRecordRules.mockResolvedValue([rule({ on: 'changed' })])
    await handleSyncRecordRules(connectorEvent() as never)
    expect(h.claimRunManifestConsumed).toHaveBeenCalledWith({}, 'run_1')
    expect(h.fireRecordRulesBatch).toHaveBeenCalledTimes(1)
  })

  // F6: a record created this run folds to an entry WITHOUT `o` — a `set` rule
  // (empty → value) must fire off that shape.
  it('fires a set rule for a created-this-run entry (no o)', async () => {
    h.getRunManifest.mockResolvedValue(
      manifest({ changes: { 'def_1:i1': { fld_status: { n: 'b' } } } as never })
    )
    h.getCachedRecordRules.mockResolvedValue([rule({ on: 'set' })])
    await handleSyncRecordRules(connectorEvent() as never)
    expect(h.fireRecordRulesBatch).toHaveBeenCalledTimes(1)
    expect(firstEvent()).toMatchObject({ oldValue: undefined, newValue: 'b' })
  })
})
