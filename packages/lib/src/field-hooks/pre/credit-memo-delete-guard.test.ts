// packages/lib/src/field-hooks/pre/credit-memo-delete-guard.test.ts
// The guard that stops a credit memo being hard-deleted once it is in the
// books, dated in a settled month, or refunded.
//
// plans/accounting/tasks/10-credit-memos.md section 2.6. Same shape as the
// vendor bill guard's test: the period predicates are driven through the real
// `settledPeriodsFor` with its three inputs mocked, and the refund read is a
// separate `select()` chain so a test cannot confuse the two.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EntityPreDeleteEvent } from '../types'

const h = vi.hoisted(() => ({
  resolvePeriodLock: vi.fn(),
  postedPeriodRows: vi.fn(),
  getOrganizationSetting: vi.fn(),
  refundRows: vi.fn(),
}))

vi.mock('../../postings/period-lock', () => ({ resolvePeriodLock: h.resolvePeriodLock }))
vi.mock('../../settings/settings-service', () => ({
  getOrganizationSetting: h.getOrganizationSetting,
}))

// `select()` is the refund read; `selectDistinct()` is the posted-period read.
vi.mock('@auxx/database', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@auxx/database')
  const refundChain: Record<string, unknown> = {}
  refundChain.from = () => refundChain
  refundChain.where = () => refundChain
  refundChain.limit = async () => h.refundRows()

  const postedChain: Record<string, unknown> = {}
  postedChain.from = () => postedChain
  postedChain.where = async () => h.postedPeriodRows()

  return {
    ...actual,
    database: { select: () => refundChain, selectDistinct: () => postedChain },
  }
})

import { guardCreditMemoDelete } from './credit-memo-delete-guard'

const MEMO_DEF = 'v5hzr4xbn1fhznih3u74gtza'
const MEMO_ID = 'cm000000000000000000000001'
const MEMO_RECORD_ID = `${MEMO_DEF}:${MEMO_ID}`
const ORG = 'abgwpa1l81reht2zmwrcihfu'

function event(values: Record<string, unknown> = {}): EntityPreDeleteEvent {
  return {
    recordId: MEMO_RECORD_ID as EntityPreDeleteEvent['recordId'],
    entityDefinitionId: MEMO_DEF,
    entityType: 'credit_memo',
    entitySlug: 'credit-memos',
    values: { credit_memo_status: 'draft', ...values },
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
  h.refundRows.mockResolvedValue([])
  settings({})
})

describe('guardCreditMemoDelete: status', () => {
  for (const status of ['issued', 'settled']) {
    it(`refuses an ${status} memo`, async () => {
      await expect(guardCreditMemoDelete(event({ credit_memo_status: status }))).rejects.toThrow(
        /void it first/i
      )
      // The status wall reads nothing: a refused memo never reaches the period read.
      expect(h.resolvePeriodLock).not.toHaveBeenCalled()
    })
  }

  for (const status of ['draft', 'void']) {
    it(`lets a ${status} memo through the status wall`, async () => {
      await expect(
        guardCreditMemoDelete(event({ credit_memo_status: status }))
      ).resolves.toBeUndefined()
    })
  }

  it('unwraps a coerced SINGLE_SELECT value', async () => {
    await expect(
      guardCreditMemoDelete(event({ credit_memo_status: { type: 'option', optionId: 'issued' } }))
    ).rejects.toThrow(/void it first/i)
  })
})

describe('guardCreditMemoDelete: period', () => {
  it('refuses a void memo dated in a locked month', async () => {
    h.resolvePeriodLock.mockResolvedValue({ lockedThroughMonth: '2026-07' })

    await expect(
      guardCreditMemoDelete(
        event({ credit_memo_status: 'void', credit_memo_issued_at: '2026-07-02T12:00:00.000Z' })
      )
    ).rejects.toThrow(/2026-07/)
  })

  it('refuses a memo dated in a month holding a standing posted entry', async () => {
    h.postedPeriodRows.mockResolvedValue([{ periodKey: '2026-08' }])

    await expect(
      guardCreditMemoDelete(
        event({ credit_memo_status: 'void', credit_memo_issued_at: '2026-08-15T12:00:00.000Z' })
      )
    ).rejects.toThrow(/2026-08/)
  })

  it('refuses a memo dated at or before the cutoff', async () => {
    settings({ 'accounting.cutoffPeriod': '2026-05' })

    await expect(
      guardCreditMemoDelete(
        event({ credit_memo_status: 'void', credit_memo_issued_at: '2026-04-30T12:00:00.000Z' })
      )
    ).rejects.toThrow(/2026-04/)
  })

  it('reads a captured date array the way the capture chain hands it over', async () => {
    h.resolvePeriodLock.mockResolvedValue({ lockedThroughMonth: '2026-07' })

    await expect(
      guardCreditMemoDelete(
        event({ credit_memo_status: 'void', credit_memo_issued_at: ['2026-07-02T12:00:00.000Z'] })
      )
    ).rejects.toThrow(/2026-07/)
  })

  it('passes an undated draft without consulting any period', async () => {
    h.resolvePeriodLock.mockResolvedValue({ lockedThroughMonth: '2026-12' })

    await expect(
      guardCreditMemoDelete(event({ credit_memo_issued_at: null }))
    ).resolves.toBeUndefined()
    expect(h.resolvePeriodLock).not.toHaveBeenCalled()
  })

  it('passes a memo dated in an open month', async () => {
    h.resolvePeriodLock.mockResolvedValue({ lockedThroughMonth: '2026-07' })

    await expect(
      guardCreditMemoDelete(
        event({ credit_memo_status: 'void', credit_memo_issued_at: '2026-09-05T12:00:00.000Z' })
      )
    ).resolves.toBeUndefined()
  })
})

describe('guardCreditMemoDelete: refunds', () => {
  it('refuses while a refund transaction references the memo', async () => {
    h.refundRows.mockResolvedValue([{ id: 'txn_1', status: 'succeeded' }])

    await expect(guardCreditMemoDelete(event())).rejects.toThrow(/succeeded refund/i)
  })

  it('refuses on a pending refund too - the row is still a ledger row', async () => {
    h.refundRows.mockResolvedValue([{ id: 'txn_1', status: 'pending' }])

    await expect(guardCreditMemoDelete(event())).rejects.toThrow(/pending refund/i)
  })

  it('passes a memo with no refund rows', async () => {
    await expect(guardCreditMemoDelete(event())).resolves.toBeUndefined()
  })
})
