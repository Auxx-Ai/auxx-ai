// packages/lib/src/accounting/mirror/translate.ts
//
// The second pass: turn the accountant's half of the mirror into our own rows
// (TARGET §1, §2). One `provider_sync` posting per `author: 'provider'` entry,
// subject `(provider_ledger_entry, <mirror id>)`.
//
// 🛑 **Only `'provider'` entries.** The mirror holds the objects we sent too;
// translating one would double it, both copies would balance, every statement
// would still tie, and nothing downstream could detect it. `author` is the
// guard and it is stamped once, by `writes.ts`.
//
// 🛑 **An unmapped provider account is a REFUSAL naming it**, never a guess and
// never a fallback account - `plan.ts`'s `resolveProviderSyncLines` is shared
// with the comparison for exactly that reason.
//
// Convergence is a REVERSAL, never a delete (`G4`): an entry that stopped
// appearing is `withdrawnAt` on the mirror, and its posting is reversed here, so
// a re-read that finds the transaction again translates it afresh.
//
// No permission checks here. The router asserts (docs/lib-module-guide.md §6).

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { buildEntry } from '../ledger/builders/entry'
import { isPeriodLocked, type PeriodLock, periodMonth } from '../ledger/periods/periods'
import { didLedgerAccept } from '../ledger/post/ledger-accepted'
import { postEntry } from '../ledger/post/post-entry'
import { reverseEntry } from '../ledger/post/reverse-entry'
import type { ProviderSyncRange } from './client'
import { PROVIDER_LEDGER_SOURCE_KIND, PROVIDER_SYNC_POSTING_TYPE } from './client'
import { guard } from './guard'
import { resolveProviderSyncLines } from './plan'
import { type MirrorEntry, readMirrorForTranslation } from './reads'
import type { DeferredEntry } from './sync-chunk'

const logger = createScopedLogger('postings:provider-sync')

export interface TranslateMirrorInput extends ProviderSyncRange {
  bookId: string
  /**
   * `providerAccountId -> glAccountId`, already checked for double claims by
   * `invertAccountMap`.
   */
  glAccountIdByProviderId: ReadonlyMap<string, string>
  providerId: string
  lock: PeriodLock
  actorUserId?: string
}

export interface TranslateMirrorOutcome {
  /** Mirror entries newly posted as `provider_sync`. */
  written: number
  /** Entries the claim already held - the ordinary answer on a re-read. */
  alreadyPosted: number
  /** Withdrawn entries whose posting was backed out. */
  reversed: number
  /** Entries carrying no money on either side. Skipped, never refused. */
  zeroValue: number
  /** §7.2. Nothing here was written, and nothing was reopened to write it. */
  deferredToClosedMonths: DeferredEntry[]
  /** One line per entry that could not be translated, naming it and the reason. */
  refusals: string[]
}

/**
 * Translate one range of the mirror into the ledger, and back out what has
 * vanished from it.
 *
 * Idempotent: the `GlPostingSource` claim on the mirror id makes a second run
 * answer `already_posted`, and a reversal has already released that claim, so a
 * transaction that comes back is translated as a fresh entry rather than
 * resurrected.
 */
export async function translateMirrorRange(
  db: Database,
  organizationId: string,
  input: TranslateMirrorInput
): Promise<Result<TranslateMirrorOutcome, Error>> {
  const read = await readMirrorForTranslation(db, organizationId, {
    bookId: input.bookId,
    from: input.from,
    to: input.to,
  })
  if (read.isErr()) return err(read.error)

  const outcome: TranslateMirrorOutcome = {
    written: 0,
    alreadyPosted: 0,
    reversed: 0,
    zeroValue: 0,
    deferredToClosedMonths: [],
    refusals: [],
  }

  for (const entry of read.value) {
    // §7.2. Reported, never reopened - the accountant's December adjusting
    // entry arriving in February is the case this whole feature exists for, and
    // reopening a month from here would put that decision somewhere with no
    // audit trail and no human.
    if (isPeriodLocked(entry.txnDate, input.lock)) {
      if (entry.withdrawn !== (entry.livePostingId === null))
        outcome.deferredToClosedMonths.push(deferred(entry, entry.withdrawn ? 'reverse' : 'write'))
      continue
    }

    if (entry.withdrawn) {
      if (!entry.livePostingId) continue
      const reversed = await reverseEntry(db, {
        organizationId,
        glPostingId: entry.livePostingId,
        actorUserId: input.actorUserId,
        lock: input.lock,
        memo: `Reversal of ${entry.liveDocNumber ?? entry.providerTxnId} - the transaction no longer appears in the provider's ledger`,
      })
      if (!didLedgerAccept(reversed)) {
        outcome.refusals.push(
          `${entry.providerTxnType} ${entry.providerTxnId} no longer appears in the provider's ` +
            `ledger but could not be reversed: ${reversed.error ?? reversed.status}.`
        )
        continue
      }
      outcome.reversed += 1
      continue
    }

    if (entry.livePostingId) {
      outcome.alreadyPosted += 1
      continue
    }

    // 🛑 Never translated, and silently: an unbalanced entry breaks every
    // statement that ties, and `planProviderSync` already reports it on the
    // chunk's `unbalanced` list. Refusing again here would say it twice.
    const totalDebitMinor = entry.lines.reduce((total, line) => total + line.debitMinor, 0)
    const totalCreditMinor = entry.lines.reduce((total, line) => total + line.creditMinor, 0)
    if (totalDebitMinor !== totalCreditMinor) continue

    const lines = resolveProviderSyncLines(
      {
        txnType: entry.providerTxnType,
        txnId: entry.providerTxnId,
        txnDate: entry.txnDate,
        docNumber: entry.docNumber,
        lines: entry.lines,
        totalDebitMinor,
        totalCreditMinor,
        balanced: true,
      },
      input.glAccountIdByProviderId
    )
    if (lines.isErr()) {
      outcome.refusals.push(lines.error.message)
      continue
    }
    // An entry that is zero on both sides is a non-event, not a refusal:
    // `buildEntry` will not take one, and the Inventory Qty Adjust opening rows
    // are four real transactions that look exactly like this (§4.7).
    if (lines.value.length === 0) {
      outcome.zeroValue += 1
      continue
    }

    const built = await guard(
      async () =>
        buildEntry({
          postingType: PROVIDER_SYNC_POSTING_TYPE,
          // Their transaction id, not a date: the doc-number keyspace keys on
          // it, and `lockKeyFor` evaluates the period against `txnDate` when the
          // key is not a date - the right month for this entry either way.
          periodKey: entry.providerTxnId,
          txnDate: entry.txnDate,
          lines: lines.value,
        }),
      'Failed to build a translated entry',
      { organizationId, txnId: entry.providerTxnId, txnType: entry.providerTxnType }
    )
    if (built.isErr()) {
      outcome.refusals.push(built.error.message)
      continue
    }

    const result = await postEntry(db, {
      organizationId,
      entry: built.value,
      actorUserId: input.actorUserId,
      memo:
        `Synced from ${input.providerId}: ${entry.providerTxnType}` +
        `${entry.docNumber ? ` ${entry.docNumber}` : ''} (transaction ${entry.providerTxnId})`,
      lock: input.lock,
      mode: 'post',
      sources: [
        { sourceKind: PROVIDER_LEDGER_SOURCE_KIND, sourceId: entry.id, linkRole: 'subject' },
      ],
    })

    if (!didLedgerAccept(result) || !result.glPostingId) {
      outcome.refusals.push(
        `${entry.providerTxnType} ${entry.providerTxnId} dated ${entry.txnDate} was not written: ` +
          `${result.error ?? result.status}.`
      )
      continue
    }
    if (result.status === 'already_posted') outcome.alreadyPosted += 1
    else outcome.written += 1
  }

  logger.info('Translated the provider ledger mirror', {
    organizationId,
    bookId: input.bookId,
    from: input.from,
    to: input.to,
    written: outcome.written,
    alreadyPosted: outcome.alreadyPosted,
    reversed: outcome.reversed,
    refusals: outcome.refusals.length,
  })

  return ok(outcome)
}

function deferred(entry: MirrorEntry, action: DeferredEntry['action']): DeferredEntry {
  return {
    month: periodMonth(entry.txnDate),
    txnType: entry.providerTxnType,
    txnId: entry.providerTxnId,
    txnDate: entry.txnDate,
    totalMinor: entry.lines.reduce((total, line) => total + line.debitMinor, 0),
    action,
  }
}
