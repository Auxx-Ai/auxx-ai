// packages/lib/src/postings/__tests__/post-payout-entry.test.ts
//
// plans/accounting/tasks/17-accounting-is-opt-in.md section 3: the accounting-off
// case is checked FIRST, before the builder, the period-lock read and the post.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  isAccountingEnabled: vi.fn(async () => true),
  buildPayoutEntry: vi.fn(),
  resolvePeriodLock: vi.fn(),
  postEntry: vi.fn(),
}))

vi.mock('../accounting-enabled', () => ({ isAccountingEnabled: h.isAccountingEnabled }))
vi.mock('../build-payout-entry', () => ({ buildPayoutEntry: h.buildPayoutEntry }))
vi.mock('../period-lock', () => ({ resolvePeriodLock: h.resolvePeriodLock }))
vi.mock('../post-entry', () => ({ postEntry: h.postEntry }))

import type { Database } from '@auxx/database'
import { ACCOUNT_ROLES } from '../build-entry'
import { postPayoutEntry } from '../post-payout-entry'

const ORG = 'org_1'
const db = {} as Database

const OPTIONS = {
  organizationId: ORG,
  actorUserId: 'user_1',
  payoutId: 'po_1',
  payoutNumber: 'PO-0007',
  grossMinor: 500_000,
  feesMinor: 14_800,
  netMinor: 485_200,
  clearingRole: ACCOUNT_ROLES.CLEARING_CARD,
  paidAt: '2026-09-04',
}

beforeEach(() => {
  vi.clearAllMocks()
  h.isAccountingEnabled.mockResolvedValue(true)
  h.resolvePeriodLock.mockResolvedValue({ lockedThroughMonth: null })
  h.buildPayoutEntry.mockReturnValue({
    entry: { postingType: 'payout', periodKey: 'PO0007', txnDate: '2026-09-04', lines: [] },
    periodKey: 'PO0007',
    grossMinor: 500_000,
  })
  h.postEntry.mockResolvedValue({
    status: 'posted',
    glPostingId: 'gl_1',
    docNumber: 'AUXX-PAY-PO0007',
  })
})

describe('accounting enabled', () => {
  it('builds, resolves the period lock, and posts', async () => {
    const result = await postPayoutEntry(db, OPTIONS)

    expect(h.buildPayoutEntry).toHaveBeenCalledTimes(1)
    expect(h.resolvePeriodLock).toHaveBeenCalledTimes(1)
    expect(h.postEntry).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ status: 'posted', glPostingId: 'gl_1', docNumber: 'AUXX-PAY-PO0007' })
  })
})

describe('accounting not enabled', () => {
  beforeEach(() => {
    h.isAccountingEnabled.mockResolvedValue(false)
  })

  it('returns not_enabled without building, locking, or posting', async () => {
    const result = await postPayoutEntry(db, OPTIONS)

    expect(result).toEqual({ status: 'not_enabled' })
    expect(h.buildPayoutEntry).not.toHaveBeenCalled()
    expect(h.resolvePeriodLock).not.toHaveBeenCalled()
    expect(h.postEntry).not.toHaveBeenCalled()
  })
})
