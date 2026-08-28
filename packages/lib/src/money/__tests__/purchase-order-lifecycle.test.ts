// packages/lib/src/money/__tests__/purchase-order-lifecycle.test.ts
//
// `purchase_order_status` had no writer at all, which is why §3.4 of
// plans/purchasing/07-purchase-order-send-and-status.md could call it "a plain human-set
// field" without anybody noticing. This is that writer. Two things here are silent when
// wrong: writing through `UnifiedCrudHandler` instead of `FieldValueService` would make the
// action trip the guard built to let it through, and inventing an `expected_at` when no line
// carries a lead time would manufacture the exceptions a later feature ages off that field.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  bySystemAttributes: vi.fn(),
  getFieldValues: vi.fn(),
  setValuesForEntity: vi.fn(),
  /** Constructor arguments every `FieldValueService` was built with. */
  fieldValueServiceArgs: [] as unknown[][],
  /** Result sets the module's drizzle query resolves to, in call order. */
  dbResults: [] as unknown[][],
}))

/** Chainable drizzle stub — resolves to the next queued result set. */
function makeChain() {
  const result = h.dbResults.shift() ?? []
  const chain: Record<string, unknown> = {}
  for (const key of ['from', 'innerJoin', 'leftJoin', 'where', 'limit']) {
    chain[key] = () => chain
  }
  // biome-ignore lint/suspicious/noThenProperty: chainable drizzle query-builder stub
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return chain
}

vi.mock('@auxx/database', () => ({
  database: { select: () => makeChain() },
  schema: {
    FieldValue: {
      entityId: 'entityId',
      organizationId: 'organizationId',
      fieldId: 'fieldId',
      valueNumber: 'valueNumber',
      relatedEntityId: 'relatedEntityId',
    },
  },
}))
vi.mock('../../cache', () => ({
  getOrgCache: () => ({ from: () => ({ bySystemAttributes: h.bySystemAttributes }) }),
  getEntityDefIdResolver: async () => (slug: string) => `def-${slug}`,
}))
vi.mock('../../resources/crud', () => ({
  UnifiedCrudHandler: class {
    getFieldValues = h.getFieldValues
  },
}))
vi.mock('../../field-values/field-value-service', () => ({
  FieldValueService: class {
    constructor(...args: unknown[]) {
      h.fieldValueServiceArgs.push(args)
    }
    setValuesForEntity = h.setValuesForEntity
  },
}))

const { markPurchaseOrderSent } = await import('../purchase-order-lifecycle')
const { BadRequestError } = await import('../../errors')

const ORG = 'org-1'
const USER = 'user-1'
const PO = 'po-1'

const STATUS_FIELD = { id: 'f-status' }
const EXPECTED_FIELD = { id: 'f-expected' }
const LINE_REL_FIELD = { id: 'f-line-order' }
const VENDOR_PART_FIELD = { id: 'f-line-vendor-part' }
const LEAD_TIME_FIELD = { id: 'f-lead-time' }

/**
 * `bySystemAttributes` is called twice with different attribute sets — once for the order's
 * own two fields, once for the three the lead-time join needs. Answer by what was asked for.
 */
function wireFields(options: { withLeadTimeLink?: boolean } = {}) {
  h.bySystemAttributes.mockImplementation((attrs: readonly string[]) => {
    if (attrs.includes('purchase_order_status')) {
      return Promise.resolve({
        purchase_order_status: STATUS_FIELD,
        purchase_order_expected_at: EXPECTED_FIELD,
      })
    }
    return Promise.resolve(
      options.withLeadTimeLink === false
        ? {}
        : {
            purchase_order_line_purchase_order: LINE_REL_FIELD,
            purchase_order_line_vendor_part: VENDOR_PART_FIELD,
            vendor_part_lead_time: LEAD_TIME_FIELD,
          }
    )
  })
}

/** The order's own field values, as `getFieldValues` returns them. */
function wireOrder(status: string | undefined, expectedAt?: string) {
  const map = new Map<string, unknown>()
  if (status !== undefined) map.set(STATUS_FIELD.id, { type: 'option', optionId: status })
  if (expectedAt !== undefined) map.set(EXPECTED_FIELD.id, { type: 'date', value: expectedAt })
  h.getFieldValues.mockResolvedValue(map)
}

/** What the lead-time MAX query comes back with. */
function wireLeadTime(maxLeadTime: string | null) {
  h.dbResults = [[{ maxLeadTime }]]
}

function writtenValues(): Array<{ fieldId: string; value: unknown }> {
  return h.setValuesForEntity.mock.calls[0]?.[0]?.values ?? []
}

beforeEach(() => {
  vi.clearAllMocks()
  h.dbResults = []
  h.fieldValueServiceArgs = []
  vi.useRealTimers()
})

describe('markPurchaseOrderSent — the status write', () => {
  it('writes issued from draft', async () => {
    wireFields()
    wireOrder('draft', '2026-09-01')
    await markPurchaseOrderSent({
      organizationId: ORG,
      userId: USER,
      purchaseOrderInstanceId: PO,
    })

    expect(writtenValues()).toContainEqual({ fieldId: 'purchase_order_status', value: 'issued' })
  })

  // 🛑 `FieldValueService`, never `UnifiedCrudHandler`: the CRUD handler runs the system
  // pre-hook chain, and `rejectManualLifecycleStatus` now refuses `issued` — so routing the
  // action through it would make the action reject itself.
  it('writes through FieldValueService, on the resolved def id', async () => {
    wireFields()
    wireOrder('draft', '2026-09-01')
    await markPurchaseOrderSent({
      organizationId: ORG,
      userId: USER,
      purchaseOrderInstanceId: PO,
    })

    expect(h.setValuesForEntity).toHaveBeenCalledTimes(1)
    // Not `purchase_order:po-1` — an unresolved type-slug RecordId silently no-ops every
    // field-change hook downstream while the write itself succeeds.
    expect(h.setValuesForEntity.mock.calls[0]![0].recordId).toBe('def-purchase_order:po-1')
  })

  it.each(['issued', 'closed', 'canceled'])('refuses to send from %s', async (status) => {
    wireFields()
    wireOrder(status, '2026-09-01')
    await expect(
      markPurchaseOrderSent({
        organizationId: ORG,
        userId: USER,
        purchaseOrderInstanceId: PO,
      })
    ).rejects.toThrow(BadRequestError)
    expect(h.setValuesForEntity).not.toHaveBeenCalled()
  })

  it('refuses when the order has no status at all, and says so', async () => {
    wireFields()
    wireOrder(undefined)
    await expect(
      markPurchaseOrderSent({
        organizationId: ORG,
        userId: USER,
        purchaseOrderInstanceId: PO,
      })
    ).rejects.toThrow(/unknown/)
  })
})

describe('markPurchaseOrderSent — the expected_at default (§6.2)', () => {
  it('sets expected_at from the longest line lead time, counted from the send date', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-01T12:00:00.000Z'))
    wireFields()
    wireOrder('draft')
    wireLeadTime('14')

    await markPurchaseOrderSent({
      organizationId: ORG,
      userId: USER,
      purchaseOrderInstanceId: PO,
    })

    expect(writtenValues()).toContainEqual({
      fieldId: 'purchase_order_expected_at',
      value: '2026-03-15',
    })
  })

  // A date somebody typed is the person who actually spoke to the vendor. The catalogue
  // never outranks that.
  it('never overwrites an expected_at that is already set', async () => {
    wireFields()
    wireOrder('draft', '2026-09-01')
    wireLeadTime('30')

    await markPurchaseOrderSent({
      organizationId: ORG,
      userId: USER,
      purchaseOrderInstanceId: PO,
    })

    expect(writtenValues()).toEqual([{ fieldId: 'purchase_order_status', value: 'issued' }])
  })

  // ✅ The whole point of §6.2: an invented date is worse than a missing one, because a
  // later feature ages an `awaiting_receipt` exception off this field — a fabricated date
  // produces fabricated exceptions.
  it('leaves expected_at EMPTY when no line carries a lead time', async () => {
    wireFields()
    wireOrder('draft')
    wireLeadTime(null)

    await markPurchaseOrderSent({
      organizationId: ORG,
      userId: USER,
      purchaseOrderInstanceId: PO,
    })

    expect(writtenValues()).toEqual([{ fieldId: 'purchase_order_status', value: 'issued' }])
  })

  // `purchase_order_line_vendor_part` is nullable and usually unset, so an order whose lines
  // all lack one produces no rows at all. That is the normal case, not a failure.
  it('leaves expected_at empty when the join matches nothing', async () => {
    wireFields()
    wireOrder('draft')
    h.dbResults = [[]]

    await markPurchaseOrderSent({
      organizationId: ORG,
      userId: USER,
      purchaseOrderInstanceId: PO,
    })

    expect(writtenValues()).toEqual([{ fieldId: 'purchase_order_status', value: 'issued' }])
  })

  it('ignores a non-positive lead time rather than dating the order in the past', async () => {
    wireFields()
    wireOrder('draft')
    wireLeadTime('0')

    await markPurchaseOrderSent({
      organizationId: ORG,
      userId: USER,
      purchaseOrderInstanceId: PO,
    })

    expect(writtenValues()).toEqual([{ fieldId: 'purchase_order_status', value: 'issued' }])
  })

  // Purchasing may simply not be provisioned for the org. Send still has to work.
  it('still issues the order when the lead-time fields do not exist', async () => {
    wireFields({ withLeadTimeLink: false })
    wireOrder('draft')

    await markPurchaseOrderSent({
      organizationId: ORG,
      userId: USER,
      purchaseOrderInstanceId: PO,
    })

    expect(writtenValues()).toEqual([{ fieldId: 'purchase_order_status', value: 'issued' }])
  })
})

describe('markPurchaseOrderSent — clearing its own guards', () => {
  // 🛑 The regression this exists to prevent: `issued` is guarded on BOTH chains, and Send
  // has to clear both or the action is refused by the wall built to protect it.
  //
  // The system hook is cleared structurally — writing through `FieldValueService` instead of
  // `UnifiedCrudHandler` means `runPreHooks` never runs (asserted above). The FIELD pre-hook
  // is NOT cleared that way: it fires on exactly this write. `fireFieldPreHooks`
  // short-circuits on `ctx.bypassFieldGuards.has(systemAttribute)` before reaching the
  // handler, so naming the attribute here is the whole mechanism.
  it('passes bypassFieldGuards for purchase_order_status', async () => {
    wireFields()
    wireOrder('draft', '2026-09-01')
    await markPurchaseOrderSent({
      organizationId: ORG,
      userId: USER,
      purchaseOrderInstanceId: PO,
    })

    const options = h.fieldValueServiceArgs[0]?.[4] as
      | { bypassFieldGuards?: ReadonlySet<string> }
      | undefined
    expect(options?.bypassFieldGuards).toBeDefined()
    expect([...(options?.bypassFieldGuards ?? [])]).toEqual(['purchase_order_status'])
  })

  // Naming more than the one attribute would quietly disarm guards on fields this action has
  // no business writing. The status writer's bypass is scoped the same way.
  it('bypasses that one attribute and nothing else', async () => {
    wireFields()
    wireOrder('draft', '2026-09-01')
    await markPurchaseOrderSent({
      organizationId: ORG,
      userId: USER,
      purchaseOrderInstanceId: PO,
    })

    const options = h.fieldValueServiceArgs[0]?.[4] as
      | { bypassFieldGuards?: ReadonlySet<string> }
      | undefined
    expect(options?.bypassFieldGuards?.size).toBe(1)
    expect(options?.bypassFieldGuards?.has('purchase_order_expected_at')).toBe(false)
  })

  // The other half of the proof: without the bypass, this exact write is refused. If this
  // ever stops throwing, the bypass above has become decoration and the guard is inert.
  it('is refused by the field pre-hook when the bypass is absent', async () => {
    const { guardManualPurchaseOrderIssued } = await import(
      '../../field-hooks/pre/purchase-order-status-guard'
    )
    await expect(
      guardManualPurchaseOrderIssued({
        newValue: { type: 'option', optionId: 'issued' },
      } as any)
    ).rejects.toThrow(/Use Send/)
  })
})
