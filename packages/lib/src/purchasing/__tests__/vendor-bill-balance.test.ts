// packages/lib/src/purchasing/__tests__/vendor-bill-balance.test.ts
//
// `vendor_bill_balance` shipped declared "computed from total and amountPaid"
// with NO writer — zero stored values in the entire installation, across every
// org and every bill. It stayed invisible because the payment card computes the
// subtraction in the browser and never reads the column. These tests pin the
// wiring and the three arithmetic rules that are easy to get wrong.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EntityFieldChangeEvent } from '../../field-hooks/types'

const h = vi.hoisted(() => ({
  bySystemAttributes: vi.fn(),
  requireCachedEntityDefId: vi.fn(),
  setValueWithType: vi.fn(),
  publishFieldValueUpdates: vi.fn(),
}))

vi.mock('../../cache', () => ({
  getOrgCache: () => ({ from: () => ({ bySystemAttributes: h.bySystemAttributes }) }),
  requireCachedEntityDefId: h.requireCachedEntityDefId,
}))
vi.mock('../../field-values/field-value-mutations', () => ({
  setValueWithType: h.setValueWithType,
}))
vi.mock('../../field-values/field-value-helpers', () => ({
  createFieldValueContext: (organizationId: string) => ({ organizationId }),
}))
vi.mock('../../realtime', () => ({
  getRealtimeService: () => ({}),
  publishFieldValueUpdates: h.publishFieldValueUpdates,
}))
// `readFieldScalars` runs for real over these rows, so the test exercises the
// absent-vs-null distinction the writer depends on rather than stubbing it away.
vi.mock('@auxx/database', async () => {
  const schema = await import('../../../../database/src/db/schema/index')
  return {
    schema,
    database: { select: () => ({ from: () => ({ where: () => storedRows() }) }) },
  }
})

import { runWithDirtyParents } from '../../reconcilers/dirty-parents'
import {
  recalculateBalanceOnBillChange,
  recalculateVendorBillBalance,
  registerVendorBillBalanceReconcilers,
  VENDOR_BILL_BALANCE_TRIGGER_ATTRS,
  vendorBillBalance,
} from '../vendor-bill-balance'

const FIELDS: Record<string, { id: string; type: string }> = {
  vendor_bill_total: { id: 'f-total', type: 'CURRENCY' },
  vendor_bill_amount_paid: { id: 'f-paid', type: 'CURRENCY' },
  vendor_bill_balance: { id: 'f-balance', type: 'CURRENCY' },
}

const BILL = 'bill-1'

/** What the bill currently has stored, per fieldId. `null` means a row with no value. */
let stored: Record<string, number | null> = {}

function storedRows() {
  return Object.entries(stored).map(([fieldId, valueNumber]) => ({
    entityId: BILL,
    fieldId,
    valueNumber,
  }))
}

/** The value the last write sent, or `undefined` when nothing was written. */
function written(): unknown {
  return h.setValueWithType.mock.calls.at(-1)?.[1]?.value
}

beforeEach(() => {
  vi.clearAllMocks()
  stored = {}
  h.bySystemAttributes.mockImplementation(async (attrs: string[]) =>
    Object.fromEntries(attrs.filter((a) => FIELDS[a]).map((a) => [a, FIELDS[a]]))
  )
  h.requireCachedEntityDefId.mockResolvedValue('def-vendor-bill')
  h.setValueWithType.mockResolvedValue([])
  h.publishFieldValueUpdates.mockResolvedValue(undefined)
})

const recalc = () => recalculateVendorBillBalance('org_1', BILL)

describe('vendorBillBalance', () => {
  it('subtracts what has been paid from the total', () => {
    expect(vendorBillBalance(115000, 100000)).toBe(15000)
  })

  it('treats an absent payment as a payment of nothing', () => {
    expect(vendorBillBalance(20000, null)).toBe(20000)
  })

  it('has NO balance when the bill has no total', () => {
    // Not zero. A bill nobody has keyed a total onto owes an unknown amount, and
    // storing `0 - paid` would render an unentered invoice as fully settled —
    // then collect it in a `balance = 0` filter alongside genuinely paid bills.
    expect(vendorBillBalance(null, 50000)).toBeNull()
    expect(vendorBillBalance(null, null)).toBeNull()
  })

  it('keeps an overpayment negative rather than clamping it to zero', () => {
    // The vendor owes US money. `Math.max(0, …)` here would erase that fact from
    // the column; the bills card clamps for display, and that is the right place.
    expect(vendorBillBalance(1000, 1500)).toBe(-500)
  })

  it('rounds, because the inputs live in a double column', () => {
    // Integer minor units stored as doubles: `setValueWithType` rejects a
    // non-integer CURRENCY value outright, so float drift would throw rather
    // than store a wrong number — but it would still take the write down.
    expect(Number.isInteger(vendorBillBalance(0.3 * 3 * 100000, 1))).toBe(true)
  })
})

describe('recalculateVendorBillBalance', () => {
  it('writes the balance when a bill has a total and a part payment', async () => {
    stored = { 'f-total': 115000, 'f-paid': 100000 }

    await recalc()

    expect(written()).toEqual({ type: 'number', value: 15000 })
  })

  it('writes the whole total when nothing has been paid', async () => {
    stored = { 'f-total': 20000 }

    await recalc()

    expect(written()).toEqual({ type: 'number', value: 20000 })
  })

  it('writes ZERO for a fully settled bill, and does not confuse it with absent', async () => {
    stored = { 'f-total': 430000, 'f-paid': 430000 }

    await recalc()

    expect(h.setValueWithType).toHaveBeenCalledTimes(1)
    expect(written()).toEqual({ type: 'number', value: 0 })
  })

  it('changes nothing → writes nothing', async () => {
    // The case that keeps a derived write cheap: a second trigger attribute
    // landing in the same save, or a total re-keyed to what it already was, must
    // not cost a write, a realtime frame and a timeline entry.
    stored = { 'f-total': 115000, 'f-paid': 100000, 'f-balance': 15000 }

    await recalc()

    expect(h.setValueWithType).not.toHaveBeenCalled()
    expect(h.publishFieldValueUpdates).not.toHaveBeenCalled()
  })

  it('writes nothing when there is no total and no stored balance', async () => {
    stored = {}

    await recalc()

    expect(h.setValueWithType).not.toHaveBeenCalled()
  })

  it('CLEARS a stored balance when the total is cleared', async () => {
    // The delete path. Nothing else clears this column, so without it a bill
    // whose total was removed keeps a balance derived from a number that is
    // gone.
    stored = { 'f-paid': 5000, 'f-balance': 15000 }

    await recalc()

    expect(h.setValueWithType).toHaveBeenCalledTimes(1)
    expect(written()).toBeNull()
  })

  it('publishes the new value so an open drawer does not show the old one', async () => {
    stored = { 'f-total': 3000 }

    await recalc()

    expect(h.publishFieldValueUpdates).toHaveBeenCalledTimes(1)
    const entries = h.publishFieldValueUpdates.mock.calls[0]?.[2] as Array<{ value?: unknown }>
    expect(entries[0]?.value).toEqual({ type: 'number', value: 3000 })
  })

  it('publishes a clear with no value at all — the signal a cell is empty', async () => {
    stored = { 'f-balance': 15000 }

    await recalc()

    const entries = h.publishFieldValueUpdates.mock.calls[0]?.[2] as Array<{ value?: unknown }>
    expect(entries[0]).not.toHaveProperty('value')
  })

  it('does nothing when the org is missing one of the three fields', async () => {
    h.bySystemAttributes.mockResolvedValue({ vendor_bill_total: FIELDS.vendor_bill_total })
    stored = { 'f-total': 3000 }

    await recalc()

    expect(h.setValueWithType).not.toHaveBeenCalled()
  })

  it('reports whether it wrote, so a backfill can count', async () => {
    stored = { 'f-total': 3000 }
    expect(await recalc()).toBe(true)

    stored = { 'f-total': 3000, 'f-balance': 3000 }
    expect(await recalc()).toBe(false)
  })
})

describe('the trigger vocabulary', () => {
  it('watches BOTH inputs — a balance driven by only one of them is wrong half the time', () => {
    expect(VENDOR_BILL_BALANCE_TRIGGER_ATTRS.has('vendor_bill_total' as never)).toBe(true)
    expect(VENDOR_BILL_BALANCE_TRIGGER_ATTRS.has('vendor_bill_amount_paid' as never)).toBe(true)
  })

  it('never contains the field the hook itself writes — that would recurse', () => {
    expect(VENDOR_BILL_BALANCE_TRIGGER_ATTRS.has('vendor_bill_balance' as never)).toBe(false)
  })
})

describe('recalculateBalanceOnBillChange', () => {
  const event = (systemAttribute: string) =>
    ({
      recordId: `def-vendor-bill:${BILL}`,
      organizationId: 'org_1',
      userId: 'usr_1',
      field: { id: 'f', systemAttribute },
    }) as unknown as EntityFieldChangeEvent

  it('recomputes when the total is written', async () => {
    stored = { 'f-total': 3000 }

    await recalculateBalanceOnBillChange(event('vendor_bill_total'))

    expect(written()).toEqual({ type: 'number', value: 3000 })
  })

  it('recomputes when the amount paid is written', async () => {
    stored = { 'f-total': 3000, 'f-paid': 1000 }

    await recalculateBalanceOnBillChange(event('vendor_bill_amount_paid'))

    expect(written()).toEqual({ type: 'number', value: 2000 })
  })

  it('recomputes on a CLEAR of a trigger field, not just a set', async () => {
    // A cleared value fires the same post-hook chain as a set one, which is why
    // there is no separate delete hook beside this one.
    stored = { 'f-paid': 1000, 'f-balance': 2000 }

    await recalculateBalanceOnBillChange({
      ...event('vendor_bill_total'),
      newValue: null,
    } as EntityFieldChangeEvent)

    expect(written()).toBeNull()
  })

  it('ignores a bill write the balance does not depend on', async () => {
    stored = { 'f-total': 3000 }

    await recalculateBalanceOnBillChange(event('vendor_bill_payment_method'))

    expect(h.setValueWithType).not.toHaveBeenCalled()
  })
})

describe('coalescing', () => {
  beforeAll(() => {
    registerVendorBillBalanceReconcilers()
  })

  const event = (systemAttribute: string) =>
    ({
      recordId: `def-vendor-bill:${BILL}`,
      organizationId: 'org_1',
      userId: 'usr_1',
      field: { id: 'f', systemAttribute },
    }) as unknown as EntityFieldChangeEvent

  it('collapses one payment save into ONE recompute', async () => {
    // `MarkBillPaidDialog` writes six attributes in one call, two of which are
    // triggers. Without the drain that is two recomputes, and the first runs
    // against a half-applied payment.
    stored = { 'f-total': 115000, 'f-paid': 100000 }

    await runWithDirtyParents('org_1', 'usr_1', async () => {
      await recalculateBalanceOnBillChange(event('vendor_bill_total'))
      await recalculateBalanceOnBillChange(event('vendor_bill_amount_paid'))
    })

    expect(h.setValueWithType).toHaveBeenCalledTimes(1)
    expect(written()).toEqual({ type: 'number', value: 15000 })
  })
})
