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
  runSyncFinalize: vi.fn<(db: unknown, input: Record<string, unknown>) => Promise<void>>(
    async () => {}
  ),
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
vi.mock('./sync-finalize', () => ({ runSyncFinalize: h.runSyncFinalize }))

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
    version: 2,
    detailTruncated: false,
    membershipTruncated: false,
    touched: {},
    deltas: {},
    createdRecordIds: [],
    archivedRecordIds: [],
    ...over,
  } as SyncChangeManifest
}

/** Tier-2 deltas plus the tier-1 `touched` entries a real collector derives from them. */
function fromDeltas(
  deltas: Record<string, Record<string, { o?: unknown; n: unknown }>>
): Partial<SyncChangeManifest> {
  const touched: Record<string, string[]> = {}
  for (const [rid, bucket] of Object.entries(deltas)) touched[rid] = Object.keys(bucket)
  return { touched, deltas } as never
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
      manifest(fromDeltas({ 'def_1:i1': { fld_status: { o: 'a', n: 'b' } } }))
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
      manifest(fromDeltas({ 'def_1:i1': { fld_status: { o: 'a', n: 'a' } } }))
    )
    h.getCachedRecordRules.mockResolvedValue([rule({ on: 'changed' })])
    await handleSyncRecordRules(connectorEvent() as never)
    expect(h.fireRecordRulesBatch).not.toHaveBeenCalled()
  })

  it('conditionless rule fires with no snapshot fetch', async () => {
    h.getRunManifest.mockResolvedValue(
      manifest(fromDeltas({ 'def_1:i1': { fld_status: { o: 'a', n: 'b' } } }))
    )
    h.getCachedRecordRules.mockResolvedValue([rule({ condition: [] })])
    await handleSyncRecordRules(connectorEvent() as never)
    expect(h.fetchResourceSnapshots).not.toHaveBeenCalled()
    expect(firstEvent().snapshot).toBeUndefined()
  })

  it('partial-snapshot fast path: condition refs all within changed keys → no fetch', async () => {
    h.getRunManifest.mockResolvedValue(
      manifest(fromDeltas({ 'def_1:i1': { fld_status: { o: 'a', n: 'b' } } }))
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
      manifest(fromDeltas({ 'def_1:i1': { fld_status: { o: 'a', n: 'b' } } }))
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
      manifest(fromDeltas({ 'def_1:i1': { fld_status: { o: 'a', n: 'b' } } }))
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
      manifest(fromDeltas({ 'def_1:i1': { fld_status: { o: 'a', n: 'b' } } }))
    )
    h.getCachedRecordRules.mockResolvedValue([rule({ on: 'changed' })])
    h.claimRunManifestConsumed.mockResolvedValue(false)
    await handleSyncRecordRules(connectorEvent() as never)
    expect(h.fireRecordRulesBatch).not.toHaveBeenCalled()
  })

  it('claims before firing on the happy path', async () => {
    h.getRunManifest.mockResolvedValue(
      manifest(fromDeltas({ 'def_1:i1': { fld_status: { o: 'a', n: 'b' } } }))
    )
    h.getCachedRecordRules.mockResolvedValue([rule({ on: 'changed' })])
    await handleSyncRecordRules(connectorEvent() as never)
    expect(h.claimRunManifestConsumed).toHaveBeenCalledWith({}, 'run_1')
    expect(h.fireRecordRulesBatch).toHaveBeenCalledTimes(1)
  })

  // ── Phase 4 finalize integration (plan events/03 §8) ─────────────────────────

  it('runs the finalize pass after rules fire, on the claimed manifest', async () => {
    const m = manifest(fromDeltas({ 'def_1:i1': { fld_status: { o: 'a', n: 'b' } } }))
    h.getRunManifest.mockResolvedValue(m)
    h.getCachedRecordRules.mockResolvedValue([rule({ on: 'changed' })])
    await handleSyncRecordRules(connectorEvent() as never)

    expect(h.runSyncFinalize).toHaveBeenCalledTimes(1)
    expect(h.runSyncFinalize.mock.calls[0]?.[1]).toMatchObject({
      organizationId: 'org_1',
      source: 'connector',
      ref: 'run_1',
      manifest: m,
    })
    // Claim before rules, rules before finalize.
    const claimOrder = h.claimRunManifestConsumed.mock.invocationCallOrder[0]!
    const fireOrder = h.fireRecordRulesBatch.mock.invocationCallOrder[0]!
    const finalizeOrder = h.runSyncFinalize.mock.invocationCallOrder[0]!
    expect(claimOrder).toBeLessThan(fireOrder)
    expect(fireOrder).toBeLessThan(finalizeOrder)
  })

  // The at-most-once contract covers finalize too: it inserts timeline rows, so a
  // redelivered event that loses the claim must skip it along with the rules.
  it('skips finalize on duplicate delivery (claim already taken)', async () => {
    h.getRunManifest.mockResolvedValue(
      manifest(fromDeltas({ 'def_1:i1': { fld_status: { o: 'a', n: 'b' } } }))
    )
    h.getCachedRecordRules.mockResolvedValue([rule({ on: 'changed' })])
    h.claimRunManifestConsumed.mockResolvedValue(false)
    await handleSyncRecordRules(connectorEvent() as never)
    expect(h.runSyncFinalize).not.toHaveBeenCalled()
  })

  it('skips finalize when the manifest is unresolvable', async () => {
    h.getRunManifest.mockResolvedValue(null)
    h.getCachedRecordRules.mockResolvedValue([rule()])
    await handleSyncRecordRules(connectorEvent() as never)
    expect(h.runSyncFinalize).not.toHaveBeenCalled()
    expect(h.claimRunManifestConsumed).not.toHaveBeenCalled()
  })

  // The claim moved ahead of the zero-rules bail: finalize must run exactly once per
  // run even when every rule was disabled between write and consume.
  it('still claims and finalizes when no rules are enabled', async () => {
    h.getRunManifest.mockResolvedValue(
      manifest(fromDeltas({ 'def_1:i1': { fld_status: { o: 'a', n: 'b' } } }))
    )
    h.getCachedRecordRules.mockResolvedValue([])
    await handleSyncRecordRules(connectorEvent() as never)
    expect(h.claimRunManifestConsumed).toHaveBeenCalledTimes(1)
    expect(h.fireRecordRulesBatch).not.toHaveBeenCalled()
    expect(h.runSyncFinalize).toHaveBeenCalledTimes(1)
  })

  it('handler still succeeds when finalize rejects (rules already fired)', async () => {
    h.getRunManifest.mockResolvedValue(
      manifest(fromDeltas({ 'def_1:i1': { fld_status: { o: 'a', n: 'b' } } }))
    )
    h.getCachedRecordRules.mockResolvedValue([rule({ on: 'changed' })])
    h.runSyncFinalize.mockRejectedValueOnce(new Error('finalize boom'))
    await expect(handleSyncRecordRules(connectorEvent() as never)).resolves.toBeUndefined()
    expect(h.fireRecordRulesBatch).toHaveBeenCalledTimes(1)
  })

  it('import source: finalize gets the importRef as its run ref', async () => {
    h.getCachedRecordRules.mockResolvedValue([rule()])
    h.getImportManifest.mockResolvedValue(
      manifest(fromDeltas({ 'def_1:i1': { fld_status: { o: 'a', n: 'b' } } }))
    )
    const evt = {
      data: {
        type: 'sync:records:changed',
        data: { source: 'import', organizationId: 'org_1', importRef: 'job_1' },
      },
    }
    await handleSyncRecordRules(evt as never)
    expect(h.runSyncFinalize.mock.calls[0]?.[1]).toMatchObject({ source: 'import', ref: 'job_1' })
  })

  // F6: a record created this run folds to an entry WITHOUT `o` — a `set` rule
  // (empty → value) must fire off that shape.
  it('fires a set rule for a created-this-run entry (no o)', async () => {
    h.getRunManifest.mockResolvedValue(
      manifest(fromDeltas({ 'def_1:i1': { fld_status: { n: 'b' } } }))
    )
    h.getCachedRecordRules.mockResolvedValue([rule({ on: 'set' })])
    await handleSyncRecordRules(connectorEvent() as never)
    expect(h.fireRecordRulesBatch).toHaveBeenCalledTimes(1)
    expect(firstEvent()).toMatchObject({ oldValue: undefined, newValue: 'b' })
  })

  // ── v1 → v2 read edge (one-release shim) ────────────────────────────────────

  it('upgrades a stored v1 manifest at the read edge — rules fire and finalize sees v2', async () => {
    h.getRunManifest.mockResolvedValue({
      version: 1,
      truncated: false,
      changes: { 'def_1:i1': { fld_status: { o: 'a', n: 'b' } } },
      createdRecordIds: [],
      archivedRecordIds: [],
    } as never)
    h.getCachedRecordRules.mockResolvedValue([rule({ on: 'changed' })])
    await handleSyncRecordRules(connectorEvent() as never)

    expect(h.fireRecordRulesBatch).toHaveBeenCalledTimes(1)
    expect(firstEvent()).toMatchObject({ oldValue: 'a', newValue: 'b' })
    // Finalize receives the UPGRADED v2 shape — touched derived from `changes`.
    const passed = h.runSyncFinalize.mock.calls[0]?.[1]?.manifest as SyncChangeManifest
    expect(passed.version).toBe(2)
    expect(passed.touched).toEqual({ 'def_1:i1': ['fld_status'] })
    expect(passed.deltas).toEqual({ 'def_1:i1': { fld_status: { o: 'a', n: 'b' } } })
    expect(passed.membershipTruncated).toBe(false)
  })

  // ── { source, ref } pointer shape ───────────────────────────────────────────

  it('prefers `ref` and resolves without the deprecated per-source fields', async () => {
    h.getRunManifest.mockResolvedValue(
      manifest(fromDeltas({ 'def_1:i1': { fld_status: { o: 'a', n: 'b' } } }))
    )
    h.getCachedRecordRules.mockResolvedValue([rule({ on: 'changed' })])
    const evt = {
      data: {
        type: 'sync:records:changed',
        data: { source: 'connector', organizationId: 'org_1', ref: 'run_9' },
      },
    }
    await handleSyncRecordRules(evt as never)
    expect(h.getRunManifest).toHaveBeenCalledWith({}, 'run_9')
    expect(h.claimRunManifestConsumed).toHaveBeenCalledWith({}, 'run_9')
    expect(h.runSyncFinalize.mock.calls[0]?.[1]).toMatchObject({ ref: 'run_9' })
  })
})
