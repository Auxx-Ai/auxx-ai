// packages/lib/src/money/payouts/__tests__/reads.test.ts
//
// `findBankAccountByStripeExternalAccountId` (brief 13 §2.3): a payout's
// Stripe destination resolves to the org's own `bank_account` through a
// CONFIRMED `stripeExternalAccountId` identity, never `last4`. What is pinned
// here:
//
//  - `null` when the org has no `bank_account` def yet, or the identity field
//    has never been provisioned - both are "nothing to match against", not a
//    crash;
//  - `null` when no live bank account carries the destination;
//  - the matched account's `gl_account` id, when it has one;
//  - `null` glAccountId (not a crash) when the matched account carries no
//    chart mapping at all.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  getCachedEntityDefId: vi.fn(async () => null as string | null),
  bySystemAttributes: vi.fn(async () => ({}) as Record<string, { id: string } | null>),
}))

vi.mock('../../../cache', () => ({
  getCachedEntityDefId: h.getCachedEntityDefId,
  getOrgCache: () => ({ from: () => ({ bySystemAttributes: h.bySystemAttributes }) }),
}))

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { findBankAccountByStripeExternalAccountId, listPayouts } from '../reads'

const ORG = 'org_1'
const BANK_ACCOUNT_DEF = 'def_bank_account'
const STRIPE_FIELD = 'field_stripe_external_account_id'
const GL_FIELD = 'field_gl_account'

/**
 * A `Database` answering the two selects in call order: the join query that
 * finds the matching account (call 1), then the `gl_account` field value on
 * it (call 2). `.where()`/`.innerJoin()` are unevaluated - the caller already
 * scoped the seed to the query under test, the same posture the migration
 * stubs in this package take.
 */
function stubDb(opts: {
  matchRows?: { entityId: string }[]
  valueRows?: { valueText: string | null }[]
}): Database {
  let call = 0
  const chain = (rows: unknown[]): any => ({
    innerJoin: () => chain(rows),
    where: () => chain(rows),
    limit: () => Promise.resolve(rows),
  })
  return {
    select: () => ({
      from: () => {
        call++
        return call === 1 ? chain(opts.matchRows ?? []) : chain(opts.valueRows ?? [])
      },
    }),
  } as unknown as Database
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getCachedEntityDefId.mockResolvedValue(BANK_ACCOUNT_DEF)
  h.bySystemAttributes.mockResolvedValue({
    bank_account_stripe_external_account_id: { id: STRIPE_FIELD },
    bank_account_gl_account: { id: GL_FIELD },
  })
})

describe('findBankAccountByStripeExternalAccountId', () => {
  it('returns null when the org has no bank_account def yet', async () => {
    h.getCachedEntityDefId.mockResolvedValue(null)
    const db = stubDb({})

    const result = await findBankAccountByStripeExternalAccountId(db, ORG, 'ba_1')
    expect(result).toBeNull()
    expect(h.bySystemAttributes).not.toHaveBeenCalled()
  })

  it('returns null when the identity field has never been provisioned', async () => {
    h.bySystemAttributes.mockResolvedValue({ bank_account_stripe_external_account_id: null })
    const db = stubDb({})

    const result = await findBankAccountByStripeExternalAccountId(db, ORG, 'ba_1')
    expect(result).toBeNull()
  })

  it('returns null when no live bank account carries the destination', async () => {
    const db = stubDb({ matchRows: [] })

    const result = await findBankAccountByStripeExternalAccountId(db, ORG, 'ba_unknown')
    expect(result).toBeNull()
  })

  it('resolves the matched account and its gl_account mapping', async () => {
    const db = stubDb({
      matchRows: [{ entityId: 'ba_row_1' }],
      valueRows: [{ valueText: 'gl_1000' }],
    })

    const result = await findBankAccountByStripeExternalAccountId(db, ORG, 'ba_confirmed')
    expect(result).toEqual({ bankAccountId: 'ba_row_1', glAccountId: 'gl_1000' })
  })

  it('resolves the account with a null glAccountId when it carries no chart mapping', async () => {
    const db = stubDb({
      matchRows: [{ entityId: 'ba_row_1' }],
      valueRows: [],
    })

    const result = await findBankAccountByStripeExternalAccountId(db, ORG, 'ba_confirmed')
    expect(result).toEqual({ bankAccountId: 'ba_row_1', glAccountId: null })
  })

  it('resolves the account with a null glAccountId when the gl_account field has never been provisioned', async () => {
    h.bySystemAttributes.mockResolvedValue({
      bank_account_stripe_external_account_id: { id: STRIPE_FIELD },
      bank_account_gl_account: null,
    })
    const db = stubDb({ matchRows: [{ entityId: 'ba_row_1' }] })

    const result = await findBankAccountByStripeExternalAccountId(db, ORG, 'ba_confirmed')
    expect(result).toEqual({ bankAccountId: 'ba_row_1', glAccountId: null })
  })
})

// ── `bankTransactionId` (brief 18 §1: payouts become match candidates) ──────
//
// Set only by `matchTransaction` (`banking/review/writes.ts`) once a reviewer
// matches this payout to its bank line. A `paid` payout carrying null here is
// the payouts page's own `unmatched` signal.
describe('listPayouts', () => {
  const PAYOUT_DEF = 'def_payout'
  const FIELD_IDS: Record<string, string> = {
    payout_gateway_id: 'f_gateway',
    payout_status: 'f_status',
    payout_bank_transaction_id: 'f_bank_txn',
  }

  /** Every `select().from(<table>)` resolves to a fixed row set by table identity. */
  function stubPayoutsDb(rows: { entityInstance: unknown[]; fieldValue: unknown[] }): Database {
    const chain = (data: unknown[]): Record<string, unknown> => {
      const c: Record<string, unknown> = {}
      for (const method of ['innerJoin', 'where', 'orderBy', 'limit', 'offset', '$dynamic']) {
        c[method] = () => chain(data)
      }
      // biome-ignore lint/suspicious/noThenProperty: chainable drizzle query-builder stub
      c.then = (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) =>
        Promise.resolve(data).then(resolve, reject)
      return c
    }
    return {
      select: () => ({
        from: (target: unknown) =>
          target === schema.EntityInstance ? chain(rows.entityInstance) : chain(rows.fieldValue),
      }),
    } as unknown as Database
  }

  beforeEach(() => {
    h.getCachedEntityDefId.mockResolvedValue(PAYOUT_DEF)
    h.bySystemAttributes.mockResolvedValue(
      Object.fromEntries(Object.entries(FIELD_IDS).map(([attr, id]) => [attr, { id }]))
    )
  })

  it('carries bankTransactionId through from payout_bank_transaction_id', async () => {
    const db = stubPayoutsDb({
      entityInstance: [{ id: 'payout_1', createdAt: new Date('2026-09-10') }],
      fieldValue: [
        { entityId: 'payout_1', fieldId: FIELD_IDS.payout_gateway_id, valueText: 'po_1' },
        { entityId: 'payout_1', fieldId: FIELD_IDS.payout_status, optionId: 'paid' },
        { entityId: 'payout_1', fieldId: FIELD_IDS.payout_bank_transaction_id, valueText: 'txn_1' },
      ],
    })
    const result = await listPayouts(db, { organizationId: ORG })
    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value[0]?.bankTransactionId).toBe('txn_1')
  })

  it('is null - the payouts page unmatched signal - until a reviewer matches it', async () => {
    const db = stubPayoutsDb({
      entityInstance: [{ id: 'payout_1', createdAt: new Date('2026-09-10') }],
      fieldValue: [
        { entityId: 'payout_1', fieldId: FIELD_IDS.payout_gateway_id, valueText: 'po_1' },
        { entityId: 'payout_1', fieldId: FIELD_IDS.payout_status, optionId: 'paid' },
      ],
    })
    const result = await listPayouts(db, { organizationId: ORG })
    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value[0]?.bankTransactionId).toBeNull()
  })
})
