// packages/lib/src/resources/crud/__tests__/tx-write-flush-dispatch.test.ts
//
// plans/events/10 §4.3: the flush projects the committed scope into `dispatchFieldChanges`
// and hands the in-tx marks to the SAME dirty-parent scope, so a document marked in-tx and
// by a hook rebuilds once. Boundaries mocked as in tx-write-scope.test.ts.

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DispatchInput, DispatchReport } from '../../../field-hooks/dispatch'

const h = vi.hoisted(() => ({
  publish: vi.fn<(room: unknown, event: string, data?: unknown) => Promise<void>>(async () => {}),
  publishFieldValueUpdates: vi.fn(async () => {}),
  publishRecordsInvalidated: vi.fn(async () => {}),
  enqueueDuplicateScan: vi.fn(async () => 'job_1'),
  getEntityInstance: vi.fn(async () => ok({ id: 'inv_1', displayName: 'Invoice 1' })),
  findCachedResource: vi.fn(async () => ({ fields: [] })),
  publishLater: vi.fn(() => {}),
  dispatchFieldChanges: vi.fn<(input: DispatchInput) => Promise<DispatchReport>>(async (input) => ({
    lane: input.lane,
    handlers: {},
    changes: 0,
    degraded: 0,
  })),
}))

vi.mock('../../../realtime', () => ({
  getRealtimeService: () => ({ publish: h.publish }),
  rooms: { orgRecords: (org: string, def: string) => `records:${org}:${def}` },
  publishFieldValueUpdates: h.publishFieldValueUpdates,
  publishRecordsInvalidated: h.publishRecordsInvalidated,
}))
vi.mock('../../../events/publisher', () => ({
  publisher: { publishLater: h.publishLater, publish: h.publishLater },
}))
vi.mock('../../../dedup/enqueue-scan', () => ({ enqueueDuplicateScan: h.enqueueDuplicateScan }))
vi.mock('../../../cache', () => ({ findCachedResource: h.findCachedResource }))
vi.mock('../../../entity-instances', () => ({
  getEntityInstance: h.getEntityInstance,
}))
vi.mock('../../../field-hooks/dispatch', () => ({
  dispatchFieldChanges: h.dispatchFieldChanges,
}))

import type { RecordId } from '@auxx/types/resource'
import {
  __resetReconcilersForTest,
  markParentDirty,
  registerReconciler,
} from '../../../reconcilers/dirty-parents'
import { flushTxWriteScope } from '../tx-write-flush'
import {
  createTxWriteScope,
  recordTxWriteArchive,
  recordTxWriteChange,
  recordTxWriteCreate,
  type TxWriteScope,
} from '../tx-write-scope'

const ORG = 'org_1'
const USER = 'user_1'
const INVOICE_DEF = 'def_invoice'
const LINE_DEF = 'def_line_item'

function lastInput(): DispatchInput {
  const call = h.dispatchFieldChanges.mock.calls.at(-1)
  if (!call) throw new Error('dispatchFieldChanges was not called')
  return call[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetReconcilersForTest()
})

describe('flushTxWriteScope → dispatchFieldChanges', () => {
  it('projects a create as one change per written key, with o: null and isCreate', async () => {
    const scope = createTxWriteScope(ORG, USER)
    recordTxWriteCreate(scope, {
      recordId: `${INVOICE_DEF}:inv_1` as RecordId,
      entityDefinitionId: INVOICE_DEF,
      entityType: 'invoice',
      entitySlug: 'invoices',
      values: { invoice_total: 4000, invoice_status: 'draft' },
    })

    await flushTxWriteScope(scope)

    const input = lastInput()
    expect(input.lane).toBe('buffered')
    expect(input.organizationId).toBe(ORG)
    expect(input.userId).toBe(USER)
    expect(input.degraded).toBeUndefined()
    expect(input.changes).toEqual([
      {
        recordId: `${INVOICE_DEF}:inv_1`,
        outputKey: 'invoice_total',
        o: null,
        n: 4000,
        isCreate: true,
      },
      {
        recordId: `${INVOICE_DEF}:inv_1`,
        outputKey: 'invoice_status',
        o: null,
        n: 'draft',
        isCreate: true,
      },
    ])
  })

  it('passes a change bucket verbatim and drops T-1 changes on a created record', async () => {
    const scope = createTxWriteScope(ORG, USER)
    recordTxWriteCreate(scope, {
      recordId: `${INVOICE_DEF}:inv_1` as RecordId,
      entityDefinitionId: INVOICE_DEF,
      entityType: 'invoice',
      entitySlug: 'invoices',
      values: { invoice_total: 4000 },
    })
    // Same record, the OTHER keyspace — T-1 matches on the instance id.
    recordTxWriteChange(scope, {
      recordId: 'invoice:inv_1' as RecordId,
      outputKey: 'invoice_status',
      change: { o: 'draft', n: 'sent' },
    })
    recordTxWriteChange(scope, {
      recordId: `${LINE_DEF}:line_1` as RecordId,
      outputKey: 'line_item_qty',
      change: { o: 1, n: 2 },
    })

    await flushTxWriteScope(scope)

    expect(lastInput().changes).toEqual([
      {
        recordId: `${INVOICE_DEF}:inv_1`,
        outputKey: 'invoice_total',
        o: null,
        n: 4000,
        isCreate: true,
      },
      { recordId: `${LINE_DEF}:line_1`, outputKey: 'line_item_qty', o: 1, n: 2 },
    ])
  })

  it('a truncated scope degrades to every touched record, with no changes', async () => {
    const scope = createTxWriteScope(ORG, USER)
    recordTxWriteCreate(scope, {
      recordId: `${INVOICE_DEF}:inv_1` as RecordId,
      entityDefinitionId: INVOICE_DEF,
      entityType: 'invoice',
      entitySlug: 'invoices',
      values: { invoice_total: 4000 },
    })
    recordTxWriteChange(scope, {
      recordId: `${LINE_DEF}:line_1` as RecordId,
      outputKey: 'line_item_qty',
      change: { o: 1, n: 2 },
    })
    recordTxWriteArchive(scope, {
      recordId: `${LINE_DEF}:line_2` as RecordId,
      entityDefinitionId: LINE_DEF,
      entityType: 'line_item',
      entitySlug: 'line-items',
      realtimeEvent: 'record:archived',
      eventData: {},
    })
    scope.truncated = true

    await flushTxWriteScope(scope)

    const input = lastInput()
    expect(input.changes).toEqual([])
    expect(input.degraded).toEqual([
      `${INVOICE_DEF}:inv_1`,
      `${LINE_DEF}:line_1`,
      `${LINE_DEF}:line_2`,
    ])
  })

  it('does not dispatch when the scope buffered nothing', async () => {
    await flushTxWriteScope(createTxWriteScope(ORG, USER))
    expect(h.dispatchFieldChanges).not.toHaveBeenCalled()
  })

  it('coalesces in-tx marks with the hooks own marks into ONE drain', async () => {
    const drains: string[][] = []
    registerReconciler('totals', async ({ parentInstanceIds }) => {
      drains.push(parentInstanceIds)
    })
    // What a mark handler does once the dispatch reaches it.
    h.dispatchFieldChanges.mockImplementationOnce(async (input) => {
      markParentDirty('totals', 'doc_from_hook')
      return { lane: input.lane, handlers: {}, changes: 0, degraded: 0 }
    })

    const scope = createTxWriteScope(ORG, USER) as TxWriteScope
    scope.dirtyParents.set('totals', new Set(['doc_from_tx']))
    recordTxWriteChange(scope, {
      recordId: `${LINE_DEF}:line_1` as RecordId,
      outputKey: 'line_item_qty',
      change: { o: 1, n: 2 },
    })

    await flushTxWriteScope(scope)

    expect(drains).toEqual([['doc_from_hook', 'doc_from_tx']])
  })

  it('drains in-tx marks even when there is nothing to dispatch', async () => {
    const drains: string[][] = []
    registerReconciler('totals', async ({ parentInstanceIds }) => {
      drains.push(parentInstanceIds)
    })

    const scope = createTxWriteScope(ORG, USER)
    scope.dirtyParents.set('totals', new Set(['doc_from_tx']))

    await flushTxWriteScope(scope)

    expect(drains).toEqual([['doc_from_tx']])
  })
})
