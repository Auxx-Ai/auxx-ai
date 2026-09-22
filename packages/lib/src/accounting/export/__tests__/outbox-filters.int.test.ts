// packages/lib/src/accounting/export/__tests__/outbox-filters.int.test.ts
import { schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { listBlockedMovements } from '../../money/blocked-movements'

vi.mock('../../../settings/read', () => ({
  readOrganizationSettings: async () => ({ 'accounting.bookTimeZone': 'America/Los_Angeles' }),
}))

import { listPostings } from '../../ledger/reads/list-postings'
import { listExportBatches } from '../queue-reads'

const db = () => getTestDb()

async function posting(
  organizationId: string,
  values: Partial<typeof schema.GlPosting.$inferInsert> = {}
) {
  const [row] = await db()
    .insert(schema.GlPosting)
    .values({
      organizationId,
      postingType: 'fulfillment',
      periodKey: 'reference',
      status: 'draft',
      txnDate: '2026-02-28',
      totalMinor: 1000,
      built: { memo: 'Order 10%_off' },
      ...values,
    })
    .returning()
  return row!
}

async function book(organizationId: string) {
  const [b] = await db()
    .insert(schema.ExternalAccountingBook)
    .values({ organizationId, providerKey: 'test', externalCompanyId: 'company' })
    .returning()
  const [c] = await db()
    .insert(schema.ExternalBookConnection)
    .values({
      organizationId,
      bookId: b!.id,
      epoch: 1,
      credentialBindingSnapshot: 'test',
      state: 'active',
      exportFromDate: '2026-01-01',
      openingPolicy: {},
    })
    .returning()
  return { bookId: b!.id, connectionId: c!.id }
}

async function batch(
  organizationId: string,
  connection: Awaited<ReturnType<typeof book>>,
  index: number,
  days: string[],
  avenue = 'fulfillment',
  withdrawn = false
) {
  const [b] = await db()
    .insert(schema.ExportBatch)
    .values({
      organizationId,
      ...connection,
      mode: 'summary',
      avenue,
      grainKey: String(index),
      currency: 'USD',
      objectType: 'journal',
      payload: { docNumber: `B-${index}` },
      payloadHash: 'a'.repeat(64),
      totalMinor: days.length * 1000,
      createdAt: new Date(2026, 8, index + 1),
    })
    .returning()
  for (const day of days) {
    const p = await posting(organizationId, { txnDate: day, docNumber: `P-${index}-${day}` })
    await db()
      .insert(schema.ExportBatchPosting)
      .values({
        organizationId,
        batchId: b!.id,
        glPostingId: p.id,
        withdrawnAt: withdrawn ? new Date() : null,
      })
  }
  return b!
}

describe('Outbox filters before pagination', () => {
  it('combines draft categories with literal search and inclusive dates before paging', async () => {
    const org = await createTestOrganization()
    const other = await createTestOrganization()
    await posting(other.id)
    await posting(org.id, { postingType: 'vendor_bill' })
    await posting(org.id, { txnDate: '2026-03-01' })
    await posting(org.id, { built: { memo: 'Order 100xoff' } })
    const first = await posting(org.id)
    const second = await posting(org.id, { postingType: 'payout' })
    const input = {
      organizationId: org.id,
      status: 'draft' as const,
      categories: ['fulfillment', 'payout'] as Array<'fulfillment' | 'payout'>,
      from: '2026-02-28',
      to: '2026-02-28',
      search: '10%_OFF',
      limit: 1,
    }
    const a = await listPostings(db(), input)
    const b = await listPostings(db(), { ...input, offset: 1 })
    expect(a.isOk() && b.isOk()).toBe(true)
    if (a.isErr() || b.isErr()) throw new Error('read failed')
    expect(new Set([...a.value, ...b.value].map((row) => row.id))).toEqual(
      new Set([first.id, second.id])
    )
  })

  it('filters movement purposes and literal references on the book day across DST', async () => {
    const org = await createTestOrganization()
    const [command] = await db()
      .insert(schema.MoneyCommand)
      .values({
        organizationId: org.id,
        commandKey: 'filters',
        kind: 'test',
        payloadHash: 'h',
        actorSnapshot: {},
      })
      .returning()
    const insert = async (
      purpose: 'customer_receipt' | 'vendor_payment' | 'customer_refund',
      occurredAt: string,
      reference = '100%_literal'
    ) => {
      const [row] = await db()
        .insert(schema.MoneyTransaction)
        .values({
          organizationId: org.id,
          recordedByCommandId: command!.id,
          purpose,
          amountMinor: 100n,
          currency: 'USD',
          currencyExponent: 2,
          datePrecision: 'instant',
          occurredAt: new Date(occurredAt),
          reference,
          postingBlockedReason: 'Missing account',
          postingBlockedAt: new Date(),
        })
        .returning()
      return row!.id
    }
    await insert('customer_receipt', '2026-03-08T07:59:59Z')
    const first = await insert('customer_receipt', '2026-03-08T08:00:00Z')
    const second = await insert('vendor_payment', '2026-03-09T06:59:59Z')
    await insert('vendor_payment', '2026-03-09T07:00:00Z')
    await insert('customer_refund', '2026-03-08T12:00:00Z')
    await insert('customer_receipt', '2026-03-08T12:00:00Z', '100xxliteral')
    const input = {
      categories: ['customer_receipt', 'vendor_payment'] as Array<
        'customer_receipt' | 'vendor_payment'
      >,
      from: '2026-03-08',
      to: '2026-03-08',
      search: '%_LITERAL',
      limit: 1,
    }
    const a = await listBlockedMovements(db(), org.id, input)
    const b = await listBlockedMovements(db(), org.id, { ...input, offset: 1 })
    expect(new Set([...a, ...b].map((row) => row.id))).toEqual(new Set([first, second]))
  })

  it('finds older matching batches, keeps complete members, and excludes withdrawn matches', async () => {
    const org = await createTestOrganization()
    const connection = await book(org.id)
    const first = await batch(org.id, connection, 0, ['2026-02-28', '2026-03-01'])
    const second = await batch(org.id, connection, 1, ['2026-02-28'], 'payout')
    await batch(org.id, connection, 2, ['2026-02-28'], 'fulfillment', true)
    await batch(org.id, connection, 3, ['2026-02-28'], 'invoice')
    await batch(org.id, connection, 4, ['2026-03-01'])
    const other = await createTestOrganization()
    await batch(other.id, await book(other.id), 5, ['2026-02-28'])
    const input = {
      organizationId: org.id,
      categories: ['fulfillment', 'payout'],
      from: '2026-02-28',
      to: '2026-02-28',
      states: ['ready'] as Array<'ready'>,
      limit: 1,
    }
    const a = await listExportBatches(db(), input)
    const b = await listExportBatches(db(), { ...input, offset: 1 })
    if (a.isErr()) throw a.error
    if (b.isErr()) throw b.error
    expect(a.value.map((row) => row.id)).toEqual([second.id])
    expect(b.value.map((row) => row.id)).toEqual([first.id])
    expect(b.value[0]!.members).toHaveLength(2)
    expect(b.value[0]!.totalMinor).toBe(2000)
    const month = await listExportBatches(db(), {
      organizationId: org.id,
      month: '2026-02',
      categories: ['fulfillment', 'payout'],
      limit: 1,
    })
    if (month.isErr()) throw month.error
    expect(month.value.map((row) => row.id)).toEqual([second.id])
    const search = await listExportBatches(db(), { ...input, search: 'p-0-2026-03-01' })
    if (search.isErr()) throw search.error
    expect(search.value.map((row) => row.id)).toEqual([first.id])
    expect(search.value[0]!.members).toHaveLength(2)
  })
})
