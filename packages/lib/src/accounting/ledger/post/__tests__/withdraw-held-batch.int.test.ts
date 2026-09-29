// packages/lib/src/accounting/ledger/post/__tests__/withdraw-held-batch.int.test.ts
import { type Database, schema, type Transaction } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { withdrawHeldBatchInTx } from '../reverse-entry'

const db = () => getTestDb() as Database

async function held(
  organizationId: string,
  values: Partial<typeof schema.ExportBatch.$inferInsert> = {}
) {
  const [book] = await db()
    .insert(schema.ExternalAccountingBook)
    .values({ organizationId, providerKey: 'test', externalCompanyId: crypto.randomUUID() })
    .returning()
  const [connection] = await db()
    .insert(schema.ExternalBookConnection)
    .values({
      organizationId,
      bookId: book!.id,
      epoch: 1,
      credentialBindingSnapshot: 'test',
      state: 'active',
      exportFromDate: '2026-01-01',
      openingPolicy: {},
    })
    .returning()
  const [posting] = await db()
    .insert(schema.GlPosting)
    .values({
      organizationId,
      postingType: 'fulfillment',
      periodKey: 'reference',
      status: 'posted',
      postedAt: new Date(),
      txnDate: '2026-09-01',
      totalMinor: 1000,
      built: {},
      avenue: 'fulfillment',
    })
    .returning()
  const [batch] = await db()
    .insert(schema.ExportBatch)
    .values({
      organizationId,
      bookId: book!.id,
      connectionId: connection!.id,
      mode: 'transaction',
      avenue: 'fulfillment',
      grainKey: posting!.id,
      currency: 'USD',
      objectType: 'journal',
      payload: {},
      payloadHash: 'a'.repeat(64),
      totalMinor: 1000,
      ...values,
    })
    .returning()
  await db()
    .insert(schema.ExportBatchPosting)
    .values({ organizationId, batchId: batch!.id, glPostingId: posting!.id })
  return { postingId: posting!.id, batchId: batch!.id }
}

async function withdraw(organizationId: string, postingId: string) {
  await db().transaction((tx) =>
    withdrawHeldBatchInTx(tx as Transaction, organizationId, postingId)
  )
  const [batch] = await db()
    .select({ state: schema.ExportBatch.state })
    .from(schema.ExportBatch)
    .innerJoin(
      schema.ExportBatchPosting,
      eq(schema.ExportBatchPosting.batchId, schema.ExportBatch.id)
    )
    .where(eq(schema.ExportBatchPosting.glPostingId, postingId))
  const [member] = await db()
    .select({ withdrawnAt: schema.ExportBatchPosting.withdrawnAt })
    .from(schema.ExportBatchPosting)
    .where(eq(schema.ExportBatchPosting.glPostingId, postingId))
  return { state: batch!.state, memberWithdrawn: member!.withdrawnAt !== null }
}

describe('withdrawHeldBatchInTx', () => {
  it('withdraws a held transaction batch and frees its posting', async () => {
    const org = await createTestOrganization()
    const { postingId } = await held(org.id)
    expect(await withdraw(org.id, postingId)).toEqual({
      state: 'withdrawn',
      memberWithdrawn: true,
    })
  })

  it('leaves a sent, a leased, and a summary batch alone', async () => {
    // One active book connection per org, so one org per case.
    const [a, b, c] = await Promise.all([
      createTestOrganization(),
      createTestOrganization(),
      createTestOrganization(),
    ])
    const sent = await held(a.id, { state: 'sent' })
    const leased = await held(b.id, { leaseExpiresAt: new Date(Date.now() + 60_000) })
    const summary = await held(c.id, { mode: 'summary' })

    expect(await withdraw(a.id, sent.postingId)).toEqual({
      state: 'sent',
      memberWithdrawn: false,
    })
    expect(await withdraw(b.id, leased.postingId)).toEqual({
      state: 'ready',
      memberWithdrawn: false,
    })
    expect(await withdraw(c.id, summary.postingId)).toEqual({
      state: 'ready',
      memberWithdrawn: false,
    })
  })
})
