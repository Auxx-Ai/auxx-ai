// packages/lib/src/postings/provider-sync/reads.ts
//
// What our own books already say, for the three questions the inbound sync
// asks of them:
//
//  1. Which provider transactions did AUXX author? - the exclusion set, and the
//     single most dangerous query in this directory.
//  2. What do our copies of those entries actually say? - §5.3's comparison.
//  3. What have we already synced in this range? - §7.1's convergence, which
//     reverses anything whose id stopped appearing.
//
// No permission checks here. The router asserts (docs/lib-module-guide.md §6).

import { type Database, schema } from '@auxx/database'
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import type { Result } from 'neverthrow'
import type { OurPostedEntry, OurPostedLine, ProviderLedgerLine, ProviderSyncRange } from './client'
import { PROVIDER_LEDGER_SOURCE_KIND, PROVIDER_SYNC_POSTING_TYPE } from './client'
import { guard } from './guard'

/**
 * Every provider transaction id this organization holds for an object **auxx
 * sent** - the set {@link isOurs} is keyed on.
 *
 * 🛑🛑 **Completeness is the whole safety property.** The general ledger report
 * contains every journal entry auxx has ever pushed. An id missing from this set
 * is an object of ours that the sync writes back as though the accountant had
 * authored it, doubling it.
 *
 * Read off `ExportBatch`, which since the export batch (TARGET §3) is the only
 * record of what auxx put in the provider's books. A withdrawn batch is
 * excluded because its copy is gone from their register too, so it can never
 * appear in a walk.
 */
export async function readOurProviderEntryIds(
  db: Database,
  organizationId: string
): Promise<Result<Set<string>, Error>> {
  return guard(
    async () => {
      const rows = await db
        .select({ providerObjectId: schema.ExportBatch.providerObjectId })
        .from(schema.ExportBatch)
        .where(
          and(
            eq(schema.ExportBatch.organizationId, organizationId),
            eq(schema.ExportBatch.state, 'sent'),
            isNotNull(schema.ExportBatch.providerObjectId)
          )
        )
      const ids = new Set<string>()
      for (const row of rows) if (row.providerObjectId) ids.add(row.providerObjectId)
      return ids
    },
    'Failed to read the provider object ids this organization sent',
    { organizationId }
  )
}

export interface ReadOurPostedEntriesInput extends ProviderSyncRange {
  /**
   * The transaction ids the chunk actually carried. Our objects are read for
   * the UNION of these and the date range: an id that appeared is compared,
   * and an id that did not appear but whose object is dated in range is the
   * `'missing'` case (§3.5's delete, detected for free).
   */
  providerEntryIds: readonly string[]
}

/**
 * What we SENT, for §5.3's comparison.
 *
 * 🔑 Read off the batch's FROZEN payload, not off `GlPostingLine`. The payload
 * is what left, and in Summary mode one provider object carries many postings -
 * so re-deriving the comparison from the detail ledger would compare a hundred
 * postings against one remote entry and report every one of them as divergent.
 * `glPostingId` names the first member, for a label.
 */
export async function readOurPostedEntries(
  db: Database,
  organizationId: string,
  input: ReadOurPostedEntriesInput
): Promise<Result<OurPostedEntry[], Error>> {
  return guard(
    async () => {
      const appeared: SQL | undefined =
        input.providerEntryIds.length > 0
          ? inArray(schema.ExportBatch.providerObjectId, [...input.providerEntryIds])
          : undefined

      const batches = await db
        .select({
          id: schema.ExportBatch.id,
          providerObjectId: schema.ExportBatch.providerObjectId,
          payload: schema.ExportBatch.payload,
        })
        .from(schema.ExportBatch)
        .where(
          and(
            eq(schema.ExportBatch.organizationId, organizationId),
            eq(schema.ExportBatch.state, 'sent'),
            isNotNull(schema.ExportBatch.providerObjectId),
            appeared
              ? or(inRangeByPayloadDate(input.from, input.to), appeared)
              : inRangeByPayloadDate(input.from, input.to)
          )
        )
      if (batches.length === 0) return []

      const members = await db
        .select({
          batchId: schema.ExportBatchPosting.batchId,
          glPostingId: schema.ExportBatchPosting.glPostingId,
        })
        .from(schema.ExportBatchPosting)
        .where(
          and(
            eq(schema.ExportBatchPosting.organizationId, organizationId),
            inArray(
              schema.ExportBatchPosting.batchId,
              batches.map((batch) => batch.id)
            ),
            isNull(schema.ExportBatchPosting.withdrawnAt)
          )
        )
      const firstMember = new Map<string, string>()
      for (const member of members)
        if (!firstMember.has(member.batchId)) firstMember.set(member.batchId, member.glPostingId)

      return batches.map((batch) => {
        const payload = batch.payload as {
          docNumber?: string
          txnDate?: string
          lines?: Array<{
            glAccountId?: string
            accountCode?: string | null
            direction?: string
            amountMinor?: number
          }>
        }
        return {
          glPostingId: firstMember.get(batch.id) ?? batch.id,
          providerEntryId: batch.providerObjectId ?? '',
          docNumber: payload.docNumber ?? '',
          txnDate: toDateKey(payload.txnDate ?? ''),
          lines: (payload.lines ?? []).map(
            (line): OurPostedLine => ({
              glAccountId: line.glAccountId ?? '',
              accountCode: line.accountCode ?? null,
              // The batch payload carries no account NAME - nothing joins on it
              // and the difference report falls back to the code.
              accountName: null,
              direction: line.direction === 'credit' ? 'credit' : 'debit',
              amountMinor: toMinor(line.amountMinor ?? 0),
            })
          ),
        }
      })
    },
    'Failed to read our own sent batches for the provider comparison',
    { organizationId, from: input.from, to: input.to }
  )
}

/** The payload's own accounting date, compared as the string it is stored as. */
function inRangeByPayloadDate(from: string, to: string): SQL {
  return sql`${schema.ExportBatch.payload}->>'txnDate' BETWEEN ${from} AND ${to}`
}

/**
 * Keep a Postgres `date` as `YYYY-MM-DD`.
 *
 * Drizzle's `date()` is string-mode, so this is a pass-through in production.
 * The `Date` branch exists because the accounting date must never acquire a
 * time and a zone: `new Date('2026-08-31')` read through a local getter renders
 * as August 30 west of Greenwich, and §5.3's range test is a string compare
 * against exactly this value.
 */
function toDateKey(value: Date | string): string {
  return typeof value === 'string' ? value : value.toISOString().slice(0, 10)
}

/** `bigint({ mode: 'number' })` crosses as a number through Drizzle and as a string through a raw driver. */
function toMinor(value: string | number): number {
  return typeof value === 'number' ? value : Number(value)
}

/** The `ExternalAccountingBook` the org's active connection points at, or null. */
export async function readActiveBookId(
  db: Database,
  organizationId: string
): Promise<Result<string | null, Error>> {
  return guard(
    async () => {
      const [row] = await db
        .select({ bookId: schema.ExternalBookConnection.bookId })
        .from(schema.ExternalBookConnection)
        .where(
          and(
            eq(schema.ExternalBookConnection.organizationId, organizationId),
            eq(schema.ExternalBookConnection.state, 'active')
          )
        )
        .limit(1)
      return row?.bookId ?? null
    },
    'Failed to read the active accounting book',
    { organizationId }
  )
}

/**
 * Every document number this org has minted, for the mirror's authorship stamp.
 *
 * The second witness behind the transaction id: an entry carrying a number we
 * issued is ours even when its id is not in the exclusion set, and calling it
 * theirs would translate our own entry back into our own books.
 */
export async function readOurDocNumbers(
  db: Database,
  organizationId: string
): Promise<Result<Set<string>, Error>> {
  return guard(
    async () => {
      const rows = await db
        .select({ docNumber: schema.GlPosting.docNumber })
        .from(schema.GlPosting)
        .where(
          and(
            eq(schema.GlPosting.organizationId, organizationId),
            isNotNull(schema.GlPosting.docNumber),
            ne(schema.GlPosting.postingType, PROVIDER_SYNC_POSTING_TYPE)
          )
        )
      const numbers = new Set<string>()
      for (const row of rows) if (row.docNumber) numbers.add(row.docNumber)
      return numbers
    },
    'Failed to read the document numbers this organization minted',
    { organizationId }
  )
}

/** One mirror entry, with its lines, as the translation reads it. */
export interface MirrorEntry {
  id: string
  providerTxnType: string
  providerTxnId: string
  txnDate: string
  docNumber: string | null
  withdrawn: boolean
  lines: ProviderLedgerLine[]
  /** The live `provider_sync` posting claiming this entry, when one exists. */
  livePostingId: string | null
  liveDocNumber: string | null
}

/**
 * Every `author: 'provider'` entry the mirror holds in a range, with whether our
 * books already carry it.
 *
 * `author` is what keeps this from re-importing the objects we sent: an `'auxx'`
 * row stays in the mirror for the readback and the reconciliation and is never a
 * translation candidate.
 */
export async function readMirrorForTranslation(
  db: Database,
  organizationId: string,
  input: ProviderSyncRange & { bookId: string }
): Promise<Result<MirrorEntry[], Error>> {
  return guard(
    async () => {
      const entries = await db
        .select({
          id: schema.ProviderLedgerEntry.id,
          providerTxnType: schema.ProviderLedgerEntry.providerTxnType,
          providerTxnId: schema.ProviderLedgerEntry.providerTxnId,
          txnDate: schema.ProviderLedgerEntry.txnDate,
          docNumber: schema.ProviderLedgerEntry.docNumber,
          withdrawnAt: schema.ProviderLedgerEntry.withdrawnAt,
        })
        .from(schema.ProviderLedgerEntry)
        .where(
          and(
            eq(schema.ProviderLedgerEntry.organizationId, organizationId),
            eq(schema.ProviderLedgerEntry.bookId, input.bookId),
            eq(schema.ProviderLedgerEntry.author, 'provider'),
            gte(schema.ProviderLedgerEntry.txnDate, input.from),
            lte(schema.ProviderLedgerEntry.txnDate, input.to)
          )
        )
      if (entries.length === 0) return []

      const ids = entries.map((entry) => entry.id)
      const lineRows = await db
        .select({
          entryId: schema.ProviderLedgerLine.entryId,
          providerAccountId: schema.ProviderLedgerLine.providerAccountId,
          providerAccountName: schema.ProviderLedgerLine.providerAccountName,
          direction: schema.ProviderLedgerLine.direction,
          amountMinor: schema.ProviderLedgerLine.amountMinor,
          memo: schema.ProviderLedgerLine.memo,
        })
        .from(schema.ProviderLedgerLine)
        .where(inArray(schema.ProviderLedgerLine.entryId, ids))
        .orderBy(asc(schema.ProviderLedgerLine.sortOrder))

      // The live claim, in one read rather than one per entry. `linkRole` is the
      // claim and a reversal deletes it, so a row here means our books still
      // stand behind that mirror entry.
      const claims = await db
        .select({
          sourceId: schema.GlPostingSource.sourceId,
          glPostingId: schema.GlPostingSource.glPostingId,
          status: schema.GlPosting.status,
          docNumber: schema.GlPosting.docNumber,
        })
        .from(schema.GlPostingSource)
        .innerJoin(schema.GlPosting, eq(schema.GlPosting.id, schema.GlPostingSource.glPostingId))
        .where(
          and(
            eq(schema.GlPostingSource.organizationId, organizationId),
            eq(schema.GlPostingSource.sourceKind, PROVIDER_LEDGER_SOURCE_KIND),
            eq(schema.GlPostingSource.linkRole, 'subject'),
            inArray(schema.GlPostingSource.sourceId, ids)
          )
        )

      const linesByEntry = new Map<string, ProviderLedgerLine[]>()
      for (const row of lineRows) {
        const lines = linesByEntry.get(row.entryId) ?? []
        const entry = entries.find((candidate) => candidate.id === row.entryId)!
        const amount = toMinor(row.amountMinor)
        lines.push({
          txnType: entry.providerTxnType,
          txnId: entry.providerTxnId,
          txnDate: entry.txnDate,
          providerAccountId: row.providerAccountId,
          providerAccountName: row.providerAccountName ?? '',
          debitMinor: row.direction === 'debit' ? amount : 0,
          creditMinor: row.direction === 'credit' ? amount : 0,
          docNumber: entry.docNumber,
          memo: row.memo,
        })
        linesByEntry.set(row.entryId, lines)
      }

      const claimByEntry = new Map(
        claims.filter((row) => row.status !== 'reversed').map((row) => [row.sourceId, row])
      )

      return entries.map((entry) => ({
        id: entry.id,
        providerTxnType: entry.providerTxnType,
        providerTxnId: entry.providerTxnId,
        txnDate: entry.txnDate,
        docNumber: entry.docNumber,
        withdrawn: entry.withdrawnAt !== null,
        lines: linesByEntry.get(entry.id) ?? [],
        livePostingId: claimByEntry.get(entry.id)?.glPostingId ?? null,
        liveDocNumber: claimByEntry.get(entry.id)?.docNumber ?? null,
      }))
    },
    'Failed to read the provider ledger mirror for translation',
    { organizationId, bookId: input.bookId, from: input.from, to: input.to }
  )
}
