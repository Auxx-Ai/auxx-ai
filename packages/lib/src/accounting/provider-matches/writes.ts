// packages/lib/src/accounting/provider-matches/writes.ts
// The person's answers to a suggestion, and the one write the matcher shares with them.
// No permission checks: the router asserts (docs/lib-module-guide.md §6).

import { type Database, schema } from '@auxx/database'
import { and, eq, isNull } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { BadRequestError, ConflictError, NotFoundError } from '../../errors'
import { didLedgerAccept } from '../ledger/post/ledger-accepted'
import { reverseEntry } from '../ledger/post/reverse-entry'
import { findLiveSubjectPosting } from '../ledger/reads/list-postings'
import { upsertWorkItem } from '../work-items/write'
import type { MatchState, ProviderMatchKind, ProviderMatchReason } from './client'

export interface ProviderMatchWrite {
  state: MatchState | null
  reason: ProviderMatchReason
  kind?: ProviderMatchKind | null
  matchedId?: string | null
  matchedBy?: string | null
}

export async function writeProviderMatch(
  db: Database,
  organizationId: string,
  entryId: string,
  next: ProviderMatchWrite
): Promise<void> {
  await db
    .update(schema.ProviderLedgerEntry)
    .set({
      matchState: next.state,
      matchReason: next.reason,
      matchedKind: next.kind ?? null,
      matchedId: next.matchedId ?? null,
      matchedBy: next.matchedBy ?? null,
      matchedAt: next.state === 'matched' ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.ProviderLedgerEntry.organizationId, organizationId),
        eq(schema.ProviderLedgerEntry.id, entryId)
      )
    )
}

async function readEntry(db: Database, organizationId: string, entryId: string) {
  const [entry] = await db
    .select()
    .from(schema.ProviderLedgerEntry)
    .where(
      and(
        eq(schema.ProviderLedgerEntry.organizationId, organizationId),
        eq(schema.ProviderLedgerEntry.id, entryId)
      )
    )
    .limit(1)
  return entry ?? null
}

export interface ProviderMatchActionInput {
  organizationId: string
  entryId: string
  actorUserId: string
}

/**
 * Accept a suggestion (102 D1). Ours unsent → keep theirs: our receipt is marked adopted, then
 * its entry reversed. Ours sent → no ledger change; a work item asks for theirs to be deleted.
 * A payout is always the second: ours carries the fee split a feed *Add* does not. Their expense
 * paying our bill → no ledger change; a work item asks for it to be linked to the bill there, and
 * the Bill Payment that replaces it adopts by identity on the next sync.
 */
export async function acceptProviderMatch(
  db: Database,
  input: ProviderMatchActionInput
): Promise<Result<void, Error>> {
  const entry = await readEntry(db, input.organizationId, input.entryId)
  if (!entry) return err(new NotFoundError('That provider transaction does not exist'))
  if (entry.matchState !== 'suggested' || !entry.matchedId || !entry.matchedKind)
    return err(new ConflictError('Only a suggested match can be accepted'))
  const reason = entry.matchReason as ProviderMatchReason

  if (entry.matchedKind === 'vendor_bill' && reason === 'pays_bill') {
    const recorded = await upsertWorkItem(db, input.organizationId, {
      sourceKind: 'provider_ledger_entry',
      sourceId: entry.id,
      stage: 'post',
      reasonCode: 'PROVIDER_BILL_LEFT_OPEN',
      externalRef: `${entry.providerTxnType} ${entry.docNumber ?? entry.providerTxnId}`,
      detail: { matchedKind: 'vendor_bill', matchedId: entry.matchedId },
    })
    if (recorded.isErr()) return err(recorded.error)
    await writeProviderMatch(db, input.organizationId, entry.id, {
      state: 'matched',
      reason,
      kind: 'vendor_bill',
      matchedId: entry.matchedId,
      matchedBy: input.actorUserId,
    })
    return ok(undefined)
  }

  if (entry.matchedKind === 'money_transaction' && reason === 'ours_unsent') {
    // The marker first: the reversal releases the claim, and an unmarked movement with no
    // live posting is exactly what the sweep re-posts.
    const marked = await db
      .update(schema.MoneyTransaction)
      .set({ providerLedgerEntryId: entry.id })
      .where(
        and(
          eq(schema.MoneyTransaction.organizationId, input.organizationId),
          eq(schema.MoneyTransaction.id, entry.matchedId),
          isNull(schema.MoneyTransaction.providerLedgerEntryId)
        )
      )
      .returning({ id: schema.MoneyTransaction.id })
    if (marked.length === 0)
      return err(new ConflictError('That receipt is already matched to another transaction'))
    const live = await findLiveSubjectPosting(db, {
      organizationId: input.organizationId,
      sourceKind: 'money_transaction',
      sourceId: entry.matchedId,
    })
    if (live.isErr()) return err(live.error)
    if (live.value) {
      const reversed = await reverseEntry(db, {
        organizationId: input.organizationId,
        glPostingId: live.value.id,
        actorUserId: input.actorUserId,
        memo: `Reversed: the connected books hold this payment as ${entry.providerTxnType} ${entry.docNumber ?? entry.providerTxnId}`,
      })
      if (!didLedgerAccept(reversed))
        return err(new BadRequestError(reversed.error ?? 'Our receipt could not be reversed'))
    }
  } else {
    const recorded = await upsertWorkItem(db, input.organizationId, {
      sourceKind: 'provider_ledger_entry',
      sourceId: entry.id,
      stage: 'post',
      reasonCode: 'PROVIDER_DUPLICATE',
      externalRef: `${entry.providerTxnType} ${entry.docNumber ?? entry.providerTxnId}`,
      detail: { matchedKind: entry.matchedKind, matchedId: entry.matchedId },
    })
    if (recorded.isErr()) return err(recorded.error)
  }

  await writeProviderMatch(db, input.organizationId, entry.id, {
    state: 'matched',
    reason,
    kind: entry.matchedKind as ProviderMatchKind,
    matchedId: entry.matchedId,
    matchedBy: input.actorUserId,
  })
  return ok(undefined)
}

/** Reject a suggestion or a pending candidate search; the matcher never offers it again. */
export async function dismissProviderMatch(
  db: Database,
  input: ProviderMatchActionInput
): Promise<Result<void, Error>> {
  const entry = await readEntry(db, input.organizationId, input.entryId)
  if (!entry) return err(new NotFoundError('That provider transaction does not exist'))
  if (entry.matchState === 'matched')
    return err(new ConflictError('A settled match is undone from the record it names, not here'))
  await writeProviderMatch(db, input.organizationId, entry.id, {
    state: null,
    reason: 'dismissed',
    matchedBy: input.actorUserId,
  })
  return ok(undefined)
}
