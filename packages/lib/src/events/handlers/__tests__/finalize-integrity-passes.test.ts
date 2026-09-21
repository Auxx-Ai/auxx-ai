// packages/lib/src/events/handlers/__tests__/finalize-integrity-passes.test.ts
//
// plans/events/10 §4.4: the sync finalize projects its manifest onto `dispatchFieldChanges`
// and runs the two membership-keyed passes after it. What each handler then DOES is covered
// beside its own core (geocoding, phone-geo, interactions, sales/totals) and in
// field-hooks/__tests__/dispatch.test.ts. Boundaries are mocked with plain synchronous
// factories — the lazy imports mean the real modules are never loaded.

import type { RecordId } from '@auxx/types/resource'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DispatchChange, DispatchReport } from '../../../field-hooks/dispatch'
import type { SyncChangeManifest } from '../../../record-rules/sync-manifest-types'

const h = vi.hoisted(() => ({
  findCachedResource: vi.fn(),
  dispatchFieldChanges: vi.fn(),
  markOrStampOrderLine: vi.fn(async (_organizationId: string, _lineInstanceId: string) => {}),
  fulfillmentPostingTriggerPass: vi.fn(
    async (
      _db: unknown,
      _organizationId: string,
      _manifest: unknown,
      _resolveDef: (id: string) => Promise<{ entityType: string | null } | null>
    ) => {}
  ),
  reconcileFinancialRecordsAfterBulk: vi.fn(
    async (_db: unknown, _organizationId: string, _manifest: unknown) => {}
  ),
}))

vi.mock('../../../cache', () => ({ findCachedResource: h.findCachedResource }))
vi.mock('../../../field-hooks/dispatch', () => ({
  dispatchFieldChanges: h.dispatchFieldChanges,
}))
// Pass-through: the real scope is covered by reconcilers/__tests__/dirty-parents.test.ts, and
// what matters here is that both markers run inside ONE call.
vi.mock('../../../reconcilers/dirty-parents', () => ({
  runWithDirtyParents: vi.fn((_organizationId: string, _userId: string, fn: () => Promise<void>) =>
    fn()
  ),
}))
vi.mock('../../../inventory/builds/drift-reconciler', () => ({
  markOrStampOrderLine: h.markOrStampOrderLine,
}))
vi.mock('../passes/fulfillment-log-pass', () => ({
  fulfillmentPostingTriggerPass: h.fulfillmentPostingTriggerPass,
}))
vi.mock('../../../accounting/money/customer-money/record-events', () => ({
  reconcileFinancialRecordsAfterBulk: h.reconcileFinancialRecordsAfterBulk,
}))

import { runIntegrityPasses } from '../finalize-integrity-passes'

const ORG = 'org_1'
const DB = { tag: 'db' } as never

const RESOURCES = [
  { entityDefinitionId: 'def_li', entityType: 'line_item', apiSlug: 'line-items' },
  { entityDefinitionId: 'def_contact', entityType: 'contact', apiSlug: 'contacts' },
  { entityDefinitionId: 'def_order', entityType: 'order', apiSlug: 'orders' },
]

const EMPTY_REPORT: DispatchReport = { lane: 'sync', handlers: {}, changes: 0, degraded: 0 }

/** `touched` is keyed by RecordId; the literals here are plain strings, hence the one cast. */
function manifest(
  overrides: Partial<Omit<SyncChangeManifest, 'touched'>> & {
    touched?: Record<string, string[] | 1>
  } = {}
): SyncChangeManifest {
  return {
    version: 2,
    detailTruncated: false,
    membershipTruncated: false,
    touched: {},
    deltas: {},
    createdRecordIds: [],
    archivedRecordIds: [],
    ...overrides,
  } as unknown as SyncChangeManifest
}

function run(m: SyncChangeManifest) {
  return runIntegrityPasses(DB, { organizationId: ORG, manifest: m })
}

/** The one dispatch call's input. */
function dispatched(): { changes: DispatchChange[]; degraded: RecordId[]; lane: string } {
  return h.dispatchFieldChanges.mock.calls[0]?.[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  h.findCachedResource.mockImplementation(async (_org: string, key: string) => {
    return (
      RESOURCES.find(
        (r) => r.entityDefinitionId === key || r.entityType === key || r.apiSlug === key
      ) ?? null
    )
  })
  h.dispatchFieldChanges.mockResolvedValue(EMPTY_REPORT)
})

describe('manifest projection', () => {
  it('turns each touched key into one valueless change on the sync lane', async () => {
    await run(
      manifest({
        touched: {
          'def_li:li1': ['line_item_qty', 'line_item_unit_price'],
          'def_contact:c1': ['primary_email'],
        },
      })
    )

    expect(h.dispatchFieldChanges).toHaveBeenCalledTimes(1)
    const input = dispatched()
    expect(input.lane).toBe('sync')
    expect(input.changes).toEqual([
      { recordId: 'def_li:li1', outputKey: 'line_item_qty' },
      { recordId: 'def_li:li1', outputKey: 'line_item_unit_price' },
      { recordId: 'def_contact:c1', outputKey: 'primary_email' },
    ])
    // Tier-2 `deltas` are never read — a rule-gated value would under-select (bug B-1).
    expect(input.changes.every((c) => !('o' in c) && !('n' in c))).toBe(true)
  })

  it('sends an ids-only record as degraded, never as a change', async () => {
    await run(manifest({ touched: { 'def_contact:c9': 1, 'def_contact:c1': ['phone'] } }))

    const input = dispatched()
    expect(input.degraded).toEqual(['def_contact:c9'])
    expect(input.changes).toEqual([{ recordId: 'def_contact:c1', outputKey: 'phone' }])
  })

  it('hands the whole run over in ONE dispatch call', async () => {
    await run(
      manifest({
        touched: {
          'def_li:li1': ['line_item_qty'],
          'def_li:li2': ['line_item_qty'],
          'def_contact:c1': 1,
        },
      })
    )

    expect(h.dispatchFieldChanges).toHaveBeenCalledTimes(1)
  })

  it('dispatches nothing for an empty manifest, and runs no pass', async () => {
    await run(manifest())

    expect(h.dispatchFieldChanges).not.toHaveBeenCalled()
    expect(h.fulfillmentPostingTriggerPass).not.toHaveBeenCalled()
    expect(h.reconcileFinancialRecordsAfterBulk).not.toHaveBeenCalled()
  })

  it('still runs for a created-only manifest — the fulfillment pass reads that tier', async () => {
    await run(manifest({ createdRecordIds: ['def_li:li1' as RecordId] }))

    expect(h.dispatchFieldChanges).toHaveBeenCalledTimes(1)
    expect(dispatched().changes).toEqual([])
    expect(h.fulfillmentPostingTriggerPass).toHaveBeenCalledTimes(1)
  })
})

describe('archived lines', () => {
  it('marks an archived line so the drift reconciler resolves its order', async () => {
    await run(manifest({ archivedRecordIds: ['def_li:l7' as RecordId] }))

    expect(h.markOrStampOrderLine).toHaveBeenCalledTimes(1)
    expect(h.markOrStampOrderLine).toHaveBeenCalledWith(ORG, 'l7')
  })

  it('ignores an archived record that is not a line item', async () => {
    await run(manifest({ archivedRecordIds: ['def_order:ord_1' as RecordId] }))

    expect(h.markOrStampOrderLine).not.toHaveBeenCalled()
  })

  it('marks inside the same scope as the dispatch, after it', async () => {
    await run(
      manifest({
        touched: { 'def_li:li1': ['line_item_qty'] },
        archivedRecordIds: ['def_li:l7' as RecordId],
      })
    )

    expect(h.dispatchFieldChanges.mock.invocationCallOrder[0]!).toBeLessThan(
      h.markOrStampOrderLine.mock.invocationCallOrder[0]!
    )
  })
})

describe('the two hand-written passes', () => {
  it('both run, and both AFTER the dispatch (evidence rows before the lanes that read them)', async () => {
    await run(manifest({ touched: { 'def_li:li1': ['line_item_qty'] } }))

    expect(h.fulfillmentPostingTriggerPass).toHaveBeenCalledTimes(1)
    expect(h.reconcileFinancialRecordsAfterBulk).toHaveBeenCalledWith(DB, ORG, expect.anything())
    expect(h.dispatchFieldChanges.mock.invocationCallOrder[0]!).toBeLessThan(
      h.fulfillmentPostingTriggerPass.mock.invocationCallOrder[0]!
    )
    expect(h.fulfillmentPostingTriggerPass.mock.invocationCallOrder[0]!).toBeLessThan(
      h.reconcileFinancialRecordsAfterBulk.mock.invocationCallOrder[0]!
    )
  })

  it('hands the fulfillment pass a resolver that resolves each def at most once', async () => {
    await run(
      manifest({
        touched: { 'def_li:li1': ['line_item_qty'], 'def_li:li2': ['line_item_qty'] },
        archivedRecordIds: ['def_li:l7' as RecordId, 'def_li:l8' as RecordId],
      })
    )

    expect(h.findCachedResource).toHaveBeenCalledTimes(1)
    const resolveDef = h.fulfillmentPostingTriggerPass.mock.calls[0]![3]
    await expect(resolveDef('def_li')).resolves.toEqual({ entityType: 'line_item' })
  })
})

describe('never throws', () => {
  it('a throwing dispatch does not fail the run, and does not stop the passes', async () => {
    h.dispatchFieldChanges.mockRejectedValueOnce(new Error('boom'))

    await expect(
      run(manifest({ touched: { 'def_li:li1': ['line_item_qty'] } }))
    ).resolves.toBeUndefined()
  })

  it('a throwing mark does not fail the run', async () => {
    h.markOrStampOrderLine.mockRejectedValueOnce(new Error('boom'))

    await expect(
      run(manifest({ archivedRecordIds: ['def_li:l7' as RecordId] }))
    ).resolves.toBeUndefined()
    expect(h.fulfillmentPostingTriggerPass).toHaveBeenCalledTimes(1)
  })

  it('a throwing pass does not fail the run', async () => {
    h.reconcileFinancialRecordsAfterBulk.mockRejectedValueOnce(new Error('boom'))

    await expect(
      run(manifest({ touched: { 'def_li:li1': ['line_item_qty'] } }))
    ).resolves.toBeUndefined()
  })

  it('a record whose def cannot be resolved is skipped, not thrown on', async () => {
    h.findCachedResource.mockResolvedValue(null)

    await expect(
      run(manifest({ archivedRecordIds: ['mystery:m1' as RecordId] }))
    ).resolves.toBeUndefined()
    expect(h.markOrStampOrderLine).not.toHaveBeenCalled()
  })
})
