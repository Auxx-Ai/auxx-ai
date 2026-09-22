// packages/lib/src/accounting/money/__tests__/blocked-movements.int.test.ts
//
// The sweep's never-tried queue, in SQL: nothing before the opening cutoff,
// nothing already parked as a work item (that comes back through its own
// `nextAttemptAt`), and every purpose since 75-D1. Plus the movement drawer's read,
// which carries the movement's work items and its acceptances' (91 §4.6).

import { schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { upsertWorkItem } from '../../work-items/write'
import {
  listMovementAccountingCandidates,
  type MovementCandidateWindow,
  type MovementPurpose,
  readMovementDetail,
} from '../blocked-movements'

const db = () => getTestDb()
let organizationId: string
let commandId: string
let sourceAccountId: string

const WINDOW: MovementCandidateWindow = {
  cutoffPeriod: '2026-08',
  bookTimeZone: 'America/Los_Angeles',
}

async function movement(input: {
  occurredOn: string
  createdAt: Date
  purpose?: MovementPurpose
}): Promise<string> {
  const [money] = await db()
    .insert(schema.MoneyTransaction)
    .values({
      organizationId,
      createdAt: input.createdAt,
      purpose: input.purpose ?? 'customer_receipt',
      amountMinor: 1000n,
      currency: 'USD',
      currencyExponent: 2,
      datePrecision: 'date',
      occurredOn: input.occurredOn,
      recordedByCommandId: commandId,
    })
    .returning({ id: schema.MoneyTransaction.id })
  return money!.id
}

/** A shopify-sourced receipt: the shape the reader used to be gated on. */
async function receipt(input: { occurredOn: string; createdAt: Date }): Promise<string> {
  const moneyId = await movement(input)
  const [object] = await db()
    .insert(schema.FinancialSourceObject)
    .values({
      organizationId,
      sourceAccountId,
      objectType: 'order_transaction',
      externalId: `txn_${moneyId}`,
    })
    .returning({ id: schema.FinancialSourceObject.id })
  const [observation] = await db()
    .insert(schema.FinancialSourceObservation)
    .values({
      organizationId,
      sourceObjectId: object!.id,
      contentHash: `hash_${moneyId}`,
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
    moneyTransactionId: moneyId,
  })
  return moneyId
}

/** The ingest acceptance behind a movement, blocked with its own work item (79 §1.3). */
async function blockedAcceptance(input: { moneyTransactionId: string }): Promise<string> {
  const [object] = await db()
    .insert(schema.FinancialSourceObject)
    .values({
      organizationId,
      sourceAccountId,
      objectType: 'order_transaction',
      externalId: `blocked_${input.moneyTransactionId}`,
    })
    .returning({ id: schema.FinancialSourceObject.id })
  const [observation] = await db()
    .insert(schema.FinancialSourceObservation)
    .values({
      organizationId,
      sourceObjectId: object!.id,
      contentHash: `blocked_hash_${input.moneyTransactionId}`,
      observedAt: new Date('2026-09-19T00:00:00.000Z'),
      payload: {},
      reportingInstallationSnapshot: {},
    })
    .returning({ id: schema.FinancialSourceObservation.id })
  const [acceptance] = await db()
    .insert(schema.FinancialSourceAcceptance)
    .values({
      organizationId,
      sourceObjectId: object!.id,
      observationId: observation!.id,
      state: 'blocked',
      orderExternalId: 'order_1',
      moneyTransactionId: input.moneyTransactionId,
    })
    .returning({ id: schema.FinancialSourceAcceptance.id })
  await park({
    sourceKind: 'financial_source_acceptance',
    sourceId: acceptance!.id,
    stage: 'evidence',
    reasonCode: 'CUSTOMER_UNRESOLVED',
  })
  return acceptance!.id
}

async function park(input: Parameters<typeof upsertWorkItem>[2]): Promise<void> {
  const written = await upsertWorkItem(db(), organizationId, input)
  expect(written.isOk()).toBe(true)
}

/** The claim a posted movement holds: one live `subject` row. */
async function claim(moneyTransactionId: string, txnDate: string): Promise<void> {
  const [posting] = await db()
    .insert(schema.GlPosting)
    .values({
      organizationId,
      postingType: 'payment',
      periodKey: txnDate.slice(0, 7),
      txnDate,
      totalMinor: 1000,
      built: {},
      status: 'posted',
      // `GlPosting_posted_check`: only a `posted` row may carry one, and it must.
      postedAt: new Date(`${txnDate}T00:00:00Z`),
    })
    .returning({ id: schema.GlPosting.id })
  await db().insert(schema.GlPostingSource).values({
    organizationId,
    glPostingId: posting!.id,
    sourceKind: 'money_transaction',
    sourceId: moneyTransactionId,
    linkRole: 'subject',
  })
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

describe('listMovementAccountingCandidates', () => {
  const candidates = () =>
    listMovementAccountingCandidates(db(), organizationId, 50, WINDOW).then((rows) =>
      rows.map((row) => row.id)
    )

  it('never offers a movement dated on or before the opening cutoff', async () => {
    const before = await receipt({
      occurredOn: '2026-08-31',
      createdAt: new Date('2026-08-31T00:00:00Z'),
    })
    const after = await receipt({
      occurredOn: '2026-09-01',
      createdAt: new Date('2026-09-01T00:00:00Z'),
    })

    const ids = await candidates()
    expect(ids).toContain(after)
    expect(ids).not.toContain(before)
  })

  it('offers a vendor payment, which the Shopify gate used to park forever', async () => {
    const payment = await movement({
      purpose: 'vendor_payment',
      occurredOn: '2026-09-04',
      createdAt: new Date('2026-09-04T00:00:00Z'),
    })

    const rows = await listMovementAccountingCandidates(db(), organizationId, 50, WINDOW)
    expect(rows.find((row) => row.id === payment)?.purpose).toBe('vendor_payment')
  })

  it('never offers a movement that already holds a live subject posting', async () => {
    const posted = await movement({
      occurredOn: '2026-09-06',
      createdAt: new Date('2026-09-06T00:00:00Z'),
    })
    await claim(posted, '2026-09-06')

    expect(await candidates()).not.toContain(posted)
  })

  it('leaves a parked movement to its work item, so a thousand refusals never crowd out a fresh one', async () => {
    const refused = await receipt({
      occurredOn: '2026-09-01',
      createdAt: new Date('2026-09-01T00:00:00Z'),
    })
    await park({
      sourceKind: 'money_transaction',
      sourceId: refused,
      stage: 'post',
      reasonCode: 'ROLE_UNMAPPED',
      role: 'clearing',
    })
    const untried = await receipt({
      occurredOn: '2026-09-05',
      createdAt: new Date('2026-09-05T00:00:00Z'),
    })

    const ids = await candidates()
    expect(ids).toContain(untried)
    expect(ids).not.toContain(refused)
  })

  it('leaves a movement whose acceptance is blocked to the ingest sweep', async () => {
    const waiting = await movement({
      occurredOn: '2026-09-11',
      createdAt: new Date('2026-09-11T00:00:00Z'),
    })
    await blockedAcceptance({ moneyTransactionId: waiting })

    expect(await candidates()).not.toContain(waiting)
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
    })
    // The draft's `pending` link is what holds the movement back (tasks/77).
    await db().insert(schema.GlPostingSource).values({
      organizationId,
      glPostingId: draft!.id,
      sourceKind: 'money_transaction',
      sourceId: waiting,
      linkRole: 'pending',
    })
    expect(await candidates()).not.toContain(waiting)

    // Discarded: the link cascades away and the movement is drafted again next sweep.
    await db().delete(schema.GlPosting).where(eq(schema.GlPosting.id, draft!.id))
    expect(await candidates()).toContain(waiting)
  })
})

describe('readMovementDetail', () => {
  it('returns a posted movement with no work items', async () => {
    const posted = await movement({
      occurredOn: '2026-09-14',
      createdAt: new Date('2026-09-14T00:00:00Z'),
    })
    await claim(posted, '2026-09-14')

    const detail = await readMovementDetail(db(), organizationId, posted)
    expect(detail?.id).toBe(posted)
    expect(detail?.workItems).toEqual([])
    expect(detail?.amountMinor).toBe(1000)
    expect(detail?.links).toEqual([])
  })

  it("carries its own post row and the acceptance's evidence row while it is parked", async () => {
    const parked = await movement({
      occurredOn: '2026-09-15',
      createdAt: new Date('2026-09-15T00:00:00Z'),
    })
    await park({
      sourceKind: 'money_transaction',
      sourceId: parked,
      stage: 'post',
      reasonCode: 'ROLE_UNMAPPED',
      role: 'purchase_discounts',
    })
    await blockedAcceptance({ moneyTransactionId: parked })

    const detail = await readMovementDetail(db(), organizationId, parked)
    expect(detail?.workItems.map((item) => [item.stage, item.reasonCode, item.role])).toEqual([
      ['evidence', 'CUSTOMER_UNRESOLVED', null],
      ['post', 'ROLE_UNMAPPED', 'purchase_discounts'],
    ])
  })

  it('returns null for a movement in another organization', async () => {
    const mine = await movement({
      occurredOn: '2026-09-16',
      createdAt: new Date('2026-09-16T00:00:00Z'),
    })
    const other = (await createTestOrganization()).id
    expect(await readMovementDetail(db(), other, mine)).toBeNull()
  })
})
