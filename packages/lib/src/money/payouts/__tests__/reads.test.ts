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
import { findBankAccountByStripeExternalAccountId } from '../reads'

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
