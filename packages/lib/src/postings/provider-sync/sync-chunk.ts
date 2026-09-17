// packages/lib/src/postings/provider-sync/sync-chunk.ts
//
// One chunk of the walk: plan what the provider answered, write what the
// accountant authored, check our own copies against theirs, and converge.
//
// 🛑 Provider-INDEPENDENT, and that is the point of brief 55 §4.9. What differs
// per provider is how the next batch of lines is obtained and what the cursor
// is; everything from here down - grouping by `(txnType, txnId)`, the claim
// index, the one-author exclusion, the closed-month deferral and the unbalanced
// refusal - is written exactly once. Behind a per-provider call site, *"the new
// adapter forgot to exclude our own entries"* becomes a possible bug, and its
// symptom is a ledger that balances and is wrong.
//
// And one thing this file deliberately does NOT do: **it reopens nothing**
// (§7.2). An entry dated in a month our own lock has closed is normal - it is
// the accountant's December adjusting entry arriving in February, which is the
// case that motivated the whole feature - so it is REPORTED and a person with
// `ledgerControl` decides. Reopening from here would put the decision somewhere
// with no audit trail and no human.
//
// No permission checks here. The router asserts (docs/lib-module-guide.md §6).

import type { Database } from '@auxx/database'
import { isPeriodLocked, type PeriodLock, periodMonth } from '../periods'
import type {
  OurEntryCheck,
  ProviderLedger,
  ProviderLedgerEntry,
  ProviderSyncRange,
} from './client'
import { planProviderSync } from './plan'
import { readOurPostedEntries, readSyncedEntriesInRange } from './reads'
import { postProviderSyncEntry, reverseSyncedEntry } from './writes'

/** One entry the sync wants to write into a month our own lock has closed. */
export interface DeferredEntry {
  /** `YYYY-MM`. */
  month: string
  txnType: string
  txnId: string
  txnDate: string
  totalMinor: number
  /** `'write'` for a new entry of theirs, `'reverse'` for one that has vanished. */
  action: 'write' | 'reverse'
}

/** What one month-sized call found and did. */
export interface ProviderSyncChunkOutcome extends ProviderSyncRange {
  /** `Header.Option[NoReportData] === 'false'`. `false` is an empty company, not a failure. */
  hasData: boolean
  /** Entries of theirs newly written as `provider_sync` postings. */
  written: number
  /**
   * Entries of theirs the claim index already held. A SUCCESS and the ordinary
   * answer on a re-read - `periodKey` is their transaction id (§0.3).
   */
  alreadyPosted: number
  /** Entries we held whose id stopped appearing, backed out with a reversal (§7.1). */
  reversed: number
  /**
   * Entries carrying no money on either side - the Inventory Qty Adjust rows
   * §4.7 found. Skipped, and deliberately NOT a refusal: `buildEntry` will not
   * take an entry with no value, and there is nothing wrong with one.
   */
  zeroValue: number
  /** §7.2. Nothing here was written, and nothing was reopened to write it. */
  deferredToClosedMonths: DeferredEntry[]
  /** 🛑 Never written. An unbalanced entry breaks every statement that ties. */
  unbalanced: ProviderLedgerEntry[]
  /** §5.3. Our own entries, checked rather than written. REPORTED, never repaired. */
  ourChecks: OurEntryCheck[]
  /** One line per entry that could not be written, naming the entry and the reason. */
  refusals: string[]
}

export interface ChunkContext {
  ledger: ProviderLedger
  ourProviderEntryIds: ReadonlySet<string>
  accountMap: ReadonlyMap<string, string>
  glAccountIdByProviderId: ReadonlyMap<string, string>
  lock: PeriodLock
  providerId: string
  /** The provider company the ledger was read from; stamped on every row written (`G20`). */
  providerTenantId: string | null
  actorUserId?: string
}

export async function syncOneChunk(
  db: Database,
  organizationId: string,
  ctx: ChunkContext
): Promise<ProviderSyncChunkOutcome> {
  const { ledger, lock } = ctx
  const seenIds = new Set(ledger.lines.map((line) => line.txnId))

  // Our own copies, for §5.3: every exported entry whose id appears in this
  // chunk, plus every exported entry dated inside it. The second half is what
  // makes `'missing'` possible, and the range used is the one the provider
  // ECHOED - `assertRangeEcho` has already proved it is the one we asked for.
  const ourEntries = await readOurPostedEntries(db, organizationId, {
    from: ledger.from,
    to: ledger.to,
    providerEntryIds: [...seenIds],
  })
  if (ourEntries.isErr()) throw ourEntries.error

  const plan = planProviderSync({
    ledger,
    ourProviderEntryIds: ctx.ourProviderEntryIds,
    ourEntries: ourEntries.value,
    accountMap: ctx.accountMap,
  })
  if (plan.isErr()) throw plan.error

  const outcome: ProviderSyncChunkOutcome = {
    from: plan.value.from,
    to: plan.value.to,
    hasData: ledger.hasData,
    written: 0,
    alreadyPosted: 0,
    reversed: 0,
    zeroValue: 0,
    deferredToClosedMonths: [],
    unbalanced: plan.value.unbalanced,
    ourChecks: plan.value.ours,
    refusals: [],
  }

  for (const entry of plan.value.theirs) {
    if (entry.totalDebitMinor === 0 && entry.totalCreditMinor === 0) {
      outcome.zeroValue += 1
      continue
    }

    // ⚠️ §4.5's collision, made real by the write. `GlPosting_org_provider_entry_key`
    // is unique per org over `providerEntryId`, and this entry is about to be
    // stamped with a transaction id one of OUR entries already carries under a
    // different `txnType`. The exclusion was right to let it through - it is a
    // different transaction - but the two cannot share the column, so it is a
    // refusal naming both rather than a constraint violation nobody can read.
    if (ctx.ourProviderEntryIds.has(entry.txnId)) {
      outcome.refusals.push(
        `${entry.txnType} ${entry.txnId} dated ${entry.txnDate} carries a transaction id one of ` +
          'your own exported journal entries already holds. The two are different transactions ' +
          'on their side, but our books can only record one entry per provider id, so this one ' +
          'is left unwritten rather than guessed at.'
      )
      continue
    }

    // §7.2. Reported, never reopened.
    if (isPeriodLocked(entry.txnDate, lock)) {
      outcome.deferredToClosedMonths.push(deferred(entry, 'write'))
      continue
    }

    const written = await postProviderSyncEntry(db, organizationId, {
      entry,
      glAccountIdByProviderId: ctx.glAccountIdByProviderId,
      providerId: ctx.providerId,
      providerTenantId: ctx.providerTenantId,
      lock,
      actorUserId: ctx.actorUserId,
    })
    if (written.isErr()) {
      outcome.refusals.push(written.error.message)
      continue
    }
    if (written.value.status === 'already_posted') outcome.alreadyPosted += 1
    else outcome.written += 1
  }

  // ── §7.1, converge ────────────────────────────────────────────────────────
  // Anything we hold as `provider_sync` in this range whose id has stopped
  // appearing has been deleted on their side. A REVERSAL, never a delete.
  const held = await readSyncedEntriesInRange(db, organizationId, {
    from: ledger.from,
    to: ledger.to,
  })
  if (held.isErr()) throw held.error

  for (const row of held.value) {
    if (seenIds.has(row.providerEntryId)) continue
    if (isPeriodLocked(row.txnDate, lock)) {
      outcome.deferredToClosedMonths.push({
        month: periodMonth(row.txnDate),
        txnType: 'Journal Entry',
        txnId: row.providerEntryId,
        txnDate: row.txnDate,
        totalMinor: 0,
        action: 'reverse',
      })
      continue
    }
    const reversed = await reverseSyncedEntry(db, organizationId, {
      glPostingId: row.glPostingId,
      docNumber: row.docNumber,
      lock,
      actorUserId: ctx.actorUserId,
    })
    if (reversed.isErr()) outcome.refusals.push(reversed.error.message)
    else outcome.reversed += 1
  }

  return outcome
}

function deferred(entry: ProviderLedgerEntry, action: DeferredEntry['action']): DeferredEntry {
  return {
    month: periodMonth(entry.txnDate),
    txnType: entry.txnType,
    txnId: entry.txnId,
    txnDate: entry.txnDate,
    totalMinor: entry.totalDebitMinor,
    action,
  }
}
