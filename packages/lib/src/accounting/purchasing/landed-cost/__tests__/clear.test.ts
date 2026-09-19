// packages/lib/src/accounting/purchasing/landed-cost/__tests__/clear.test.ts

/**
 * The Clear action (74 D4): the entry it composes, the refusal when nothing is
 * accrued, and the reversal.
 *
 * The ledger primitives are mocked - what this file tests is which legs the
 * clear names and on which claim, not that `postEntry` posts.
 */

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../reads', () => ({ readLandedCostByBill: vi.fn() }))
vi.mock('../cleared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../cleared')>()),
  countClearPostings: vi.fn(),
}))
vi.mock('../../expense-bill/reads', () => ({ requireVendorBill: vi.fn() }))
vi.mock('../../../ledger/setup/accounting-enabled', () => ({ isAccountingEnabled: vi.fn() }))
vi.mock('../../../ledger/setup/book-time-zone', () => ({ todayInBookTimeZone: vi.fn() }))
vi.mock('../../../ledger/periods/period-lock', () => ({ resolvePeriodLock: vi.fn() }))
vi.mock('../../../ledger/post/auto-post', () => ({ readAutoPostMode: vi.fn() }))
vi.mock('../../../ledger/post/post-entry', () => ({ postEntry: vi.fn() }))
vi.mock('../../../ledger/post/reverse-entry', () => ({ reverseEntry: vi.fn() }))
vi.mock('../../../ledger/reads/list-postings', () => ({ findLiveSubjectPosting: vi.fn() }))

import { ok } from 'neverthrow'
import { resolvePeriodLock } from '../../../ledger/periods/period-lock'
import { readAutoPostMode } from '../../../ledger/post/auto-post'
import { postEntry } from '../../../ledger/post/post-entry'
import { reverseEntry } from '../../../ledger/post/reverse-entry'
import { findLiveSubjectPosting } from '../../../ledger/reads/list-postings'
import { isAccountingEnabled } from '../../../ledger/setup/accounting-enabled'
import { todayInBookTimeZone } from '../../../ledger/setup/book-time-zone'
import { requireVendorBill } from '../../expense-bill/reads'
import { clearLandedCost, clearOccurrence, reverseLandedCostClear } from '../clear'
import { countClearPostings } from '../cleared'
import { readLandedCostByBill } from '../reads'

const db = {} as Database

function summary(freightRemaining: number, dutiesRemaining: number) {
  const leg = (remainingMinor: number) => ({
    accruedMinor: remainingMinor,
    billedMinor: 0,
    differenceMinor: remainingMinor,
    clearedMinor: 0,
    remainingMinor,
  })
  return ok({
    freight: leg(freightRemaining),
    duties: leg(dutiesRemaining),
    otherBilledMinor: 0,
    receiptCount: 1,
    landedLineCount: 1,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isAccountingEnabled).mockResolvedValue(true)
  vi.mocked(todayInBookTimeZone).mockResolvedValue('2026-09-20')
  vi.mocked(resolvePeriodLock).mockResolvedValue({ mode: 'open' } as never)
  vi.mocked(readAutoPostMode).mockResolvedValue('auto' as never)
  vi.mocked(countClearPostings).mockResolvedValue(0)
  vi.mocked(requireVendorBill).mockResolvedValue({
    id: 'vb_goods',
    number: 'INV-77',
    internalNumber: 'BILL-0002',
  } as never)
  vi.mocked(postEntry).mockResolvedValue({ status: 'posted' } as never)
})

describe('clearLandedCost', () => {
  it('posts the under-run as Dr accrual / Cr ppv, one entry, on the goods bill', async () => {
    vi.mocked(readLandedCostByBill).mockResolvedValue(summary(200, 0) as never)

    const result = await clearLandedCost(db, {
      organizationId: 'org_1',
      goodsBillInstanceId: 'vb_goods',
    })
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toMatchObject({ freightMinor: 200, dutiesMinor: 0 })

    const [, options] = vi.mocked(postEntry).mock.calls[0] as [unknown, any]
    expect(options.entry.postingType).toBe('landed_cost_clear')
    expect(options.entry.txnDate).toBe('2026-09-20')
    // The zero duties leg is dropped rather than posted at nothing.
    expect(
      options.entry.lines.map((line: any) => [line.accountRole, line.direction, line.amount])
    ).toEqual([
      ['freight_accrual', 'debit', 200],
      ['ppv', 'credit', 200],
    ])
    expect(options.sources).toEqual([
      {
        sourceKind: 'vendor_bill',
        sourceId: 'vb_goods',
        linkRole: 'subject',
        occurrence: 'clear:0',
      },
    ])
  })

  it('names both accruals in ONE entry when both are outstanding', async () => {
    vi.mocked(readLandedCostByBill).mockResolvedValue(summary(200, 500) as never)

    await clearLandedCost(db, { organizationId: 'org_1', goodsBillInstanceId: 'vb_goods' })
    const [, options] = vi.mocked(postEntry).mock.calls[0] as [unknown, any]
    expect(postEntry).toHaveBeenCalledTimes(1)
    expect(options.entry.lines.map((line: any) => [line.accountRole, line.amount])).toEqual([
      ['freight_accrual', 200],
      ['duties_accrual', 500],
      ['ppv', 700],
    ])
  })

  it('keys a second attempt on its own occurrence', async () => {
    vi.mocked(readLandedCostByBill).mockResolvedValue(summary(100, 0) as never)
    vi.mocked(countClearPostings).mockResolvedValue(1)

    await clearLandedCost(db, { organizationId: 'org_1', goodsBillInstanceId: 'vb_goods' })
    const [, options] = vi.mocked(postEntry).mock.calls[0] as [unknown, any]
    expect(options.sources[0].occurrence).toBe(clearOccurrence(1))
  })

  it('refuses when nothing is left accrued on either leg', async () => {
    vi.mocked(readLandedCostByBill).mockResolvedValue(summary(0, 0) as never)

    const result = await clearLandedCost(db, {
      organizationId: 'org_1',
      goodsBillInstanceId: 'vb_goods',
    })
    expect(result.isErr()).toBe(true)
    expect(postEntry).not.toHaveBeenCalled()
  })
})

describe('reverseLandedCostClear', () => {
  it('reverses the attempt still standing, and answers null when none is', async () => {
    vi.mocked(findLiveSubjectPosting).mockResolvedValue(
      ok({ id: 'glp_1', docNumber: 'AUXX-LCC-ABC123' }) as never
    )
    vi.mocked(reverseEntry).mockResolvedValue({ status: 'posted' } as never)

    await reverseLandedCostClear(db, {
      organizationId: 'org_1',
      goodsBillInstanceId: 'vb_goods',
      attempt: 0,
    })
    expect(vi.mocked(findLiveSubjectPosting).mock.calls[0]?.[1]).toMatchObject({
      sourceKind: 'vendor_bill',
      sourceId: 'vb_goods',
      occurrence: 'clear:0',
    })
    expect(vi.mocked(reverseEntry).mock.calls[0]?.[1]).toMatchObject({ glPostingId: 'glp_1' })

    vi.mocked(findLiveSubjectPosting).mockResolvedValue(ok(null) as never)
    await expect(
      reverseLandedCostClear(db, {
        organizationId: 'org_1',
        goodsBillInstanceId: 'vb_goods',
        attempt: 0,
      })
    ).resolves.toBeNull()
  })
})
