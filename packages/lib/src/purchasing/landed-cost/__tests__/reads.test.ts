// packages/lib/src/purchasing/landed-cost/__tests__/reads.test.ts

/**
 * `purchasing/landed-cost/reads.ts` — 73 §7.2's worked shipment, read back.
 *
 * `systemFields` / `readSystemRecords` are mocked rather than driven through a
 * fake `FieldValue` join: what this module does is join three readings and
 * apportion, and a real join would test `readSystemRecords` instead.
 */

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../resources/system-records', () => ({
  systemFields: vi.fn(),
  readSystemRecords: vi.fn(),
}))
vi.mock('../../../accounting/ledger/roles/role-assignments', () => ({
  readRoleAssignments: vi.fn(),
}))

import { readRoleAssignments } from '../../../accounting/ledger/roles/role-assignments'
import { readSystemRecords, systemFields } from '../../../resources/system-records'
import { readLandedCostByBill, readLandedCostByVendorPart } from '../reads'

const db = {} as Database
const FREIGHT_ACCOUNT = 'acct_freight_accrual'
const DUTIES_ACCOUNT = 'acct_duties_accrual'

/** A `SystemRecord` stand-in: only the accessors `reads.ts` calls. */
function record(
  id: string,
  cells: Record<string, string | number | null>
): ReturnType<typeof makeRecord> {
  return makeRecord(id, cells)
}

function makeRecord(id: string, cells: Record<string, string | number | null>) {
  const read = (attribute: string) => cells[attribute] ?? null
  return {
    id,
    text: (attribute: string) => (typeof read(attribute) === 'string' ? read(attribute) : null),
    number: (attribute: string) => (typeof read(attribute) === 'number' ? read(attribute) : null),
    related: (attribute: string) => (typeof read(attribute) === 'string' ? read(attribute) : null),
    option: () => null,
  }
}

const CONTEXTS: Record<string, { defId: string; fields: Record<string, { id: string } | null> }> = {
  vendor_bill_line: {
    defId: 'def_vendor_bill_line',
    fields: {
      vendor_bill_line_vendor_bill: { id: 'f_bill' },
      vendor_bill_line_purchase_order_line: { id: 'f_poline' },
      vendor_bill_line_landed_bill: { id: 'f_landed' },
      vendor_bill_line_line_total: { id: 'f_total' },
      vendor_bill_line_gl_account: { id: 'f_account' },
    },
  },
  stock_movement: { defId: 'def_stock_movement', fields: {} },
  purchase_order_line: { defId: 'def_purchase_order_line', fields: {} },
}

/**
 * Route each `readSystemRecords` call by the `by.attribute` it was given, which
 * is what actually distinguishes the four reads this module makes.
 */
function route(rows: Record<string, ReturnType<typeof makeRecord>[]>) {
  vi.mocked(readSystemRecords).mockImplementation((async (
    _db: unknown,
    _org: unknown,
    _ctx: unknown,
    options: any
  ) => {
    const key = options?.by?.attribute ?? 'ids'
    return (rows[key] ?? []) as never
  }) as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(systemFields).mockImplementation(
    (async (_db: unknown, _org: unknown, entityType: string) =>
      (CONTEXTS[entityType] ?? null) as any) as never
  )
  vi.mocked(readRoleAssignments).mockResolvedValue([
    {
      role: 'freight_accrual',
      glAccountId: FREIGHT_ACCOUNT,
      markedUnused: false,
      sourceAccountId: null,
      paymentGatewayId: null,
      currency: null,
      source: 'seed',
      confirmedAt: null,
    },
    {
      role: 'duties_accrual',
      glAccountId: DUTIES_ACCOUNT,
      markedUnused: false,
      sourceAccountId: null,
      paymentGatewayId: null,
      currency: null,
      source: 'seed',
      confirmedAt: null,
    },
  ])
})

describe('readLandedCostByBill', () => {
  // §7.2, worked: M agreed 12, shipping 1, tariff 25% -> receive 10 accrues
  // freight 10 and duty 30. The carrier bills 12, the broker 30 + 5.
  it('names the accrued, the billed and the difference for the worked shipment', async () => {
    route({
      vendor_bill_line_vendor_bill: [
        record('vbl_goods', {
          vendor_bill_line_purchase_order_line: 'pol_1',
          vendor_bill_line_line_total: 12_000,
        }),
      ],
      vendor_bill_line_landed_bill: [
        record('vbl_freight', {
          vendor_bill_line_line_total: 1_200,
          vendor_bill_line_gl_account: FREIGHT_ACCOUNT,
        }),
        record('vbl_duty', {
          vendor_bill_line_line_total: 3_000,
          vendor_bill_line_gl_account: DUTIES_ACCOUNT,
        }),
        record('vbl_brokerage', {
          vendor_bill_line_line_total: 500,
          vendor_bill_line_gl_account: FREIGHT_ACCOUNT,
        }),
      ],
      stock_movement_purchase_order_line: [
        record('sm_1', {
          stock_movement_purchase_order_line: 'pol_1',
          stock_movement_freight_accrued: 1_000,
          stock_movement_duties_accrued: 3_000,
          stock_movement_tariff_rate: 25,
        }),
      ],
    })

    const result = await readLandedCostByBill(db, 'org_1', 'vb_goods')
    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value.freight).toEqual({
      accruedMinor: 1_000,
      billedMinor: 1_700,
      differenceMinor: -700,
    })
    expect(result.value.duties).toEqual({
      accruedMinor: 3_000,
      billedMinor: 3_000,
      differenceMinor: 0,
    })
    expect(result.value.otherBilledMinor).toBe(0)
    expect(result.value.receiptCount).toBe(1)
    expect(result.value.landedLineCount).toBe(3)
  })

  it('reads a bill with no receipts behind it as zero rather than refusing', async () => {
    route({
      vendor_bill_line_vendor_bill: [record('vbl_expense', { vendor_bill_line_line_total: 9_900 })],
      vendor_bill_line_landed_bill: [],
      stock_movement_purchase_order_line: [],
    })

    const result = await readLandedCostByBill(db, 'org_1', 'vb_expense')
    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value.freight.accruedMinor).toBe(0)
    expect(result.value.duties.differenceMinor).toBe(0)
    expect(result.value.receiptCount).toBe(0)
  })

  it('never folds a line coded to a third account into an accrual leg', async () => {
    route({
      vendor_bill_line_vendor_bill: [],
      vendor_bill_line_landed_bill: [
        record('vbl_odd', {
          vendor_bill_line_line_total: 4_200,
          vendor_bill_line_gl_account: 'acct_office_supplies',
        }),
      ],
      stock_movement_purchase_order_line: [],
    })

    const result = await readLandedCostByBill(db, 'org_1', 'vb_goods')
    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value.otherBilledMinor).toBe(4_200)
    expect(result.value.freight.billedMinor).toBe(0)
    expect(result.value.duties.billedMinor).toBe(0)
  })
})

describe('readLandedCostByVendorPart', () => {
  /**
   * Two parts on one shipment: ours at 25% on a 12,000 line, a zero-rate part
   * on a 12,000 line. Duty splits by value x rate, so ours takes all of it;
   * freight splits by value alone, so ours takes half.
   */
  it('derives its share of the shipment by value x rate for duty and by value for freight', async () => {
    vi.mocked(readSystemRecords).mockImplementation((async (
      _db: unknown,
      _org: unknown,
      ctx: any,
      options: any
    ) => {
      const attribute = options?.by?.attribute
      if (attribute === 'stock_movement_vendor_part') {
        return [
          record('sm_1', {
            stock_movement_purchase_order_line: 'pol_ours',
            stock_movement_vendor_part: 'vp_ours',
            stock_movement_freight_accrued: 1_000,
            stock_movement_duties_accrued: 3_000,
            stock_movement_tariff_rate: 25,
          }),
        ] as never
      }
      if (attribute === 'vendor_bill_line_purchase_order_line') {
        return [record('vbl_ours', { vendor_bill_line_vendor_bill: 'vb_goods' })] as never
      }
      if (attribute === 'vendor_bill_line_vendor_bill') {
        return [
          record('vbl_ours', {
            vendor_bill_line_purchase_order_line: 'pol_ours',
            vendor_bill_line_line_total: 12_000,
          }),
          record('vbl_theirs', {
            vendor_bill_line_purchase_order_line: 'pol_theirs',
            vendor_bill_line_line_total: 12_000,
          }),
        ] as never
      }
      if (attribute === 'vendor_bill_line_landed_bill') {
        return [
          record('vbl_freight', {
            vendor_bill_line_line_total: 1_200,
            vendor_bill_line_gl_account: FREIGHT_ACCOUNT,
          }),
          record('vbl_duty', {
            vendor_bill_line_line_total: 3_000,
            vendor_bill_line_gl_account: DUTIES_ACCOUNT,
          }),
        ] as never
      }
      if (attribute === 'stock_movement_purchase_order_line') {
        return [
          record('sm_1', {
            stock_movement_purchase_order_line: 'pol_ours',
            stock_movement_freight_accrued: 1_000,
            stock_movement_duties_accrued: 3_000,
            stock_movement_tariff_rate: 25,
          }),
        ] as never
      }
      // The `ids` read: order lines, for each goods line's vendor part.
      if (ctx?.defId === 'def_purchase_order_line') {
        return [
          record('pol_ours', { purchase_order_line_vendor_part: 'vp_ours' }),
          record('pol_theirs', { purchase_order_line_vendor_part: 'vp_theirs' }),
        ] as never
      }
      return [] as never
    }) as never)

    const result = await readLandedCostByVendorPart(db, 'org_1', 'vp_ours')
    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value.duties).toEqual({
      accruedMinor: 3_000,
      billedMinor: 3_000,
      differenceMinor: 0,
    })
    expect(result.value.freight).toEqual({
      accruedMinor: 1_000,
      billedMinor: 600,
      differenceMinor: 400,
    })
    expect(result.value.billCount).toBe(1)
  })
})
