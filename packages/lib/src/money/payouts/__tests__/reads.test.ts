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

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  getCachedEntityDefId: vi.fn(async () => null as string | null),
  bySystemAttributes: vi.fn(async () => ({}) as Record<string, { id: string } | null>),
}))

vi.mock('../../../payment-gateways/reads', () => ({ listPaymentGateways: async () => ok([]) }))

vi.mock('../../../cache', () => ({
  getCachedEntityDefId: h.getCachedEntityDefId,
  getOrgCache: () => ({ from: () => ({ bySystemAttributes: h.bySystemAttributes }) }),
}))

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import {
  findBankAccountByStripeExternalAccountId,
  findPayoutByGatewayId,
  listPayouts,
} from '../reads'

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
    expect(result).toEqual({
      bankAccountId: 'ba_row_1',
      recordId: `${BANK_ACCOUNT_DEF}:ba_row_1`,
      glAccountId: 'gl_1000',
    })
  })

  it('resolves the account with a null glAccountId when it carries no chart mapping', async () => {
    const db = stubDb({
      matchRows: [{ entityId: 'ba_row_1' }],
      valueRows: [],
    })

    const result = await findBankAccountByStripeExternalAccountId(db, ORG, 'ba_confirmed')
    expect(result).toEqual({
      bankAccountId: 'ba_row_1',
      recordId: `${BANK_ACCOUNT_DEF}:ba_row_1`,
      glAccountId: null,
    })
  })

  it('resolves the account with a null glAccountId when the gl_account field has never been provisioned', async () => {
    h.bySystemAttributes.mockResolvedValue({
      bank_account_stripe_external_account_id: { id: STRIPE_FIELD },
      bank_account_gl_account: null,
    })
    const db = stubDb({ matchRows: [{ entityId: 'ba_row_1' }] })

    const result = await findBankAccountByStripeExternalAccountId(db, ORG, 'ba_confirmed')
    expect(result).toEqual({
      bankAccountId: 'ba_row_1',
      recordId: `${BANK_ACCOUNT_DEF}:ba_row_1`,
      glAccountId: null,
    })
  })
})

// ── `findPayoutByGatewayId`: the pair is the key (brief 27 §6.4, §13 test 4) ──
//
// The stub cannot evaluate SQL, so what is pinned is the PREDICATE the read
// hands the database, rendered through drizzle's own dialect: with a rail the
// pointer is narrowed to that rail OR null (an unstamped row is adopted, never
// duplicated), and without one nothing about the pointer is asked at all.
// Rendered outside a full statement the dialect prints no column names, so
// the assertions read the operators and the bound parameters, which is where
// the rail id actually travels.
describe('findPayoutByGatewayId', () => {
  const PAYOUT_DEF = 'def_payout'
  const GATEWAY_ID_FIELD = 'f_gateway_id'
  const RAIL_FIELD = 'f_rail'
  const dialect = new PgDialect()

  interface Captured {
    leftJoins: number
    orderBy: unknown[]
    where: unknown
  }

  /**
   * A `Database` whose first select records the query shape and answers no
   * rows, so the read stops before `hydrate`. Every builder method is
   * chainable and the chain is awaitable.
   */
  function capturingDb(captured: Captured): Database {
    const chain = (): Record<string, unknown> => {
      const c: Record<string, unknown> = {}
      for (const method of ['innerJoin', '$dynamic', 'limit']) {
        c[method] = () => chain()
      }
      c.leftJoin = () => {
        captured.leftJoins += 1
        return chain()
      }
      c.orderBy = (...args: unknown[]) => {
        captured.orderBy.push(...args)
        return chain()
      }
      c.where = (predicate: unknown) => {
        captured.where = predicate
        return chain()
      }
      // biome-ignore lint/suspicious/noThenProperty: chainable drizzle query-builder stub
      c.then = (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) =>
        Promise.resolve([]).then(resolve, reject)
      return c
    }
    return { select: () => ({ from: () => chain() }) } as unknown as Database
  }

  function render(predicate: unknown) {
    return dialect.sqlToQuery(predicate as SQL)
  }

  beforeEach(() => {
    h.getCachedEntityDefId.mockResolvedValue(PAYOUT_DEF)
    h.bySystemAttributes.mockResolvedValue({
      payout_gateway_id: { id: GATEWAY_ID_FIELD },
      payout_status: { id: 'f_status' },
      payout_payment_gateway: { id: RAIL_FIELD },
    })
  })

  it('narrows on the rail OR a null pointer when a rail is given - the same id on another rail is a different row', async () => {
    const captured: Captured = { leftJoins: 0, orderBy: [], where: undefined }

    await findPayoutByGatewayId(capturingDb(captured), ORG, 'po_1', 'pg_stripe')

    expect(captured.leftJoins).toBe(1)
    const { sql, params } = render(captured.where)
    // org, def, then the rail: the gateway payout id itself is bound in the
    // inner join, which is not part of the captured predicate.
    expect(params).toEqual([ORG, PAYOUT_DEF, 'pg_stripe'])
    expect(sql).toMatch(/\(\s*is null or\s*= \$3\)/)
  })

  it('prefers a row stamped with this rail over an unstamped one', async () => {
    const captured: Captured = { leftJoins: 0, orderBy: [], where: undefined }

    await findPayoutByGatewayId(capturingDb(captured), ORG, 'po_1', 'pg_stripe')

    expect(captured.orderBy).toHaveLength(1)
    // `false` before `true`: a stamped row sorts ahead of an unstamped one.
    expect(render(captured.orderBy[0]).sql).toMatch(/is null$/i)
  })

  it('asks nothing about the pointer without a rail - the id-only lookup, as before the pair existed', async () => {
    const captured: Captured = { leftJoins: 0, orderBy: [], where: undefined }

    await findPayoutByGatewayId(capturingDb(captured), ORG, 'po_1')

    expect(captured.leftJoins).toBe(0)
    expect(captured.orderBy).toHaveLength(0)
    const { sql, params } = render(captured.where)
    expect(params).toEqual([ORG, PAYOUT_DEF])
    expect(sql).not.toMatch(/ or /)
  })

  it('falls back to the id-only lookup on an org short of migration 157, whose rows are all unstamped', async () => {
    h.bySystemAttributes.mockResolvedValue({
      payout_gateway_id: { id: GATEWAY_ID_FIELD },
      payout_status: { id: 'f_status' },
      payout_payment_gateway: null,
    })
    const captured: Captured = { leftJoins: 0, orderBy: [], where: undefined }

    await findPayoutByGatewayId(capturingDb(captured), ORG, 'po_1', 'pg_stripe')

    expect(captured.leftJoins).toBe(0)
    expect(render(captured.where).params).toEqual([ORG, PAYOUT_DEF])
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

  it('hydrates ordinary source fields into the settlement summary without changing posting values', async () => {
    const sourceFields = {
      payout_source_amount: { valueText: '105.67' },
      payout_source_currency: { valueText: 'USD' },
      payout_source_currency_exponent: { valueNumber: 2 },
      payout_source_status: { valueText: 'paid' },
    }
    h.bySystemAttributes.mockResolvedValue({
      ...Object.fromEntries(Object.entries(FIELD_IDS).map(([attr, id]) => [attr, { id }])),
      ...Object.fromEntries(Object.keys(sourceFields).map((attr) => [attr, { id: attr }])),
    })
    const db = stubPayoutsDb({
      entityInstance: [{ id: 'payout_1', createdAt: new Date('2026-09-15') }],
      fieldValue: Object.entries(sourceFields).map(([fieldId, value]) => ({
        entityId: 'payout_1',
        fieldId,
        ...value,
      })),
    })
    const result = await listPayouts(db, { organizationId: ORG })
    expect(result.isOk()).toBe(true)
    if (result.isOk())
      expect(result.value[0]).toMatchObject({
        depositedMinor: 0,
        paymentGatewayId: null,
        sourceSummary: {
          amountMinor: '10567',
          currency: 'USD',
          currencyExponent: 2,
          status: 'paid',
        },
      })
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

  // ── brief 27 §6.1: the rail, the bank account and the provenance ──────────

  it('reads the rail and bank-account pointers off relatedEntityId, and the source off its option', async () => {
    h.bySystemAttributes.mockResolvedValue({
      ...Object.fromEntries(Object.entries(FIELD_IDS).map(([attr, id]) => [attr, { id }])),
      payout_payment_gateway: { id: 'f_rail' },
      payout_bank_account: { id: 'f_bank' },
      payout_source: { id: 'f_source' },
    })
    const db = stubPayoutsDb({
      entityInstance: [{ id: 'payout_1', createdAt: new Date('2026-09-10') }],
      fieldValue: [
        { entityId: 'payout_1', fieldId: FIELD_IDS.payout_gateway_id, valueText: 'po_1' },
        { entityId: 'payout_1', fieldId: 'f_rail', relatedEntityId: 'pg_stripe' },
        { entityId: 'payout_1', fieldId: 'f_bank', relatedEntityId: 'ba_1' },
        { entityId: 'payout_1', fieldId: 'f_source', optionId: 'imported' },
      ],
    })
    const result = await listPayouts(db, { organizationId: ORG })
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value[0]).toMatchObject({
        paymentGatewayId: 'pg_stripe',
        bankAccountId: 'ba_1',
        source: 'imported',
      })
    }
  })

  it('reads an unstamped row as synced with no pointers - what every pre-157 payout is', async () => {
    const db = stubPayoutsDb({
      entityInstance: [{ id: 'payout_1', createdAt: new Date('2026-09-10') }],
      fieldValue: [
        { entityId: 'payout_1', fieldId: FIELD_IDS.payout_gateway_id, valueText: 'po_1' },
      ],
    })
    const result = await listPayouts(db, { organizationId: ORG })
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value[0]).toMatchObject({
        paymentGatewayId: null,
        bankAccountId: null,
        source: 'synced',
      })
    }
  })
})
