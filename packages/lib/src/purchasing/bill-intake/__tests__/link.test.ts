// packages/lib/src/purchasing/bill-intake/__tests__/link.test.ts
//
// The one writer for "this bill line is against that order line"
// (plans/money/tasks/58 §6.5). `db` is a chainable stub the way
// `intake/__tests__/resolve.test.ts` pins the tier ladder; `resolveRoles` and
// `UnifiedCrudHandler` are mocked so what is pinned is THIS module's policy:
// ownership is verified for the WHOLE batch before anything is written, grni
// is resolved once, and one `update` call per line carries all three fields.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  defs: new Map<string, string>(),
  materialised: new Set<string>(),
  results: [] as unknown[][],
  selectCalls: 0,
  grniAccountId: null as string | null,
  grniShouldErr: false,
  updateCalls: [] as { recordId: string; values: Record<string, unknown> }[],
}))

vi.mock('../../../cache', () => ({
  getCachedEntityDefId: vi.fn(async (_org: string, entityType: string) => h.defs.get(entityType)),
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: readonly string[]) =>
        Object.fromEntries(
          attrs.map((a) => [a, h.materialised.has(a) ? { id: `fld_${a}` } : null])
        ),
    }),
  }),
}))

vi.mock('../../../accounting/ledger/roles/resolve-roles', () => ({
  resolveRoles: vi.fn(async () => {
    const { ok, err } = await import('neverthrow')
    if (h.grniShouldErr) {
      const { UnprocessableEntityError } = await import('../../../errors')
      return err(new UnprocessableEntityError('grni not mapped'))
    }
    return ok(h.grniAccountId ? new Map([['grni', { glAccountId: h.grniAccountId }]]) : new Map())
  }),
}))

vi.mock('../../../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.update = vi.fn(async (recordId: string, values: Record<string, unknown>) => {
      h.updateCalls.push({ recordId, values })
      return {}
    })
  }),
}))

import type { Database } from '@auxx/database'
import { UnprocessableEntityError } from '../../../errors'
import { linkBillLines, linkBillLineToOrderLine, resolveGrniAccountId } from '../link'

/** Answers `rows` however the builder is chained, then resolves on await. */
function chainReturning(rows: unknown[]): unknown {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') return (resolve: (value: unknown) => void) => resolve(rows)
        return () => proxy
      },
    }
  )
  return proxy
}

const db = {
  select: () => chainReturning(h.results[h.selectCalls++] ?? []),
} as unknown as Database

/** [billOrderMap rows, lineBillMap rows, orderLineOrderMap rows, orderLinePartMap rows]. */
function setupRows(rows: {
  billOrder: { entityId: string; relatedEntityId: string | null }[]
  lineBill: { entityId: string; relatedEntityId: string | null }[]
  orderLineOrder: { entityId: string; relatedEntityId: string | null }[]
  orderLinePart: { entityId: string; relatedEntityId: string | null }[]
}): void {
  h.results = [rows.billOrder, rows.lineBill, rows.orderLineOrder, rows.orderLinePart]
  h.selectCalls = 0
}

beforeEach(() => {
  h.defs = new Map([
    ['vendor_bill', 'def_vendor_bill'],
    ['part', 'def_part'],
  ])
  h.materialised = new Set([
    'vendor_bill_purchase_order',
    'vendor_bill_line_vendor_bill',
    'purchase_order_line_purchase_order',
    'purchase_order_line_part',
  ])
  h.results = []
  h.selectCalls = 0
  h.grniAccountId = null
  h.grniShouldErr = false
  h.updateCalls = []
})

describe('resolveGrniAccountId', () => {
  it('returns the mapped account', async () => {
    h.grniAccountId = 'acct_1'
    expect(await resolveGrniAccountId(db, 'org_1')).toBe('acct_1')
  })

  it('never throws: an unresolved role logs and answers null', async () => {
    h.grniShouldErr = true
    expect(await resolveGrniAccountId(db, 'org_1')).toBeNull()
  })
})

describe('linkBillLineToOrderLine', () => {
  it('is one update call carrying only what is given', async () => {
    await linkBillLineToOrderLine(db, 'org_1', 'user_1', {
      lineRecordId: 'vendor_bill_line:l1' as never,
      orderLineRecordId: 'purchase_order_line:pol1' as never,
      partRecordId: null,
      grniAccountId: null,
    })

    expect(h.updateCalls).toEqual([
      {
        recordId: 'vendor_bill_line:l1',
        values: { vendor_bill_line_purchase_order_line: 'purchase_order_line:pol1' },
      },
    ])
  })

  it('stamps part and gl account when given', async () => {
    await linkBillLineToOrderLine(db, 'org_1', 'user_1', {
      lineRecordId: 'vendor_bill_line:l1' as never,
      orderLineRecordId: 'purchase_order_line:pol1' as never,
      partRecordId: 'part:p1' as never,
      grniAccountId: 'acct_1',
    })

    expect(h.updateCalls[0]?.values).toEqual({
      vendor_bill_line_purchase_order_line: 'purchase_order_line:pol1',
      vendor_bill_line_part: 'part:p1',
      vendor_bill_line_gl_account: 'acct_1',
    })
  })
})

describe('linkBillLines', () => {
  it('🛑 refuses a line that belongs to another bill, naming it', async () => {
    setupRows({
      billOrder: [{ entityId: 'bill_1', relatedEntityId: 'po_1' }],
      lineBill: [
        { entityId: 'l1', relatedEntityId: 'bill_1' },
        { entityId: 'l2', relatedEntityId: 'bill_OTHER' },
      ],
      orderLineOrder: [
        { entityId: 'pol1', relatedEntityId: 'po_1' },
        { entityId: 'pol2', relatedEntityId: 'po_1' },
      ],
      orderLinePart: [],
    })

    const result = await linkBillLines(db, 'org_1', 'user_1', {
      billRecordId: 'vendor_bill:bill_1' as never,
      links: [
        {
          lineRecordId: 'vendor_bill_line:l1' as never,
          orderLineRecordId: 'purchase_order_line:pol1' as never,
        },
        {
          lineRecordId: 'vendor_bill_line:l2' as never,
          orderLineRecordId: 'purchase_order_line:pol2' as never,
        },
      ],
    })

    const error = result._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(error.message).toContain('vendor_bill_line:l2')
    expect(h.updateCalls).toEqual([])
  })

  it('🛑 refuses an order line that belongs to another order, naming it', async () => {
    setupRows({
      billOrder: [{ entityId: 'bill_1', relatedEntityId: 'po_1' }],
      lineBill: [
        { entityId: 'l1', relatedEntityId: 'bill_1' },
        { entityId: 'l2', relatedEntityId: 'bill_1' },
      ],
      orderLineOrder: [
        { entityId: 'pol1', relatedEntityId: 'po_1' },
        { entityId: 'pol2', relatedEntityId: 'po_OTHER' },
      ],
      orderLinePart: [],
    })

    const result = await linkBillLines(db, 'org_1', 'user_1', {
      billRecordId: 'vendor_bill:bill_1' as never,
      links: [
        {
          lineRecordId: 'vendor_bill_line:l1' as never,
          orderLineRecordId: 'purchase_order_line:pol1' as never,
        },
        {
          lineRecordId: 'vendor_bill_line:l2' as never,
          orderLineRecordId: 'purchase_order_line:pol2' as never,
        },
      ],
    })

    const error = result._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(error.message).toContain('purchase_order_line:pol2')
    expect(h.updateCalls).toEqual([])
  })

  it('stamps the part and the grni account when both resolve', async () => {
    h.grniAccountId = 'acct_1'
    setupRows({
      billOrder: [{ entityId: 'bill_1', relatedEntityId: 'po_1' }],
      lineBill: [{ entityId: 'l1', relatedEntityId: 'bill_1' }],
      orderLineOrder: [{ entityId: 'pol1', relatedEntityId: 'po_1' }],
      orderLinePart: [{ entityId: 'pol1', relatedEntityId: 'part_1' }],
    })

    const result = await linkBillLines(db, 'org_1', 'user_1', {
      billRecordId: 'vendor_bill:bill_1' as never,
      links: [
        {
          lineRecordId: 'vendor_bill_line:l1' as never,
          orderLineRecordId: 'purchase_order_line:pol1' as never,
        },
      ],
    })

    expect(result._unsafeUnwrap()).toEqual({ linked: 1 })
    expect(h.updateCalls).toEqual([
      {
        recordId: 'vendor_bill_line:l1',
        values: {
          vendor_bill_line_purchase_order_line: 'purchase_order_line:pol1',
          vendor_bill_line_part: 'def_part:part_1',
          vendor_bill_line_gl_account: 'acct_1',
        },
      },
    ])
  })

  it('omits the part and the gl account when neither resolves', async () => {
    setupRows({
      billOrder: [{ entityId: 'bill_1', relatedEntityId: 'po_1' }],
      lineBill: [{ entityId: 'l1', relatedEntityId: 'bill_1' }],
      orderLineOrder: [{ entityId: 'pol1', relatedEntityId: 'po_1' }],
      orderLinePart: [{ entityId: 'pol1', relatedEntityId: null }],
    })

    const result = await linkBillLines(db, 'org_1', 'user_1', {
      billRecordId: 'vendor_bill:bill_1' as never,
      links: [
        {
          lineRecordId: 'vendor_bill_line:l1' as never,
          orderLineRecordId: 'purchase_order_line:pol1' as never,
        },
      ],
    })

    expect(result._unsafeUnwrap()).toEqual({ linked: 1 })
    expect(h.updateCalls).toEqual([
      {
        recordId: 'vendor_bill_line:l1',
        values: { vendor_bill_line_purchase_order_line: 'purchase_order_line:pol1' },
      },
    ])
  })

  it('resolves grni ONCE and writes one update call per line', async () => {
    h.grniAccountId = 'acct_1'
    setupRows({
      billOrder: [{ entityId: 'bill_1', relatedEntityId: 'po_1' }],
      lineBill: [
        { entityId: 'l1', relatedEntityId: 'bill_1' },
        { entityId: 'l2', relatedEntityId: 'bill_1' },
      ],
      orderLineOrder: [
        { entityId: 'pol1', relatedEntityId: 'po_1' },
        { entityId: 'pol2', relatedEntityId: 'po_1' },
      ],
      orderLinePart: [
        { entityId: 'pol1', relatedEntityId: 'part_1' },
        { entityId: 'pol2', relatedEntityId: 'part_2' },
      ],
    })

    const result = await linkBillLines(db, 'org_1', 'user_1', {
      billRecordId: 'vendor_bill:bill_1' as never,
      links: [
        {
          lineRecordId: 'vendor_bill_line:l1' as never,
          orderLineRecordId: 'purchase_order_line:pol1' as never,
        },
        {
          lineRecordId: 'vendor_bill_line:l2' as never,
          orderLineRecordId: 'purchase_order_line:pol2' as never,
        },
      ],
    })

    expect(result._unsafeUnwrap()).toEqual({ linked: 2 })
    expect(h.updateCalls).toHaveLength(2)
    expect(
      h.updateCalls.every((call) => call.values.vendor_bill_line_gl_account === 'acct_1')
    ).toBe(true)
  })

  it('refuses when the bill has no purchase order', async () => {
    setupRows({
      billOrder: [{ entityId: 'bill_1', relatedEntityId: null }],
      lineBill: [],
      orderLineOrder: [],
      orderLinePart: [],
    })

    const result = await linkBillLines(db, 'org_1', 'user_1', {
      billRecordId: 'vendor_bill:bill_1' as never,
      links: [
        {
          lineRecordId: 'vendor_bill_line:l1' as never,
          orderLineRecordId: 'purchase_order_line:pol1' as never,
        },
      ],
    })

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(UnprocessableEntityError)
    expect(h.updateCalls).toEqual([])
  })
})
