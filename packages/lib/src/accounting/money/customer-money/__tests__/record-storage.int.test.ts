// packages/lib/src/accounting/money/customer-money/__tests__/record-storage.int.test.ts
import { schema } from '@auxx/database'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { beforeEach, describe, expect, it } from 'vitest'
import { reconcileTransferIds } from '../../payouts/assess-payouts'
import type { PayoutRecordEvidence } from '../record-contracts'
import { type FinancialWriteProvenance, writeFinancialRecords } from '../record-storage'

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
    version: 2 as const,
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

async function write(
  envelopes: PayoutRecordEvidence[],
  provenance: FinancialWriteProvenance = { source: 'import', ref: 'fixture-import' }
) {
  const results = await writeFinancialRecords(getTestDb(), {
    organizationId,
    actorUserId,
    records: envelopes.flatMap((envelope) => [
      { entityType: 'payout' as const, entityDefinitionId: payoutDefId, evidence: envelope },
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
    provenance,
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

describe('canonical financial record storage', () => {
  it('retains unsupported money for import inspection and rejects manual writes atomically', async () => {
    const invalid = evidence('bad')
    invalid.payout!.amount = '12.345'
    const [saved] = await write([invalid])
    expect(await getTestDb().select().from(schema.MoneyTransfer)).toHaveLength(0)
    const observation = await getTestDb().query.FinancialSourceObservation.findFirst({
      where: eq(schema.FinancialSourceObservation.id, saved!.observationId),
    })
    expect(observation?.payload).toMatchObject({ payout: { amount: '12.345' } })
    await expect(
      write([{ ...invalid, externalId: 'manual', payout: { ...invalid.payout!, id: 'manual' } }], {
        source: 'interactive',
      })
    ).rejects.toThrow()
    const headers = await getTestDb().select().from(schema.EntityInstance)
    expect(headers.filter((h) => h.entityDefinitionId === payoutDefId)).toHaveLength(1)
  })
  it('keeps verified provider facts when a newer import conflicts', async () => {
    const source = { source: 'connector', connectorId: 'connector-a', credentialId: 'credential-a' }
    const [saved] = await write([evidence('p1')], source)
    const next = evidence('p1')
    next.acquisition = { id: 'manual-new', startedAt: '2026-09-16T00:00:00Z' }
    next.payout!.amount = '500.00'
    await write([next])
    const [row] = await getTestDb().select().from(schema.MoneyTransfer)
    expect(row!.id).toBe(saved!.id)
    expect(row!.sourceAmountMinor).toBe(9700n)
    const observations = await getTestDb().select().from(schema.FinancialSourceObservation)
    expect(
      observations.some((o) =>
        (o.reportingInstallationSnapshot as { rejectionReason?: string }).rejectionReason?.includes(
          'conflicts'
        )
      )
    ).toBe(true)
  })
  it('invalidates coverage without replacing an already stored conflicting page', async () => {
    const input = evidence('p1')
    await write([input])
    const changed = structuredClone(input)
    changed.membership.entries[0]!.net = '96.00'
    await write([changed])
    const [coverage] = await getTestDb().select().from(schema.FinancialSourceCoverage)
    expect(coverage!.complete).toBe(false)
    expect(coverage!.fetchedBoundary).toMatchObject({ conflict: true })
    const [entry] = await getTestDb().select().from(schema.ProcessorBalanceEntry)
    expect(entry!.netMinor).toBe(9700n)
  })
  it('does not write typed facts again when an exact acquisition replays under a new run', async () => {
    const [saved] = await write([evidence('p1')], { source: 'import', ref: 'run-a' })
    const [replayed] = await write([evidence('p1')], { source: 'import', ref: 'run-b' })
    expect(replayed!.changed).toBe(false)
    expect(replayed!.observationId).toBe(saved!.observationId)
  })
  it('retains exact amounts beyond Number safe integer range', async () => {
    const input = evidence('p1')
    input.payout!.amount = '900719925474099.17'
    await write([input])
    const [row] = await getTestDb().select().from(schema.MoneyTransfer)
    expect(row!.sourceAmountMinor).toBe(90071992547409917n)
  })
  it('retains prior amounts but reports a newer rejected header after reconciliation', async () => {
    const [saved] = await write([evidence('p1')])
    const next = evidence('p1')
    next.acquisition = { id: 'rejected-new', startedAt: '2026-09-16T00:00:00Z' }
    next.payout!.amount = '97.001'
    const [rejected] = await write([next])
    await reconcileTransferIds(getTestDb(), organizationId, [saved!.id])
    const [row] = await getTestDb().select().from(schema.MoneyTransfer)
    expect(row!.sourceAmountMinor).toBe(9700n)
    expect(row!.currentObservationId).toBe(rejected!.observationId)
    expect(row!.reconciliationState).not.toBe('complete')
  })
  it('refuses reassignment of a canonical record to another source identity', async () => {
    const [saved] = await write([evidence('p1')])
    await expect(
      writeFinancialRecords(getTestDb(), {
        organizationId,
        actorUserId,
        provenance: { source: 'import' },
        records: [
          {
            entityType: 'payout',
            entityDefinitionId: payoutDefId,
            recordId: saved!.id,
            evidence: evidence('p2'),
          },
        ],
      })
    ).rejects.toThrow('cannot change its source identity')
    const [row] = await getTestDb().select().from(schema.MoneyTransfer)
    expect(row!.externalId).toBe('p1')
  })
  it('preserves a stored match when the same entry is observed again', async () => {
    await write([evidence('p-match')])
    const [before] = await getTestDb()
      .select()
      .from(schema.ProcessorBalanceEntry)
      .where(eq(schema.ProcessorBalanceEntry.organizationId, organizationId))
    await getTestDb()
      .update(schema.ProcessorBalanceEntry)
      .set({
        matchState: 'matched',
        matchedMoneyTransactionId: 'mt-vouched',
        matchReason: 'manual',
        matchedBy: actorUserId,
      })
      .where(eq(schema.ProcessorBalanceEntry.id, before!.id))
    // A new acquisition with a changed fee, so the upsert's `set` really runs.
    const again = evidence('p-match')
    again.acquisition = { id: 'acquisition-p-match-2', startedAt: '2026-09-16T01:00:00Z' }
    again.membership.entries[0]!.fee = '4.00'
    again.membership.entries[0]!.net = '96.00'
    await write([again])
    const [after] = await getTestDb()
      .select()
      .from(schema.ProcessorBalanceEntry)
      .where(eq(schema.ProcessorBalanceEntry.id, before!.id))
    expect(after!.feeMinor).toBe(400n)
    expect(after).toMatchObject({
      matchState: 'matched',
      matchedMoneyTransactionId: 'mt-vouched',
      matchReason: 'manual',
      matchedBy: actorUserId,
    })
  })
  it('uses a fixed number of storage queries within a batch', async () => {
    const queries: string[] = []
    const db = drizzle(getTestDb().$client, {
      schema: getTestDb()._.fullSchema,
      logger: {
        logQuery(query) {
          queries.push(query)
        },
      },
    })
    const count = async (size: number, prefix: string) => {
      queries.length = 0
      await writeFinancialRecords(db, {
        organizationId,
        actorUserId,
        records: Array.from({ length: size }, (_, index) => ({
          entityType: 'payout' as const,
          entityDefinitionId: payoutDefId,
          evidence: evidence(`${prefix}-${index}`),
        })),
        provenance: { source: 'import' },
      })
      return queries.length
    }
    expect(await count(100, 'large')).toBe(await count(10, 'small'))
  })
})
