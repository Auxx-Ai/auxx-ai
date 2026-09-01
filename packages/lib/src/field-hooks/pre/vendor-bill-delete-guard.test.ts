// packages/lib/src/field-hooks/pre/vendor-bill-delete-guard.test.ts
// The guard that stops a vendor bill being hard-deleted once it is in the books,
// part-paid, or dated in a settled month.
//
// plans/money/tasks/21-money-parent-delete-safety.md §5. The shape difference
// from the other three guards: a bill has no movements of its own, so the
// settled test runs on ONE date — `vendor_bill_billed_at`, which the field's own
// description calls "the ACCOUNTING date".

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EntityPreDeleteEvent } from '../types'

const h = vi.hoisted(() => ({
  listFiltered: vi.fn(),
  findRelated: vi.fn(),
  del: vi.fn(),
  resolvePeriodLock: vi.fn(),
  postedPeriodRows: vi.fn(),
  getOrganizationSetting: vi.fn(),
  instanceRows: vi.fn(),
}))

vi.mock('../../resources/crud', () => ({
  UnifiedCrudHandler: class {
    listFiltered = h.listFiltered
    delete = h.del
  },
}))

vi.mock('./related-rows', () => ({ findRelatedInstanceIds: h.findRelated }))

vi.mock('../../postings/period-lock', () => ({ resolvePeriodLock: h.resolvePeriodLock }))
vi.mock('../../settings/settings-service', () => ({
  getOrganizationSetting: h.getOrganizationSetting,
}))

// `select()` is the `createdAt` fallback read; `selectDistinct()` is the
// posted-period read. Separate chains so a test cannot confuse them.
vi.mock('@auxx/database', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@auxx/database')
  const instanceChain: Record<string, unknown> = {}
  instanceChain.from = () => instanceChain
  instanceChain.where = async () => h.instanceRows()

  const postedChain: Record<string, unknown> = {}
  postedChain.from = () => postedChain
  postedChain.where = async () => h.postedPeriodRows()

  return {
    ...actual,
    database: { select: () => instanceChain, selectDistinct: () => postedChain },
  }
})

import { guardVendorBillDelete } from './vendor-bill-delete-guard'

const BILL_DEF = 'v5hzr4xbn1fhznih3u74gtza'
const BILL_ID = 'b1ll00000000000000000001'
const BILL_RECORD_ID = `${BILL_DEF}:${BILL_ID}`
const ORG = 'abgwpa1l81reht2zmwrcihfu'

function event(values: Record<string, unknown> = {}): EntityPreDeleteEvent {
  return {
    recordId: BILL_RECORD_ID as EntityPreDeleteEvent['recordId'],
    entityDefinitionId: BILL_DEF,
    entityType: 'vendor_bill',
    entitySlug: 'vendor-bills',
    values: { vendor_bill_billed_at: '2026-09-05', ...values },
    organizationId: ORG,
    userId: 'usr_1',
    bypass: new Set(),
  }
}

/** `findRelatedInstanceIds` answers per child type, so a test cannot confuse the two reads. */
function children({ allocations = [], lines = [] }: { allocations?: string[]; lines?: string[] }) {
  h.findRelated.mockImplementation(async (_org: string, childType: string) =>
    childType === 'vendor_payment_allocation' ? allocations : lines
  )
}

function settings(values: Record<string, string | null>): void {
  h.getOrganizationSetting.mockImplementation(
    async ({ key }: { key: string }) => values[key] ?? null
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  h.resolvePeriodLock.mockResolvedValue({ lockedThroughMonth: null })
  h.postedPeriodRows.mockResolvedValue([])
  h.instanceRows.mockResolvedValue([{ createdAt: new Date('2026-09-05') }])
  children({})
  settings({})
})

describe('guardVendorBillDelete — status', () => {
  for (const status of ['posted', 'partially_paid', 'paid']) {
    it(`refuses a ${status} bill`, async () => {
      await expect(guardVendorBillDelete(event({ vendor_bill_status: status }))).rejects.toThrow(
        /in the books or part-paid/i
      )
      expect(h.del).not.toHaveBeenCalled()
    })
  }

  for (const status of ['draft', 'awaiting_receipt', 'matched', 'exception']) {
    it(`allows a ${status} bill through the status wall`, async () => {
      children({ lines: ['line-1'] })

      await guardVendorBillDelete(event({ vendor_bill_status: status }))

      expect(h.del).toHaveBeenCalled()
    })
  }

  it('unwraps a coerced SINGLE_SELECT value', async () => {
    // The `build-status-guard.ts` trap: on the field chain a select arrives as
    // `{ type: 'option', optionId }`, and a guard comparing the raw value is
    // inert while reading perfectly in review.
    await expect(
      guardVendorBillDelete(event({ vendor_bill_status: { type: 'option', optionId: 'paid' } }))
    ).rejects.toThrow(/part-paid/i)
  })
})

describe('guardVendorBillDelete — allocations and period', () => {
  it('refuses when a vendor payment has been allocated to the bill', async () => {
    children({ allocations: ['alloc-1'], lines: ['line-1'] })

    await expect(guardVendorBillDelete(event())).rejects.toThrow(/payment allocation/i)
    expect(h.del).not.toHaveBeenCalled()
  })

  it('refuses when the bill date sits in a locked month', async () => {
    h.resolvePeriodLock.mockResolvedValue({ lockedThroughMonth: '2026-07' })

    await expect(
      guardVendorBillDelete(event({ vendor_bill_billed_at: '2026-07-02' }))
    ).rejects.toThrow(/2026-07/)
  })

  it('refuses when the bill date sits in a month holding a standing posted entry', async () => {
    h.postedPeriodRows.mockResolvedValue([{ periodKey: '2026-08' }])

    await expect(
      guardVendorBillDelete(event({ vendor_bill_billed_at: '2026-08-15' }))
    ).rejects.toThrow(/2026-08/)
  })

  it('refuses when the bill date is at or before the cutoff', async () => {
    settings({ 'accounting.cutoffPeriod': '2026-05' })

    await expect(
      guardVendorBillDelete(event({ vendor_bill_billed_at: '2026-04-30' }))
    ).rejects.toThrow(/2026-04/)
  })

  it('falls back to createdAt when billedAt is unset, rather than reading it as open', async () => {
    h.instanceRows.mockResolvedValue([{ createdAt: new Date('2026-07-20') }])
    h.resolvePeriodLock.mockResolvedValue({ lockedThroughMonth: '2026-07' })

    await expect(guardVendorBillDelete(event({ vendor_bill_billed_at: null }))).rejects.toThrow(
      /2026-07/
    )
  })

  it('falls back to createdAt when billedAt is unparseable', async () => {
    h.instanceRows.mockResolvedValue([{ createdAt: new Date('2026-07-20') }])
    h.resolvePeriodLock.mockResolvedValue({ lockedThroughMonth: '2026-07' })

    await expect(
      guardVendorBillDelete(event({ vendor_bill_billed_at: 'not a date' }))
    ).rejects.toThrow(/2026-07/)
  })
})

describe('guardVendorBillDelete — cascade', () => {
  it('deletes the bill lines WITH post-delete hooks suppressed', async () => {
    // `rematchAfterBillLineDelete` re-projects the bill being deleted, so
    // leaving it live re-runs the whole match once per line against a document
    // that is about to vanish. This is the one guard of the four that suppresses.
    children({ lines: ['line-1', 'line-2'] })

    await guardVendorBillDelete(event())

    expect(h.del).toHaveBeenCalledTimes(2)
    expect(h.del).toHaveBeenCalledWith('vendor_bill_line:line-1', {
      suppressPostDeleteHooks: true,
    })
    expect(h.del).toHaveBeenCalledWith('vendor_bill_line:line-2', {
      suppressPostDeleteHooks: true,
    })
  })

  it('does nothing for a bill with no lines', async () => {
    await guardVendorBillDelete(event())
    expect(h.del).not.toHaveBeenCalled()
  })

  it('settles nothing for an org with no accounting setup', async () => {
    children({ lines: ['line-1'] })

    await guardVendorBillDelete(event({ vendor_bill_billed_at: '2020-01-01' }))

    expect(h.del).toHaveBeenCalledWith('vendor_bill_line:line-1', {
      suppressPostDeleteHooks: true,
    })
  })
})
