// packages/lib/src/postings/reports/__tests__/completeness.test.ts

import type { Database } from '@auxx/database'
import { err, ok } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../verify-balance', () => ({ listUnpostedPeriods: vi.fn() }))

import { listUnpostedPeriods } from '../../verify-balance'
import { readCompleteness } from '../completeness'

const ORG = 'org_1'

function stubDb(): Database {
  return {} as unknown as Database
}

describe('readCompleteness', () => {
  it('names every posting type not in ENABLED_POSTING_TYPES, each with a remedy', async () => {
    vi.mocked(listUnpostedPeriods).mockResolvedValue(ok([]))

    const result = await readCompleteness(stubDb(), { organizationId: ORG, asOf: '2026-08-31' })
    const completeness = result._unsafeUnwrap()

    // Wave 2 flipped `fulfillment` on (revenue legs only, COGS leg dark); the
    // L3 buy side (`receipt`, `vendor_bill`) and `bank_transaction` are still
    // off and must be named, each with a remedy.
    expect(completeness.disabledPostingTypes.length).toBeGreaterThan(0)
    expect(completeness.disabledPostingTypes.every((item) => item.remedy.href)).toBe(true)
    const ids = completeness.disabledPostingTypes.map((item) => item.id)
    expect(ids.some((id) => id.includes('receipt'))).toBe(true)
    expect(ids.some((id) => id.includes('fulfillment'))).toBe(false)
  })

  it('surfaces unposted periods with a remedy that opens that period', async () => {
    vi.mocked(listUnpostedPeriods).mockResolvedValue(
      ok([
        {
          periodKey: '2026-07',
          postingType: 'month_end_inventory',
          glPostingId: 'gl_1',
          status: 'failed',
          docNumber: 'GL-ME-2026-07',
          attempts: 2,
          failureReason: 'QuickBooks rate limit',
        },
      ])
    )

    const result = await readCompleteness(stubDb(), { organizationId: ORG, asOf: '2026-08-31' })
    const completeness = result._unsafeUnwrap()

    expect(completeness.unpostedPeriods).toHaveLength(1)
    const item = completeness.items.find((i) => i.id.includes('gl_1'))
    expect(item?.label).toContain('QuickBooks rate limit')
    expect(item?.remedy.href).toBe('/app/accounting/2026-07')
  })

  it('leaves the bank-feed placeholders empty until the feed exists', async () => {
    vi.mocked(listUnpostedPeriods).mockResolvedValue(ok([]))

    const result = await readCompleteness(stubDb(), { organizationId: ORG, asOf: '2026-08-31' })
    const completeness = result._unsafeUnwrap()

    expect(completeness.unreviewedBankLines).toEqual([])
    expect(completeness.coverageGaps).toEqual([])
  })

  it('returns err rather than throwing when the unposted-periods read fails', async () => {
    vi.mocked(listUnpostedPeriods).mockResolvedValue(err(new Error('boom')))

    const result = await readCompleteness(stubDb(), { organizationId: ORG, asOf: '2026-08-31' })
    expect(result.isErr()).toBe(true)
  })
})
