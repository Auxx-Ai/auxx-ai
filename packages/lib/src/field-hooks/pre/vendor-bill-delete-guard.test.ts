// packages/lib/src/field-hooks/pre/vendor-bill-delete-guard.test.ts
// The guard that stops a vendor bill being hard-deleted once it is in the books,
// part-paid, or dated in a settled month.
//
// plans/money/tasks/21-money-parent-delete-safety.md §5. The shape difference
// from the other money guards: a bill has no movements of its own, so the
// settled test runs on ONE date, `vendor_bill_billed_at`, which the field's own
// description calls "the ACCOUNTING date".
//
// The allocation refusal and the line cascade are no longer here: they are
// `onDelete: 'restrict'` on `vendor_bill_payment_allocations` and `onDelete:
// 'cascade'` on `vendor_bill_lines`, run by the delete engine.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EntityPreDeleteEvent } from '../types'

const h = vi.hoisted(() => ({
  resolvePeriodLock: vi.fn(),
  postedPeriodRows: vi.fn(),
  getOrganizationSetting: vi.fn(),
  instanceRows: vi.fn(),
}))

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
  settings({})
})

describe('guardVendorBillDelete: status', () => {
  for (const status of ['posted', 'partially_paid', 'paid']) {
    it(`refuses a ${status} bill`, async () => {
      await expect(guardVendorBillDelete(event({ vendor_bill_status: status }))).rejects.toThrow(
        /in the books or part-paid/i
      )
      // The status wall reads nothing: a refused bill never reaches the period read.
      expect(h.resolvePeriodLock).not.toHaveBeenCalled()
    })
  }

  for (const status of ['draft', 'awaiting_receipt', 'matched', 'exception']) {
    it(`allows a ${status} bill through the status wall`, async () => {
      await expect(
        guardVendorBillDelete(event({ vendor_bill_status: status }))
      ).resolves.toBeUndefined()
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

describe('guardVendorBillDelete: period', () => {
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

  it('passes a bill dated in an open month', async () => {
    h.resolvePeriodLock.mockResolvedValue({ lockedThroughMonth: '2026-07' })

    await expect(
      guardVendorBillDelete(event({ vendor_bill_billed_at: '2026-09-05' }))
    ).resolves.toBeUndefined()
  })

  it('settles nothing for an org with no accounting setup', async () => {
    await expect(
      guardVendorBillDelete(event({ vendor_bill_billed_at: '2020-01-01' }))
    ).resolves.toBeUndefined()
  })
})
