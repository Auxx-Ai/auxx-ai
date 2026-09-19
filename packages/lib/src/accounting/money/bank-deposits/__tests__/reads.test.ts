// packages/lib/src/accounting/money/bank-deposits/__tests__/reads.test.ts
//
// Three properties, and all three fail SILENTLY in production:
//
//  1. **A stored deposit date reads back as a day, not an instant.** `valueDate`
//     is `timestamp(3) with time zone` in `mode: 'string'`, so `'2026-09-03'`
//     written comes back `'2026-09-03 00:00:00+00'`. `updateBankDeposit`
//     compares the caller's date against the stored one to decide whether the
//     date actually changed, so an unsliced comparison ALWAYS differs.
//
//  2. **A receipt's own date/method/reference/currency now come straight off
//     `MoneyTransaction`** (MIGRATION follow-up 9) - no `payment` entity mirror,
//     no `FieldValue` join. `listUndepositedPayments`, `readDepositPayments` and
//     `readPaymentsByIds` all read the same columns through `hydrateReceipts`.
//
//  3. **The undeposited list and `createBankDeposit` must read the same
//     receipt the same way**: a movement naming neither a rail nor a bank
//     account really is sitting in 1050, whatever its method says.

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fieldStubs } from './support/field-stubs'

const h = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  /** One array per awaited `.select()` chain, consumed in order. */
  results: [] as unknown[][],
  /** `MoneyApplication` rows `hydrateReceipts` nets against. */
  applications: [] as Record<string, unknown>[],
  calls: [] as string[],
}))

vi.mock('../../../../cache', () => ({
  getCachedEntityDefId: async (_org: string, slug: string) => `def_${slug}`,
  getOrgCache: () => ({
    get: async () => h.settings,
    from: () => ({
      // `{ id, type }`: `readSystemRecords` converts a stored row through the
      // field's TYPE, so a stub without one reads every cell as unset.
      bySystemAttributes: async (attributes: string[]) => fieldStubs(attributes),
    }),
  }),
}))

const {
  listUndepositedPayments,
  readBankDepositDetail,
  readDepositBankAccount,
  readDepositPayments,
  readPaymentsByIds,
} = await import('../reads')
const { loadDepositBankAccountContext } = await import('../fields')

const ORG = 'org_1'

function stubDb(): Database {
  let index = 0
  const chain = (): Record<string, unknown> => {
    const self: Record<string, unknown> = {}
    for (const method of ['from', 'where', 'orderBy', 'limit', 'offset']) {
      self[method] = () => {
        h.calls.push(method)
        return self
      }
    }
    // biome-ignore lint/suspicious/noThenProperty: chainable drizzle query-builder stub
    self.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(h.results[index++] ?? []).then(resolve, reject)
    return self
  }
  return {
    select: () => chain(),
    query: { MoneyApplication: { findMany: async () => h.applications } },
  } as unknown as Database
}

/** One `FieldValue` row, in the whole-row shape `readSystemRecords` selects. */
function depositValue(entityId: string, attribute: string, columns: Record<string, unknown>) {
  return {
    id: `fv_${entityId}_${attribute}`,
    entityId,
    fieldId: `fld_${attribute}`,
    sortKey: 'a0',
    valueText: null,
    valueNumber: null,
    valueBoolean: null,
    valueDate: null,
    valueJson: null,
    optionId: null,
    actorId: null,
    relatedEntityId: null,
    relatedEntityDefinitionId: null,
    createdAt: new Date('2026-09-03T00:00:00Z'),
    updatedAt: new Date('2026-09-03T00:00:00Z'),
    ...columns,
  }
}

/** One `MoneyTransaction` receipt row, as `RECEIPT_COLUMNS` selects it. */
function receipt(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    amountMinor: 100_00n,
    occurredAt: null,
    occurredOn: '2026-09-01',
    method: 'check',
    reference: null,
    currency: 'USD',
    bankDepositInstanceId: null,
    ...overrides,
  }
}

beforeEach(() => {
  h.settings = {}
  h.results = []
  h.applications = []
  h.calls = []
})

describe('a stored deposit date reads back as a day, not an instant', () => {
  it('slices the deposit date to YYYY-MM-DD', async () => {
    h.results = [
      // the deposit instance
      [{ id: 'dep_1', createdAt: new Date('2026-09-03T00:00:00Z') }],
      // its field values - what postgres actually hands back for a DATE field
      [
        depositValue('dep_1', 'bank_deposit_date', { valueDate: '2026-09-03 00:00:00+00' }),
        depositValue('dep_1', 'bank_deposit_number', { valueText: 'DEP-0001' }),
        depositValue('dep_1', 'bank_deposit_total', { valueNumber: 350_00 }),
      ],
      // readDepositPayments: no receipts grouped in yet
      [],
    ]

    const deposit = await readBankDepositDetail(stubDb(), ORG, 'dep_1')
    // 🛑 Not `'2026-09-03 00:00:00+00'`. `updateBankDeposit` compares this
    // against a caller's `'2026-09-03'` to decide whether the date moved.
    expect(deposit?.depositDate).toBe('2026-09-03')
    expect(deposit?.payments).toEqual([])
  })

  it('leaves an unset deposit date null rather than inventing today', async () => {
    h.results = [[{ id: 'dep_1', createdAt: new Date() }], [], []]
    const deposit = await readBankDepositDetail(stubDb(), ORG, 'dep_1')
    expect(deposit?.depositDate).toBeNull()
  })
})

describe('a receipt is hydrated off MoneyTransaction directly', () => {
  it('reads amount, date, method, reference and currency off the row', async () => {
    h.results = [[receipt('mt_1', { amountMinor: 250_00n, reference: 'Check #402' })]]

    const rows = await listUndepositedPayments(stubDb(), { organizationId: ORG })
    expect(rows._unsafeUnwrap()).toEqual([
      {
        paymentId: 'mt_1',
        amountMinor: 250_00,
        date: '2026-09-01',
        method: 'check',
        reference: 'Check #402',
        invoiceInstanceId: null,
        invoiceName: null,
        currency: 'USD',
      },
    ])
  })

  it('falls back to the instant when there is no occurredOn', async () => {
    h.results = [
      [
        receipt('mt_1', {
          occurredOn: null,
          occurredAt: new Date('2026-09-05T00:00:00Z'),
        }),
      ],
    ]
    const rows = await listUndepositedPayments(stubDb(), { organizationId: ORG })
    expect(rows._unsafeUnwrap()[0]?.date).toBe('2026-09-05')
  })

  it('names the invoice a receipt is currently applied to', async () => {
    h.results = [
      [receipt('mt_1')],
      // the invoice display-name lookup
      [{ id: 'inv_1', displayName: 'INV-0042' }],
    ]
    h.applications = [
      {
        moneyTransactionId: 'mt_1',
        invoiceInstanceId: 'inv_1',
        operation: 'apply',
        amountMinor: 100_00n,
      },
    ]

    const rows = await listUndepositedPayments(stubDb(), { organizationId: ORG })
    expect(rows._unsafeUnwrap()[0]).toMatchObject({
      invoiceInstanceId: 'inv_1',
      invoiceName: 'INV-0042',
    })
  })

  it('leaves the invoice unset once an application was fully unapplied', async () => {
    h.results = [[receipt('mt_1')]]
    h.applications = [
      {
        moneyTransactionId: 'mt_1',
        invoiceInstanceId: 'inv_1',
        operation: 'apply',
        amountMinor: 100_00n,
      },
      {
        moneyTransactionId: 'mt_1',
        invoiceInstanceId: 'inv_1',
        operation: 'unapply',
        amountMinor: 100_00n,
      },
    ]

    const rows = await listUndepositedPayments(stubDb(), { organizationId: ORG })
    expect(rows._unsafeUnwrap()[0]).toMatchObject({ invoiceInstanceId: null, invoiceName: null })
  })
})

describe('readDepositPayments / readPaymentsByIds carry the deposit link', () => {
  it('readDepositPayments hydrates the rows already grouped into a deposit', async () => {
    h.results = [[receipt('mt_1', { bankDepositInstanceId: 'dep_1' })]]
    const rows = await readDepositPayments(stubDb(), ORG, 'dep_1')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.paymentId).toBe('mt_1')
  })

  it('readPaymentsByIds reports bankDepositId so the write path can refuse a re-bank', async () => {
    h.results = [[receipt('mt_1', { bankDepositInstanceId: 'dep_1' }), receipt('mt_2')]]
    const rows = await readPaymentsByIds(stubDb(), ORG, ['mt_1', 'mt_2'])
    expect(rows.find((r) => r.paymentId === 'mt_1')?.bankDepositId).toBe('dep_1')
    expect(rows.find((r) => r.paymentId === 'mt_2')?.bankDepositId).toBeNull()
  })

  it('is empty for no ids without querying', async () => {
    expect(await readPaymentsByIds(stubDb(), ORG, [])).toEqual([])
    expect(h.calls).toEqual([])
  })
})

describe('the undeposited filter is the movement\u2019s own endpoint columns', () => {
  it('lists a method-less receipt rather than dropping it', async () => {
    h.results = [[receipt('mt_1', { method: null })]]
    const rows = await listUndepositedPayments(stubDb(), { organizationId: ORG })
    expect(rows._unsafeUnwrap()).toHaveLength(1)
    expect(rows._unsafeUnwrap()[0]).toMatchObject({ paymentId: 'mt_1', method: null })
  })

  it('narrows on an explicit method without deciding what belongs in the list', async () => {
    h.results = [[receipt('mt_1', { method: 'check' })]]
    const rows = await listUndepositedPayments(stubDb(), { organizationId: ORG, method: 'check' })
    expect(rows._unsafeUnwrap()).toHaveLength(1)
  })
})

describe('readDepositBankAccount', () => {
  it('answers an ARCHIVED account rather than hiding it, so the write path can refuse by name', async () => {
    h.results = [
      [
        {
          id: 'acct_1',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          archivedAt: new Date('2026-08-01T00:00:00Z'),
        },
      ],
      [
        depositValue('acct_1', 'bank_account_name', { valueText: ' Business Checking ' }),
        depositValue('acct_1', 'bank_account_gl_account', { valueText: ' gla_1 ' }),
      ],
    ]

    const ctx = await loadDepositBankAccountContext(undefined, ORG)
    const account = await readDepositBankAccount(stubDb(), ORG, ctx!, 'acct_1')
    // "that account is archived" is a better answer than "no such account".
    expect(account?.archivedAt).toEqual(new Date('2026-08-01T00:00:00Z'))
    expect(account).toMatchObject({ name: 'Business Checking', glAccountId: 'gla_1' })
  })
})
