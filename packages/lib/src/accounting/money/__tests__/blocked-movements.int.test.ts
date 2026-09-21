// packages/lib/src/accounting/money/__tests__/blocked-movements.int.test.ts
//
// The sweep's queue, in SQL: nothing before the opening cutoff, nothing refused
// in the last hour, and a movement nobody has tried yet ahead of one that was
// refused (task 71 §A). Head-of-line blocking is the failure this guards
// against; every purpose is offered since 75-D1, not only the Shopify receipts.

import { schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  countBlockedMovements,
  listBlockedMovements,
  listMovementAccountingCandidates,
  type MovementCandidateWindow,
  type MovementPurpose,
  readBlockedMovement,
  readMovementDetail,
} from '../blocked-movements'

const db = () => getTestDb()
let organizationId: string
let commandId: string
let sourceAccountId: string

const WINDOW: MovementCandidateWindow = {
  cutoffPeriod: '2026-08',
  bookTimeZone: 'America/Los_Angeles',
  retryBefore: new Date('2026-09-20T12:00:00.000Z'),
}

async function movement(input: {
  occurredOn: string
  createdAt: Date
  purpose?: MovementPurpose
  postingBlockedAt?: Date | null
  postingBlockedReason?: string | null
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
      postingBlockedAt: input.postingBlockedAt ?? null,
      postingBlockedReason:
        input.postingBlockedReason ?? (input.postingBlockedAt ? 'unmapped handle' : null),
    })
    .returning({ id: schema.MoneyTransaction.id })
  return money!.id
}

/** A shopify-sourced receipt: the shape the reader used to be gated on. */
async function receipt(input: {
  occurredOn: string
  createdAt: Date
  postingBlockedAt?: Date | null
}): Promise<string> {
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

/** The ingest acceptance behind a movement, blocked for its own reason (79 §1.3). */
async function blockedAcceptance(input: {
  moneyTransactionId: string
  reason: string
  attempts: number
  nextAttemptAt: Date | null
}): Promise<void> {
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
  await db().insert(schema.FinancialSourceAcceptance).values({
    organizationId,
    sourceObjectId: object!.id,
    observationId: observation!.id,
    state: 'blocked',
    reason: input.reason,
    orderExternalId: 'order_1',
    moneyTransactionId: input.moneyTransactionId,
    attempts: input.attempts,
    nextAttemptAt: input.nextAttemptAt,
  })
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
  it('never offers a movement dated on or before the opening cutoff', async () => {
    const before = await receipt({
      occurredOn: '2026-08-31',
      createdAt: new Date('2026-08-31T00:00:00Z'),
    })
    const after = await receipt({
      occurredOn: '2026-09-01',
      createdAt: new Date('2026-09-01T00:00:00Z'),
    })

    const ids = (await listMovementAccountingCandidates(db(), organizationId, 50, WINDOW)).map(
      (row) => row.id
    )
    expect(ids).toContain(after)
    expect(ids).not.toContain(before)
  })

  it('offers a blocked vendor payment, which the Shopify gate used to park forever', async () => {
    const payment = await movement({
      purpose: 'vendor_payment',
      occurredOn: '2026-09-04',
      createdAt: new Date('2026-09-04T00:00:00Z'),
      postingBlockedAt: new Date('2026-09-19T00:00:00.000Z'),
      postingBlockedReason: 'Cannot post: 1 line(s) do not resolve to a usable account.',
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

    const ids = (await listMovementAccountingCandidates(db(), organizationId, 50, WINDOW)).map(
      (row) => row.id
    )
    expect(ids).not.toContain(posted)
  })

  it('holds a refused movement back inside the retry interval and offers it after', async () => {
    const fresh = await receipt({
      occurredOn: '2026-09-02',
      createdAt: new Date('2026-09-02T00:00:00Z'),
      // Blocked AFTER `retryBefore` (= now minus the interval), so still cooling.
      postingBlockedAt: new Date('2026-09-20T12:30:00.000Z'),
    })

    expect(
      (await listMovementAccountingCandidates(db(), organizationId, 50, WINDOW)).map(
        (row) => row.id
      )
    ).not.toContain(fresh)

    expect(
      (
        await listMovementAccountingCandidates(db(), organizationId, 50, {
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
    })
    // The draft's `pending` link is what holds the movement back (tasks/77).
    await db().insert(schema.GlPostingSource).values({
      organizationId,
      glPostingId: draft!.id,
      sourceKind: 'money_transaction',
      sourceId: waiting,
      linkRole: 'pending',
    })

    const candidates = () =>
      listMovementAccountingCandidates(db(), organizationId, 50, WINDOW).then((rows) =>
        rows.map((row) => row.id)
      )
    expect(await candidates()).not.toContain(waiting)

    // Discarded: the link cascades away and the movement is drafted again next sweep.
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

    const ids = (await listMovementAccountingCandidates(db(), organizationId, 50, WINDOW)).map(
      (row) => row.id
    )
    expect(ids.indexOf(untried)).toBeLessThan(ids.indexOf(blocked))
  })
})

describe('listBlockedMovements', () => {
  it('lists only parked movements, newest refusal first, and names the refusal shape', async () => {
    const unmapped = await movement({
      purpose: 'vendor_payment',
      occurredOn: '2026-09-07',
      createdAt: new Date('2026-09-07T00:00:00Z'),
      postingBlockedAt: new Date('2026-09-19T10:00:00.000Z'),
      postingBlockedReason:
        "Cannot post: 1 line(s) do not resolve to a usable account. 'purchase_discounts' (Purchase Discounts) is not mapped to any account.",
    })
    const other = await movement({
      purpose: 'customer_refund',
      occurredOn: '2026-09-08',
      createdAt: new Date('2026-09-08T00:00:00Z'),
      postingBlockedAt: new Date('2026-09-19T09:00:00.000Z'),
      postingBlockedReason: 'Refund has no settlement partition',
    })
    await movement({ occurredOn: '2026-09-09', createdAt: new Date('2026-09-09T00:00:00Z') })

    const rows = await listBlockedMovements(db(), organizationId, { limit: 50 })
    expect(rows.map((row) => row.id)).toEqual([unmapped, other])
    expect(rows[0]!.reasonKind).toBe('account_unmapped')
    expect(rows[1]!.reasonKind).toBe('other')
    expect(rows[0]!.amountMinor).toBe(1000)
    expect(await countBlockedMovements(db(), organizationId)).toBe(2)
  })

  it("carries the blocked acceptance's reason, not the poster's message about it", async () => {
    const guest = await movement({
      occurredOn: '2026-09-11',
      createdAt: new Date('2026-09-11T00:00:00Z'),
      postingBlockedAt: new Date('2026-09-19T07:00:00.000Z'),
      postingBlockedReason: 'Receipt needs complete applications to one order on its book date',
    })
    await blockedAcceptance({
      moneyTransactionId: guest,
      reason: 'Order customer or currency is unresolved or incompatible',
      attempts: 97,
      nextAttemptAt: null,
    })

    const [row] = await listBlockedMovements(db(), organizationId, { limit: 50 })
    expect(row!.reason).toBe('Order customer or currency is unresolved or incompatible')
    expect(row!.acceptanceAttempts).toBe(97)
    expect(row!.acceptanceWaitingOn).toBe('change')
    expect(row!.reasonKind).toBe('other')
  })

  it('reports an acceptance with a next attempt as waiting on time', async () => {
    const waiting = await movement({
      occurredOn: '2026-09-12',
      createdAt: new Date('2026-09-12T00:00:00Z'),
      postingBlockedAt: new Date('2026-09-19T07:00:00.000Z'),
    })
    await blockedAcceptance({
      moneyTransactionId: waiting,
      reason: 'Transaction is not yet confirmed',
      attempts: 3,
      nextAttemptAt: new Date('2026-09-19T08:00:00.000Z'),
    })

    const [row] = await listBlockedMovements(db(), organizationId, { limit: 50 })
    expect(row!.acceptanceWaitingOn).toBe('time')
    expect(row!.acceptanceAttempts).toBe(3)
  })

  it("keeps the poster's refusal for a hand-recorded movement with no acceptance", async () => {
    await movement({
      occurredOn: '2026-09-13',
      createdAt: new Date('2026-09-13T00:00:00Z'),
      postingBlockedAt: new Date('2026-09-19T06:00:00.000Z'),
      postingBlockedReason: 'Receipt needs complete applications to one order on its book date',
    })

    const [row] = await listBlockedMovements(db(), organizationId, { limit: 50 })
    expect(row!.reason).toBe('Receipt needs complete applications to one order on its book date')
    expect(row!.acceptanceAttempts).toBeNull()
    expect(row!.acceptanceWaitingOn).toBeNull()
  })

  it('drops a parked movement once it holds a live subject posting', async () => {
    const posted = await movement({
      occurredOn: '2026-09-10',
      createdAt: new Date('2026-09-10T00:00:00Z'),
      postingBlockedAt: new Date('2026-09-19T08:00:00.000Z'),
    })
    await claim(posted, '2026-09-10')

    expect(await listBlockedMovements(db(), organizationId, { limit: 50 })).toEqual([])
    expect(await countBlockedMovements(db(), organizationId)).toBe(0)
  })
})

describe('readMovementDetail', () => {
  it('returns a posted movement with no refusal, where readBlockedMovement returns null', async () => {
    const posted = await movement({
      occurredOn: '2026-09-14',
      createdAt: new Date('2026-09-14T00:00:00Z'),
      // It WAS refused once; the claim is what makes it posted, not a cleared column.
      postingBlockedAt: new Date('2026-09-19T05:00:00.000Z'),
      postingBlockedReason: 'Receipt needs complete applications to one order on its book date',
    })
    await claim(posted, '2026-09-14')

    const detail = await readMovementDetail(db(), organizationId, posted)
    expect(detail?.id).toBe(posted)
    expect(detail?.reason).toBeNull()
    expect(detail?.reasonKind).toBeNull()
    expect(detail?.blockedAt).toBeNull()
    expect(detail?.acceptanceAttempts).toBeNull()
    expect(detail?.acceptanceWaitingOn).toBeNull()
    expect(detail?.amountMinor).toBe(1000)
    expect(detail?.links).toEqual([])

    expect(await readBlockedMovement(db(), organizationId, posted)).toBeNull()
  })

  it('still carries the refusal while the movement is parked', async () => {
    const parked = await movement({
      occurredOn: '2026-09-15',
      createdAt: new Date('2026-09-15T00:00:00Z'),
      postingBlockedAt: new Date('2026-09-19T04:00:00.000Z'),
      postingBlockedReason:
        "Cannot post: 1 line(s) do not resolve to a usable account. 'purchase_discounts' (Purchase Discounts) is not mapped to any account.",
    })

    const detail = await readMovementDetail(db(), organizationId, parked)
    expect(detail?.reasonKind).toBe('account_unmapped')
    expect(detail?.blockedAt).toEqual(new Date('2026-09-19T04:00:00.000Z'))
    expect((await readBlockedMovement(db(), organizationId, parked))?.reason).toBe(detail?.reason)
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
