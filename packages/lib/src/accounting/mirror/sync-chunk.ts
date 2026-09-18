// packages/lib/src/accounting/mirror/sync-chunk.ts
//
// One chunk of the walk: plan what the provider answered, write it into the
// mirror verbatim, check our own copies against theirs, and translate the
// accountant's half into our books.
//
// 🛑 Provider-INDEPENDENT, and that is the point of brief 55 §4.9. What differs
// per provider is how the next batch of lines is obtained and what the cursor
// is; everything from here down - grouping by `(txnType, txnId)`, the mirror's
// unique key, the authorship stamp, the closed-month deferral and the unbalanced
// refusal - is written exactly once.
//
// And one thing this file deliberately does NOT do: **it reopens nothing**
// (§7.2). An entry dated in a month our own lock has closed is normal - it is
// the accountant's December adjusting entry arriving in February - so it is
// REPORTED and a person with `ledgerControl` decides.
//
// No permission checks here. The router asserts (docs/lib-module-guide.md §6).

import type { Database } from '@auxx/database'
import type { PeriodLock } from '../../postings/periods'
import type {
  OurEntryCheck,
  ProviderLedger,
  ProviderLedgerEntry,
  ProviderSyncRange,
} from './client'
import { groupProviderLedgerEntries, planProviderSync } from './plan'
import { readOurPostedEntries } from './reads'
import { translateMirrorRange } from './translate'
import { type OurLedgerIdentity, upsertMirrorChunk } from './writes'

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
  /** Entries copied into the mirror, ours and theirs alike (TARGET §2). */
  mirrored: number
  /** Mirror entries in the range that stopped appearing, stamped `withdrawnAt`. */
  withdrawn: number
  /** Entries of theirs newly written as `provider_sync` postings. */
  written: number
  /**
   * Entries of theirs our books already carry. A SUCCESS and the ordinary
   * answer on a re-read - the claim is on the mirror row's id.
   */
  alreadyPosted: number
  /** Postings backed out because their mirror entry was withdrawn (§7.1). */
  reversed: number
  /**
   * Entries carrying no money on either side - the Inventory Qty Adjust rows
   * §4.7 found. Skipped, and deliberately NOT a refusal.
   */
  zeroValue: number
  /** §7.2. Nothing here was written, and nothing was reopened to write it. */
  deferredToClosedMonths: DeferredEntry[]
  /** 🛑 Never translated. An unbalanced entry breaks every statement that ties. */
  unbalanced: ProviderLedgerEntry[]
  /** §5.3. Our own entries, checked rather than written. REPORTED, never repaired. */
  ourChecks: OurEntryCheck[]
  /** One line per entry that could not be written, naming the entry and the reason. */
  refusals: string[]
}

export interface ChunkContext {
  ledger: ProviderLedger
  /** The `ExternalAccountingBook` this chunk was read from. */
  bookId: string
  ours: OurLedgerIdentity
  accountMap: ReadonlyMap<string, string>
  glAccountIdByProviderId: ReadonlyMap<string, string>
  lock: PeriodLock
  providerId: string
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
  // chunk, plus every exported entry dated inside it. The range used is the one
  // the provider ECHOED - `assertRangeEcho` has already proved it is ours.
  const ourEntries = await readOurPostedEntries(db, organizationId, {
    from: ledger.from,
    to: ledger.to,
    providerEntryIds: [...seenIds],
  })
  if (ourEntries.isErr()) throw ourEntries.error

  const plan = planProviderSync({
    ledger,
    ourProviderEntryIds: ctx.ours.providerEntryIds,
    ourEntries: ourEntries.value,
    accountMap: ctx.accountMap,
  })
  if (plan.isErr()) throw plan.error

  // 🛑 The MIRROR takes everything the chunk carried, ours and theirs, balanced
  // and not: it is a copy of what the provider holds, so filtering it here would
  // make "what does the provider hold" unanswerable, and the export's readback
  // reads exactly the rows we sent. What is not TRANSLATED is decided later, by
  // `author` and by the unbalanced list.
  const mirrored = await upsertMirrorChunk(db, organizationId, {
    bookId: ctx.bookId,
    from: ledger.from,
    to: ledger.to,
    entries: groupProviderLedgerEntries(ledger.lines),
    ours: ctx.ours,
  })
  if (mirrored.isErr()) throw mirrored.error

  const translated = await translateMirrorRange(db, organizationId, {
    bookId: ctx.bookId,
    from: ledger.from,
    to: ledger.to,
    glAccountIdByProviderId: ctx.glAccountIdByProviderId,
    providerId: ctx.providerId,
    lock,
    actorUserId: ctx.actorUserId,
  })
  if (translated.isErr()) throw translated.error

  return {
    from: plan.value.from,
    to: plan.value.to,
    hasData: ledger.hasData,
    mirrored: mirrored.value.mirrored,
    withdrawn: mirrored.value.withdrawn,
    written: translated.value.written,
    alreadyPosted: translated.value.alreadyPosted,
    reversed: translated.value.reversed,
    zeroValue: translated.value.zeroValue,
    deferredToClosedMonths: translated.value.deferredToClosedMonths,
    unbalanced: plan.value.unbalanced,
    ourChecks: plan.value.ours,
    refusals: translated.value.refusals,
  }
}
