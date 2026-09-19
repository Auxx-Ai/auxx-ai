// packages/lib/src/accounting/money/customer-money/__tests__/accounting-candidates.int.test.ts
//
// The sweep's queue, in SQL: nothing before the opening cutoff, nothing refused
// in the last hour, and a movement nobody has tried yet ahead of one that was
// refused (task 71 §A). Head-of-line blocking is the failure this guards against.

import { schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  type CustomerMoneyCandidateWindow,
  listCustomerMoneyAccountingCandidates,
} from '../receipt-accounting'

const db = () => getTestDb()
let organizationId: string
let commandId: string
let sourceAccountId: string

const WINDOW: CustomerMoneyCandidateWindow = {
  cutoffPeriod: '2026-08',
  bookTimeZone: 'America/Los_Angeles',
  retryBefore: new Date('2026-09-20T12:00:00.000Z'),
}

/** One shopify-sourced receipt with a `FinancialSourceAcceptance`, which is what makes it a candidate. */
async function receipt(input: {
  occurredOn: string
  createdAt: Date
  postingBlockedAt?: Date | null
  draftGlPostingId?: string | null
}): Promise<string> {
  const [money] = await db()
    .insert(schema.MoneyTransaction)
    .values({
      organizationId,
      createdAt: input.createdAt,
      purpose: 'customer_receipt',
      amountMinor: 1000n,
      currency: 'USD',
      currencyExponent: 2,
      datePrecision: 'date',
      occurredOn: input.occurredOn,
      recordedByCommandId: commandId,
      postingBlockedAt: input.postingBlockedAt ?? null,
      postingBlockedReason: input.postingBlockedAt ? 'unmapped handle' : null,
      draftGlPostingId: input.draftGlPostingId ?? null,
    })
    .returning({ id: schema.MoneyTransaction.id })
  const [object] = await db()
    .insert(schema.FinancialSourceObject)
    .values({
      organizationId,
      sourceAccountId,
      objectType: 'order_transaction',
      externalId: `txn_${money!.id}`,
    })
    .returning({ id: schema.FinancialSourceObject.id })
  const [observation] = await db()
    .insert(schema.FinancialSourceObservation)
    .values({
      organizationId,
      sourceObjectId: object!.id,
      contentHash: `hash_${money!.id}`,
      observedAt: input.createdAt,
      payload: {},
      reportingInstallationSnapshot: {},
    })
    .returning({ id: schema.FinancialSourceObservation.id })
  await db().insert(schema.FinancialSourceAcceptance).values({
    organizationId,
    sourceObjectId: object!.id,
    observationId: observation!.id,
    state: 'accepted',
    orderExternalId: 'order_1',
    moneyTransactionId: money!.id,
  })
  return money!.id
}

beforeEach(async () => {
  organizationId = (await createTestOrganization()).id
  const [command] = await db()
    .insert(schema.MoneyCommand)
    .values({
      organizationId,
      commandKey: `sweep-fixture-${Date.now()}`,
      kind: 'test',
      payloadHash: 'h',
      actorSnapshot: {},
    })
    .returning({ id: schema.MoneyCommand.id })
  commandId = command!.id
  const [account] = await db()
    .insert(schema.FinancialSourceAccount)
    .values({
      organizationId,
      providerKey: 'shopify',
      externalAccountId: 'fixture.myshopify.com',
      environment: 'live',
    })
    .returning({ id: schema.FinancialSourceAccount.id })
  sourceAccountId = account!.id
})

describe('listCustomerMoneyAccountingCandidates', () => {
  it('never offers a movement dated on or before the opening cutoff', async () => {
    const before = await receipt({
      occurredOn: '2026-08-31',
      createdAt: new Date('2026-08-31T00:00:00Z'),
    })
    const after = await receipt({
      occurredOn: '2026-09-01',
      createdAt: new Date('2026-09-01T00:00:00Z'),
    })

    const ids = (await listCustomerMoneyAccountingCandidates(db(), organizationId, 50, WINDOW)).map(
      (row) => row.id
    )
    expect(ids).toContain(after)
    expect(ids).not.toContain(before)
  })

  it('holds a refused movement back inside the retry interval and offers it after', async () => {
    const fresh = await receipt({
      occurredOn: '2026-09-02',
      createdAt: new Date('2026-09-02T00:00:00Z'),
      // Blocked AFTER `retryBefore` (= now minus the interval), so still cooling.
      postingBlockedAt: new Date('2026-09-20T12:30:00.000Z'),
    })

    expect(
      (await listCustomerMoneyAccountingCandidates(db(), organizationId, 50, WINDOW)).map(
        (row) => row.id
      )
    ).not.toContain(fresh)

    expect(
      (
        await listCustomerMoneyAccountingCandidates(db(), organizationId, 50, {
          ...WINDOW,
          retryBefore: new Date('2026-09-20T13:00:00.000Z'),
        })
      ).map((row) => row.id)
    ).toContain(fresh)
  })

  it('holds a movement waiting on a live draft, and offers it once the draft is gone', async () => {
    const [draft] = await db()
      .insert(schema.GlPosting)
      .values({
        organizationId,
        postingType: 'payment',
        periodKey: '2026-09',
        txnDate: '2026-09-03',
        totalMinor: 1000,
        built: {},
        status: 'draft',
      })
      .returning({ id: schema.GlPosting.id })
    const waiting = await receipt({
      occurredOn: '2026-09-03',
      createdAt: new Date('2026-09-03T00:00:00Z'),
      draftGlPostingId: draft!.id,
    })

    const candidates = () =>
      listCustomerMoneyAccountingCandidates(db(), organizationId, 50, WINDOW).then((rows) =>
        rows.map((row) => row.id)
      )
    expect(await candidates()).not.toContain(waiting)

    // Discarded: the stamp dangles and the movement is drafted again next sweep.
    await db().delete(schema.GlPosting).where(eq(schema.GlPosting.id, draft!.id))
    expect(await candidates()).toContain(waiting)
  })

  it('queues a never-tried movement AHEAD of one the ledger already refused', async () => {
    // The refused one is OLDER, so only the block ordering can put it second.
    const blocked = await receipt({
      occurredOn: '2026-09-01',
      createdAt: new Date('2026-09-01T00:00:00Z'),
      postingBlockedAt: new Date('2026-09-19T00:00:00.000Z'),
    })
    const untried = await receipt({
      occurredOn: '2026-09-05',
      createdAt: new Date('2026-09-05T00:00:00Z'),
    })

    const ids = (await listCustomerMoneyAccountingCandidates(db(), organizationId, 50, WINDOW)).map(
      (row) => row.id
    )
    expect(ids.indexOf(untried)).toBeLessThan(ids.indexOf(blocked))
  })
})
