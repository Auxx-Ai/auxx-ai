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
import { and, asc, between, eq, inArray, isNotNull, ne, or, type SQL } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import type { OurPostedEntry, OurPostedLine, ProviderSyncRange } from './client'
import { PROVIDER_SYNC_POSTING_TYPE } from './client'
import { guard } from './guard'

/**
 * Every provider transaction id this organization holds for an entry **auxx
 * authored** - the set {@link isOurs} is keyed on.
 *
 * 🛑🛑 **Completeness is the whole safety property.** The general ledger report
 * contains every journal entry auxx has ever pushed. An id missing from this
 * set is an entry of ours that the sync writes back as though the accountant
 * had authored it, doubling it. Both copies balance, every statement still
 * ties, and nothing downstream can detect it. One indexed query over
 * `GlPosting_org_provider_entry_key`, no filtering in memory, no pagination.
 *
 * 🔧 **`provider_sync` rows are EXCLUDED, and that is deliberate.** Their
 * `providerEntryId` is the accountant's transaction id on the accountant's
 * entry - carried as provenance, not as authorship. Including them would make
 * every entry we have ever imported read as "ours" on the next pass, so §5.3
 * would compare their entry against our copy of their entry and answer
 * `'matches'` forever, while a real edit by the accountant to their own entry
 * would be reported as an edit of OURS and never restated.
 *
 * It cannot cause a double either way: the claim index over
 * `(organizationId, postingType, periodKey, revision)` already holds
 * `('provider_sync', <their txn id>, 0)`, so a second write of the same
 * transaction converges to `already_posted` rather than posting again.
 *
 * `status` is deliberately NOT filtered. A reversed entry of ours still exists
 * in their register under the same id, and its reversal is a separate entry
 * with its own id; treating either as "not ours" would write one of them back.
 */
export async function readOurProviderEntryIds(
  db: Database,
  organizationId: string
): Promise<Result<Set<string>, Error>> {
  return guard(
    async () => {
      const rows = await db
        .select({ providerEntryId: schema.GlPosting.providerEntryId })
        .from(schema.GlPosting)
        .where(
          and(
            eq(schema.GlPosting.organizationId, organizationId),
            isNotNull(schema.GlPosting.providerEntryId),
            ne(schema.GlPosting.postingType, PROVIDER_SYNC_POSTING_TYPE)
          )
        )
      const ids = new Set<string>()
      for (const row of rows) if (row.providerEntryId) ids.add(row.providerEntryId)
      return ids
    },
    'Failed to read the provider entry ids this organization authored',
    { organizationId }
  )
}

export interface ReadOurPostedEntriesInput extends ProviderSyncRange {
  /**
   * The transaction ids the chunk actually carried. Our entries are read for
   * the UNION of these and the date range: an id that appeared is compared,
   * and an id that did not appear but whose entry is dated in range is the
   * `'missing'` case (§3.5's delete, detected for free).
   */
  providerEntryIds: readonly string[]
}

/**
 * Our own copies of the entries §5.3 checks, with their lines.
 *
 * Scoped to entries auxx authored, for {@link readOurProviderEntryIds}'s
 * reason, and to `posted` ones: a `reversed` entry is no longer standing in our
 * books, so "theirs differs from ours" is not a statement about it.
 *
 * Two queries, never N+1: the headers, then every line for them in one read.
 */
export async function readOurPostedEntries(
  db: Database,
  organizationId: string,
  input: ReadOurPostedEntriesInput
): Promise<Result<OurPostedEntry[], Error>> {
  return guard(
    async () => {
      const inRange = between(schema.GlPosting.txnDate, input.from, input.to)
      // `inArray` with an empty list compiles to a contradiction on some
      // drivers and to `IN ()` - a syntax error - on others, so an empty set
      // simply drops the clause.
      const appeared: SQL | undefined =
        input.providerEntryIds.length > 0
          ? inArray(schema.GlPosting.providerEntryId, [...input.providerEntryIds])
          : undefined

      const headers = await db
        .select({
          id: schema.GlPosting.id,
          providerEntryId: schema.GlPosting.providerEntryId,
          docNumber: schema.GlPosting.docNumber,
          txnDate: schema.GlPosting.txnDate,
        })
        .from(schema.GlPosting)
        .where(
          and(
            eq(schema.GlPosting.organizationId, organizationId),
            isNotNull(schema.GlPosting.providerEntryId),
            ne(schema.GlPosting.postingType, PROVIDER_SYNC_POSTING_TYPE),
            eq(schema.GlPosting.status, 'posted'),
            appeared ? or(inRange, appeared) : inRange
          )
        )

      if (headers.length === 0) return []

      const lineRows = await db
        .select({
          glPostingId: schema.GlPostingLine.glPostingId,
          glAccountId: schema.GlPostingLine.glAccountId,
          accountCode: schema.GlPostingLine.accountCode,
          accountName: schema.GlPostingLine.accountName,
          direction: schema.GlPostingLine.direction,
          amountMinor: schema.GlPostingLine.amountMinor,
        })
        .from(schema.GlPostingLine)
        .where(
          and(
            eq(schema.GlPostingLine.organizationId, organizationId),
            inArray(
              schema.GlPostingLine.glPostingId,
              headers.map((header) => header.id)
            )
          )
        )
        .orderBy(asc(schema.GlPostingLine.lineNumber))

      const linesByPostingId = new Map<string, OurPostedLine[]>()
      for (const row of lineRows) {
        const lines = linesByPostingId.get(row.glPostingId) ?? []
        lines.push({
          glAccountId: row.glAccountId,
          // The SNAPSHOTS frozen on the line, never the live chart.
          accountCode: row.accountCode ?? null,
          accountName: row.accountName ?? null,
          direction: row.direction as 'debit' | 'credit',
          amountMinor: toMinor(row.amountMinor),
        })
        linesByPostingId.set(row.glPostingId, lines)
      }

      return headers.map((header) => ({
        glPostingId: header.id,
        // Non-null by the `isNotNull` predicate above.
        providerEntryId: header.providerEntryId ?? '',
        docNumber: header.docNumber,
        txnDate: toDateKey(header.txnDate),
        lines: linesByPostingId.get(header.id) ?? [],
      }))
    },
    'Failed to read our own exported entries for the provider comparison',
    { organizationId, from: input.from, to: input.to }
  )
}

/** One entry the sync has already written, as §7.1's convergence sees it. */
export interface SyncedEntryRef {
  glPostingId: string
  /** Their transaction id. Also this row's `periodKey`. */
  providerEntryId: string
  docNumber: string
  txnDate: string
}

/**
 * Every `provider_sync` entry we currently hold dated inside a range.
 *
 * §7.1: the sync converges by RE-READING rather than by tracking changes, so a
 * row of this kind whose id no longer appears in a fresh read of the same range
 * has been deleted on their side and is REVERSED - never deleted, per `G4`.
 * `status = 'posted'` is what keeps a second pass from reversing a reversal.
 */
export async function readSyncedEntriesInRange(
  db: Database,
  organizationId: string,
  range: ProviderSyncRange
): Promise<Result<SyncedEntryRef[], Error>> {
  return guard(
    async () => {
      const rows = await db
        .select({
          id: schema.GlPosting.id,
          providerEntryId: schema.GlPosting.providerEntryId,
          docNumber: schema.GlPosting.docNumber,
          txnDate: schema.GlPosting.txnDate,
        })
        .from(schema.GlPosting)
        .where(
          and(
            eq(schema.GlPosting.organizationId, organizationId),
            eq(schema.GlPosting.postingType, PROVIDER_SYNC_POSTING_TYPE),
            eq(schema.GlPosting.status, 'posted'),
            between(schema.GlPosting.txnDate, range.from, range.to)
          )
        )
      return rows.map((row) => ({
        glPostingId: row.id,
        providerEntryId: row.providerEntryId ?? '',
        docNumber: row.docNumber,
        txnDate: toDateKey(row.txnDate),
      }))
    },
    'Failed to read the entries already synced for this range',
    { organizationId, from: range.from, to: range.to }
  )
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
