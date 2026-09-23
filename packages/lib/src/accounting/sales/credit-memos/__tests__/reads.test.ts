// packages/lib/src/accounting/sales/credit-memos/__tests__/reads.test.ts
//
// `readShippedMemoLineIds`: the per-line read that decides which memo lines reverse
// revenue (91 D4). `writes.test.ts` mocks it away, so it needs its own coverage.

import { describe, expect, it, vi } from 'vitest'

type Item = { id: string; qty: number | null; at: string | null; net?: number; tax?: number }

const h = vi.hoisted(() => ({
  items: [] as Item[],
  orderItems: [] as Item[],
  orderShipping: 0,
  reads: 0,
}))

vi.mock('../../../../resources/system-records', () => ({
  systemFields: async (_db: unknown, _org: unknown, entity: string) => ({
    entity,
    fields: { line_item_order: { id: 'f_order' } },
  }),
  readSystemRecords: async (
    _db: unknown,
    _org: unknown,
    ctx: { entity: string },
    query: { by?: unknown }
  ) => {
    h.reads++
    if (ctx.entity === 'order') return [{ id: 'order_1', number: () => h.orderShipping }]
    return (query.by ? h.orderItems : h.items).map((item) => ({
      id: item.id,
      number: (attribute: string) =>
        attribute === 'line_item_fulfilled_qty'
          ? item.qty
          : attribute === 'line_item_net_total'
            ? (item.net ?? null)
            : attribute === 'line_item_tax_total'
              ? (item.tax ?? null)
              : null,
      date: () => item.at,
    }))
  },
  findSystemRecordIdsByValue: vi.fn(),
  systemFieldMap: vi.fn(),
  systemValueJoin: vi.fn(),
}))

import type { Database } from '@auxx/database'
import { readShippedMemoLineIds } from '../reads'

const DB = {} as Database
const CHANNEL = { source: 'channel' }
const line = (id: string, lineItemInstanceId: string | null) => ({ id, lineItemInstanceId })
const read = (lines: ReturnType<typeof line>[], memo = CHANNEL) =>
  readShippedMemoLineIds(DB, 'org_1', memo, lines, '2026-01-14')

describe('readShippedMemoLineIds', () => {
  it('counts a line whose item shipped on or before the memo date', async () => {
    h.items = [
      { id: 'li_1', qty: 1, at: '2026-01-02T12:00:00Z' },
      { id: 'li_2', qty: 2, at: '2026-01-14T12:00:00Z' },
    ]
    expect(await read([line('l1', 'li_1'), line('l2', 'li_2')])).toEqual(new Set(['l1', 'l2']))
  })

  it('does not count a line the channel reports as unshipped', async () => {
    h.items = [{ id: 'li_1', qty: 0, at: null }]
    expect(await read([line('l1', 'li_1')])).toEqual(new Set())
  })

  it('does not count a line that shipped only after the memo', async () => {
    h.items = [{ id: 'li_1', qty: 1, at: '2026-01-20T12:00:00Z' }]
    expect(await read([line('l1', 'li_1')])).toEqual(new Set())
  })

  it('treats a null quantity as the channel saying nothing, not unshipped', async () => {
    h.items = [{ id: 'li_1', qty: null, at: null }]
    expect([...(await read([line('l1', 'li_1')]))]).toEqual(['l1'])
  })

  it('splits a mixed memo per line', async () => {
    h.items = [
      { id: 'li_1', qty: 1, at: '2026-01-02T12:00:00Z' },
      { id: 'li_2', qty: 0, at: null },
    ]
    expect(await read([line('l1', 'li_1'), line('l2', 'li_2')])).toEqual(new Set(['l1']))
  })

  it('reverses every line of a native memo without reading the line items', async () => {
    h.reads = 0
    expect(await read([line('l1', 'li_1')], { source: 'native' })).toEqual(new Set(['l1']))
    expect(h.reads).toBe(0)
  })

  // 91 D8: a shipping line has no item; the order's own lines say whether shipping was recognised.
  describe('a shipping line', () => {
    const shippingLine = { id: 's1', lineItemInstanceId: null, disposition: 'shipping' }
    const memo = { source: 'channel', orderInstanceId: 'order_1' }
    const readShipping = () =>
      readShippedMemoLineIds(DB, 'org_1', memo, [shippingLine], '2026-01-14')

    it('reverses when any line of the order shipped by the memo date', async () => {
      h.items = []
      h.orderItems = [
        { id: 'li_1', qty: 0, at: null },
        { id: 'li_2', qty: 1, at: '2026-01-02T12:00:00Z' },
      ]
      expect(await readShipping()).toEqual(new Set(['s1']))
    })

    it('posts nothing when no line of the order had shipped', async () => {
      h.items = []
      h.orderItems = [{ id: 'li_1', qty: 0, at: null }]
      expect(await readShipping()).toEqual(new Set())
    })

    it('reverses when the channel said nothing about any line', async () => {
      h.items = []
      h.orderItems = [{ id: 'li_1', qty: null, at: null }]
      expect(await readShipping()).toEqual(new Set(['s1']))
    })
  })

  // 101 E10: an item-less line reads the order's lines and shipping to be spread over.
  describe('an item-less line on a channel memo', () => {
    const memo = { source: 'channel', orderInstanceId: 'order_1' }
    const adjustment = { id: 'adj', lineItemInstanceId: null }

    it('carries each order line with its amounts and verdict, plus the shipping', async () => {
      h.items = []
      h.orderItems = [
        { id: 'li_1', qty: 1, at: '2026-01-02T12:00:00Z', net: 327_500, tax: 27_020 },
        { id: 'li_2', qty: 0, at: null, net: 1_000, tax: 80 },
      ]
      h.orderShipping = 995
      const result = await readShippedMemoLineIds(DB, 'org_1', memo, [adjustment], '2026-01-14')
      expect(result.orderParts).toEqual([
        { netMinor: 327_500, taxMinor: 27_020, shipped: true, component: 'goods' },
        { netMinor: 1_000, taxMinor: 80, shipped: false, component: 'goods' },
        { netMinor: 995, taxMinor: 0, shipped: true, component: 'shipping' },
      ])
    })

    it('carries no parts when the memo has no order', async () => {
      h.items = []
      const result = await readShippedMemoLineIds(
        DB,
        'org_1',
        { source: 'channel', orderInstanceId: null },
        [adjustment],
        '2026-01-14'
      )
      expect(result.orderParts).toEqual([])
    })

    it('reads no order for a memo whose lines all name an item', async () => {
      h.items = [{ id: 'li_1', qty: 1, at: '2026-01-02T12:00:00Z' }]
      const result = await readShippedMemoLineIds(
        DB,
        'org_1',
        memo,
        [line('l1', 'li_1')],
        '2026-01-14'
      )
      expect(result.orderParts).toBeUndefined()
    })
  })
})
