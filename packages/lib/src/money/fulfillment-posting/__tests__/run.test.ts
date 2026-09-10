// packages/lib/src/money/fulfillment-posting/__tests__/run.test.ts
//
// The three properties the run exists to hold:
//
//  1. **The attempt counter.** A day key claims the day once, and a late order
//     backfilled into an already-posted day - or a day that was reversed and is
//     coming back - has to claim the NEXT key. Getting this wrong converges on
//     `already_posted`, which is a SUCCESS status, so the shipments would
//     silently recognise nothing.
//  2. **`already_posted` is a SKIP that stamps nothing.** Stamping this group's
//     shipments onto an entry this run did not make would attach them to
//     somebody else's numbers.
//  3. **Never throws, three layers deep**, and a group that posted but could
//     not stamp is reported in BOTH `posted` and `failed`.
//
// `plan.ts` and lane A's pure builders run FOR REAL; only the database, the
// poster and the stamp are doubles.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UnpostedShipment } from '../types'

const h = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  shipments: [] as unknown[],
  shipmentsError: null as Error | null,
  /** `GlPosting` rows the attempt counter finds, per call. */
  livePostings: [] as unknown[][],
  post: { status: 'posted', glPostingId: 'gl_1', docNumber: 'AUXX-FUL-20260706' } as {
    status: string
    glPostingId?: string
    docNumber?: string
    error?: string
  },
  postCalls: [] as Array<{ periodKey: string; txnDate: string; memo?: string }>,
  stamps: [] as Array<{
    orderId: string
    sequence: number
    actorUserId: string
    patch: Record<string, unknown>
  }>,
  stampThrowsFor: null as string | null,
  systemUserId: 'usr_system',
  isAccountingEnabled: vi.fn(async () => true),
  readUnpostedShipmentsCalls: 0,
  readSettingsCalls: 0,
}))

vi.mock('../../../postings/accounting-enabled', () => ({
  isAccountingEnabled: h.isAccountingEnabled,
}))

vi.mock('../reads', async () => {
  const { ok, err } = await import('neverthrow')
  return {
    readUnpostedShipments: async () => {
      h.readUnpostedShipmentsCalls++
      return h.shipmentsError ? err(h.shipmentsError) : ok(h.shipments)
    },
    readFulfillmentPostingSettings: async () => {
      h.readSettingsCalls++
      return ok({
        cutoffPeriod: (h.settings['accounting.cutoffPeriod'] as string | null) ?? null,
        lockedThroughMonth: null,
        timeZone: (h.settings['accounting.bookTimeZone'] as string | null) ?? null,
        ledgerCurrency: 'USD',
      })
    },
  }
})

vi.mock('../../../settings/settings-service', () => ({
  getOrganizationSetting: async ({ key }: { key: string }) => h.settings[key] ?? null,
}))

vi.mock('../../../postings/period-lock', () => ({
  resolvePeriodLock: async () => ({ lockedThroughMonth: null }),
}))

vi.mock('../../../postings/post-entry', () => ({
  LEDGER_CURRENCY: 'USD',
  postEntry: async (
    _db: unknown,
    options: { entry: { periodKey: string; txnDate: string }; memo?: string }
  ) => {
    h.postCalls.push({
      periodKey: options.entry.periodKey,
      txnDate: options.entry.txnDate,
      memo: options.memo,
    })
    return h.post
  },
}))

vi.mock('../../orders/fulfill', () => ({
  stampFulfillment: async (
    _db: unknown,
    params: {
      orderId: string
      sequence: number
      actorUserId: string
      patch: Record<string, unknown>
    }
  ) => {
    if (h.stampThrowsFor === params.orderId) throw new Error('could not lock the order row')
    h.stamps.push({
      orderId: params.orderId,
      sequence: params.sequence,
      actorUserId: params.actorUserId,
      patch: params.patch,
    })
  },
}))

vi.mock('../../../cache', () => ({
  getOrgCache: () => ({ get: async () => h.systemUserId }),
}))

import type { Database } from '@auxx/database'
import { previewFulfillmentPosting, runFulfillmentPosting } from '../run'

const ORG = 'abgwpa1l81reht2zmwrcihfu'

function shipment(overrides: Partial<UnpostedShipment> = {}): UnpostedShipment {
  const orderId = overrides.orderId ?? 'ord_1'
  return {
    orderId,
    orderNumber: overrides.orderNumber ?? '#1001',
    sequence: 1,
    shippedAt: '2026-07-06',
    lines: [
      {
        lineId: `${orderId}_l1`,
        quantity: 1,
        unitPriceMinor: 10_000,
        lineTaxMinor: null,
        orderedQuantity: 1,
      },
    ],
    channel: 'dtc',
    currency: 'USD',
    financialStatus: 'paid',
    gateways: ['shopify_payments'],
    orderSubtotalMinor: 10_000,
    orderTaxTotalMinor: 0,
    orderShippingTotalMinor: 0,
    priorShipmentsSubtotalMinor: 0,
    includeShipping: false,
    contactId: null,
    ...overrides,
  }
}

/** `db.select(...).from(...).where(...)` awaited: the attempt counter's read. */
function stubDb(): Database {
  let index = 0
  const chain = (): Record<string, unknown> => {
    const self: Record<string, unknown> = {}
    for (const method of ['from', 'where']) self[method] = () => self
    // biome-ignore lint/suspicious/noThenProperty: chainable drizzle query-builder stub
    self.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(h.livePostings[index++] ?? []).then(resolve, reject)
    return self
  }
  return { select: () => chain() } as unknown as Database
}

const REQUEST = {
  organizationId: ORG,
  actorUserId: 'usr_1',
  range: { from: '2026-07-01', to: '2026-08-01' },
  grouping: 'day',
} as const

beforeEach(() => {
  h.settings = {
    'accounting.setupState': 'finalized',
    'accounting.bookTimeZone': 'America/Los_Angeles',
    'accounting.cutoffPeriod': null,
  }
  h.shipments = [shipment()]
  h.shipmentsError = null
  h.livePostings = []
  h.post = { status: 'posted', glPostingId: 'gl_1', docNumber: 'AUXX-FUL-20260706' }
  h.postCalls = []
  h.stamps = []
  h.stampThrowsFor = null
  h.isAccountingEnabled.mockResolvedValue(true)
  h.readUnpostedShipmentsCalls = 0
  h.readSettingsCalls = 0
})

// task 17 section 3: checked ONCE per org, before the settings read and the
// shipment netting read - this run has no use for either when the org has
// never turned accounting on.
describe('accounting not enabled', () => {
  it('reads nothing, builds nothing, posts nothing, and returns an empty summary', async () => {
    h.isAccountingEnabled.mockResolvedValue(false)

    const summary = await runFulfillmentPosting(stubDb(), REQUEST)

    expect(summary).toEqual({ posted: [], skipped: [], failed: [], exclusions: [] })
    expect(h.readSettingsCalls).toBe(0)
    expect(h.readUnpostedShipmentsCalls).toBe(0)
    expect(h.postCalls).toEqual([])
  })
})

describe('the refusals', () => {
  it('refuses a run whose organization has not finalized accounting setup', async () => {
    h.settings['accounting.setupState'] = 'draft'

    const summary = await runFulfillmentPosting(stubDb(), REQUEST)

    expect(summary.posted).toEqual([])
    expect(summary.skipped[0]?.status).toBe('refused')
    expect(summary.skipped[0]?.reason).toMatch(/not finalized/)
    expect(h.postCalls).toEqual([])
  })

  it('refuses a run with no book time zone', async () => {
    h.settings['accounting.bookTimeZone'] = null

    const summary = await runFulfillmentPosting(stubDb(), REQUEST)

    expect(summary.skipped[0]?.reason).toMatch(/book time zone/)
    expect(h.postCalls).toEqual([])
  })

  it('names setup before the time zone, because an unfinished setup has no zone', async () => {
    h.settings['accounting.setupState'] = 'draft'
    h.settings['accounting.bookTimeZone'] = null

    const summary = await runFulfillmentPosting(stubDb(), REQUEST)

    expect(summary.skipped[0]?.reason).toMatch(/not finalized/)
  })

  // ⚠️ The preview still shows the backlog. A person whose time zone is unset
  // needs to see how much is waiting on the settings row they are being told to
  // fix.
  it('previews the plan alongside the refusal rather than hiding it', async () => {
    h.settings['accounting.bookTimeZone'] = null

    const preview = (await previewFulfillmentPosting(stubDb(), REQUEST))._unsafeUnwrap()

    expect(preview.refusal).toMatch(/book time zone/)
    expect(preview.plan.groups).toHaveLength(1)
    expect(preview.plan.footer.totalMinor).toBe(10_000)
  })

  it('reports no refusal on a healthy organization', async () => {
    const preview = (await previewFulfillmentPosting(stubDb(), REQUEST))._unsafeUnwrap()

    expect(preview.refusal).toBeNull()
    expect(preview.plan.groups).toHaveLength(1)
  })

  it('surfaces a failed shipment read as an Err from the preview', async () => {
    h.shipmentsError = new Error('the ledger is unreachable')

    const preview = await previewFulfillmentPosting(stubDb(), REQUEST)

    expect(preview.isErr()).toBe(true)
  })
})

describe('the attempt counter', () => {
  it('claims the bare group key when nothing live holds it', async () => {
    h.livePostings = [[]]

    await runFulfillmentPosting(stubDb(), REQUEST)

    expect(h.postCalls[0]?.periodKey).toBe('2026-07-06')
  })

  // 🛑 §8.2: the late order backfilled into an already-posted day.
  it('appends an attempt character when one live posting already holds the day', async () => {
    h.livePostings = [[{ id: 'gl_old' }]]

    await runFulfillmentPosting(stubDb(), REQUEST)

    expect(h.postCalls[0]?.periodKey).toBe('2026-07-061')
  })

  // 🛑 Decision 9: a reversed day comes back on the next preview, and its
  // reversal is an ordinary `posted` entry at the same key. Counting it is what
  // stops the re-run colliding with the reversed original's tuple.
  it('counts a reversal, so a reversed day re-posts under the next attempt', async () => {
    h.livePostings = [[{ id: 'gl_reversal' }]]

    await runFulfillmentPosting(stubDb(), REQUEST)

    expect(h.postCalls[0]?.periodKey).toBe('2026-07-061')
  })

  it('counts per group, so two days do not share an attempt', async () => {
    h.shipments = [
      shipment({ orderId: 'a', orderNumber: '#1', shippedAt: '2026-07-06' }),
      shipment({ orderId: 'b', orderNumber: '#2', shippedAt: '2026-07-07' }),
    ]
    h.livePostings = [[{ id: 'gl_old' }], []]

    await runFulfillmentPosting(stubDb(), REQUEST)

    expect(h.postCalls.map((call) => call.periodKey)).toEqual(['2026-07-061', '2026-07-07'])
  })
})

describe('posting and stamping', () => {
  it('posts one entry per group, dated to the latest ship date in it', async () => {
    h.shipments = [
      shipment({ orderId: 'a', orderNumber: '#1', shippedAt: '2026-07-06' }),
      shipment({ orderId: 'b', orderNumber: '#2', shippedAt: '2026-07-31' }),
    ]

    const summary = await runFulfillmentPosting(stubDb(), {
      ...REQUEST,
      grouping: 'month',
    })

    expect(h.postCalls).toHaveLength(1)
    expect(h.postCalls[0]?.txnDate).toBe('2026-07-31')
    expect(summary.posted).toEqual([
      {
        groupKey: '2026-07',
        postingId: 'gl_1',
        docNumber: 'AUXX-FUL-20260706',
        shipments: 2,
      },
    ])
  })

  it('stamps every shipment of the group with the posting and its own amounts', async () => {
    h.shipments = [
      shipment({ orderId: 'a', orderNumber: '#1', sequence: 1 }),
      shipment({ orderId: 'b', orderNumber: '#2', sequence: 4 }),
    ]

    await runFulfillmentPosting(stubDb(), REQUEST)

    expect(h.stamps).toEqual([
      {
        orderId: 'a',
        sequence: 1,
        actorUserId: 'usr_1',
        patch: {
          glPostingId: 'gl_1',
          docNumber: 'AUXX-FUL-20260706',
          totalMinor: 10_000,
          subtotalMinor: 10_000,
        },
      },
      {
        orderId: 'b',
        sequence: 4,
        actorUserId: 'usr_1',
        patch: {
          glPostingId: 'gl_1',
          docNumber: 'AUXX-FUL-20260706',
          totalMinor: 10_000,
          subtotalMinor: 10_000,
        },
      },
    ])
  })

  it('carries the run memo onto the entry', async () => {
    await runFulfillmentPosting(stubDb(), { ...REQUEST, memo: 'July catch-up' })

    expect(h.postCalls[0]?.memo).toBe('July catch-up')
  })

  it.each([
    'healed',
    'not_connected',
    'disabled',
  ])('treats %s as posted, because the ledger holds the row', async (status) => {
    h.post = { status, glPostingId: 'gl_1', docNumber: 'AUXX-FUL-20260706' }

    const summary = await runFulfillmentPosting(stubDb(), REQUEST)

    expect(summary.posted).toHaveLength(1)
    expect(h.stamps).toHaveLength(1)
  })

  it('reports the exclusions the plan made', async () => {
    h.shipments = [shipment({ currency: 'CAD' })]

    const summary = await runFulfillmentPosting(stubDb(), REQUEST)

    expect(summary.posted).toEqual([])
    expect(summary.exclusions).toEqual([
      expect.objectContaining({ reason: 'foreign-currency', detail: 'CAD' }),
    ])
  })

  it('does nothing at all for an empty range', async () => {
    h.shipments = []

    const summary = await runFulfillmentPosting(stubDb(), REQUEST)

    expect(summary).toEqual({ posted: [], skipped: [], failed: [], exclusions: [] })
    expect(h.postCalls).toEqual([])
  })
})

describe('already_posted is a skip that stamps nothing', () => {
  it('skips the group and writes no stamp', async () => {
    h.post = { status: 'already_posted', glPostingId: 'gl_other', docNumber: 'AUXX-FUL-X' }

    const summary = await runFulfillmentPosting(stubDb(), REQUEST)

    expect(summary.posted).toEqual([])
    expect(h.stamps).toEqual([])
    expect(summary.skipped[0]).toMatchObject({ groupKey: '2026-07-06', status: 'already_posted' })
    expect(summary.skipped[0]?.reason).toMatch(/already claimed/)
  })

  it('keeps running the rest of the groups', async () => {
    h.shipments = [
      shipment({ orderId: 'a', orderNumber: '#1', shippedAt: '2026-07-06' }),
      shipment({ orderId: 'b', orderNumber: '#2', shippedAt: '2026-07-07' }),
    ]
    h.post = { status: 'already_posted', docNumber: 'AUXX-FUL-X' }

    const summary = await runFulfillmentPosting(stubDb(), REQUEST)

    expect(summary.skipped.map((row) => row.groupKey)).toEqual(['2026-07-06', '2026-07-07'])
    expect(summary.failed).toEqual([])
    expect(h.stamps).toEqual([])
  })
})

describe('a ledger refusal is a skip, not a failure', () => {
  it('records a closed period without stamping anything', async () => {
    h.post = { status: 'period_closed', error: 'July is closed.' }

    const summary = await runFulfillmentPosting(stubDb(), REQUEST)

    expect(summary.posted).toEqual([])
    expect(summary.failed).toEqual([])
    expect(summary.skipped).toEqual([
      { groupKey: '2026-07-06', status: 'period_closed', reason: 'July is closed.' },
    ])
    expect(h.stamps).toEqual([])
  })

  it('records an accepted status that named no posting rather than stamping null', async () => {
    h.post = { status: 'posted', docNumber: 'AUXX-FUL-20260706' }

    const summary = await runFulfillmentPosting(stubDb(), REQUEST)

    expect(summary.posted).toEqual([])
    expect(summary.skipped[0]?.reason).toMatch(/named no posting/)
    expect(h.stamps).toEqual([])
  })
})

describe('never throws, three layers deep', () => {
  it('records a group whose build threw and continues with the next', async () => {
    h.shipments = [
      shipment({ orderId: 'a', orderNumber: '#1', shippedAt: '2026-07-06' }),
      shipment({ orderId: 'b', orderNumber: '#2', shippedAt: '2026-07-07' }),
    ]
    // A day that has already burned every attempt character the document-number
    // keyspace holds: the builder refuses rather than minting a key that could
    // not be reversed.
    h.livePostings = [Array.from({ length: 36 }, (_, i) => ({ id: `gl_${i}` })), []]

    const summary = await runFulfillmentPosting(stubDb(), REQUEST)

    expect(summary.failed).toHaveLength(1)
    expect(summary.failed[0]?.groupKey).toBe('2026-07-06')
    expect(summary.posted.map((row) => row.groupKey)).toEqual(['2026-07-07'])
  })

  // 🛑 The one outcome that needs a person: the entry is in the books and the
  // shipment is not stamped, so the netting read will offer it again.
  it('reports a posted group whose stamp failed in BOTH posted and failed', async () => {
    h.shipments = [
      shipment({ orderId: 'a', orderNumber: '#1' }),
      shipment({ orderId: 'b', orderNumber: '#2' }),
    ]
    h.stampThrowsFor = 'a'

    const summary = await runFulfillmentPosting(stubDb(), REQUEST)

    expect(summary.posted).toHaveLength(1)
    // The other shipment was still stamped: one order's lock contention must
    // not lose the rest of the group.
    expect(h.stamps.map((stamp) => stamp.orderId)).toEqual(['b'])
    expect(summary.failed[0]?.reason).toMatch(/#1 shipment 1/)
    expect(summary.failed[0]?.reason).toMatch(/must NOT be posted a second time/)
  })

  it('returns a summary rather than throwing when the read fails', async () => {
    h.shipmentsError = new Error('the ledger is unreachable')

    const summary = await runFulfillmentPosting(stubDb(), REQUEST)

    expect(summary.posted).toEqual([])
    expect(summary.failed[0]?.reason).toMatch(/unreachable/)
  })
})

describe('the unattended lane', () => {
  it('writes as the system user of the organization when nobody pressed a button', async () => {
    await runFulfillmentPosting(stubDb(), { ...REQUEST, actorUserId: null })

    expect(h.stamps.map((stamp) => stamp.actorUserId)).toEqual(['usr_system'])
  })
})
