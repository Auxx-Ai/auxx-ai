// packages/lib/src/accounting/journals/entries/__tests__/journal-document.int.test.ts
//
// The manual journal's lines as `journal_entry_line` children, against a real
// database (91 D5): create writes them, the read groups and orders them, update
// keeps, rewrites, creates and deletes by id, and discard takes them with the
// entry through the `journal_entry.lines` cascade.

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import { and, eq, inArray } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEntityDefinitions } from '../../../../seed/entity-seeder/create-entity-defs'
import { createAllFields } from '../../../../seed/entity-seeder/create-fields'
import { linkRelationships } from '../../../../seed/entity-seeder/link-relationships'
import { getJournalEntry, listJournalEntries } from '../reads'
import { createJournalEntry, discardJournalEntry, updateJournalEntry } from '../writes'

vi.mock('@auxx/redis', async (original) => ({
  ...(await original<typeof import('@auxx/redis')>()),
  getRedisClient: async () => {
    throw new Error('No Redis in journal database tests')
  },
}))
vi.mock('../../../../resources/crud/tx-write-flush', () => ({ flushTxWriteScope: vi.fn() }))
vi.mock('../../../../events', () => ({ publisher: { publishLater: vi.fn(), publish: vi.fn() } }))

const db = () => getTestDb() as unknown as Database
let organizationId: string
let userId: string
let lineDefId: string

const LINES = [
  { glAccountId: 'acct_6200', direction: 'debit' as const, amountMinor: 50_000, memo: 'Rent' },
  {
    glAccountId: 'acct_2100',
    direction: 'credit' as const,
    amountMinor: 50_000,
    counterpartyType: 'vendor' as const,
    counterpartyId: 'company_1',
  },
]

async function liveLineIds(): Promise<string[]> {
  const rows = await db()
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, lineDefId)
      )
    )
  return rows.map((row) => row.id)
}

beforeEach(async () => {
  const org = await createTestOrganization()
  const user = await createTestUser()
  organizationId = org.id
  userId = user.id
  await db()
    .update(schema.Organization)
    .set({ systemUserId: userId })
    .where(eq(schema.Organization.id, organizationId))
  const all = await createEntityDefinitions(db(), organizationId)
  const defs = new Map(
    [...all].filter(([kind]) => ['journal_entry', 'journal_entry_line'].includes(kind))
  )
  const made = await createAllFields(db(), organizationId, defs)
  await linkRelationships(db(), defs, made)
  lineDefId = defs.get('journal_entry_line')!.id
})

describe('the journal document against the database', () => {
  it('writes the lines as children and reads them back in order, unposted', async () => {
    const created = (
      await createJournalEntry(db(), organizationId, userId, {
        date: '2026-08-31',
        memo: 'Accrue August rent',
        lines: LINES,
      })
    )._unsafeUnwrap()

    expect(created.status).toBe('draft')
    expect(created.glPostingId).toBeNull()
    expect(created.lines).toEqual([
      { id: expect.any(String), ...LINES[0] },
      { id: expect.any(String), ...LINES[1] },
    ])

    const listed = (
      await listJournalEntries(db(), organizationId, { status: 'draft' })
    )._unsafeUnwrap()
    expect(listed.map((entry) => entry.id)).toEqual([created.id])
    const posted = (
      await listJournalEntries(db(), organizationId, { status: 'posted' })
    )._unsafeUnwrap()
    expect(posted).toEqual([])
  })

  it('keeps a named line, rewrites it, creates an unnamed one and deletes the rest', async () => {
    const created = (
      await createJournalEntry(db(), organizationId, userId, { date: '2026-08-31', lines: LINES })
    )._unsafeUnwrap()
    const [first, second] = created.lines

    const updated = (
      await updateJournalEntry(db(), organizationId, userId, {
        journalEntryId: created.id,
        lines: [
          { ...first!, amountMinor: 60_000, memo: undefined },
          { glAccountId: 'acct_2200', direction: 'credit', amountMinor: 60_000 },
        ],
      })
    )._unsafeUnwrap()

    expect(updated.lines).toEqual([
      { id: first!.id, glAccountId: 'acct_6200', direction: 'debit', amountMinor: 60_000 },
      {
        id: expect.any(String),
        glAccountId: 'acct_2200',
        direction: 'credit',
        amountMinor: 60_000,
      },
    ])
    expect(updated.lines[1]?.id).not.toBe(second!.id)
    expect(await liveLineIds()).not.toContain(second!.id)
  })

  it('discards the entry and its lines together', async () => {
    const created = (
      await createJournalEntry(db(), organizationId, userId, { date: '2026-08-31', lines: LINES })
    )._unsafeUnwrap()
    const lineIds = created.lines.map((line) => line.id!)

    expect(
      (
        await discardJournalEntry(db(), organizationId, userId, { journalEntryId: created.id })
      ).isOk()
    ).toBe(true)

    expect((await getJournalEntry(db(), organizationId, created.id))._unsafeUnwrap()).toBeNull()
    const left = await db()
      .select({ id: schema.EntityInstance.id })
      .from(schema.EntityInstance)
      .where(inArray(schema.EntityInstance.id, lineIds))
    expect(left).toEqual([])
  })
})
