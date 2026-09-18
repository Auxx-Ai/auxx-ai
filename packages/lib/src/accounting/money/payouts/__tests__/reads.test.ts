// packages/lib/src/accounting/money/payouts/__tests__/reads.test.ts
//
// `findPayoutByGatewayId` and `listPayouts` (brief 27 §6.4, §13 test 4).
// `findBankAccountByStripeExternalAccountId` (brief 13 §2.3) was retired with
// it - task 58 §5.4 rule 1 replaced the destination match with the rail-scope
// `bank` role resolved in `resolveRoles`, and this file had no other caller.

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  getCachedEntityDefId: vi.fn(async () => null as string | null),
  bySystemAttributes: vi.fn(async () => ({}) as Record<string, unknown>),
}))

vi.mock('../../../rails/reads', () => ({ listPaymentGateways: async () => ok([]) }))

vi.mock('../../../../cache', () => ({
  getCachedEntityDefId: h.getCachedEntityDefId,
  getOrgCache: () => ({ from: () => ({ bySystemAttributes: h.bySystemAttributes }) }),
}))

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { findPayoutByGatewayId, listPayouts } from '../reads'
import { fieldStubs } from './support/field-stubs'

const ORG = 'org_1'

beforeEach(() => {
  vi.clearAllMocks()
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
    h.bySystemAttributes.mockResolvedValue(
      fieldStubs({
        payout_gateway_id: GATEWAY_ID_FIELD,
        payout_status: 'f_status',
        payout_payment_gateway: RAIL_FIELD,
      })
    )
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
      ...fieldStubs({ payout_gateway_id: GATEWAY_ID_FIELD, payout_status: 'f_status' }),
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
    // The scope columns the real paging query selects, so the fixtures stay terse
    // and `readSystemRecords` still sees a page it owns.
    const instances = rows.entityInstance.map((row) => ({
      organizationId: ORG,
      entityDefinitionId: PAYOUT_DEF,
      ...(row as object),
    }))
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
          target === schema.EntityInstance ? chain(instances) : chain(rows.fieldValue),
      }),
    } as unknown as Database
  }

  beforeEach(() => {
    h.getCachedEntityDefId.mockResolvedValue(PAYOUT_DEF)
    h.bySystemAttributes.mockResolvedValue(fieldStubs(FIELD_IDS))
  })

  it('hydrates ordinary source fields into the settlement summary without changing posting values', async () => {
    const sourceFields = {
      payout_source_amount: { valueText: '105.67' },
      payout_source_currency: { valueText: 'USD' },
      payout_source_currency_exponent: { valueNumber: 2 },
      payout_source_status: { valueText: 'paid' },
    }
    h.bySystemAttributes.mockResolvedValue(
      fieldStubs({
        ...FIELD_IDS,
        ...Object.fromEntries(Object.keys(sourceFields).map((attr) => [attr, attr])),
      })
    )
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
    h.bySystemAttributes.mockResolvedValue(
      fieldStubs({
        ...FIELD_IDS,
        payout_payment_gateway: 'f_rail',
        payout_bank_account: 'f_bank',
        payout_source: 'f_source',
      })
    )
    const db = stubPayoutsDb({
      entityInstance: [{ id: 'payout_1', createdAt: new Date('2026-09-10') }],
      fieldValue: [
        { entityId: 'payout_1', fieldId: FIELD_IDS.payout_gateway_id, valueText: 'po_1' },
        {
          entityId: 'payout_1',
          fieldId: 'f_rail',
          relatedEntityId: 'pg_stripe',
          relatedEntityDefinitionId: 'def_gateway',
        },
        {
          entityId: 'payout_1',
          fieldId: 'f_bank',
          relatedEntityId: 'ba_1',
          relatedEntityDefinitionId: 'def_bank_account',
        },
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
