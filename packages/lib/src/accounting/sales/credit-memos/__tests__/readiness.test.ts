// packages/lib/src/accounting/sales/credit-memos/__tests__/readiness.test.ts
//
// 88 D2: a channel memo is ready only when every receipt and every live,
// non-zero shipment dated on or before it holds a live posting - and the wait
// is named, a draft as a draft.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  applications: [] as Array<{ moneyTransactionId: string; operation: string }>,
  movements: new Map<string, { id: string; occurredAt: Date | null }>(),
  fulfillments: [] as Array<Record<string, unknown>>,
  posted: new Map<string, { status: string }>(),
  drafts: new Set<string>(),
}))

vi.mock('../../../money/reads', () => ({
  listOrderApplications: async () => h.applications,
  readMovements: async (_db: unknown, _org: string, ids: string[]) =>
    new Map(ids.filter((id) => h.movements.has(id)).map((id) => [id, h.movements.get(id)!])),
}))
vi.mock('../../fulfillments/reads', () => ({
  readFulfillmentsForOrder: async () => h.fulfillments,
}))
vi.mock('../../fulfillments/client', () => ({
  isLiveFulfillment: (row: { status: string }) => row.status !== 'cancelled',
}))
vi.mock('../../../ledger/reads/list-postings', () => ({
  findLiveSubjectPostings: async (
    _db: unknown,
    _org: string,
    options: { sourceIds: readonly string[] }
  ) =>
    new Map(options.sourceIds.filter((id) => h.posted.has(id)).map((id) => [id, h.posted.get(id)])),
  findPendingDraftPostings: async (
    _db: unknown,
    _org: string,
    options: { sourceIds: readonly string[] }
  ) => new Map(options.sourceIds.filter((id) => h.drafts.has(id)).map((id) => [id, {}])),
}))
vi.mock('../../../../cache', () => ({ requireCachedEntityDefId: async () => 'def' }))
vi.mock('../../../../resources/system-records', () => ({
  findSystemRecordIdsByValue: vi.fn(),
  readSystemRecords: vi.fn(),
  systemFieldMap: vi.fn(),
  systemFields: vi.fn(),
}))

import type { Database } from '@auxx/database'
import { readChannelMemoReadiness } from '../readiness'

const db = {} as Database
const input = {
  organizationId: 'org_1',
  orderInstanceId: 'ord_1',
  issuedAt: '2026-09-10',
  bookTimeZone: 'UTC',
  cutoffPeriod: '2026-01' as string | null,
}

function receipt(id: string, day: string) {
  h.applications.push({ moneyTransactionId: id, operation: 'apply' })
  h.movements.set(id, { id, occurredAt: new Date(`${day}T12:00:00.000Z`) })
}

function shipment(id: string, day: string, extra: Record<string, unknown> = {}) {
  h.fulfillments.push({
    id,
    status: 'success',
    shippedAt: `${day}T12:00:00.000Z`,
    totalMinor: 5000,
    glPosting: null,
    ...extra,
  })
}

beforeEach(() => {
  h.applications = []
  h.movements = new Map()
  h.fulfillments = []
  h.posted = new Map()
  h.drafts = new Set()
})

describe('readChannelMemoReadiness', () => {
  it('is ready when every earlier receipt and shipment has posted', async () => {
    receipt('mt_1', '2026-09-01')
    h.posted.set('mt_1', { status: 'posted' })
    shipment('ful_1', '2026-09-02', { glPosting: 'glp_1' })
    expect(await readChannelMemoReadiness(db, input)).toEqual({ ready: true })
  })

  it('waits on a receipt with no posting, naming it', async () => {
    receipt('mt_1', '2026-09-01')
    expect(await readChannelMemoReadiness(db, input)).toEqual({
      ready: false,
      reason: 'receipt mt_1 has no posting',
    })
  })

  it('names a receipt draft as a draft - the remedy is approval', async () => {
    receipt('mt_1', '2026-09-01')
    h.drafts.add('mt_1')
    expect(await readChannelMemoReadiness(db, input)).toEqual({
      ready: false,
      reason: 'receipt mt_1 is a draft awaiting approval',
    })
  })

  it('waits on an earlier shipment, and names its draft', async () => {
    shipment('ful_1', '2026-09-02')
    expect(await readChannelMemoReadiness(db, input)).toEqual({
      ready: false,
      reason: 'shipment ful_1 has no posting',
    })
    h.drafts.add('ful_1')
    expect(await readChannelMemoReadiness(db, input)).toEqual({
      ready: false,
      reason: 'shipment ful_1 is a draft awaiting approval',
    })
  })

  it('ignores a later shipment, a $0 one and a cancelled one', async () => {
    shipment('ful_after', '2026-09-11')
    shipment('ful_free', '2026-09-02', { totalMinor: 0 })
    shipment('ful_gone', '2026-09-02', { status: 'cancelled' })
    expect(await readChannelMemoReadiness(db, input)).toEqual({ ready: true })
  })

  it('treats a receipt or shipment in or before the opening cutoff as in the books', async () => {
    receipt('mt_opening', '2026-01-15')
    shipment('ful_opening', '2026-01-20')
    expect(await readChannelMemoReadiness(db, input)).toEqual({ ready: true })
    expect(await readChannelMemoReadiness(db, { ...input, cutoffPeriod: null })).toEqual({
      ready: false,
      reason: 'receipt mt_opening has no posting',
    })
  })

  it('ignores a receipt dated after the memo', async () => {
    receipt('mt_late', '2026-09-12')
    expect(await readChannelMemoReadiness(db, input)).toEqual({ ready: true })
  })
})
