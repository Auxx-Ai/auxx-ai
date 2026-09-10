// packages/lib/src/postings/provider-sync/writes.ts
//
// Turning one entry the ACCOUNTANT authored into one of our rows (§6), and
// backing one out again when it stops appearing (§7.1).
//
// 🛑 **Nothing here repairs one of OUR entries.** §5.3's comparison produces a
// report and nothing else: there is deliberately no writer that restates our
// posting from theirs or re-pushes ours over theirs. Both make one entry answer
// to two authors, which is what §3.1's single-writer rule exists to prevent,
// and §12.13 records that this is the one default in the brief that is not
// reversible.
//
// No permission checks here. The router asserts (docs/lib-module-guide.md §6).

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { UnprocessableEntityError } from '../../errors'
import { buildEntry } from '../build-entry'
import type { PeriodLock } from '../periods'
import { postEntry } from '../post-entry'
import { reverseEntry } from '../reverse-entry'
import type { PostResult } from '../types'
import { PROVIDER_SYNC_POSTING_TYPE, type ProviderLedgerEntry } from './client'
import { guard } from './guard'
import { resolveProviderSyncLines } from './plan'

const logger = createScopedLogger('postings:provider-sync')

export interface PostProviderSyncEntryInput {
  /** One balanced entry of THEIRS, as `planProviderSync` partitioned it. */
  entry: ProviderLedgerEntry
  /**
   * `providerAccountId -> glAccountId`, already checked for double claims by
   * `invertAccountMap`. 🛑 A provider account that is not in this map is a
   * REFUSAL naming it - never a guess, and never a fallback account. A guess
   * that lands on a real account produces an entry that balances and is wrong,
   * and nothing downstream can detect it.
   */
  glAccountIdByProviderId: ReadonlyMap<string, string>
  /**
   * The provider the ledger was read from, RESOLVED - `'quickbooks'`, not a
   * constant this file spells. Written to `GlPosting.providerId` as provenance.
   */
  providerId: string
  lock: PeriodLock
  actorUserId?: string
}

/** What one write did. Both outcomes mean the entry is in the books. */
export interface ProviderSyncEntryOutcome {
  /**
   * `'already_posted'` is a SUCCESS, and it is the ordinary answer on a
   * re-read: `periodKey` is their transaction id, so the claim index over
   * `(organizationId, postingType, periodKey, revision)` already holds this
   * transaction and converging on it is exactly what §7.1 asks for. It is why
   * this needs no new uniqueness constraint and no new table (§0.3).
   */
  status: 'written' | 'already_posted'
  glPostingId: string
  docNumber: string
}

/**
 * Write one of their entries as a `provider_sync` posting.
 *
 * The six fields §6's table pins, and why each one:
 *
 * | field | value |
 * |---|---|
 * | `postingType` | `provider_sync`, whose export route is `'none'` - the real loop guard |
 * | `periodKey` | their transaction id, which is where idempotency comes from |
 * | `exportStatus` | `not_required`, set by the poster because the route is `'none'` |
 * | `providerId` | the resolved provider, stamped below |
 * | `providerEntryId` | their transaction id, stamped below. Also the re-read key |
 * | `txnDate` | the row's own date. May land in a closed month - §7.2 |
 *
 * ⚠️ **`exportStatus` is `not_required`, NOT `exported`.** That column means
 * "we pushed this", and we did not. It falls out of the route table rather than
 * being written here: `EXPORT_ROUTE_BY_POSTING_TYPE.provider_sync = 'none'`
 * sends the poster to `NONE_ACCOUNTING_PROVIDER`, which answers
 * `not_connected`, which the poster stamps as `not_required`. Nothing in this
 * file may set it, and nothing needs to.
 *
 * @returns `err` when the entry was NOT written - an unmapped provider account,
 *   a malformed line, a closed period, or any other refusal from the poster.
 *   The message names the entry and what stopped it, for the caller to collect.
 */
export async function postProviderSyncEntry(
  db: Database,
  organizationId: string,
  input: PostProviderSyncEntryInput
): Promise<Result<ProviderSyncEntryOutcome, Error>> {
  const { entry, glAccountIdByProviderId, providerId, lock, actorUserId } = input

  // 🛑 The unmapped-account refusal, before anything is claimed. A guess that
  // lands on a real account produces an entry that balances and is wrong, and
  // nothing downstream can detect it.
  const lines = resolveProviderSyncLines(entry, glAccountIdByProviderId)
  if (lines.isErr()) return err(lines.error)

  const built = await guard(
    async () => {
      return buildEntry({
        postingType: PROVIDER_SYNC_POSTING_TYPE,
        // 🛑 Their transaction id, not a date. §0.3: `payout` already keys on an
        // entity id, and `lockKeyFor` in the poster evaluates the period lock
        // against `txnDate` when the key is not a date - which is the right
        // month for this entry either way.
        periodKey: entry.txnId,
        txnDate: entry.txnDate,
        lines: lines.value,
      })
    },
    'Failed to build a synced entry',
    { organizationId, txnId: entry.txnId, txnType: entry.txnType }
  )
  if (built.isErr()) return err(built.error)

  const memo =
    `Synced from ${providerId}: ${entry.txnType}` +
    `${entry.docNumber ? ` ${entry.docNumber}` : ''} (transaction ${entry.txnId})`

  const result = await postEntry(db, {
    organizationId,
    entry: built.value,
    actorUserId,
    memo,
    lock,
  })

  if (!isPosted(result)) {
    return err(
      new UnprocessableEntityError(
        `${entry.txnType} ${entry.txnId} dated ${entry.txnDate} was not written: ` +
          `${result.error ?? result.status}.`,
        { txnId: entry.txnId, txnType: entry.txnType, postStatus: result.status }
      )
    )
  }

  // `isPosted` already proved `glPostingId` is set; `docNumber` is minted
  // before the claim, so a posted result always carries one.
  const glPostingId = result.glPostingId
  const docNumber = result.docNumber ?? ''

  const stamped = await stampProvenance(db, {
    organizationId,
    glPostingId,
    providerId,
    providerEntryId: entry.txnId,
  })
  if (stamped.isErr()) return err(stamped.error)

  logger.info('Wrote an entry the accounting provider authored', {
    organizationId,
    glPostingId,
    docNumber,
    txnType: entry.txnType,
    txnId: entry.txnId,
    txnDate: entry.txnDate,
    status: result.status,
  })

  return ok({
    status: result.status === 'already_posted' ? 'already_posted' : 'written',
    glPostingId,
    docNumber,
  })
}

/**
 * Back out an entry we synced that has since stopped appearing in their ledger.
 *
 * 🛑 **A reversal, never a delete** (`G4`, §7.1). The pair stays in the books
 * and stays auditable, and a re-read that finds the transaction again writes a
 * fresh entry rather than resurrecting one - which is the property that makes
 * "re-read and diff" converge after a bad run instead of compounding.
 */
export async function reverseSyncedEntry(
  db: Database,
  organizationId: string,
  input: { glPostingId: string; docNumber: string; lock: PeriodLock; actorUserId?: string }
): Promise<Result<{ glPostingId: string }, Error>> {
  const result = await reverseEntry(db, {
    organizationId,
    glPostingId: input.glPostingId,
    actorUserId: input.actorUserId,
    lock: input.lock,
    memo: `Reversal of ${input.docNumber} - the transaction no longer appears in the provider's ledger`,
  })

  if (!isPosted(result)) {
    return err(
      new UnprocessableEntityError(
        `${input.docNumber} no longer appears in the provider's ledger but could not be ` +
          `reversed: ${result.error ?? result.status}.`,
        { glPostingId: input.glPostingId, postStatus: result.status }
      )
    )
  }
  return ok({ glPostingId: result.glPostingId })
}

/**
 * Stamp the PROVENANCE - which system the entry came from and its id there.
 *
 * Separate from the poster because the poster's own stamp describes an EXPORT
 * it attempted, and it attempted none: the route is `'none'`, so it recorded
 * `providerId: 'none'` and no entry id. Those two columns are the only record
 * that this row is an import at all and that it can be matched to the
 * transaction it came from on the next re-read, so they are written here.
 *
 * ⚠️ `exportStatus` is deliberately absent from this statement. It says "we
 * pushed this", it correctly reads `not_required`, and a write here could only
 * make it lie.
 */
async function stampProvenance(
  db: Database,
  input: {
    organizationId: string
    glPostingId: string
    providerId: string
    providerEntryId: string
  }
): Promise<Result<void, Error>> {
  return guard(
    async () => {
      await db
        .update(schema.GlPosting)
        .set({ providerId: input.providerId, providerEntryId: input.providerEntryId })
        .where(
          and(
            eq(schema.GlPosting.id, input.glPostingId),
            eq(schema.GlPosting.organizationId, input.organizationId)
          )
        )
    },
    'Failed to stamp provenance on a synced entry',
    input
  )
}

/**
 * Did the LEDGER take the entry?
 *
 * Reads `status`, never `exportStatus` - a caller deciding whether the books
 * hold the entry and reading the export's outcome instead is the exact defect
 * `plans/accounting/export-state-split.md` closed.
 */
function isPosted(result: PostResult): result is PostResult & { glPostingId: string } {
  return (
    (result.status === 'posted' ||
      result.status === 'already_posted' ||
      result.status === 'healed' ||
      result.status === 'not_connected' ||
      result.status === 'disabled') &&
    Boolean(result.glPostingId)
  )
}
