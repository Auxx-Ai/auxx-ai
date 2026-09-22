// packages/lib/src/accounting/export/__tests__/summary-rows.int.test.ts
import { schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../settings/read', () => ({
  readOrganizationSettings: async () => ({ 'accounting.exportMode': 'summary' }),
}))

import { countSummaryRows, listSummaryRows } from '../summary-rows'

const db = () => getTestDb()

async function posting(organizationId: string, txnDate: string, docNumber: string) {
  const [row] = await db()
    .insert(schema.GlPosting)
    .values({
      organizationId,
      postingType: 'fulfillment',
      avenue: 'fulfillment',
      periodKey: txnDate.slice(0, 7),
      status: 'posted',
      postedAt: new Date(),
      txnDate,
      docNumber,
      totalMinor: 1000,
      built: {},
    })
    .returning()
  await db()
    .insert(schema.GlPostingLine)
    .values(
      (['debit', 'credit'] as const).map((direction, index) => ({
        organizationId,
        glPostingId: row!.id,
        lineNumber: index + 1,
        glAccountId: direction === 'debit' ? 'acct_ar' : 'acct_revenue',
        direction,
        amountMinor: 1000,
        sourceType: 'test',
        sourceId: row!.id,
      }))
    )
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
      exportFromDate: '2026-02-01',
      openingPolicy: {},
    })
    .returning()
  return { bookId: b!.id, connectionId: c!.id }
}

async function batch(
  organizationId: string,
  connection: Awaited<ReturnType<typeof book>>,
  grainKey: string,
  state: 'ready' | 'sent' | 'failed' | 'withdrawn',
  held: Array<{ id: string }>
) {
  const [b] = await db()
    .insert(schema.ExportBatch)
    .values({
      organizationId,
      ...connection,
      mode: 'summary',
      avenue: 'fulfillment',
      grainKey,
      currency: 'USD',
      objectType: 'journal',
      state,
      payload: { docNumber: `SUM-${grainKey}` },
      payloadHash: 'a'.repeat(64),
      totalMinor: held.length * 1000,
    })
    .returning()
  for (const p of held)
    await db()
      .insert(schema.ExportBatchPosting)
      .values({
        organizationId,
        batchId: b!.id,
        glPostingId: p.id,
        withdrawnAt: state === 'withdrawn' ? new Date() : null,
      })
  return b!
}

describe('listSummaryRows over real SQL', () => {
  it('merges buckets and live batches into one ordered, paged, filtered list', async () => {
    const org = await createTestOrganization()
    const connection = await book(org.id)

    await posting(org.id, '2026-02-03', 'A-1')
    await posting(org.id, '2026-02-03', 'A-2')
    const b1 = await posting(org.id, '2026-02-04', 'B-1')
    await posting(org.id, '2026-02-04', 'B-2')
    const c1 = await posting(org.id, '2026-02-05', 'C-1')
    const d1 = await posting(org.id, '2026-02-06', 'D-1')
    const e1 = await posting(org.id, '2026-02-07', 'E-1')
    await posting(org.id, '2026-01-20', 'BEFORE-WINDOW')
    const other = await createTestOrganization()
    await book(other.id)
    await posting(other.id, '2026-02-03', 'OTHER')

    const sent = await batch(org.id, connection, '2026-02-04', 'sent', [b1])
    const failed = await batch(org.id, connection, '2026-02-05', 'failed', [c1])
    await batch(org.id, connection, '2026-02-06', 'withdrawn', [d1])
    // Held by a batch on another key: neither bucket has a posting of its own, so no row.
    await batch(org.id, connection, 'elsewhere', 'ready', [e1])

    const ready = await listSummaryRows(db(), {
      organizationId: org.id,
      tab: 'ready',
      direction: 'asc',
      limit: 50,
    })
    if (ready.isErr()) throw ready.error
    expect(ready.value.total).toBe(2)
    expect(
      ready.value.items.map((row) => [row.dayKey, row.status, row.memberCount, row.newCount])
    ).toEqual([
      ['2026-02-03', 'not_sent', 2, 2],
      ['2026-02-06', 'not_sent', 1, 1],
    ])

    const sentTab = await listSummaryRows(db(), { organizationId: org.id, tab: 'sent', limit: 50 })
    if (sentTab.isErr()) throw sentTab.error
    expect(sentTab.value.items).toHaveLength(1)
    expect(sentTab.value.items[0]).toMatchObject({
      dayKey: '2026-02-04',
      status: 'sent_new',
      memberCount: 2,
      newCount: 1,
      totalMinor: 2000,
    })
    expect(sentTab.value.items[0]!.batch?.id).toBe(sent.id)

    const failedTab = await listSummaryRows(db(), {
      organizationId: org.id,
      tab: 'failed',
      limit: 50,
    })
    if (failedTab.isErr()) throw failedTab.error
    expect(failedTab.value.items.map((row) => [row.status, row.batch?.id])).toEqual([
      ['failed', failed.id],
    ])

    const page = await listSummaryRows(db(), {
      organizationId: org.id,
      tab: 'ready',
      direction: 'desc',
      limit: 1,
      offset: 1,
    })
    if (page.isErr()) throw page.error
    expect(page.value).toMatchObject({ total: 2, items: [{ dayKey: '2026-02-03' }] })

    const searched = await listSummaryRows(db(), {
      organizationId: org.id,
      tab: 'sent',
      search: 'b-2',
      limit: 50,
    })
    if (searched.isErr()) throw searched.error
    expect(searched.value.items).toHaveLength(1)
    const byBatchDoc = await listSummaryRows(db(), {
      organizationId: org.id,
      tab: 'failed',
      search: 'sum-2026-02-05',
      limit: 50,
    })
    if (byBatchDoc.isErr()) throw byBatchDoc.error
    expect(byBatchDoc.value.items).toHaveLength(1)

    const ranged = await listSummaryRows(db(), {
      organizationId: org.id,
      tab: 'ready',
      from: '2026-02-04',
      to: '2026-02-06',
      limit: 50,
    })
    if (ranged.isErr()) throw ranged.error
    expect(ranged.value.items.map((row) => row.dayKey)).toEqual(['2026-02-06'])

    const counts = await countSummaryRows(db(), { organizationId: org.id })
    if (counts.isErr()) throw counts.error
    expect(counts.value).toEqual({ ready: 2, sent: 1, failed: 1 })
  })
})
