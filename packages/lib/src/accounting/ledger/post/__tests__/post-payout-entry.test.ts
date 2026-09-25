// packages/lib/src/accounting/ledger/post/__tests__/post-payout-entry.test.ts
//
// plans/accounting/tasks/done/17-accounting-is-opt-in.md section 3: the accounting-off
// case is checked FIRST, before the builder and the post.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  isAccountingActive: vi.fn(async () => true),
  buildPayoutEntry: vi.fn(),
  postEntry: vi.fn(),
}))

vi.mock('../../setup/accounting-enabled', () => ({ isAccountingActive: h.isAccountingActive }))
vi.mock('../../builders/payout', () => ({ buildPayoutEntry: h.buildPayoutEntry }))
vi.mock('../post-entry', () => ({ postEntry: h.postEntry }))

import type { Database } from '@auxx/database'
import { payoutAccountUnmappedResult, postPayoutEntry } from '../post-payout-entry'

const ORG = 'org_1'
const db = {} as Database

const OPTIONS = {
  organizationId: ORG,
  actorUserId: 'user_1',
  payoutId: 'po_1',
  payoutInstanceId: 'inst_1',
  payoutNumber: 'PO-0007',
  rail: 'gateway_1',
  currency: 'USD',
  grossMinor: 500_000,
  feesMinor: 14_800,
  netMinor: 485_200,
  paidAt: '2026-09-04',
}

beforeEach(() => {
  vi.clearAllMocks()
  h.isAccountingActive.mockResolvedValue(true)
  h.buildPayoutEntry.mockReturnValue({
    entry: { postingType: 'payout', periodKey: 'PO0007', txnDate: '2026-09-04', lines: [] },
    periodKey: 'PO0007',
    grossMinor: 500_000,
  })
  h.postEntry.mockResolvedValue({
    status: 'posted',
    glPostingId: 'gl_1',
    docNumber: 'PO-0007',
  })
})

describe('accounting enabled', () => {
  it('builds and posts', async () => {
    const result = await postPayoutEntry(db, OPTIONS)

    expect(h.buildPayoutEntry).toHaveBeenCalledTimes(1)
    expect(h.postEntry).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ status: 'posted', glPostingId: 'gl_1', docNumber: 'PO-0007' })
  })

  // plans/accounting/payout-links.md §11.5: the subject is the RECORD, because
  // that is the id every `LedgerCard` looks a posting up by.
  it('claims the payout record, not the provider payout id', async () => {
    await postPayoutEntry(db, OPTIONS)

    const [, input] = h.postEntry.mock.calls[0] as [unknown, { sources: unknown[] }]
    expect(input.sources).toEqual([
      { sourceKind: 'payout', sourceId: 'inst_1', linkRole: 'subject' },
    ])
  })

  it('writes one member row per processor entry beside the subject', async () => {
    await postPayoutEntry(db, { ...OPTIONS, memberEntryIds: ['pbe_1', 'pbe_2'] })

    const [, input] = h.postEntry.mock.calls[0] as [unknown, { sources: unknown[] }]
    expect(input.sources).toEqual([
      { sourceKind: 'payout', sourceId: 'inst_1', linkRole: 'subject' },
      { sourceKind: 'processor_balance_entry', sourceId: 'pbe_1', linkRole: 'member' },
      { sourceKind: 'processor_balance_entry', sourceId: 'pbe_2', linkRole: 'member' },
    ])
  })
})

describe('accounting not enabled', () => {
  beforeEach(() => {
    h.isAccountingActive.mockResolvedValue(false)
  })

  it('returns not_enabled without building or posting', async () => {
    const result = await postPayoutEntry(db, OPTIONS)

    expect(result).toEqual({ status: 'not_enabled' })
    expect(h.buildPayoutEntry).not.toHaveBeenCalled()
    expect(h.postEntry).not.toHaveBeenCalled()
  })
})

// brief 13 §2.3: the caller (`money/payouts/sync.ts`) constructs this directly
// and never calls `postPayoutEntry` at all when a payout's destination cannot
// be resolved to a confirmed bank account.
describe('payoutAccountUnmappedResult', () => {
  it('is a pre-claim account_unmapped refusal, never built or posted', () => {
    const result = payoutAccountUnmappedResult(
      'Payout PO-0007 names ba_unknown, which is not confirmed on any bank account.'
    )

    expect(result).toEqual({
      status: 'account_unmapped',
      failureClass: 'configuration',
      error: 'Payout PO-0007 names ba_unknown, which is not confirmed on any bank account.',
    })
    expect(h.buildPayoutEntry).not.toHaveBeenCalled()
    expect(h.postEntry).not.toHaveBeenCalled()
  })
})
