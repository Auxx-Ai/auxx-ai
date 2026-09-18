// packages/lib/src/accounting/money/payouts/match-writes.ts

/**
 * The three human answers to a match the matcher could not make: accept a
 * suggestion, match by hand, unmatch (§10.4, §12 T5).
 *
 * Every one of them re-marks the item for assessment, so the `MoneyTransfer`'s
 * blockers and `unmatchedCount` follow without a second trigger path. Marking
 * the ENTRY is enough: `assessPayouts` resolves the owning payout from a
 * `ProcessorBalanceEntry` id itself.
 *
 * No permission checks — the router asserts (`docs/lib-module-guide.md` §6).
 */

import { type Database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { ConflictError, NotFoundError } from '../../../errors'
import type { MatchReason, MatchState } from './match-reasons'
import { readFrozenEntryIds } from './match-sync'
import { markPayoutForAssessment } from './payout-reconciler'

/** What a write left on the row, so a caller can render it without a re-read. */
export interface MatchWriteResult {
  entryId: string
  matchState: MatchState
  matchedMoneyTransactionId: string | null
  matchReason: MatchReason | null
  matchedBy: string | null
}

type Entry = typeof schema.ProcessorBalanceEntry.$inferSelect

async function loadEntry(
  db: Database,
  organizationId: string,
  entryId: string
): Promise<Entry | null> {
  const [row] = await db
    .select()
    .from(schema.ProcessorBalanceEntry)
    .where(
      and(
        eq(schema.ProcessorBalanceEntry.organizationId, organizationId),
        eq(schema.ProcessorBalanceEntry.id, entryId)
      )
    )
    .limit(1)
  return row ?? null
}

async function write(
  db: Database,
  organizationId: string,
  userId: string,
  entryId: string,
  next: Omit<MatchWriteResult, 'entryId'>
): Promise<Result<MatchWriteResult, Error>> {
  await db
    .update(schema.ProcessorBalanceEntry)
    .set({
      matchState: next.matchState,
      matchedMoneyTransactionId: next.matchedMoneyTransactionId,
      matchReason: next.matchReason,
      matchedBy: next.matchedBy,
      matchedAt: next.matchState === 'matched' ? new Date() : null,
    })
    .where(
      and(
        eq(schema.ProcessorBalanceEntry.organizationId, organizationId),
        eq(schema.ProcessorBalanceEntry.id, entryId)
      )
    )
  await markPayoutForAssessment(organizationId, userId, entryId)
  return ok({ entryId, ...next })
}

/** Turn a suggestion into a match. The reason code is KEPT, so a report can still say what was accepted over. */
export async function acceptMatch(
  db: Database,
  input: { organizationId: string; entryId: string; userId: string }
): Promise<Result<MatchWriteResult, Error>> {
  const entry = await loadEntry(db, input.organizationId, input.entryId)
  if (!entry) return err(new NotFoundError('Processor entry not found'))
  if (entry.matchState !== 'suggested' || !entry.matchedMoneyTransactionId)
    return err(new ConflictError('This item has no suggested receipt to accept'))
  return write(db, input.organizationId, input.userId, input.entryId, {
    matchState: 'matched',
    matchedMoneyTransactionId: entry.matchedMoneyTransactionId,
    matchReason: entry.matchReason,
    matchedBy: input.userId,
  })
}

/**
 * A person vouches for a pair the matcher would not make.
 *
 * The item's existing reason code is kept, so the history says what the matcher
 * could not do; an item that had no code at all gets `manual`.
 */
export async function matchEntry(
  db: Database,
  input: {
    organizationId: string
    entryId: string
    moneyTransactionId: string
    userId: string
  }
): Promise<Result<MatchWriteResult, Error>> {
  const entry = await loadEntry(db, input.organizationId, input.entryId)
  if (!entry) return err(new NotFoundError('Processor entry not found'))
  const frozen = await readFrozenEntryIds(db, input.organizationId, [input.entryId])
  if (frozen.has(input.entryId))
    return err(
      new ConflictError('A posted payout entry already names this item. Reverse it to re-match.')
    )
  const [money] = await db
    .select({ id: schema.MoneyTransaction.id })
    .from(schema.MoneyTransaction)
    .where(
      and(
        eq(schema.MoneyTransaction.organizationId, input.organizationId),
        eq(schema.MoneyTransaction.id, input.moneyTransactionId)
      )
    )
    .limit(1)
  if (!money) return err(new NotFoundError('Customer movement not found'))
  return write(db, input.organizationId, input.userId, input.entryId, {
    matchState: 'matched',
    matchedMoneyTransactionId: input.moneyTransactionId,
    matchReason: entry.matchReason ?? 'manual',
    matchedBy: input.userId,
  })
}

/**
 * Clear a match back to `pending`, refused while a live posting names the item.
 *
 * The reason goes to null rather than to a guess: the next assessment writes the
 * code that is true then, and the row is still on the partial index meanwhile.
 */
export async function unmatchEntry(
  db: Database,
  input: { organizationId: string; entryId: string; userId: string }
): Promise<Result<MatchWriteResult, Error>> {
  const entry = await loadEntry(db, input.organizationId, input.entryId)
  if (!entry) return err(new NotFoundError('Processor entry not found'))
  const frozen = await readFrozenEntryIds(db, input.organizationId, [input.entryId])
  if (frozen.has(input.entryId))
    return err(
      new ConflictError('A posted payout entry already names this item. Reverse it to unmatch.')
    )
  return write(db, input.organizationId, input.userId, input.entryId, {
    matchState: 'pending',
    matchedMoneyTransactionId: null,
    matchReason: null,
    matchedBy: null,
  })
}
