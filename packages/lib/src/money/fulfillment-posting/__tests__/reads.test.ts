// packages/lib/src/money/fulfillment-posting/__tests__/reads.test.ts
//
// The netting read, its month arithmetic, and the two shapes it is easy to get
// silently wrong: a TAGS gateway stored as an opaque option key rather than a
// name, and a `line_item_tax_total` that is absent rather than zero.
//
// 🛑 The statement itself is asserted as TEXT. It is the one piece of this
// module a unit test cannot execute, and the three predicates in it are the
// whole netting contract - a null stamp, a `reversed` posting, or a stamp
// naming a posting that is gone. A refactor that dropped one of those would
// silently re-post a reversed day's revenue, and nothing else in the suite
// would notice.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  lock: { lockedThroughMonth: null } as { lockedThroughMonth: string | null },
  executed: [] as unknown[],
  executeRows: [] as unknown[],
  selects: [] as unknown[][],
  contextMissing: false,
  // brief 13 §5: per-order tax lines the mocked `readOrderTaxLines` returns.
  taxLinesByOrder: new Map<string, Array<{ title: string; priceMinor: number }>>(),
}))

const FIELD_IDS = {
  order_number: 'f_number',
  order_channel: 'f_channel',
  order_currency: 'f_currency',
  order_subtotal: 'f_subtotal',
  order_tax_total: 'f_tax',
  order_shipping_total: 'f_shipping',
  order_total: 'f_total',
  order_fulfillment_status: 'f_fulfillment_status',
  order_line_items: 'f_line_items',
  order_fulfillments: 'f_fulfillments',
  order_financial_status: 'f_financial_status',
  order_payment_gateways: 'f_gateways',
  order_contact: 'f_contact',
  line_item_name: 'f_line_name',
  line_item_qty: 'f_line_qty',
  line_item_unit_price: 'f_line_price',
  line_item_tax_total: 'f_line_tax',
  line_item_sort_order: 'f_line_sort',
} as const

vi.mock('../../orders/reads', async () => {
  const actual = await vi.importActual<typeof import('../../orders/reads')>('../../orders/reads')
  const field = (id: string, options?: unknown) => ({ id, options })
  return {
    // The tolerant parser stays REAL: `listOrderFulfillmentPostings` reading the
    // same log everything else reads is the property under test.
    parseFulfillments: actual.parseFulfillments,
    requireOrderFieldContext: async () => {
      if (h.contextMissing) throw new Error('order fields are not provisioned')
      const entries = Object.entries(FIELD_IDS).map(([attribute, id]) => [
        attribute,
        field(
          id,
          attribute === 'order_payment_gateways'
            ? { options: [{ value: 'opt_sp', label: 'shopify_payments' }] }
            : undefined
        ),
      ])
      const all = Object.fromEntries(entries)
      return { orderDefId: 'def_order', order: all, line: all }
    },
    // Empty by default (brief 13 §5) - no test in this file is about the
    // jurisdiction split, which `split-tax-by-jurisdiction.test.ts` owns. A
    // test that cares sets `h.taxLinesByOrder`.
    readOrderTaxLines: async () => h.taxLinesByOrder,
  }
})

vi.mock('../../../postings/post-entry', () => ({ LEDGER_CURRENCY: 'USD' }))
vi.mock('../../../postings/period-lock', () => ({ resolvePeriodLock: async () => h.lock }))
vi.mock('../../../settings/settings-service', () => ({
  getOrganizationSetting: async ({ key }: { key: string }) => h.settings[key] ?? null,
}))

import type { Database } from '@auxx/database'
import {
  countCloseBlockingShipments,
  countUnpostedShipments,
  listOrderFulfillmentPostings,
  readFulfillmentPostingSettings,
  readUnpostedShipments,
} from '../reads'
import type { FulfillmentPostingExclusionReason, FulfillmentPostingPlan } from '../types'

const ORG = 'abgwpa1l81reht2zmwrcihfu'

/**
 * A drizzle query-builder stub: every chained method returns itself, and the
 * awaited form serves the next queued row set.
 */
function stubDb(): Database {
  let index = 0
  const chain = (): Record<string, unknown> => {
    const self: Record<string, unknown> = {}
    for (const method of ['from', 'where', 'limit', 'orderBy', 'innerJoin', 'leftJoin']) {
      self[method] = () => self
    }
    // biome-ignore lint/suspicious/noThenProperty: chainable drizzle query-builder stub
    self.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(h.selects[index++] ?? []).then(resolve, reject)
    return self
  }
  return {
    select: () => chain(),
    execute: async (statement: unknown) => {
      h.executed.push(statement)
      return { rows: h.executeRows }
    },
  } as unknown as Database
}

/**
 * Everything in a drizzle `sql` object that is a string: the raw SQL chunks and
 * every bound parameter, flattened so a test can assert on both.
 */
function sqlText(node: unknown, depth = 0): string {
  if (depth > 8 || node == null) return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number' || typeof node === 'boolean') return String(node)
  if (Array.isArray(node)) return node.map((item) => sqlText(item, depth + 1)).join(' ')
  if (typeof node !== 'object') return ''
  const record = node as Record<string, unknown>
  if (Array.isArray(record.queryChunks)) return sqlText(record.queryChunks, depth + 1)
  if ('value' in record) return sqlText(record.value, depth + 1)
  if (typeof record.name === 'string') return record.name
  return ''
}

/** One row of the netting statement, as the driver hands it back. */
function entryRow(overrides: Record<string, unknown> = {}) {
  return {
    order_id: 'ord_1',
    sequence: 1,
    shipped_at: '2026-07-06',
    prior_subtotal_minor: 0,
    shipping_recognised: false,
    lines: [{ lineId: 'li_1', quantity: 2 }],
    ...overrides,
  }
}

/** One `FieldValue` row, in the columns the read selects. */
function value(
  entityId: string,
  fieldId: string,
  columns: Partial<{
    valueText: string | null
    valueNumber: number | null
    optionId: string | null
    relatedEntityId: string | null
  }> = {}
) {
  return {
    entityId,
    fieldId,
    valueText: null,
    valueNumber: null,
    optionId: null,
    relatedEntityId: null,
    sortKey: 0,
    ...columns,
  }
}

/** A whole order, plus one line, as `FieldValue` rows. */
function orderValues() {
  return [
    value('ord_1', FIELD_IDS.order_number, { valueText: '#1001' }),
    value('ord_1', FIELD_IDS.order_channel, { optionId: 'dtc' }),
    value('ord_1', FIELD_IDS.order_currency, { valueText: 'USD' }),
    value('ord_1', FIELD_IDS.order_financial_status, { optionId: 'paid' }),
    value('ord_1', FIELD_IDS.order_payment_gateways, { optionId: 'opt_sp' }),
    value('ord_1', FIELD_IDS.order_subtotal, { valueNumber: 19_999.999_999_999_996 }),
    value('ord_1', FIELD_IDS.order_tax_total, { valueNumber: 800 }),
    value('ord_1', FIELD_IDS.order_shipping_total, { valueNumber: 1_500 }),
    value('ord_1', FIELD_IDS.order_contact, { relatedEntityId: 'ct_1' }),
    value('li_1', FIELD_IDS.line_item_name, { valueText: 'Widget' }),
    value('li_1', FIELD_IDS.line_item_qty, { valueNumber: 4 }),
    value('li_1', FIELD_IDS.line_item_unit_price, { valueNumber: 5_000 }),
  ]
}

beforeEach(() => {
  h.settings = {
    'accounting.cutoffPeriod': '2025-12',
    'accounting.bookTimeZone': 'America/Los_Angeles',
  }
  h.lock = { lockedThroughMonth: null }
  h.executed = []
  h.executeRows = []
  h.selects = []
  h.contextMissing = false
  h.taxLinesByOrder = new Map()
})

describe('the netting statement', () => {
  beforeEach(async () => {
    h.executeRows = [entryRow()]
    // The same rows answer BOTH bounded reads: they bucket on disjoint entity
    // ids, so one array standing in for two queries cannot cross-contaminate.
    h.selects = [orderValues(), orderValues()]
    await readUnpostedShipments(stubDb(), {
      organizationId: ORG,
      range: { from: '2026-07-01', to: '2026-08-01' },
    })
  })

  it('expands the shipment log out of the JSON cell', () => {
    expect(sqlText(h.executed[0])).toContain('jsonb_array_elements')
  })

  it('left-joins the stamped posting to read its status', () => {
    const text = sqlText(h.executed[0])
    expect(text).toContain('LEFT JOIN')
    expect(text).toContain("'reversed'")
  })

  // 🛑 The three ways a shipment is unposted, all in one predicate.
  it('keeps a null stamp, a reversed posting and a stamp naming a posting that is gone', () => {
    const text = sqlText(h.executed[0]).replace(/\s+/g, ' ')
    // Three legs, in one OR, in this order: no stamp at all, a stamp naming a
    // posting that is gone (the join found nothing), and a reversed posting.
    // The column names render as empty here because a drizzle `sql` object
    // carries them as objects rather than as text, so the assertion is on the
    // predicate's shape.
    const predicate = text.slice(text.indexOf('gl_posting_id IS NULL'))
    expect(predicate).toContain("gl_posting_id IS NULL OR IS NULL OR = 'reversed'")
  })

  it('sums the subtotal of every EARLIER sequence of the same order', () => {
    const text = sqlText(h.executed[0]).replace(/\s+/g, ' ')
    expect(text).toContain('PARTITION BY expanded.order_id')
    expect(text).toContain('ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING')
  })

  it('binds the half-open range and the organization', () => {
    const text = sqlText(h.executed[0])
    expect(text).toContain('2026-07-01')
    expect(text).toContain('2026-08-01')
    expect(text).toContain(ORG)
  })

  it('tolerates both spellings of the stored envelope', () => {
    const text = sqlText(h.executed[0]).replace(/\s+/g, ' ')
    expect(text).toContain("-> 'v' -> 'fulfillments'")
    expect(text).toContain("-> 'fulfillments'")
  })
})

describe('readUnpostedShipments', () => {
  beforeEach(() => {
    h.executeRows = [entryRow()]
    h.selects = [orderValues(), orderValues()]
  })

  it('hangs the order and line facts on the shipment', async () => {
    const result = await readUnpostedShipments(stubDb(), {
      organizationId: ORG,
      range: { from: '2026-07-01', to: '2026-08-01' },
    })

    expect(result._unsafeUnwrap()).toEqual([
      {
        orderId: 'ord_1',
        orderNumber: '#1001',
        sequence: 1,
        shippedAt: '2026-07-06',
        lines: [
          {
            lineId: 'li_1',
            quantity: 2,
            unitPriceMinor: 5_000,
            lineTaxMinor: null,
            orderedQuantity: 4,
            name: 'Widget',
          },
        ],
        channel: 'dtc',
        currency: 'USD',
        financialStatus: 'paid',
        gateways: ['shopify_payments'],
        // 🛑 Rounded, not refused: `FieldValue.valueNumber` is a double and
        // 20_000 reads back as 19999.999999999996. Refusing here would take a
        // 500-order run down for a rounding artefact.
        orderSubtotalMinor: 20_000,
        orderTaxTotalMinor: 800,
        orderShippingTotalMinor: 1_500,
        priorShipmentsSubtotalMinor: 0,
        includeShipping: false,
        contactId: 'ct_1',
        // Empty: the mocked `readOrderTaxLines` returns nothing (brief 13 §5).
        taxLines: [],
      },
    ])
  })

  // brief 13 §5: the bulk tax-line read is threaded onto the shipment it
  // belongs to, verbatim - the split itself is `splitTaxByJurisdiction`'s job.
  it('carries the order own tax lines onto its shipment', async () => {
    h.taxLinesByOrder = new Map([
      [
        'ord_1',
        [
          { title: 'CA State Tax', priceMinor: 600 },
          { title: 'CA District Tax', priceMinor: 200 },
        ],
      ],
    ])

    const result = await readUnpostedShipments(stubDb(), {
      organizationId: ORG,
      range: { from: '2026-07-01', to: '2026-08-01' },
    })

    expect(result._unsafeUnwrap()[0]?.taxLines).toEqual([
      { title: 'CA State Tax', priceMinor: 600 },
      { title: 'CA District Tax', priceMinor: 200 },
    ])
  })

  // 🛑 A TAGS value is an opaque option KEY, and the debit fork compares gateway
  // NAMES. Reading `optionId` straight through would send every card order to
  // `gateway-ambiguous` or worse, silently.
  it('resolves a gateway option key back to its name', async () => {
    const result = await readUnpostedShipments(stubDb(), {
      organizationId: ORG,
      range: { from: '2026-07-01', to: '2026-08-01' },
    })

    expect(result._unsafeUnwrap()[0]?.gateways).toEqual(['shopify_payments'])
  })

  it('falls back to the stored key when no option matches it', async () => {
    h.selects = [
      [...orderValues(), value('ord_1', FIELD_IDS.order_payment_gateways, { optionId: 'Affirm' })],
      orderValues(),
    ]

    const result = await readUnpostedShipments(stubDb(), {
      organizationId: ORG,
      range: { from: '2026-07-01', to: '2026-08-01' },
    })

    expect(result._unsafeUnwrap()[0]?.gateways).toEqual(['shopify_payments', 'Affirm'])
  })

  // 🛑 Null is not zero (48 §8.2). A zero here would flip the whole entry onto
  // the per-line tax basis and under-credit sales tax payable.
  it('reads an absent line tax as null and a stored zero as zero', async () => {
    const withTax = [
      ...orderValues(),
      value('li_1', FIELD_IDS.line_item_tax_total, { valueNumber: 0 }),
    ]
    h.selects = [withTax, withTax]

    const result = await readUnpostedShipments(stubDb(), {
      organizationId: ORG,
      range: { from: '2026-07-01', to: '2026-08-01' },
    })

    expect(result._unsafeUnwrap()[0]?.lines[0]?.lineTaxMinor).toBe(0)
  })

  it('carries the prior-subtotal window and the shipping flag through', async () => {
    h.executeRows = [
      entryRow({ sequence: 2, prior_subtotal_minor: '10000', shipping_recognised: true }),
    ]

    const shipment = (
      await readUnpostedShipments(stubDb(), {
        organizationId: ORG,
        range: { from: '2026-07-01', to: '2026-08-01' },
      })
    )._unsafeUnwrap()[0]

    expect(shipment?.priorShipmentsSubtotalMinor).toBe(10_000)
    expect(shipment?.includeShipping).toBe(true)
  })

  it('drops a shipment whose order fields cannot be read at all', async () => {
    h.selects = [[], []]

    const result = await readUnpostedShipments(stubDb(), {
      organizationId: ORG,
      range: { from: '2026-07-01', to: '2026-08-01' },
    })

    expect(result._unsafeUnwrap()).toEqual([])
  })

  it('reads no rows without touching the field reads', async () => {
    h.executeRows = []

    const result = await readUnpostedShipments(stubDb(), {
      organizationId: ORG,
      range: { from: '2026-07-01', to: '2026-08-01' },
    })

    expect(result._unsafeUnwrap()).toEqual([])
  })

  it('refuses a range bound that is not a calendar date', async () => {
    const result = await readUnpostedShipments(stubDb(), {
      organizationId: ORG,
      range: { from: '2026-07', to: '2026-08-01' },
    })

    expect(result._unsafeUnwrapErr().message).toMatch(/YYYY-MM-DD/)
  })
})

describe('countUnpostedShipments', () => {
  it('reads through the SAME statement the list uses', async () => {
    h.executeRows = []

    const result = await countUnpostedShipments(stubDb(), { organizationId: ORG, month: '2026-07' })

    expect(result._unsafeUnwrap()).toBe(0)
    expect(sqlText(h.executed[0])).toContain('jsonb_array_elements')
  })

  it('turns a month into a half-open day range', async () => {
    h.executeRows = []
    await countUnpostedShipments(stubDb(), { organizationId: ORG, month: '2026-07' })

    const text = sqlText(h.executed[0])
    expect(text).toContain('2026-07-01')
    expect(text).toContain('2026-08-01')
  })

  it('rolls December over into the next year', async () => {
    h.executeRows = []
    await countUnpostedShipments(stubDb(), { organizationId: ORG, month: '2026-12' })

    const text = sqlText(h.executed[0])
    expect(text).toContain('2026-12-01')
    expect(text).toContain('2027-01-01')
  })

  it('refuses anything that is not a month', async () => {
    const result = await countUnpostedShipments(stubDb(), {
      organizationId: ORG,
      month: '2026-07-06',
    })

    expect(result._unsafeUnwrapErr().message).toMatch(/YYYY-MM/)
  })
})

describe('countCloseBlockingShipments', () => {
  const exclusion = (reason: FulfillmentPostingExclusionReason) => ({
    orderId: 'o',
    orderNumber: '#1',
    sequence: 1,
    shippedAt: '2026-07-06',
    reason,
    detail: '',
  })
  const plan = (
    shipments: number,
    reasons: FulfillmentPostingExclusionReason[]
  ): FulfillmentPostingPlan => ({
    grouping: 'day',
    groups: [],
    exclusions: reasons.map(exclusion),
    footer: { postings: 0, shipments, orders: 0, excluded: reasons.length, totalMinor: 0 },
  })

  it('counts what would post plus what a person still owes', () => {
    expect(
      countCloseBlockingShipments(
        plan(2, ['foreign-currency', 'gateway-ambiguous', 'test-gateway'])
      )
    ).toBe(5)
  })

  it('lets a zero-value shipment and out-of-range months through', () => {
    expect(
      countCloseBlockingShipments(plan(0, ['zero-value', 'before-cutoff', 'locked-period']))
    ).toBe(0)
  })
})

describe('listOrderFulfillmentPostings', () => {
  /** The stored log cell, then the `GlPosting` rows its stamps name. */
  function stamps(log: unknown[], postings: unknown[]) {
    h.selects = [[{ valueJson: { v: { fulfillments: log } } }], postings]
  }

  it('reports each stamp with the posting status as it stands NOW', async () => {
    stamps(
      [
        { sequence: 1, shippedAt: '2026-07-06', glPostingId: 'gl_1', lines: [] },
        { sequence: 2, shippedAt: '2026-07-09', glPostingId: 'gl_2', lines: [] },
      ],
      [
        { id: 'gl_1', docNumber: 'AUXX-FUL-20260706', status: 'reversed' },
        { id: 'gl_2', docNumber: 'AUXX-FUL-20260709', status: 'posted' },
      ]
    )

    const result = await listOrderFulfillmentPostings(stubDb(), {
      organizationId: ORG,
      orderId: 'ord_1',
    })

    expect(result._unsafeUnwrap()).toEqual([
      {
        sequence: 1,
        shippedAt: '2026-07-06',
        glPostingId: 'gl_1',
        docNumber: 'AUXX-FUL-20260706',
        status: 'reversed',
      },
      {
        sequence: 2,
        shippedAt: '2026-07-09',
        glPostingId: 'gl_2',
        docNumber: 'AUXX-FUL-20260709',
        status: 'posted',
      },
    ])
  })

  it('ignores an unstamped shipment', async () => {
    stamps([{ sequence: 1, shippedAt: '2026-07-06', glPostingId: null, lines: [] }], [])

    expect(
      (
        await listOrderFulfillmentPostings(stubDb(), { organizationId: ORG, orderId: 'ord_1' })
      )._unsafeUnwrap()
    ).toEqual([])
  })

  it('drops a stamp naming a posting that no longer exists', async () => {
    stamps([{ sequence: 1, shippedAt: '2026-07-06', glPostingId: 'gl_gone', lines: [] }], [])

    expect(
      (
        await listOrderFulfillmentPostings(stubDb(), { organizationId: ORG, orderId: 'ord_1' })
      )._unsafeUnwrap()
    ).toEqual([])
  })

  it('returns nothing for an order with no log at all', async () => {
    h.selects = [[], []]

    expect(
      (
        await listOrderFulfillmentPostings(stubDb(), { organizationId: ORG, orderId: 'ord_1' })
      )._unsafeUnwrap()
    ).toEqual([])
  })
})

describe('readFulfillmentPostingSettings', () => {
  it('reads the cutoff, the lock, the zone and the ledger currency', async () => {
    h.lock = { lockedThroughMonth: '2026-06' }

    const result = await readFulfillmentPostingSettings(stubDb(), ORG)

    expect(result._unsafeUnwrap()).toEqual({
      cutoffPeriod: '2025-12',
      lockedThroughMonth: '2026-06',
      timeZone: 'America/Los_Angeles',
      ledgerCurrency: 'USD',
    })
  })

  // 🛑 Null, never a `'UTC'` default: the run refuses on an unset zone rather
  // than dating revenue into the wrong month invisibly (44 lane 4).
  it('reports an unset or blank book time zone as null', async () => {
    h.settings = { 'accounting.bookTimeZone': '   ' }

    expect((await readFulfillmentPostingSettings(stubDb(), ORG))._unsafeUnwrap()).toMatchObject({
      cutoffPeriod: null,
      timeZone: null,
    })
  })
})
