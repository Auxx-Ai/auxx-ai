// packages/lib/src/accounting/mirror/writes.ts
//
// The mirror's writer: one chunk of the provider's general ledger, verbatim,
// into `ProviderLedgerEntry` and `ProviderLedgerLine` (TARGET §2).
//
// 🛑 **Nothing here reaches `GlPosting`.** The mirror is a raw copy of what the
// provider holds, including the objects we sent it; turning the accountant's
// half of it into our own rows is `translate.ts`'s job, one pass later. Keeping
// the two apart is what lets a re-read converge - an entry that stops appearing
// is WITHDRAWN on the mirror and reversed in the ledger, rather than deleted
// from either.
//
// 🛑 **Nothing here repairs one of OUR entries.** §5.3's comparison produces a
// report and nothing else: there is deliberately no writer that restates our
// posting from theirs or re-pushes ours over theirs.
//
// No permission checks here. The router asserts (docs/lib-module-guide.md §6).

import { type Database, schema } from '@auxx/database'
import { and, eq, gte, isNull, lte, notInArray } from 'drizzle-orm'
import { ok, type Result } from 'neverthrow'
import {
  authorOf,
  type ProviderLedgerAuthorship,
  type ProviderLedgerEntry,
  type ProviderSyncRange,
} from './client'
import { guard } from './guard'

/** What the org's own books already claim, so an entry can be attributed. */
export interface OurLedgerIdentity {
  providerEntryIds: ReadonlySet<string>
  docNumbers: ReadonlySet<string>
}

export interface UpsertMirrorChunkInput extends ProviderSyncRange {
  /** The `ExternalAccountingBook` this chunk was read from. */
  bookId: string
  /** Every entry the chunk carried, ours and theirs, as `plan.ts` grouped them. */
  entries: readonly ProviderLedgerEntry[]
  ours: OurLedgerIdentity
}

export interface MirrorChunkOutcome {
  /** Mirror entries inserted or refreshed by this chunk. */
  mirrored: number
  /** Entries stamped `author: 'auxx'` - ones we pushed, kept but never translated. */
  ours: number
  /** Entries in the range that stopped appearing and were stamped `withdrawnAt`. */
  withdrawn: number
  /** The mirror ids withdrawn, so the translation can reverse their postings. */
  withdrawnIds: string[]
}

/**
 * Write one chunk of their ledger into the mirror and converge the range.
 *
 * Idempotent by the unique key `(organizationId, bookId, providerTxnType,
 * providerTxnId)`: a re-read of the same month refreshes the same rows, replaces
 * their lines, and clears `withdrawnAt` on anything that has come back.
 *
 * ⚠️ Lines are REPLACED rather than merged. A provider line has no stable id in
 * a general-ledger report, so there is nothing to match on, and a merge would
 * accumulate the old shape of an edited entry beside the new one.
 */
export async function upsertMirrorChunk(
  db: Database,
  organizationId: string,
  input: UpsertMirrorChunkInput
): Promise<Result<MirrorChunkOutcome, Error>> {
  return guard(
    async () => {
      const outcome: MirrorChunkOutcome = {
        mirrored: 0,
        ours: 0,
        withdrawn: 0,
        withdrawnIds: [],
      }
      const seen: string[] = []

      for (const entry of input.entries) {
        const author: ProviderLedgerAuthorship = authorOf(entry, input.ours)
        const id = await db.transaction(async (tx) => {
          const [row] = await tx
            .insert(schema.ProviderLedgerEntry)
            .values({
              organizationId,
              bookId: input.bookId,
              providerTxnType: entry.txnType,
              providerTxnId: entry.txnId,
              txnDate: entry.txnDate,
              docNumber: entry.docNumber,
              author,
              raw: entry as unknown as Record<string, unknown>,
            })
            .onConflictDoUpdate({
              target: [
                schema.ProviderLedgerEntry.organizationId,
                schema.ProviderLedgerEntry.bookId,
                schema.ProviderLedgerEntry.providerTxnType,
                schema.ProviderLedgerEntry.providerTxnId,
              ],
              set: {
                txnDate: entry.txnDate,
                docNumber: entry.docNumber,
                author,
                raw: entry as unknown as Record<string, unknown>,
                fetchedAt: new Date(),
                updatedAt: new Date(),
                // It is back. A re-read is the only evidence either way.
                withdrawnAt: null,
              },
            })
            .returning({ id: schema.ProviderLedgerEntry.id })
          const entryId = row!.id

          await tx
            .delete(schema.ProviderLedgerLine)
            .where(eq(schema.ProviderLedgerLine.entryId, entryId))
          const lines = entry.lines.map((line, index) => ({
            entryId,
            providerAccountId: line.providerAccountId,
            providerAccountName: line.providerAccountName,
            direction: (line.debitMinor > 0 ? 'debit' : 'credit') as 'debit' | 'credit',
            amountMinor: line.debitMinor > 0 ? line.debitMinor : line.creditMinor,
            memo: line.memo,
            providerCustomerId: line.customerId ?? null,
            providerVendorId: line.vendorId ?? null,
            sortOrder: index,
            raw: line as unknown as Record<string, unknown>,
          }))
          if (lines.length > 0) await tx.insert(schema.ProviderLedgerLine).values(lines)
          return entryId
        })

        seen.push(id)
        outcome.mirrored += 1
        if (author === 'auxx') outcome.ours += 1
      }

      // ── Converge by re-reading (§7.1) ────────────────────────────────────
      // Anything the mirror holds inside the range the provider ECHOED that
      // this read did not return has been deleted on their side.
      const vanished = await db
        .update(schema.ProviderLedgerEntry)
        .set({ withdrawnAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(schema.ProviderLedgerEntry.organizationId, organizationId),
            eq(schema.ProviderLedgerEntry.bookId, input.bookId),
            gte(schema.ProviderLedgerEntry.txnDate, input.from),
            lte(schema.ProviderLedgerEntry.txnDate, input.to),
            isNull(schema.ProviderLedgerEntry.withdrawnAt),
            // `notInArray` over an empty list is a contradiction on some drivers,
            // so an empty chunk withdraws the whole range by dropping the clause.
            seen.length > 0 ? notInArray(schema.ProviderLedgerEntry.id, seen) : undefined
          )
        )
        .returning({ id: schema.ProviderLedgerEntry.id })

      outcome.withdrawn = vanished.length
      outcome.withdrawnIds = vanished.map((row) => row.id)
      return outcome
    },
    'Failed to write the provider ledger mirror',
    { organizationId, bookId: input.bookId, from: input.from, to: input.to }
  )
}
