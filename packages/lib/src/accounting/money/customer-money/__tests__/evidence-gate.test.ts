// packages/lib/src/accounting/money/customer-money/__tests__/evidence-gate.test.ts
//
// plans/accounting/tasks/110-money-marks-not-rules.md G2: the evidence writers write nothing
// until accounting is active. A draft call must not touch the db; a finalized one must.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  isAccountingActive: vi.fn(async (_org: string) => false),
  lock: vi.fn(async (..._args: unknown[]) => {
    throw new Error('reached')
  }),
}))

vi.mock('../../../ledger/setup/accounting-enabled', () => ({
  isAccountingActive: h.isAccountingActive,
}))
vi.mock('@auxx/database', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  withAccountingCommitLock: h.lock,
}))

import type { Database, Transaction } from '@auxx/database'
import { assessPayouts } from '../../payouts/assess-payouts'
import { bridgeFinancialRecords } from '../bridge'
import { materializeImportedMoneyInTx } from '../ingest'
import { reconcileOrderPaymentEvidence } from '../record-evidence'

const ORG = 'org_1'

/** A db whose every entry point throws, so reaching it is visible. */
function trapDb() {
  const reached = vi.fn(() => {
    throw new Error('reached')
  })
  const db = {
    select: reached,
    transaction: reached,
    query: { FinancialSourceAcceptance: { findMany: reached } },
  }
  return { db: db as unknown as Database & Transaction, reached }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.isAccountingActive.mockResolvedValue(false)
})

describe('in draft, the evidence writers return without writing', () => {
  it('bridgeFinancialRecords returns its empty result', async () => {
    const { db, reached } = trapDb()
    const result = await bridgeFinancialRecords(db, {
      organizationId: ORG,
      actorUserId: 'user_1',
      records: [{ id: 'po_1', kind: 'payout' }],
    })
    expect(result.payoutInstanceIds).toEqual([])
    expect(result.orderInstanceIds).toEqual([])
    expect(result.payout.skipped).toBe(0)
    expect(reached).not.toHaveBeenCalled()
  })

  it('reconcileOrderPaymentEvidence examines nothing', async () => {
    const { db, reached } = trapDb()
    await expect(
      reconcileOrderPaymentEvidence(db, { organizationId: ORG, orderInstanceIds: ['ord_1'] })
    ).resolves.toEqual({ examined: 0 })
    expect(reached).not.toHaveBeenCalled()
  })

  it('assessPayouts assesses nothing', async () => {
    const { db, reached } = trapDb()
    await expect(assessPayouts(db, ORG, ['po_1'])).resolves.toBe(0)
    expect(reached).not.toHaveBeenCalled()
  })

  it('materializeImportedMoneyInTx does not take the lock', async () => {
    const { db } = trapDb()
    await expect(materializeImportedMoneyInTx(db, ORG, 'acc_1')).resolves.toBeUndefined()
    expect(h.lock).not.toHaveBeenCalled()
  })
})

describe('once finalized, the same calls proceed', () => {
  beforeEach(() => {
    h.isAccountingActive.mockResolvedValue(true)
  })

  it('bridgeFinancialRecords looks the payout def up', async () => {
    const { db } = trapDb()
    const result = await bridgeFinancialRecords(db, {
      organizationId: ORG,
      actorUserId: 'user_1',
      records: [{ id: 'po_1', kind: 'payout' }],
    })
    // The test org has no payout def, so reaching the lookup shows as a skip.
    expect(result.payout.reasons).toEqual({ 'resource is not installed for this organization': 1 })
  })

  it('reconcileOrderPaymentEvidence reads the acceptances', async () => {
    const { db } = trapDb()
    await expect(
      reconcileOrderPaymentEvidence(db, { organizationId: ORG, orderInstanceIds: ['ord_1'] })
    ).rejects.toThrow('reached')
  })

  it('assessPayouts reads the entries', async () => {
    const { db } = trapDb()
    await expect(assessPayouts(db, ORG, ['po_1'])).rejects.toThrow('reached')
  })

  it('materializeImportedMoneyInTx takes the lock', async () => {
    const { db } = trapDb()
    await expect(materializeImportedMoneyInTx(db, ORG, 'acc_1')).rejects.toThrow('reached')
    expect(h.lock).toHaveBeenCalled()
  })
})
