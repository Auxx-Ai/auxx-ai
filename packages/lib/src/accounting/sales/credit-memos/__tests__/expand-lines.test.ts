// packages/lib/src/accounting/sales/credit-memos/__tests__/expand-lines.test.ts
//
// 101 E10: a channel memo's item-less line is spread over the order's lines, a negative one netted
// against the memo's own item lines, before the entry is built.

import { describe, expect, it } from 'vitest'
import { UnprocessableEntityError } from '../../../../errors'
import { buildEntryForCreditMemo, expandCreditMemoLines } from '../accounting'
import type {
  CreditMemoLineRecord,
  CreditMemoRecord,
  OrderSpreadPart,
  ShippedMemoLines,
} from '../reads'

const memo = (source: string) =>
  ({
    id: 'cm_1',
    number: 'CM-0007',
    source,
    contactInstanceId: 'contact_1',
    orderInstanceId: 'order_1',
  }) as CreditMemoRecord

const line = (
  id: string,
  subtotalMinor: number,
  taxTotalMinor: number,
  lineItemInstanceId: string | null = null,
  disposition: string | null = null
): CreditMemoLineRecord => ({
  id,
  description: null,
  qty: 1,
  unitPriceMinor: subtotalMinor,
  subtotalMinor,
  taxTotalMinor,
  disposition,
  lineItemInstanceId,
  sortOrder: 0,
})

const goods = (netMinor: number, taxMinor: number, shipped: boolean): OrderSpreadPart => ({
  netMinor,
  taxMinor,
  shipped,
  component: 'goods',
})

const shippedSet = (ids: string[], orderParts?: OrderSpreadPart[]): ShippedMemoLines =>
  Object.assign(new Set(ids), { orderParts })

const build = (source: string, lines: CreditMemoLineRecord[], shipped: ShippedMemoLines) =>
  buildEntryForCreditMemo({
    memo: memo(source),
    lines,
    issuedAt: '2026-01-14',
    currency: 'USD',
    shippedLineIds: shipped,
  })

/** The entry's legs by role, debit positive and credit negative. */
const legs = (built: ReturnType<typeof build>) =>
  Object.fromEntries(
    (built?.entry.lines ?? []).map((l) => [
      l.accountRole,
      l.direction === 'debit' ? l.amount : -l.amount,
    ])
  )

describe('expandCreditMemoLines', () => {
  it("reverses order #14456's full refund by amount as returns plus its tax", () => {
    const built = build(
      'channel',
      [line('adj', 354_520, 0)],
      shippedSet(['adj'], [goods(327_500, 27_020, true)])
    )
    expect(legs(built)).toEqual({
      revenue_returns_allowances: 327_500,
      sales_tax_payable: 27_020,
      accounts_receivable: -354_520,
    })
  })

  it('posts only the shipped line share of a partial amount, tax proportional', () => {
    const lines = [line('adj', 5_000, 0)]
    const shipped = shippedSet(['adj'], [goods(10_001, 833, true), goods(3_333, 277, false)])
    const expanded = expandCreditMemoLines({
      memo: memo('channel'),
      lines,
      shippedLineIds: shipped,
    })
    // 5,000 over weights 10,834 : 3,610 is 3,750.3 : 1,249.7; largest remainder hands B the cent.
    expect(expanded).toEqual([
      { subtotal: 3_462, taxTotal: 288, shipped: true, component: 'goods' },
      { subtotal: 1_154, taxTotal: 96, shipped: false, component: 'goods' },
    ])
    expect(expanded.reduce((sum, l) => sum + Number(l.subtotal) + Number(l.taxTotal), 0)).toBe(
      5_000
    )
    expect(legs(build('channel', lines, shipped))).toEqual({
      revenue_returns_allowances: 3_462,
      sales_tax_payable: 288,
      accounts_receivable: -3_750,
    })
  })

  it('gives the shipping its share, reversing revenue_shipping', () => {
    const built = build(
      'channel',
      [line('adj', 12_000, 0)],
      shippedSet(
        ['adj'],
        [
          goods(10_000, 800, true),
          { netMinor: 1_200, taxMinor: 0, shipped: true, component: 'shipping' },
        ]
      )
    )
    expect(legs(built)).toEqual({
      revenue_returns_allowances: 10_000,
      revenue_shipping: 1_200,
      sales_tax_payable: 800,
      accounts_receivable: -12_000,
    })
  })

  it('posts nothing when no part of the order had shipped', () => {
    expect(
      build('channel', [line('adj', 1_000, 0)], shippedSet(['adj'], [goods(900, 100, false)]))
    ).toBeNull()
  })

  it('nets a negative remainder against the memo item lines, pro rata including tax', () => {
    const lines = [
      line('l1', 10_000, 800, 'li_1'),
      line('l2', 5_000, 400, 'li_2'),
      line('adj', -3_240, 0),
    ]
    const shipped = shippedSet(['l1', 'adj'])
    expect(
      expandCreditMemoLines({ memo: memo('channel'), lines, shippedLineIds: shipped })
    ).toEqual([
      { subtotal: 8_000, taxTotal: 640, shipped: true, component: 'goods' },
      { subtotal: 4_000, taxTotal: 320, shipped: false, component: 'goods' },
    ])
    expect(legs(build('channel', lines, shipped))).toEqual({
      revenue_returns_allowances: 8_000,
      sales_tax_payable: 640,
      accounts_receivable: -8_640,
    })
  })

  it('leaves a native memo item-less line as typed', () => {
    const lines = [line('c1', 5_000, 250)]
    expect(
      expandCreditMemoLines({ memo: memo('native'), lines, shippedLineIds: shippedSet(['c1']) })
    ).toEqual([{ subtotal: 5_000, taxTotal: 250, shipped: true, component: 'goods' }])
  })

  it('refuses a positive remainder when the order has no line items to spread over', () => {
    expect(() =>
      expandCreditMemoLines({
        memo: memo('channel'),
        lines: [line('adj', 1_000, 0)],
        shippedLineIds: shippedSet(['adj'], []),
      })
    ).toThrow(UnprocessableEntityError)
  })

  it('refuses a negative remainder larger than the item lines it nets against', () => {
    expect(() =>
      expandCreditMemoLines({
        memo: memo('channel'),
        lines: [line('l1', 1_000, 0, 'li_1'), line('adj', -1_500, 0)],
        shippedLineIds: shippedSet(['l1']),
      })
    ).toThrow(UnprocessableEntityError)
  })
})
