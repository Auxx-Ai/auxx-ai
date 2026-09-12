// packages/lib/src/money/credit-memo-posting/__tests__/reads.test.ts
//
// The netting read, the two per-memo reads it replaces with set-based ones, and
// the close count.
//
// 🛑 The netting PREDICATE is asserted structurally. The three cases in it are
// the whole netting contract (§4.2) - a null stamp, a stamp naming a posting
// that is gone, or one naming a `reversed` posting - and a refactor that dropped
// any of them would strand a reversed period's memos silently: they would simply
// never be offered again.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  lock: { lockedThroughMonth: null } as { lockedThroughMonth: string | null },
  /** Row sets the stubbed `db.select()` serves, in order. */
  selects: [] as unknown[][],
  /** Every argument every chained query-builder method was handed. */
  captured: [] as unknown[],
  missingFields: [] as string[],
  gateways: [] as Array<{ handles: string[]; clearingGlAccountId: string }>,
  listPaymentGatewayCalls: 0,
}))

vi.mock('../../../cache', () => ({
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attributes: string[]) =>
        Object.fromEntries(
          attributes.map((attribute) => [
            attribute,
            h.missingFields.includes(attribute) ? null : { id: `f_${attribute}` },
          ])
        ),
    }),
  }),
}))

vi.mock('../../../postings/post-entry', () => ({ LEDGER_CURRENCY: 'USD' }))
vi.mock('../../../postings/period-lock', () => ({ resolvePeriodLock: async () => h.lock }))
vi.mock('../../../settings/settings-service', () => ({
  getOrganizationSetting: async ({ key }: { key: string }) => h.settings[key] ?? null,
}))
vi.mock('../../../payment-gateways', async () => {
  const { ok } = await import('neverthrow')
  return {
    listPaymentGateways: async () => {
      h.listPaymentGatewayCalls += 1
      return ok([])
    },
    // The real `toGatewayRoutes` maps stored rows; the routes themselves are
    // what `matchGatewayRoute` (kept REAL) consumes, so the fixture is the
    // route list directly.
    toGatewayRoutes: () => h.gateways,
  }
})

import type { Database } from '@auxx/database'
import {
  CLOSE_BLOCKING_EXCLUSION_REASONS,
  countUnpostedCreditMemos,
  listCreditMemoPostings,
  readCreditMemoPostingSettings,
  readCreditMemoSettlementAccounts,
  readUnpostedCreditMemos,
} from '../reads'
import type { UnpostedCreditMemo } from '../types'

const ORG = 'abgwpa1l81reht2zmwrcihfu'

/** A drizzle query-builder stub: every chained method records its argument. */
function stubDb(): Database {
  let index = 0
  const chain = (): Record<string, unknown> => {
    const self: Record<string, unknown> = {}
    for (const method of ['from', 'where', 'limit', 'orderBy', 'innerJoin', 'leftJoin']) {
      self[method] = (...args: unknown[]) => {
        h.captured.push(...args)
        return self
      }
    }
    // biome-ignore lint/suspicious/noThenProperty: chainable drizzle query-builder stub
    self.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(h.selects[index++] ?? []).then(resolve, reject)
    return self
  }
  return { select: () => chain() } as unknown as Database
}

/** Everything in a drizzle condition tree that reads as text: chunks, columns, params. */
function conditionText(node: unknown, depth = 0): string {
  if (depth > 24 || node == null) return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number' || typeof node === 'boolean') return String(node)
  if (Array.isArray(node)) return node.map((item) => conditionText(item, depth + 1)).join(' ')
  if (typeof node !== 'object') return ''
  const record = node as Record<string, unknown>
  const parts: string[] = []
  for (const key of ['queryChunks', 'value', 'name', 'left', 'right', 'sql']) {
    if (key in record) parts.push(conditionText(record[key], depth + 1))
  }
  return parts.join(' ')
}

/** The netting statement's own `where`, found by the range bound only it carries. */
function nettingWhere(): string {
  return (
    h.captured
      .map((node) => conditionText(node))
      .find((text) => text.includes('2026-01-01T00:00:00.000Z')) ?? ''
  )
}

interface MemoSpec {
  id: string
  number: string
  status?: string
  source?: string
  issuedAt?: string
  subtotal?: number
  tax?: number
  total?: number
  refunded?: number
  contactId?: string | null
  orderId?: string | null
}

interface OrderSpec {
  id: string
  currency?: string | null
  shippedAt?: string[]
  gateways?: string[]
}

function value(entityId: string, attribute: string, row: Record<string, unknown>) {
  return {
    entityId,
    fieldId: `f_${attribute}`,
    valueText: null,
    valueNumber: null,
    valueDate: null,
    valueJson: null,
    optionId: null,
    relatedEntityId: null,
    ...row,
  }
}

function memoValues(spec: MemoSpec): unknown[] {
  const issuedAt = spec.issuedAt ?? '2026-01-14'
  return [
    value(spec.id, 'credit_memo_number', { valueText: spec.number }),
    value(spec.id, 'credit_memo_status', { optionId: spec.status ?? 'issued' }),
    value(spec.id, 'credit_memo_source', { optionId: spec.source ?? 'channel' }),
    value(spec.id, 'credit_memo_issued_at', { valueDate: `${issuedAt}T12:00:00.000Z` }),
    value(spec.id, 'credit_memo_subtotal', { valueNumber: spec.subtotal ?? 10_000 }),
    value(spec.id, 'credit_memo_tax_total', { valueNumber: spec.tax ?? 0 }),
    value(spec.id, 'credit_memo_total', { valueNumber: spec.total ?? 10_000 }),
    value(spec.id, 'credit_memo_amount_refunded', { valueNumber: spec.refunded ?? 10_000 }),
    value(spec.id, 'credit_memo_contact', {
      relatedEntityId: spec.contactId === undefined ? 'ct_1' : spec.contactId,
    }),
    value(spec.id, 'credit_memo_order', {
      relatedEntityId: spec.orderId === undefined ? 'ord_1' : spec.orderId,
    }),
  ]
}

function orderValues(spec: OrderSpec): unknown[] {
  return [
    value(spec.id, 'order_currency', { valueText: spec.currency ?? 'USD' }),
    value(spec.id, 'order_fulfillments', {
      valueJson: {
        v: {
          fulfillments: (spec.shippedAt ?? []).map((shippedAt, index) => ({
            sequence: index + 1,
            shippedAt,
          })),
        },
      },
    }),
  ]
}

/** Queue the three row sets `readUnpostedCreditMemos` reads, in its own order. */
function queue(memos: MemoSpec[], orders: OrderSpec[] = [{ id: 'ord_1', shippedAt: [] }]): void {
  h.selects = [
    memos.map((memo) => ({ creditMemoId: memo.id })),
    memos.flatMap(memoValues),
    orders.flatMap(orderValues),
  ]
}

const RANGE = { from: '2026-01-01', to: '2026-02-01' }

beforeEach(() => {
  h.settings = { 'accounting.cutoffPeriod': null, 'accounting.bookTimeZone': 'America/Los_Angeles' }
  h.lock = { lockedThroughMonth: null }
  h.selects = []
  h.captured = []
  h.missingFields = []
  h.gateways = []
  h.listPaymentGatewayCalls = 0
})

describe('the netting read', () => {
  it('reads every field the planner and the builder need off one pivot', async () => {
    queue([{ id: 'cm_1', number: 'CM-0001' }], [{ id: 'ord_1', shippedAt: ['2026-01-02'] }])

    const memos = (
      await readUnpostedCreditMemos(stubDb(), {
        organizationId: ORG,
        range: RANGE,
      })
    )._unsafeUnwrap()

    expect(memos).toEqual([
      {
        creditMemoId: 'cm_1',
        number: 'CM-0001',
        issuedAt: '2026-01-14',
        status: 'issued',
        source: 'channel',
        currency: 'USD',
        subtotalMinor: 10_000,
        taxTotalMinor: 0,
        totalMinor: 10_000,
        amountRefundedMinor: 10_000,
        contactId: 'ct_1',
        orderId: 'ord_1',
        reverseRevenue: true,
      } satisfies UnpostedCreditMemo,
    ])
  })

  // 🛑 §4.2. Reading only the null case strands every memo of a reversed run.
  it('nets on a null stamp, a posting that is gone, AND a reversed posting', async () => {
    queue([{ id: 'cm_1', number: 'CM-0001' }])

    await readUnpostedCreditMemos(stubDb(), { organizationId: ORG, range: RANGE })

    // Two `is null`s - the stamp's own cell and the LEFT JOIN's miss on the
    // posting it names - and one `reversed`.
    expect(nettingWhere().match(/is null/g)).toHaveLength(2)
    expect(nettingWhere()).toContain('reversed')
  })

  it('joins the stamp on the declared field rather than scanning a JSON cell', async () => {
    queue([{ id: 'cm_1', number: 'CM-0001' }])

    await readUnpostedCreditMemos(stubDb(), { organizationId: ORG, range: RANGE })

    const joins = h.captured.map((node) => conditionText(node)).join(' | ')
    expect(joins).toContain('f_credit_memo_gl_posting')
  })

  it('keeps the range half-open on the issue day', async () => {
    queue([{ id: 'cm_1', number: 'CM-0001' }])

    await readUnpostedCreditMemos(stubDb(), { organizationId: ORG, range: RANGE })

    expect(nettingWhere()).toContain('2026-01-01T00:00:00.000Z')
    expect(nettingWhere()).toContain('2026-02-01T00:00:00.000Z')
  })

  it('refuses a range bound that is not a calendar day', async () => {
    const result = await readUnpostedCreditMemos(stubDb(), {
      organizationId: ORG,
      range: { from: 'January', to: '2026-02-01' },
    })

    expect(result.isErr()).toBe(true)
  })

  it('reads as no memos on an org that has not seeded the credit memo def', async () => {
    h.missingFields = ['credit_memo_status']
    queue([{ id: 'cm_1', number: 'CM-0001' }])

    const memos = (
      await readUnpostedCreditMemos(stubDb(), {
        organizationId: ORG,
        range: RANGE,
      })
    )._unsafeUnwrap()

    expect(memos).toEqual([])
  })

  // An org that has not run entity migration 152 has stamped nothing, so every
  // memo IS unposted - one query, not two code paths.
  it('reads every memo as unposted when the org has no stamp field yet', async () => {
    h.missingFields = ['credit_memo_gl_posting']
    queue([{ id: 'cm_1', number: 'CM-0001' }])

    const memos = (
      await readUnpostedCreditMemos(stubDb(), {
        organizationId: ORG,
        range: RANGE,
      })
    )._unsafeUnwrap()

    expect(memos).toHaveLength(1)
  })

  it('takes the currency from the memo order, and leaves a native memo blank', async () => {
    queue(
      [
        { id: 'cm_1', number: 'CM-0001' },
        { id: 'cm_2', number: 'CM-0002', source: 'native', orderId: null },
      ],
      [{ id: 'ord_1', currency: 'CAD' }]
    )

    const memos = (
      await readUnpostedCreditMemos(stubDb(), {
        organizationId: ORG,
        range: RANGE,
      })
    )._unsafeUnwrap()

    expect(memos.map((memo) => memo.currency)).toEqual(['CAD', null])
  })

  it('reads the order fields ONCE for every memo that names the same order', async () => {
    queue(
      [
        { id: 'cm_1', number: 'CM-0001' },
        { id: 'cm_2', number: 'CM-0002' },
        { id: 'cm_3', number: 'CM-0003' },
      ],
      [{ id: 'ord_1', shippedAt: ['2026-01-02'] }]
    )
    const db = stubDb()

    const memos = (
      await readUnpostedCreditMemos(db, {
        organizationId: ORG,
        range: RANGE,
      })
    )._unsafeUnwrap()

    // Three queries, whatever the memo count: the netting join, the memo pivot,
    // the order pivot. A fourth would mean a read crept into the loop.
    expect(memos).toHaveLength(3)
    expect(h.selects).toHaveLength(3)
  })
})

// §3.1 item 3, decided on the READ because it needs the shipment log.
describe('reverseRevenue', () => {
  const cases: Array<[string, MemoSpec, OrderSpec[], boolean]> = [
    [
      'a channel memo whose order shipped before it was issued',
      { id: 'cm_1', number: 'CM-0001', issuedAt: '2026-01-14' },
      [{ id: 'ord_1', shippedAt: ['2026-01-02'] }],
      true,
    ],
    [
      'a channel memo issued on the day the order shipped',
      { id: 'cm_1', number: 'CM-0001', issuedAt: '2026-01-14' },
      [{ id: 'ord_1', shippedAt: ['2026-01-14'] }],
      true,
    ],
    [
      'a channel memo whose order shipped AFTER it was issued (the CM-0091 case)',
      { id: 'cm_1', number: 'CM-0001', issuedAt: '2026-01-14' },
      [{ id: 'ord_1', shippedAt: ['2026-01-20'] }],
      false,
    ],
    [
      'a channel memo whose order never shipped',
      { id: 'cm_1', number: 'CM-0001' },
      [{ id: 'ord_1', shippedAt: [] }],
      false,
    ],
    [
      'a channel memo with no order at all',
      { id: 'cm_1', number: 'CM-0001', orderId: null },
      [],
      false,
    ],
    [
      'a native memo, which exists only where an invoice was issued',
      { id: 'cm_1', number: 'CM-0001', source: 'native', orderId: null },
      [],
      true,
    ],
  ]

  for (const [what, spec, orders, expected] of cases) {
    it(`is ${expected} for ${what}`, async () => {
      queue([spec], orders)

      const memos = (
        await readUnpostedCreditMemos(stubDb(), {
          organizationId: ORG,
          range: RANGE,
        })
      )._unsafeUnwrap()

      expect(memos[0]?.reverseRevenue).toBe(expected)
    })
  }

  it('takes the EARLIEST shipment in a multi-shipment log', async () => {
    queue(
      [{ id: 'cm_1', number: 'CM-0001', issuedAt: '2026-01-14' }],
      [{ id: 'ord_1', shippedAt: ['2026-01-20', '2026-01-02'] }]
    )

    const memos = (
      await readUnpostedCreditMemos(stubDb(), {
        organizationId: ORG,
        range: RANGE,
      })
    )._unsafeUnwrap()

    expect(memos[0]?.reverseRevenue).toBe(true)
  })
})

// §3.1 item 1: an Affirm memo and a card memo in one group must stay two credit
// lines, or `1210` is overstated forever in an entry that balances.
describe('the settlement accounts', () => {
  function memo(overrides: Partial<UnpostedCreditMemo> = {}): UnpostedCreditMemo {
    return {
      creditMemoId: 'cm_1',
      number: 'CM-0001',
      issuedAt: '2026-01-14',
      status: 'issued',
      source: 'channel',
      currency: 'USD',
      subtotalMinor: 10_000,
      taxTotalMinor: 0,
      totalMinor: 10_000,
      amountRefundedMinor: 10_000,
      contactId: 'ct_1',
      orderId: 'ord_1',
      reverseRevenue: true,
      ...overrides,
    }
  }

  it('routes a memo whose order names exactly one matched gateway', async () => {
    h.gateways = [{ handles: ['affirm'], clearingGlAccountId: 'acct_1210' }]
    h.selects = [[value('ord_1', 'order_payment_gateways', { optionId: 'affirm' })]]

    const accounts = (
      await readCreditMemoSettlementAccounts(stubDb(), {
        organizationId: ORG,
        memos: [memo()],
      })
    )._unsafeUnwrap()

    expect(accounts.get('cm_1')).toBe('acct_1210')
  })

  // The role fallback, and NOT a refusal: a refund cannot be refused, because
  // the money has already moved (§7).
  const fallbacks: Array<[string, unknown[]]> = [
    ['an order naming no gateway', []],
    [
      'an order naming two gateways',
      [
        value('ord_1', 'order_payment_gateways', { optionId: 'affirm' }),
        value('ord_1', 'order_payment_gateways', { optionId: 'shopify_payments' }),
      ],
    ],
    [
      'a gateway no payment_gateway record claims',
      [value('ord_1', 'order_payment_gateways', { optionId: 'bogus' })],
    ],
  ]

  for (const [what, rows] of fallbacks) {
    it(`leaves ${what} to the clearing_card role`, async () => {
      h.gateways = [{ handles: ['affirm'], clearingGlAccountId: 'acct_1210' }]
      h.selects = [rows]

      const accounts = (
        await readCreditMemoSettlementAccounts(stubDb(), {
          organizationId: ORG,
          memos: [memo()],
        })
      )._unsafeUnwrap()

      expect(accounts.has('cm_1')).toBe(false)
    })
  }

  it('reads nothing at all for memos with no money leg', async () => {
    const accounts = (
      await readCreditMemoSettlementAccounts(stubDb(), {
        organizationId: ORG,
        memos: [
          memo({ creditMemoId: 'native', source: 'native' }),
          memo({ creditMemoId: 'unrefunded', amountRefundedMinor: 0 }),
          memo({ creditMemoId: 'orderless', orderId: null }),
        ],
      })
    )._unsafeUnwrap()

    expect(accounts.size).toBe(0)
    expect(h.listPaymentGatewayCalls).toBe(0)
  })

  // ⚠️ The whole reason this read exists instead of a loop over
  // `resolveSettlementAccount`: 1,061 memos would be 2,122 queries.
  it('reads the routing table ONCE for the whole batch', async () => {
    h.gateways = [{ handles: ['affirm'], clearingGlAccountId: 'acct_1210' }]
    h.selects = [
      [
        value('ord_1', 'order_payment_gateways', { optionId: 'affirm' }),
        value('ord_2', 'order_payment_gateways', { optionId: 'nomatch' }),
      ],
    ]

    const accounts = (
      await readCreditMemoSettlementAccounts(stubDb(), {
        organizationId: ORG,
        memos: [
          memo({ creditMemoId: 'a' }),
          memo({ creditMemoId: 'b' }),
          memo({ creditMemoId: 'c', orderId: 'ord_2' }),
        ],
      })
    )._unsafeUnwrap()

    expect(h.listPaymentGatewayCalls).toBe(1)
    expect([...accounts.entries()]).toEqual([
      ['a', 'acct_1210'],
      ['b', 'acct_1210'],
    ])
  })
})

// §9.1: a month holding an issued-but-unposted memo must refuse to close.
describe('the close count', () => {
  it('counts an issued memo that owes the ledger a posting', async () => {
    queue([{ id: 'cm_1', number: 'CM-0001' }])

    const count = (
      await countUnpostedCreditMemos(stubDb(), {
        organizationId: ORG,
        month: '2026-01',
      })
    )._unsafeUnwrap()

    expect(count).toBe(1)
  })

  // §7: `not-issued` does NOT block a close. `countUnissuedChannelCreditMemos`
  // already refuses over an unissued channel draft, and a native draft is a
  // person's scratch pad rather than revenue the books are missing.
  it('does not count a draft', async () => {
    queue([{ id: 'cm_1', number: 'CM-0001', status: 'draft' }])

    const count = (
      await countUnpostedCreditMemos(stubDb(), {
        organizationId: ORG,
        month: '2026-01',
      })
    )._unsafeUnwrap()

    expect(count).toBe(0)
  })

  // The trap the first fulfillment drive hit: one zero-value order kept July
  // unclosable after every day had posted.
  it('does not count a memo excluded for good', async () => {
    queue([{ id: 'cm_1', number: 'CM-0001', subtotal: 0, tax: 0, total: 0, refunded: 0 }])

    const count = (
      await countUnpostedCreditMemos(stubDb(), {
        organizationId: ORG,
        month: '2026-01',
      })
    )._unsafeUnwrap()

    expect(count).toBe(0)
  })

  it('counts a memo excluded for a reason that needs a person', async () => {
    queue([{ id: 'cm_1', number: 'CM-0001' }], [{ id: 'ord_1', currency: 'EUR' }])

    const count = (
      await countUnpostedCreditMemos(stubDb(), {
        organizationId: ORG,
        month: '2026-01',
      })
    )._unsafeUnwrap()

    expect(count).toBe(1)
    expect([...CLOSE_BLOCKING_EXCLUSION_REASONS]).toEqual(['foreign-currency', 'missing-contact'])
  })

  it('refuses a month that is not a YYYY-MM', async () => {
    const result = await countUnpostedCreditMemos(stubDb(), {
      organizationId: ORG,
      month: '2026-1',
    })

    expect(result.isErr()).toBe(true)
  })

  it('is zero on a month with nothing in it, without reading the settings', async () => {
    h.selects = [[]]

    const count = (
      await countUnpostedCreditMemos(stubDb(), {
        organizationId: ORG,
        month: '2026-01',
      })
    )._unsafeUnwrap()

    expect(count).toBe(0)
  })
})

// §3.3: the memo's ledger card reads the posting the memo is STAMPED with, never
// one whose lines name it - a batched memo has no line naming it at all.
describe('the stamped posting read', () => {
  it('returns the posting the stamp names, with its current status', async () => {
    h.selects = [
      [{ valueText: 'gl_1' }],
      [{ id: 'gl_1', docNumber: 'AUXX-CRM-202601', status: 'posted' }],
    ]

    const refs = (
      await listCreditMemoPostings(stubDb(), {
        organizationId: ORG,
        creditMemoId: 'cm_1',
      })
    )._unsafeUnwrap()

    expect(refs).toEqual([{ glPostingId: 'gl_1', docNumber: 'AUXX-CRM-202601', status: 'posted' }])
  })

  it('renders a reversed stamp as reversed rather than hiding it', async () => {
    h.selects = [[{ valueText: 'gl_1' }], [{ id: 'gl_1', docNumber: null, status: 'reversed' }]]

    const refs = (
      await listCreditMemoPostings(stubDb(), {
        organizationId: ORG,
        creditMemoId: 'cm_1',
      })
    )._unsafeUnwrap()

    expect(refs[0]?.status).toBe('reversed')
    expect(refs[0]?.docNumber).toBeNull()
  })

  it('reads an unstamped memo as no postings', async () => {
    h.selects = [[]]

    const refs = (
      await listCreditMemoPostings(stubDb(), {
        organizationId: ORG,
        creditMemoId: 'cm_1',
      })
    )._unsafeUnwrap()

    expect(refs).toEqual([])
  })

  it('drops a stamp naming a posting that no longer exists', async () => {
    h.selects = [[{ valueText: 'gl_gone' }], []]

    const refs = (
      await listCreditMemoPostings(stubDb(), {
        organizationId: ORG,
        creditMemoId: 'cm_1',
      })
    )._unsafeUnwrap()

    expect(refs).toEqual([])
  })
})

describe('the settings read', () => {
  it('reads the cutoff, the lock, the zone and the ledger currency', async () => {
    h.settings = {
      'accounting.cutoffPeriod': ' 2025-12 ',
      'accounting.bookTimeZone': 'America/Los_Angeles',
    }
    h.lock = { lockedThroughMonth: '2026-01' }

    const settings = (await readCreditMemoPostingSettings(stubDb(), ORG))._unsafeUnwrap()

    expect(settings).toEqual({
      cutoffPeriod: '2025-12',
      lockedThroughMonth: '2026-01',
      timeZone: 'America/Los_Angeles',
      ledgerCurrency: 'USD',
    })
  })

  // 🛑 Null rather than a 'UTC' default: `run.ts` refuses on it rather than
  // cutting day boundaries in a zone nobody chose.
  it('reports a blank book time zone as null', async () => {
    h.settings = { 'accounting.bookTimeZone': '   ' }

    const settings = (await readCreditMemoPostingSettings(stubDb(), ORG))._unsafeUnwrap()

    expect(settings.timeZone).toBeNull()
  })
})
