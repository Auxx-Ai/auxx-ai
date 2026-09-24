// packages/lib/src/accounting/money/payouts/__tests__/record-reconciliation.int.test.ts
import { schema } from '@auxx/database'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PayoutRecordEvidence } from '../../customer-money/record-contracts'
import { writeFinancialRecords } from '../../customer-money/record-storage'
import {
  assessPayouts,
  reconcileTransferIds,
  recoverPayoutReconciliationPage,
} from '../assess-payouts'
import { isPayoutHeldReversed, listTransfersAwaitingRepost } from '../repost-reads'

vi.mock('../../../ledger/setup/accounting-enabled', () => ({
  isAccountingActive: async () => true,
}))

let organizationId: string
let actorUserId: string
let payoutDefId: string
let processorDefId: string

function evidence(id: string, providerKey = 'gateway_a'): PayoutRecordEvidence {
  const entry = {
    id: `entry-${id}`,
    type: 'charge' as const,
    providerType: 'provider_charge',
    gross: '100.00',
    fee: '3.00',
    net: '97.00',
    currency: 'USD',
    currencyExponent: 2,
    transactionDate: '2026-09-15T01:00:00Z',
    payoutId: id,
    sourceTransactionId: `capture-${id}`,
    sourceOrderId: null,
    sourceId: null,
    sourceType: null,
    sourceReference: null,
    raw: {},
  }
  return {
    version: 2,
    externalId: id,
    sourceAccount: { providerKey, externalAccountId: 'merchant-1', environment: 'live' },
    acquisition: { id: `acquisition-${id}`, startedAt: '2026-09-15T01:00:00Z' },
    payout: {
      id,
      status: 'paid',
      amount: '97.00',
      currency: 'USD',
      currencyExponent: 2,
      issuedAt: null,
      issuedOn: '2026-09-15',
      destinationExternalId: null,
      raw: {},
    },
    raw: {},
    rejectionReason: null,
    membership: {
      providerReady: true,
      complete: true,
      reason: null,
      page: { id: `page-${id}`, index: 0, requestCursor: null, nextCursor: null, terminal: true },
      entries: [entry],
      rejections: [],
      rawRows: [entry.raw],
    },
  }
}

/**
 * The payout header AND its items. Both lanes write both, and since T2 the
 * assessment's match state comes off the `ProcessorBalanceEntry` rows rather
 * than the observation envelope, so a header-only fixture would report every
 * payout as having nothing to match.
 */
async function write(envelopes: PayoutRecordEvidence[]) {
  const results = await writeFinancialRecords(getTestDb(), {
    organizationId,
    actorUserId,
    records: envelopes.flatMap((envelope) => [
      {
        entityType: 'payout' as const,
        entityDefinitionId: payoutDefId,
        evidence: envelope,
      },
      ...envelope.membership.entries.map((entry, rowIndex) => ({
        entityType: 'processor_balance_entry' as const,
        entityDefinitionId: processorDefId,
        evidence: {
          version: 2 as const,
          externalId: entry.id,
          sourceAccount: envelope.sourceAccount,
          acquisition: envelope.acquisition,
          page: {
            id: envelope.membership.page?.id ?? envelope.acquisition.id,
            index: envelope.membership.page?.index ?? 0,
            rowIndex,
          },
          entry,
          raw: entry.raw,
          rejectionReason: null,
        },
      })),
    ]),
    provenance: { source: 'import', ref: 'fixture-import' },
  })
  return results.filter((result) => result.entityType === 'payout')
}

beforeEach(async () => {
  organizationId = (await createTestOrganization()).id
  actorUserId = (await createTestUser()).id
  const definitions = await getTestDb()
    .insert(schema.EntityDefinition)
    .values([
      {
        organizationId,
        entityType: 'payout',
        apiSlug: 'payouts',
        singular: 'Payout',
        plural: 'Payouts',
        updatedAt: new Date(),
      },
      {
        organizationId,
        entityType: 'processor_balance_entry',
        apiSlug: 'processor-balance-entries',
        singular: 'Processor entry',
        plural: 'Processor entries',
        updatedAt: new Date(),
      },
    ])
    .returning()
  payoutDefId = definitions.find((row) => row.entityType === 'payout')!.id
  processorDefId = definitions.find((row) => row.entityType === 'processor_balance_entry')!.id
})

describe('shared payout records and event reconciliation against PostgreSQL', () => {
  it('uses one canonical identity across import replay and separate merchant sources', async () => {
    const [first] = await write([evidence('p1')])
    const [replay] = await write([evidence('p1')])
    const [other] = await write([evidence('p1', 'gateway_b')])
    expect(replay!.id).toBe(first!.id)
    expect(other!.id).not.toBe(first!.id)
    await assessPayouts(getTestDb(), organizationId, [first!.id, first!.id, other!.id])
    const transfers = await getTestDb().select().from(schema.MoneyTransfer)
    expect(transfers).toHaveLength(2)
    for (const row of transfers)
      expect(row.reconciliationResult).toMatchObject({
        state: 'complete',
        constituentNetMinor: '9700',
        differenceMinor: '0',
        unmatchedCount: 1,
      })
    expect(await getTestDb().select().from(schema.MoneyTransaction)).toHaveLength(0)
    expect(await getTestDb().select().from(schema.GlPosting)).toHaveLength(0)
    const instances = await getTestDb().select().from(schema.EntityInstance)
    expect(
      instances
        .filter((row) => row.entityDefinitionId === payoutDefId)
        .map((row) => row.id)
        .sort()
    ).toEqual(transfers.map((row) => row.id).sort())
    expect(await getTestDb().select().from(schema.FieldValue)).toHaveLength(0)
  })

  it('matches an existing receipt by full source identity and its actual rail', async () => {
    const input = evidence('p1')
    input.membership.entries[0]!.sourceReference = {
      sourceAccount: {
        providerKey: 'order_source',
        externalAccountId: 'store-1',
        environment: 'live',
      },
      objectType: 'capture',
      externalId: 'capture-1',
      componentKey: 'principal',
    }
    const [record] = await write([input])
    const [transfer] = await getTestDb().select().from(schema.MoneyTransfer)
    const [gatewayDef] = await getTestDb()
      .insert(schema.EntityDefinition)
      .values({
        organizationId,
        entityType: 'payment_gateway',
        apiSlug: 'gateways',
        singular: 'Gateway',
        plural: 'Gateways',
        updatedAt: new Date(),
      })
      .returning()
    const [gateway] = await getTestDb()
      .insert(schema.EntityInstance)
      .values({
        organizationId,
        entityDefinitionId: gatewayDef!.id,
        updatedAt: new Date(),
      })
      .returning()
    // task 58 D3/D5: the rail is `FinancialSourceAccount.paymentGatewayId`, not
    // a `PaymentRoute` (its processor kind is retired). The payout's own
    // merchant account is stamped onto this rail directly.
    await getTestDb()
      .update(schema.FinancialSourceAccount)
      .set({ paymentGatewayId: gateway!.id })
      .where(eq(schema.FinancialSourceAccount.id, transfer!.sourceAccountId))
    const [command] = await getTestDb()
      .insert(schema.MoneyCommand)
      .values({
        organizationId,
        commandKey: 'receipt',
        kind: 'record',
        payloadHash: 'fixture',
        actorSnapshot: {},
      })
      .returning()
    const [money] = await getTestDb()
      .insert(schema.MoneyTransaction)
      .values({
        organizationId,
        purpose: 'customer_receipt',
        amountMinor: 10000n,
        currency: 'USD',
        currencyExponent: 2,
        datePrecision: 'date',
        occurredOn: '2026-09-15',
        recordedByCommandId: command!.id,
      })
      .returning()
    const [source] = await getTestDb()
      .insert(schema.FinancialSourceAccount)
      .values({
        organizationId,
        ...input.membership.entries[0]!.sourceReference!.sourceAccount,
        // The order-side feed settles through the SAME rail as the payout's
        // own merchant account - that agreement is what identifies which
        // payout actually settled this receipt.
        paymentGatewayId: gateway!.id,
      })
      .returning()
    const [object] = await getTestDb()
      .insert(schema.FinancialSourceObject)
      .values({
        organizationId,
        sourceAccountId: source!.id,
        objectType: 'capture',
        externalId: 'capture-1',
        componentKey: 'principal',
      })
      .returning()
    await getTestDb().insert(schema.MoneySourceLink).values({
      organizationId,
      sourceObjectId: object!.id,
      moneyTransactionId: money!.id,
      verifiedByCommandId: command!.id,
    })
    await reconcileTransferIds(getTestDb(), organizationId, [record!.id])
    const [matched] = await getTestDb().select().from(schema.MoneyTransfer)
    expect(matched!.reconciliationResult).toMatchObject({ unmatchedCount: 0 })
    const other = evidence('p1', 'gateway_b')
    other.membership.entries[0]!.sourceReference = input.membership.entries[0]!.sourceReference
    const [otherRecord] = await write([other])
    await reconcileTransferIds(getTestDb(), organizationId, [otherRecord!.id])
    const [unmatched] = await getTestDb()
      .select()
      .from(schema.MoneyTransfer)
      .where(eq(schema.MoneyTransfer.id, otherRecord!.id))
    expect(unmatched!.reconciliationResult).toMatchObject({ unmatchedCount: 1 })
    expect(await getTestDb().select().from(schema.MoneyTransaction)).toHaveLength(1)
    expect(await getTestDb().select().from(schema.GlPosting)).toHaveLength(0)
  })

  it('retains the independent payout amount and excludes the outgoing transfer', async () => {
    const input = evidence('p1')
    input.payout!.amount = '96.00'
    input.membership.entries.push({
      ...input.membership.entries[0]!,
      id: 'out',
      type: 'outgoing_transfer',
      gross: '-96.00',
      fee: '0',
      net: '-96.00',
    })
    input.membership.rawRows.push({})
    const [record] = await write([input])
    await reconcileTransferIds(getTestDb(), organizationId, [record!.id])
    const [row] = await getTestDb().select().from(schema.MoneyTransfer)
    expect(row!.sourceAmountMinor).toBe(9600n)
    expect(row!.reconciliationResult).toMatchObject({
      constituentNetMinor: '9700',
      differenceMinor: '-100',
    })
  })

  it('recovers a lost event and performs no domain write on an unchanged second assessment', async () => {
    await write([evidence('p1')])
    const first = await recoverPayoutReconciliationPage(getTestDb())
    expect(first.changed).toBe(1)
    expect(first.nextCursor).toBeNull()
    const [before] = await getTestDb().select().from(schema.MoneyTransfer)
    expect((await recoverPayoutReconciliationPage(getTestDb())).changed).toBe(0)
    const [after] = await getTestDb().select().from(schema.MoneyTransfer)
    expect(after!.reconciledAt).toEqual(before!.reconciledAt)
    expect(after!.reconciliationBasisHash).toBe(before!.reconciliationBasisHash)
  })

  it('keeps incomplete membership pending until a terminal page arrives', async () => {
    const first = evidence('p1')
    first.membership.complete = false
    first.membership.page!.terminal = false
    first.membership.page!.nextCursor = 'next'
    const [record] = await write([first])
    await reconcileTransferIds(getTestDb(), organizationId, [record!.id])
    let [row] = await getTestDb().select().from(schema.MoneyTransfer)
    expect(row!.reconciliationState).toBe('incomplete')
    const last = evidence('p1')
    last.membership.page = {
      id: 'terminal',
      index: 1,
      requestCursor: 'next',
      nextCursor: null,
      terminal: true,
    }
    last.membership.entries = []
    last.membership.rawRows = []
    await write([last])
    await reconcileTransferIds(getTestDb(), organizationId, [record!.id])
    ;[row] = await getTestDb().select().from(schema.MoneyTransfer)
    expect(row!.reconciliationResult).toMatchObject({
      state: 'complete',
      constituentNetMinor: '9700',
    })
  })

  it('does not let replayed acquisition A replace acquisition B', async () => {
    const a = evidence('p1')
    const [record] = await write([a])
    const b = evidence('p1')
    b.acquisition = { id: 'new-acquisition', startedAt: '2026-09-16T01:00:00Z' }
    b.membership.page!.id = 'new-page'
    b.payout!.status = 'failed'
    await write([b])
    const [before] = await getTestDb().select().from(schema.MoneyTransfer)
    await write([a])
    const [after] = await getTestDb()
      .select()
      .from(schema.MoneyTransfer)
      .where(eq(schema.MoneyTransfer.id, record!.id))
    expect(after!.status).toBe('failed')
    expect(after!.currentObservationId).toBe(before!.currentObservationId)
  })

  it('batches query families for 10 and 100 owners and grows only across chunk boundaries', async () => {
    const records = await write(Array.from({ length: 101 }, (_, index) => evidence(`p${index}`)))
    const queries: string[] = []
    const measured = drizzle(getTestDb().$client, {
      schema: getTestDb()._.fullSchema,
      logger: {
        logQuery(query) {
          queries.push(query)
        },
      },
    })
    const count = async (size: number) => {
      queries.length = 0
      await assessPayouts(
        measured,
        organizationId,
        records.slice(0, size).map((row) => row.id)
      )
      return queries.filter((query) => !/^insert into "MoneyTransfer"/.test(query)).length
    }
    const ten = await count(10)
    const hundred = await count(100)
    const nextChunk = await count(101)
    expect(hundred).toBe(ten)
    expect(nextChunk).toBeGreaterThan(hundred)
    // 12 before T2; the stored match pass adds its own flat families (the
    // entry rows, their accounts, the frozen ids and one batched correction).
    expect(hundred).toBeLessThanOrEqual(16)
    expect(nextChunk).toBeLessThanOrEqual(hundred * 2)
  })

  it('re-books only a payout whose latest reversal was the matcher’s', async () => {
    const [record, unposted] = await write([evidence('p1'), evidence('p2')])
    const ids = [record!.id, unposted!.id]
    const [entry] = await getTestDb()
      .select({ id: schema.ProcessorBalanceEntry.id })
      .from(schema.ProcessorBalanceEntry)
      .where(eq(schema.ProcessorBalanceEntry.payoutExternalId, 'p1'))
    const insertPosting = async (values: {
      docNumber: string
      periodKey: string
      status: 'posted' | 'reversed'
      revision?: number
      reversesId?: string
    }) => {
      const [row] = await getTestDb()
        .insert(schema.GlPosting)
        .values({
          organizationId,
          postingType: 'payout',
          txnDate: '2025-11-03',
          totalMinor: 9700,
          built: {},
          postedAt: new Date(),
          ...values,
        })
        .returning({ id: schema.GlPosting.id })
      return row!.id
    }
    /** An original naming the item, then its reversal - the matcher's when `stale`. */
    const postAndReverse = async (key: string, stale: boolean) => {
      const original = await insertPosting({ docNumber: key, periodKey: key, status: 'reversed' })
      await getTestDb().insert(schema.GlPostingSource).values({
        organizationId,
        glPostingId: original,
        sourceKind: 'processor_balance_entry',
        sourceId: entry!.id,
        linkRole: 'member',
      })
      const reversal = await insertPosting({
        docNumber: `${key}-REV`,
        periodKey: key,
        status: 'posted',
        revision: 1,
        reversesId: original,
      })
      if (stale)
        await getTestDb().insert(schema.GlPostingSource).values({
          organizationId,
          glPostingId: reversal,
          sourceKind: 'money_transfer',
          sourceId: record!.id,
          linkRole: 'parent',
        })
    }
    const awaiting = () => listTransfersAwaitingRepost(getTestDb(), organizationId, ids)

    expect(await awaiting()).toEqual([])

    // A person's reversal stands.
    await postAndReverse('PAY-0001', false)
    expect(await awaiting()).toEqual([])
    expect(await isPayoutHeldReversed(getTestDb(), organizationId, 'PAY-0001')).toBe(true)

    // The matcher's later reversal of a later entry is re-booked.
    await new Promise((resolve) => setTimeout(resolve, 5))
    await postAndReverse('PAY-0001-R2', true)
    expect(await awaiting()).toEqual([
      {
        transferId: record!.id,
        payoutExternalId: 'p1',
        providerKey: 'gateway_a',
        paymentGatewayId: null,
      },
    ])
    expect(await isPayoutHeldReversed(getTestDb(), organizationId, 'PAY-0001')).toBe(false)

    // Re-posted: its live entry names the same items, so a second pass finds nothing to do.
    const live = await insertPosting({
      docNumber: 'PAY-0001-R3',
      periodKey: 'PAY-0001-R3',
      status: 'posted',
    })
    await getTestDb().insert(schema.GlPostingSource).values({
      organizationId,
      glPostingId: live,
      sourceKind: 'processor_balance_entry',
      sourceId: entry!.id,
      linkRole: 'member',
    })
    expect(await awaiting()).toEqual([])
  })
})
