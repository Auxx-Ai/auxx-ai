// packages/lib/src/accounting/mirror/sync-source.ts
//
// The inbound sync as a `SyncSource` (brief 55 §4). One slice is one batch of
// the connected provider's general ledger: fetch it through the slicer, plan it,
// write what the accountant authored, and report a `SliceCommit`.
//
// 🔑 **The run-scoped values are resolved ONCE, in the factory, and held for the
// whole chain** (§4.7): the provider, the company, the account map and its
// inversion, the exclusion set and the period lock. `readOurProviderEntryIds`'
// correctness argument - *"it cannot change underneath us"* - depends on that,
// because the only rows this sync writes are `provider_sync` ones, which that
// read deliberately excludes.
//
// 🛑 **The cutover floor is asserted in the factory, by `planSyncChunks`, BEFORE
// the first fetch** (§6). It refuses rather than clamps, and it must never
// migrate into `fetchSlice` or into a slicer, where per-provider code could
// widen it. A slice is handed a range that has already been proved legal.
//
// ## What the `SliceCommit` replaces
//
// Today's `blocked` boolean carried two different failures at once: a provider
// fault and an entry that will never balance both froze the marker and kept the
// walk reading and writing every later month for nothing (§4.2). Here they are
// separate verdicts, and the core acts on each correctly:
//
// | what happened | commit | what the runner does |
// | --- | --- | --- |
// | clean chunk | `all` | advance the cursor, advance the marker |
// | provider fault, 429, timeout | `partial-retriable` | HOLD the cursor; the next slice re-reads the same month |
// | a refusal, or an entry that will never balance | `partial-permanent` | advance PAST it, feed `failed` and the error sample |
//
// 🛑 The MARKER is not the cursor and does not follow it. Once one chunk of a
// run comes back unclean the marker stops for that run: `accounting.
// providerSyncedThrough` means "this range has been read completely", so a later
// clean month must not vouch for the broken one before it. The cursor advances;
// the marker does not.
//
// No permission checks here. The router asserts (docs/lib-module-guide.md §6).

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { UnprocessableEntityError } from '../../errors'
import { getOrganizationSetting } from '../../settings/settings-service'
import type {
  SliceResult,
  SyncRunErrorSample,
  SyncSliceCtx,
  SyncSource,
} from '../../sync-core/contracts'
import { resolvePeriodLock } from '../ledger/periods/period-lock'
import type { PeriodLock } from '../ledger/periods/periods'
import { OPENING_BASELINE_SETTING_KEYS } from '../ledger/setup/setup-readiness'
import { readActiveBookCompanyId } from '../providers/book-connections'
import { NONE_PROVIDER_ID, resolveAccountingProvider } from '../providers/provider'
import type { ProviderLedgerSlicer, ProviderSyncRange } from './client'
import { recordProviderSyncedThrough } from './marker-writes'
import { invertAccountMap } from './plan'
import { planSyncChunks } from './range'
import { readActiveBookId, readOurDocNumbers, readOurProviderEntryIds } from './reads'
import { type ProviderSyncChunkOutcome, syncOneChunk } from './sync-chunk'
import type { OurLedgerIdentity } from './writes'

const logger = createScopedLogger('postings:provider-sync')

/** What one run of the walk has accumulated so far. */
export interface ProviderLedgerSyncProgress {
  /** The first date of the planned range, after the floor was applied. */
  from: string
  /** The provider actually read. Never assumed. */
  providerId: string
  /** Their reporting currency, from the first batch that carried one. */
  currency: string | null
  chunks: ProviderSyncChunkOutcome[]
  /** The end of the last range read CLEANLY, or null. See the header. */
  syncedThrough: string | null
}

export interface CreateProviderLedgerSyncSourceInput {
  /** `YYYY-MM-DD`. Omit for "everything the sync is allowed to see". */
  from?: string
  /** `YYYY-MM-DD`, inclusive. */
  to: string
  actorUserId?: string
  /**
   * 🛑 Did an EARLIER slice of this same run already come back unclean?
   *
   * A driver that rebuilds the source per slice - the worker does, once per job
   * - must load this from durable state and pass it, or the flag resets and a
   * clean month vouches for a broken earlier one (§7.3).
   */
  markerBlocked?: boolean
  /**
   * Called once, at the moment the flag flips, so the same driver can persist
   * it. 🛑 A throw is deliberately not swallowed: if the block cannot be
   * recorded, the next slice must not be allowed to advance the marker.
   */
  onMarkerBlocked?: () => Promise<void>
}

class ProviderLedgerSyncSource implements SyncSource {
  readonly id: string
  readonly throttleKey: string

  private readonly chunks: ProviderSyncChunkOutcome[] = []
  private currency: string | null = null
  private syncedThrough: string | null = null
  /**
   * 🛑 Set by the first unclean chunk and never cleared for this run. The marker
   * may not hop over a month that did not come across completely.
   *
   * Seeded from the caller, because the worker rebuilds this source once per
   * slice and in-memory state alone would reset between jobs (§7.3).
   */
  private markerBlocked: boolean
  /**
   * The fault behind the last `partial-retriable` verdict, for a driver that has
   * no queue to re-enqueue onto and must surface it instead (`syncProviderLedger`).
   */
  private lastFault: Error | null = null

  constructor(
    private readonly db: Database,
    private readonly organizationId: string,
    private readonly deps: {
      range: ProviderSyncRange
      slicer: ProviderLedgerSlicer
      providerId: string
      providerTenantId: string | null
      bookId: string
      lock: PeriodLock
      ours: OurLedgerIdentity
      accountMap: ReadonlyMap<string, string>
      glAccountIdByProviderId: ReadonlyMap<string, string>
      actorUserId?: string
      markerBlocked?: boolean
      onMarkerBlocked?: () => Promise<void>
    }
  ) {
    this.markerBlocked = deps.markerBlocked === true
    this.id = `provider-sync:${organizationId}:${deps.providerId}`
    // §3.3's `connection:operation` bucket. The provider COMPANY stands in for a
    // connection id: it is what identifies the upstream account whose rate limit
    // is being spent, and it is already resolved once per run for `G20`.
    this.throttleKey = `${deps.providerTenantId ?? organizationId}:general-ledger`
  }

  /** What the walk has brought across so far. Safe to read after any slice. */
  progress(): ProviderLedgerSyncProgress {
    return {
      from: this.deps.range.from,
      providerId: this.deps.providerId,
      currency: this.currency,
      chunks: [...this.chunks],
      syncedThrough: this.syncedThrough,
    }
  }

  /** The fault behind the last `partial-retriable`, or null. */
  lastRetriableFault(): Error | null {
    return this.lastFault
  }

  /** Has this run's marker stopped? What a per-slice driver must carry forward. */
  isMarkerBlocked(): boolean {
    return this.markerBlocked
  }

  async fetchSlice(ctx: SyncSliceCtx): Promise<SliceResult> {
    // No cursor ⇒ the first batch of the planned range (§4.7.1).
    const cursor = ctx.cursor ?? this.deps.slicer.firstCursor(this.deps.range)

    const read = await ctx.throttle.run(() =>
      this.deps.slicer.fetchBatch(this.organizationId, cursor)
    )
    if (read.isErr()) {
      // A provider fault, a 429 or a timeout. HOLD the cursor: the next slice
      // re-reads the same month, so no ground is lost and nothing is skipped.
      this.lastFault = read.error
      logger.warn('A provider ledger batch failed - holding the cursor', {
        organizationId: this.organizationId,
        cursor: cursor.value,
        error: read.error.message,
      })
      return {
        recordsProcessed: 0,
        pagesProcessed: 1,
        hasMore: true,
        commit: 'partial-retriable',
        counters: { failed: 1 },
        errorSample: [{ externalId: cursor.value, error: read.error.message }],
      }
    }

    const batch = read.value
    if (!batch) {
      throw new UnprocessableEntityError(
        'No accounting system is connected, so there is no ledger to sync from.',
        { organizationId: this.organizationId }
      )
    }

    const { ledger } = batch
    this.currency ??= ledger.currency

    const outcome = await syncOneChunk(this.db, this.organizationId, {
      ledger,
      bookId: this.deps.bookId,
      ours: this.deps.ours,
      accountMap: this.deps.accountMap,
      glAccountIdByProviderId: this.deps.glAccountIdByProviderId,
      lock: this.deps.lock,
      providerId: this.deps.providerId,
      actorUserId: this.deps.actorUserId,
    })
    this.chunks.push(outcome)

    const clean = isChunkClean(outcome)
    if (!clean && !this.markerBlocked) {
      this.markerBlocked = true
      // Persisted BEFORE this slice returns, so the next job - which builds a
      // fresh source - loads the block rather than a cleared flag.
      await this.deps.onMarkerBlocked?.()
    }

    // 🛑 §7.3, and the whole point of the marker. It advances ONLY over a chunk
    // that actually succeeded, and the write happens here rather than after the
    // walk so that a provider fault on a later month keeps every month already
    // brought across.
    if (clean && !this.markerBlocked) {
      const marked = await recordProviderSyncedThrough(this.organizationId, outcome.to)
      if (marked.isErr()) {
        // Not a refusal of the sync: the entries are written and the ledger is
        // right. The marker is left where it was, which UNDERSTATES coverage -
        // the safe direction for a value whose job is to stop a statement
        // overstating its own completeness. `syncedThrough` is left behind too,
        // so the reported outcome matches what is actually stored.
        logger.warn('Synced a chunk but could not advance the marker', {
          organizationId: this.organizationId,
          to: outcome.to,
          error: marked.error.message,
        })
      } else {
        this.syncedThrough = outcome.to
      }
    }

    return {
      // One provider ledger LINE is one record here - the unit the progress UI
      // counts, and the only one that is comparable across providers.
      recordsProcessed: ledger.lines.length,
      pagesProcessed: 1,
      hasMore: batch.hasMore,
      nextCursor: batch.nextCursor,
      commit: clean ? 'all' : 'partial-permanent',
      counters: {
        fetched: ledger.lines.length,
        created: outcome.written,
        skipped: outcome.alreadyPosted + outcome.zeroValue,
        failed: outcome.refusals.length + outcome.unbalanced.length,
        reversed: outcome.reversed,
        deferred: outcome.deferredToClosedMonths.length,
      },
      errorSample: sliceSample(outcome),
    }
  }

  /**
   * TODO(accounting): the reversal pass moves here - brief 55 unit 6, §4.3.
   *
   * A no-op for now, on purpose: convergence still runs per chunk inside
   * `syncOneChunk`. `runSyncSlice` fires this once, only when the walk is
   * exhausted, which is the gate a reversal needs - a reversal driven from a
   * partial read would back out entries that simply had not been reached yet.
   */
  async finalizeBackfill(): Promise<void> {
    return
  }
}

export type { ProviderLedgerSyncSource }

/**
 * Resolve everything one walk needs, once, and hand back the source.
 *
 * @throws an `AuxxError` when the cutoff is unset, the requested range is below
 *   the cutover floor, nothing is connected, or the account map is ambiguous.
 *   Every one of those is a refusal BEFORE the first fetch, by design.
 */
export async function createProviderLedgerSyncSource(
  db: Database,
  organizationId: string,
  input: CreateProviderLedgerSyncSourceInput
): Promise<ProviderLedgerSyncSource> {
  const cutoffPeriod = await readCutoffPeriod(organizationId)

  // 🛑 THE FLOOR, before anything is fetched. `planSyncChunks` refuses a range
  // that reaches into the period brief 19's opening entry summarises; reading it
  // back would import the balances that entry was derived from and double the
  // entire opening position.
  const chunks = planSyncChunks({ cutoffPeriod, from: input.from, to: input.to })
  if (chunks.isErr()) throw chunks.error
  const range: ProviderSyncRange = { from: chunks.value[0]!.from, to: input.to }

  const provider = await resolveAccountingProvider(organizationId)
  if (provider.id === NONE_PROVIDER_ID) {
    throw new UnprocessableEntityError(
      'No accounting system is connected, so there is no ledger to sync from.',
      { organizationId }
    )
  }
  // Resolved ONCE per run: a walk reads one connected book, and the book is what
  // scopes every mirror row it writes.
  const book = await readActiveBookId(db, organizationId)
  if (book.isErr()) throw book.error
  if (!book.value) {
    throw new UnprocessableEntityError(
      'No accounting book is connected, so there is no ledger to mirror.',
      { organizationId }
    )
  }

  const lock = await resolvePeriodLock(organizationId)

  // 🛑 The exclusion set, read ONCE for the whole walk. It cannot change
  // underneath us: the only rows this sync writes are `provider_sync` ones,
  // which `readOurProviderEntryIds` deliberately excludes.
  const ourIds = await readOurProviderEntryIds(db, organizationId)
  if (ourIds.isErr()) throw ourIds.error
  const ourDocNumbers = await readOurDocNumbers(db, organizationId)
  if (ourDocNumbers.isErr()) throw ourDocNumbers.error

  const mappings = await provider.listAccountMappings(organizationId)
  if (mappings.isErr()) throw mappings.error
  // Refuses a provider account claimed by two of ours, naming both. Done once,
  // before any write - the alternative is discovering it on entry 90.
  const inverted = invertAccountMap(mappings.value)
  if (inverted.isErr()) throw inverted.error

  return new ProviderLedgerSyncSource(db, organizationId, {
    range,
    slicer: provider.ledgerSlicer(),
    providerId: provider.id,
    providerTenantId: await readActiveBookCompanyId(db, organizationId),
    bookId: book.value,
    lock,
    ours: { providerEntryIds: ourIds.value, docNumbers: ourDocNumbers.value },
    accountMap: mappings.value,
    glAccountIdByProviderId: inverted.value,
    actorUserId: input.actorUserId,
    markerBlocked: input.markerBlocked,
    onMarkerBlocked: input.onMarkerBlocked,
  })
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

/**
 * Everything this chunk found that a person has to look at, for the run's blob.
 *
 * 🛑 `errorSample` is the ONLY per-entry channel the core carries from a slice to
 * the run (`SliceResult` -> `SliceLedgerEntry` -> `recordSliceInBlob`); counters
 * cannot name an entry. So the two things that are not faults ride it too, and
 * `tier` is what tells them apart:
 *
 * - `'diverged'` - our own entry, edited or deleted in the provider (§5.3).
 *   REPORTED, never repaired. Nothing failed, which is exactly why it would
 *   otherwise be invisible.
 * - `'skipped'` - deferred to a closed month (§7.2). A decision waiting on
 *   somebody with `ledgerControl`, and deliberately not a fault - which is also
 *   why it is the one tier `derivedStatus` does not read as partial.
 */
function sliceSample(outcome: ProviderSyncChunkOutcome): SyncRunErrorSample[] | undefined {
  const samples: SyncRunErrorSample[] = [
    ...outcome.unbalanced.map((entry) => ({
      externalId: entry.txnId,
      error: `${entry.txnType} ${entry.txnId} dated ${entry.txnDate} does not balance as read.`,
      tier: 'invalid' as const,
    })),
    ...outcome.refusals.map((refusal) => ({
      externalId: `${outcome.from}..${outcome.to}`,
      error: refusal,
      tier: 'rejected' as const,
    })),
    // ⚠️ `'matches'` is the ordinary case and carries nothing to report.
    ...outcome.ourChecks.flatMap((check) =>
      check.verdict === 'matches'
        ? []
        : [
            {
              externalId: check.docNumber,
              error: `${DIVERGENCE_PREFIX[check.verdict]} ${check.differences.join(' ')}`.trim(),
              tier: 'diverged' as const,
            },
          ]
    ),
    ...outcome.deferredToClosedMonths.map((entry) => ({
      externalId: entry.month,
      error:
        `${entry.month} is closed, so ${entry.txnType} ${entry.txnId} dated ${entry.txnDate} was ` +
        `${entry.action === 'write' ? 'not written' : 'not reversed'}. Reopen the month and run ` +
        'the sync again.',
      tier: 'skipped' as const,
    })),
  ]
  return samples.length > 0 ? samples : undefined
}

/** The verdict, said once at the head of the line, so the panel need not parse it. */
const DIVERGENCE_PREFIX: Record<'edited' | 'missing', string> = {
  edited: 'Edited in the provider since we exported it.',
  missing: 'Gone from the provider, but still in our books.',
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
