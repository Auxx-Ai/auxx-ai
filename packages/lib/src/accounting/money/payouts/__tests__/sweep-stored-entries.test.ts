// packages/lib/src/accounting/money/payouts/__tests__/sweep-stored-entries.test.ts
//
// 110 G7: the never-tried list is SQL, so the fake db answers it and the tests pin its
// predicates on the rendered query; `handle` is exercised through the real sweep frame.

import type { Database } from '@auxx/database'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  fresh: [] as string[],
  queries: [] as Array<{ sql: string; params: unknown[] }>,
  records: {} as Record<string, { gatewayId: string; railId: string }>,
  repostStoredPayout: vi.fn(),
  upsertWorkItem: vi.fn(),
}))

const fields = Object.fromEntries(
  [
    'payout_status',
    'payout_paid_at',
    'payout_gateway_id',
    'payout_payment_gateway',
    'payout_number',
  ].map((attribute) => [attribute, { id: `fld_${attribute}` }])
)
vi.mock('../fields', () => ({
  loadPayoutFieldContext: async () => ({ defId: 'def_payout', fields }),
}))
vi.mock('../../../../settings/read', () => ({
  readOrganizationSettings: async () => ({ 'accounting.cutoffPeriod': '2026-03' }),
}))
vi.mock('../../../rails/reads', () => ({
  listPaymentGateways: async () =>
    ok([
      { id: 'pg_shop', settlementSource: 'shopify_payments' },
      { id: 'pg_manual', settlementSource: 'manual' },
    ]),
}))
vi.mock('../source-registry', async () => {
  const { err, ok } = await import('neverthrow')
  return {
    getPayoutSource: (id: string) =>
      id === 'shopify_payments' ? ok({ id }) : err(new Error(`No payout source "${id}"`)),
  }
})
vi.mock('../../../../resources/system-records', () => ({
  readSystemRecords: async (
    _db: unknown,
    _org: string,
    _ctx: unknown,
    options: { ids: string[] }
  ) =>
    options.ids.flatMap((id) => {
      const record = h.records[id]
      if (!record) return []
      return [
        {
          id,
          text: (attribute: string) =>
            attribute === 'payout_gateway_id' ? record.gatewayId : null,
          related: (attribute: string) =>
            attribute === 'payout_payment_gateway' ? record.railId : null,
        },
      ]
    }),
}))
vi.mock('../sync', () => ({ repostStoredPayout: h.repostStoredPayout }))
vi.mock('../../../work-items/write', () => ({ upsertWorkItem: h.upsertWorkItem }))
vi.mock('../../../work-items/realtime', () => ({ publishAccountingWork: async () => {} }))

import { sweepStoredPayoutEntries } from '../sweep-stored-entries'

const dialect = new PgDialect()
// First `execute` is the never-tried list; the frame's due-row read goes through `select`.
const db = {
  execute: async (query: SQL) => {
    h.queries.push(dialect.sqlToQuery(query))
    return { rows: h.fresh.map((id) => ({ id })) }
  },
  select: () => ({
    from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [] }) }) }),
  }),
} as unknown as Database

beforeEach(() => {
  vi.clearAllMocks()
  h.queries = []
  h.fresh = []
  h.records = {}
  h.repostStoredPayout.mockResolvedValue(ok({ status: 'posted' }))
})

describe('sweepStoredPayoutEntries', () => {
  it('lists only paid payouts after the cutover with no live posting, oldest first', async () => {
    await sweepStoredPayoutEntries(db, { organizationId: 'org_1' })
    const [list] = h.queries
    expect(list?.params).toEqual(expect.arrayContaining(['2026-03', 'fld_payout_paid_at']))
    expect(list?.sql).toContain(`to_char(pa."valueDate" AT TIME ZONE 'UTC', 'YYYY-MM') >`)
    expect(list?.sql).toContain(`st."optionId" = 'paid'`)
    expect(list?.sql).toMatch(
      /NOT EXISTS \(SELECT 1 FROM "GlPostingSource" link[\s\S]*link."sourceKind" = 'payout'[\s\S]*link."linkRole" = 'subject'/
    )
    // Never tried: no work item on the lane `ingestOne` parks payouts on.
    expect(list?.sql).toContain('item."stage" =')
    expect(list?.params).toEqual(expect.arrayContaining(['payout', 'post']))
    expect(list?.sql).toContain('ORDER BY pa."valueDate" ASC, e.id ASC')
  })

  it('hands each listed payout to repostStoredPayout once, with its rail context', async () => {
    h.fresh = ['po_1', 'po_2']
    h.records = {
      po_1: { gatewayId: 'gw_1', railId: 'pg_shop' },
      po_2: { gatewayId: 'gw_2', railId: 'pg_shop' },
    }
    const counts = await sweepStoredPayoutEntries(db, { organizationId: 'org_1' })

    expect(h.repostStoredPayout).toHaveBeenCalledTimes(2)
    expect(h.repostStoredPayout.mock.calls.map((call) => call[1].providerPayoutId)).toEqual([
      'gw_1',
      'gw_2',
    ])
    expect(h.repostStoredPayout.mock.calls[0]![1].ctx).toEqual({
      organizationId: 'org_1',
      sourceId: 'shopify_payments',
      rail: { id: 'pg_shop', settlementSource: 'shopify_payments' },
      handle: null,
    })
    expect(counts).toMatchObject({ scanned: 2, accepted: 2 })
  })

  it('parks a payout whose rail has no payout source instead of re-offering it', async () => {
    h.fresh = ['po_1']
    h.records = { po_1: { gatewayId: 'gw_1', railId: 'pg_manual' } }
    const counts = await sweepStoredPayoutEntries(db, { organizationId: 'org_1' })

    expect(h.repostStoredPayout).not.toHaveBeenCalled()
    expect(h.upsertWorkItem).toHaveBeenCalledWith(
      db,
      'org_1',
      expect.objectContaining({
        sourceKind: 'payout',
        sourceId: 'po_1',
        stage: 'post',
        reasonCode: 'GATEWAY_UNMAPPED',
      })
    )
    expect(counts).toMatchObject({ scanned: 1, blocked: 1 })
  })
})
