// packages/lib/src/resources/system-records/__tests__/payment-gateway-shape.test.ts
//
// The worked example for B2: `payment_gateway` read end to end through the
// primitive — registry attributes, `systemFields`, `readSystemRecords` — and
// shaped into the row `payment-gateways/reads.ts` assembles by hand today.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ select: vi.fn(), fields: vi.fn() }))

vi.mock('../../../cache', () => ({
  getCachedEntityDefId: vi.fn().mockResolvedValue('def_pg'),
  getOrgCache: () => ({ from: () => ({ bySystemAttributes: h.fields }) }),
}))

vi.mock('@auxx/database', async () => ({
  schema: await import('../../../../../database/src/db/schema/index'),
  database: (await import('../../../test/database-mock')).createChainableDatabaseMock(),
}))

import { schema } from '@auxx/database'
import { PAYMENT_GATEWAY_FIELDS } from '../../registry/resources/payment-gateway-fields'
import { pickSystemAttributes } from '../../registry/system-attributes'
import { systemFields } from '../fields'
import { readSystemRecords } from '../read'

const ORG = 'org_1'
// The PICK, not the whole map: `payment_gateway_payouts` is the inverse of a
// has-many, so a whole-map read costs one FieldValue row per payout per gateway.
const ATTRIBUTES = pickSystemAttributes(PAYMENT_GATEWAY_FIELDS, [
  'payment_gateway_name',
  'payment_gateway_handles',
  'payment_gateway_fee_treatment',
  'payment_gateway_status',
  'payment_gateway_last_settlement_at',
  'payment_gateway_last_fee_booked_at',
] as const)

const FIELDS = {
  payment_gateway_name: { id: 'f_name', type: 'TEXT' },
  payment_gateway_handles: { id: 'f_handles', type: 'TAGS' },
  payment_gateway_fee_treatment: { id: 'f_fee', type: 'SINGLE_SELECT' },
  payment_gateway_status: { id: 'f_status', type: 'SINGLE_SELECT' },
  payment_gateway_last_settlement_at: { id: 'f_settled', type: 'DATE' },
  payment_gateway_last_fee_booked_at: { id: 'f_fee_booked', type: 'DATE' },
  payment_gateway_payouts: { id: 'f_payouts', type: 'RELATIONSHIP' },
}

function row(fieldId: string, sortKey: string, columns: object) {
  return {
    id: `v_${fieldId}_${sortKey}`,
    entityId: 'pg_1',
    fieldId,
    sortKey,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...columns,
  }
}

const VALUES = [
  row('f_name', 'a0', { valueText: 'Shopify Payments' }),
  row('f_handles', 'a0', { optionId: 'shopify_payments' }),
  // The defensive fallback the settings screen depends on: a tag written with
  // no option row at all.
  row('f_handles', 'a1', { optionId: null, valueText: 'Shopify Payments (legacy)' }),
  row('f_fee', 'a0', { optionId: 'netted' }),
  row('f_status', 'a0', { optionId: 'open' }),
  row('f_settled', 'a0', { valueDate: '2026-02-03T00:00:00.000Z' }),
]

// biome-ignore lint/suspicious/noExplicitAny: a query-builder stand-in
const db: any = {
  select: (columns?: unknown) => ({
    from: (table: unknown) => ({
      where: () => {
        const result = Promise.resolve(h.select(table, columns))
        return Object.assign(result, { orderBy: () => result })
      },
    }),
  }),
}

beforeEach(() => {
  vi.clearAllMocks()
  h.fields.mockResolvedValue(FIELDS)
  h.select.mockImplementation((table: unknown) =>
    table === schema.EntityInstance
      ? [
          {
            id: 'pg_1',
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-02'),
            archivedAt: null,
          },
        ]
      : VALUES
  )
})

describe('payment_gateway through the primitive', () => {
  it('takes its attribute list from the registry, and only what it reads', () => {
    expect(ATTRIBUTES).toContain('payment_gateway_name')
    expect(ATTRIBUTES).toContain('payment_gateway_handles')
    // 🛑 The has-many inverse is never fetched to shape one row.
    expect(ATTRIBUTES).not.toContain('payment_gateway_payouts')
  })

  it('assembles the same row payment-gateways/reads.ts assembles by hand', async () => {
    const ctx = await systemFields(db, ORG, 'payment_gateway', ATTRIBUTES)
    if (!ctx) throw new Error('expected a context')

    const records = await readSystemRecords(db, ORG, ctx)
    const gateway = records.map((record) => ({
      id: record.id,
      recordId: record.recordId,
      name: record.text('payment_gateway_name') ?? '',
      handles: record
        .rows('payment_gateway_handles')
        .map((value) => value.optionId ?? value.valueText)
        .filter((handle): handle is string => !!handle),
      feeTreatment: record.option('payment_gateway_fee_treatment'),
      status: record.option('payment_gateway_status'),
      lastSettlementAt: record.date('payment_gateway_last_settlement_at')?.slice(0, 10) ?? null,
      lastFeeBookedAt: record.date('payment_gateway_last_fee_booked_at')?.slice(0, 10) ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }))[0]

    expect(gateway).toEqual({
      id: 'pg_1',
      recordId: 'def_pg:pg_1',
      name: 'Shopify Payments',
      handles: ['shopify_payments', 'Shopify Payments (legacy)'],
      feeTreatment: 'netted',
      status: 'open',
      lastSettlementAt: '2026-02-03',
      lastFeeBookedAt: null,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-02'),
    })
  })

  it('costs two queries for the whole list, as the hand-written read does', async () => {
    const ctx = await systemFields(db, ORG, 'payment_gateway', ATTRIBUTES)
    if (!ctx) throw new Error('expected a context')
    h.select.mockClear()
    await readSystemRecords(db, ORG, ctx)
    expect(h.select).toHaveBeenCalledTimes(2)
  })
})
