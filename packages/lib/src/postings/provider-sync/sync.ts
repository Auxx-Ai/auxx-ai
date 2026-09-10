// packages/lib/src/postings/provider-sync/sync.ts
//
// The orchestration: walk the allowed range a month at a time, plan each chunk,
// write what the accountant authored, check what auxx authored, and converge.
//
// Three rules run this file and each of them is in the brief for a reason:
//
//  1. 🛑 **The cutover floor is asserted BEFORE the first call** (§5.4). It is
//     enforced by `planSyncChunks`, which refuses rather than clamps, so there
//     is no code path here that can reach a date below it.
//  2. **One month per call** (§4.8). Report endpoints do not paginate - Intuit
//     accepts `startposition` and `maxresults` and ignores them - so the date
//     range is the only lever, and a chunk that silently truncated is
//     indistinguishable from a quiet month. Chunk size is a safety property.
//  3. **Converge by re-reading, never by tracking changes** (§7.1). A re-read
//     of a range writes what is new (the claim index makes a repeat a no-op)
//     and REVERSES anything we hold as `provider_sync` in that range whose id
//     has stopped appearing. A reversal, never a delete.
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
import { createScopedLogger } from '@auxx/logger'
import type { Result } from 'neverthrow'
import { UnprocessableEntityError } from '../../errors'
import { getOrganizationSetting } from '../../settings/settings-service'
import { resolvePeriodLock } from '../period-lock'
import { isPeriodLocked, type PeriodLock, periodMonth } from '../periods'
import { NONE_PROVIDER_ID, resolveAccountingProvider } from '../provider'
import { OPENING_BASELINE_SETTING_KEYS } from '../setup-readiness'
import type {
  OurEntryCheck,
  ProviderLedger,
  ProviderLedgerEntry,
  ProviderSyncRange,
} from './client'
import { guard } from './guard'
import { recordProviderSyncedThrough } from './marker-writes'
import { invertAccountMap, planProviderSync } from './plan'
import { planSyncChunks } from './range'
import { readOurPostedEntries, readOurProviderEntryIds, readSyncedEntriesInRange } from './reads'
import { postProviderSyncEntry, reverseSyncedEntry } from './writes'

const logger = createScopedLogger('postings:provider-sync')

export interface SyncProviderLedgerInput {
  /**
   * The first date to read, `YYYY-MM-DD`. Omit for "everything the sync is
   * allowed to see", which starts at the month after `accounting.cutoffPeriod`.
   * 🛑 A value below that floor is a REFUSAL, never a clamp.
   */
  from?: string
  /** The last date to read, inclusive. Usually today in the book timezone. */
  to: string
  actorUserId?: string
}

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

export interface ProviderSyncOutcome {
  /** The whole range walked, as asked (after the floor was applied). */
  from: string
  to: string
  /** The provider actually read - `'quickbooks'`. Never assumed. */
  providerId: string
  /**
   * Their reporting currency, from the first chunk that carried one.
   *
   * ⚠️ Reported, not enforced. A currency mismatch WARNS here rather than
   * refusing (decision 12): brief 19's fill path refuses because it writes an
   * opening position, and this reads. The caller states it out loud.
   */
  currency: string | null
  chunks: ProviderSyncChunkOutcome[]
  written: number
  alreadyPosted: number
  reversed: number
  deferredToClosedMonths: DeferredEntry[]
  refusals: string[]
  /**
   * The end of the last range read CLEANLY - §7.3's "synced through" marker,
   * and what `accounting.providerSyncedThrough` now holds. A statement of an org
   * with a connected provider is incomplete until the sync has passed over its
   * month, and a statement that silently changes two months after a reader last
   * looked at it is a trust problem.
   *
   * 🛑 **It stops at the FIRST unclean chunk and does not resume past it.** A
   * marker that skipped over a failed month and carried on would claim that
   * month had been read, which is the one direction in which this value must
   * never be wrong. It is persisted chunk by chunk as the walk proceeds, so a
   * provider fault on month six keeps the five months already brought across.
   *
   * Null when not one chunk was clean; the stored value is then left exactly as
   * it was, because "this run read nothing new" is not "nothing has ever been
   * read".
   */
  syncedThrough: string | null
}

/**
 * Read the connected provider's general ledger from the cutover forward and
 * bring everything the accountant authored into our books.
 *
 * @throws nothing. Every refusal is an `err`.
 */
export async function syncProviderLedger(
  db: Database,
  organizationId: string,
  input: SyncProviderLedgerInput
): Promise<Result<ProviderSyncOutcome, Error>> {
  return guard(
    async () => {
      const cutoffPeriod = await readCutoffPeriod(organizationId)

      // 🛑 THE FLOOR, before anything is fetched. `planSyncChunks` refuses a
      // range that reaches into the period brief 19's opening entry summarises;
      // reading it back would import the balances that entry was derived from
      // and double the entire opening position.
      const chunks = planSyncChunks({ cutoffPeriod, from: input.from, to: input.to })
      if (chunks.isErr()) throw chunks.error

      const provider = await resolveAccountingProvider(organizationId)
      if (provider.id === NONE_PROVIDER_ID) {
        throw new UnprocessableEntityError(
          'No accounting system is connected, so there is no ledger to sync from.',
          { organizationId }
        )
      }

      const lock = await resolvePeriodLock(organizationId)

      // 🛑 The exclusion set, read ONCE for the whole walk. It cannot change
      // underneath us: the only rows this sync writes are `provider_sync` ones,
      // which `readOurProviderEntryIds` deliberately excludes.
      const ourIds = await readOurProviderEntryIds(db, organizationId)
      if (ourIds.isErr()) throw ourIds.error

      const mappings = await provider.listAccountMappings(organizationId)
      if (mappings.isErr()) throw mappings.error
      // Refuses a provider account claimed by two of ours, naming both. Done
      // once, before any write - the alternative is discovering it on entry 90.
      const inverted = invertAccountMap(mappings.value)
      if (inverted.isErr()) throw inverted.error

      const outcomes: ProviderSyncChunkOutcome[] = []
      let currency: string | null = null
      let syncedThrough: string | null = null
      // §7.3. Once one chunk comes back unclean the marker stops for the whole
      // run: a later clean month cannot vouch for an earlier broken one, and a
      // marker that hopped over it would claim it had been read.
      let blocked = false

      for (const chunk of chunks.value) {
        const read = await provider.readProviderLedger(organizationId, chunk)
        if (read.isErr()) throw read.error
        const ledger = read.value
        if (!ledger) {
          throw new UnprocessableEntityError(
            'No accounting system is connected, so there is no ledger to sync from.',
            { organizationId }
          )
        }
        assertRangeEcho(chunk, ledger)
        currency ??= ledger.currency

        const outcome = await syncOneChunk(db, organizationId, {
          ledger,
          ourProviderEntryIds: ourIds.value,
          accountMap: mappings.value,
          glAccountIdByProviderId: inverted.value,
          lock,
          providerId: provider.id,
          actorUserId: input.actorUserId,
        })
        outcomes.push(outcome)

        // 🛑 §7.3, and the whole point of the marker. It advances ONLY over a
        // chunk that actually succeeded, and the write happens here rather than
        // after the walk so that a provider fault on a later month keeps every
        // month already brought across.
        if (blocked || !isChunkClean(outcome)) {
          blocked = true
          continue
        }
        const marked = await recordProviderSyncedThrough(organizationId, outcome.to)
        if (marked.isErr()) {
          // Not a refusal of the sync: the entries are written and the ledger is
          // right. The marker is left where it was, which UNDERSTATES coverage -
          // the safe direction for a value whose job is to stop a statement
          // overstating its own completeness. `syncedThrough` is left behind too,
          // so the returned outcome matches what is actually stored.
          logger.warn('Synced a chunk but could not advance the marker', {
            organizationId,
            to: outcome.to,
            error: marked.error.message,
          })
          continue
        }
        syncedThrough = outcome.to
      }

      const result: ProviderSyncOutcome = {
        from: chunks.value[0]!.from,
        to: input.to,
        providerId: provider.id,
        currency,
        chunks: outcomes,
        written: sum(outcomes, (o) => o.written),
        alreadyPosted: sum(outcomes, (o) => o.alreadyPosted),
        reversed: sum(outcomes, (o) => o.reversed),
        deferredToClosedMonths: outcomes.flatMap((o) => o.deferredToClosedMonths),
        refusals: outcomes.flatMap((o) => o.refusals),
        syncedThrough,
      }

      logger.info("Synced the accounting provider's general ledger", {
        organizationId,
        providerId: provider.id,
        from: result.from,
        to: result.to,
        chunks: outcomes.length,
        written: result.written,
        alreadyPosted: result.alreadyPosted,
        reversed: result.reversed,
        deferred: result.deferredToClosedMonths.length,
        refusals: result.refusals.length,
      })

      return result
    },
    "Failed to sync the accounting provider's general ledger",
    { organizationId, from: input.from ?? '', to: input.to }
  )
}

interface ChunkContext {
  ledger: ProviderLedger
  ourProviderEntryIds: ReadonlySet<string>
  accountMap: ReadonlyMap<string, string>
  glAccountIdByProviderId: ReadonlyMap<string, string>
  lock: PeriodLock
  providerId: string
  actorUserId?: string
}

async function syncOneChunk(
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

/**
 * 🛑 The range the provider ECHOED must be the range we asked for.
 *
 * §4.6 verified that `/reports/GeneralLedger` honours `start_date` and
 * `end_date` exactly - unlike `BalanceSheet`, where `as_of` is silently ignored
 * and `end_date` alone falls back to "this calendar year-to-date". The
 * assertion is one line and the failure it catches is severe in both
 * directions: a NARROWER echo means the next chunk starts after a period
 * nothing read, leaving a silent hole in the ledger, and a WIDER one means
 * §5.3's `'missing'` test is applied over dates this call did not really cover.
 */
function assertRangeEcho(requested: ProviderSyncRange, ledger: ProviderLedger): void {
  if (ledger.from === requested.from && ledger.to === requested.to) return
  throw new UnprocessableEntityError(
    `The accounting provider was asked for ${requested.from}..${requested.to} and answered for ` +
      `${ledger.from}..${ledger.to}. A chunk labelled with a range it does not cover would leave ` +
      'a hole in the ledger that nothing downstream can see.',
    { requestedFrom: requested.from, requestedTo: requested.to, from: ledger.from, to: ledger.to }
  )
}

/**
 * Did this chunk bring everything across that it found?
 *
 * Two things say no, and both mean an entry that exists on their side did not
 * reach our books: a `refusal` (a write that was declined, or an id collision)
 * and an `unbalanced` entry (never written, because an unbalanced entry breaks
 * every statement that ties).
 *
 * 🛑 `deferredToClosedMonths` deliberately does NOT block, and the reason is
 * that it is the ONE incompleteness a person already knows about. §7.2 makes a
 * deferral a reported decision waiting on someone with `ledgerControl`, and it
 * persists until they reopen the month - so blocking on it would pin the marker
 * to the month before the deferral forever, on the exact org the feature was
 * built for. The deferral list is its own surface; this flag is about faults.
 *
 * `hasData: false` is not a fault either - an empty company is a real answer,
 * and a month in which the accountant posted nothing is the ordinary case.
 */
function isChunkClean(outcome: ProviderSyncChunkOutcome): boolean {
  return outcome.refusals.length === 0 && outcome.unbalanced.length === 0
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

/**
 * `accounting.cutoffPeriod`, or a refusal.
 *
 * There is no default and there must not be one: the cutoff is what places the
 * floor, and a sync that guessed it would read back the opening period.
 */
async function readCutoffPeriod(organizationId: string): Promise<string> {
  const raw = await getOrganizationSetting({
    organizationId,
    key: OPENING_BASELINE_SETTING_KEYS.cutoffPeriod,
  })
  const cutoffPeriod = typeof raw === 'string' ? raw.trim() : ''
  if (cutoffPeriod.length === 0) {
    throw new UnprocessableEntityError(
      'The accounting cutoff month is not set, so the provider sync has no floor to start from. ' +
        'Finish accounting setup first - everything up to the end of the cutoff month is the ' +
        'opening entry, and reading it back would double it.',
      { organizationId, setting: OPENING_BASELINE_SETTING_KEYS.cutoffPeriod }
    )
  }
  return cutoffPeriod
}

function sum<T>(items: readonly T[], of: (item: T) => number): number {
  return items.reduce((total, item) => total + of(item), 0)
}
