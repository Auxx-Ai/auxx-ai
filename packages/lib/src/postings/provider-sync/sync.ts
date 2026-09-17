// packages/lib/src/postings/provider-sync/sync.ts
//
// The orchestration: drive `ProviderLedgerSyncSource` over the allowed range
// and report what one walk brought across.
//
// 🔑 **The walk itself lives in `sync-source.ts` now** (brief 55 §4.7). One
// slice is one batch of the provider's ledger, and the slicing strategy is the
// provider's - QuickBooks by month, Xero by `JournalNumber` offset. The loop
// below is the in-process stand-in for the core's continuation chain, which
// brief 55 unit 4 moves onto a worker queue; the tRPC mutation and the panel
// keep the signature and the outcome shape they have today until unit 5.
//
// Three rules still run this path and each of them is in the brief for a reason:
//
//  1. 🛑 **The cutover floor is asserted BEFORE the first call** (§5.4), by
//     `planSyncChunks`, inside the source's factory. It refuses rather than
//     clamps, so no slice can ever reach a date below it.
//  2. **One month per call** for QuickBooks (§4.8). Report endpoints do not
//     paginate - Intuit accepts `startposition` and `maxresults` and ignores
//     them - so the date range is the only lever, and a chunk that silently
//     truncated is indistinguishable from a quiet month. That is now a fact
//     about one slicer rather than about this file.
//  3. **Converge by re-reading, never by tracking changes** (§7.1). A re-read
//     of a range writes what is new (the claim index makes a repeat a no-op)
//     and REVERSES anything we hold as `provider_sync` in that range whose id
//     has stopped appearing. A reversal, never a delete.
//
// No permission checks here. The router asserts (docs/lib-module-guide.md §6).

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Result } from 'neverthrow'
import { UnprocessableEntityError } from '../../errors'
import type {
  SliceBudget,
  SyncCursor,
  SyncSliceCtx,
  ThrottleHandle,
} from '../../sync-core/contracts'
import { guard } from './guard'
import type { DeferredEntry, ProviderSyncChunkOutcome } from './sync-chunk'
import { createProviderLedgerSyncSource } from './sync-source'

const logger = createScopedLogger('postings:provider-sync')

/**
 * The in-process budget. `maxPages: 1` is a fact about the QuickBooks report
 * rather than a knob - one slice is one report call by construction - and the
 * record and time caps are uncapped here because this source cannot stop
 * halfway through a month without leaving a hole.
 */
const LOCAL_SLICE_BUDGET: SliceBudget = {
  maxPages: 1,
  maxRecords: Number.MAX_SAFE_INTEGER,
  maxMs: Number.MAX_SAFE_INTEGER,
}

/** No quota is wired onto the provider yet - brief 55 §4.1 adds one in unit 4. */
const PASS_THROUGH_THROTTLE: ThrottleHandle = { run: (fn) => fn() }

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
   * ⚠️ The CURSOR does not behave this way and must not: an unclean chunk is
   * `partial-permanent`, so the walk advances past it (§4.2). Only the marker
   * stops.
   *
   * Null when not one chunk was clean; the stored value is then left exactly as
   * it was, because "this run read nothing new" is not "nothing has ever been
   * read".
   */
  syncedThrough: string | null
}

export type { DeferredEntry, ProviderSyncChunkOutcome }

/**
 * Read the connected provider's general ledger from the cutover forward and
 * bring everything the accountant authored into our books.
 *
 * 🛑 THE OUT-OF-BAND PROBE DOOR, and its only caller is `scripts/probe-provider-
 * sync.ts`. A press goes through `enqueueProviderSync` (brief 55 §2, §4.6): this
 * walks in-process, opens no run and so is invisible to `assertNoOpenRun`, which
 * means driving it while a worker chain is going would move the marker underneath
 * that chain - §7.3's failure through a second door. Keep it for driving a walk
 * from a script with a person watching; do not wire it to a router.
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
      // Every run-scoped read, the cutover floor and the connected-provider
      // refusal all happen here, before the first fetch.
      const source = await createProviderLedgerSyncSource(db, organizationId, input)
      const controller = new AbortController()

      let cursor: SyncCursor | undefined
      for (;;) {
        const ctx: SyncSliceCtx = {
          phase: 'backfill',
          cursor,
          budget: LOCAL_SLICE_BUDGET,
          throttle: PASS_THROUGH_THROTTLE,
          signal: controller.signal,
        }
        const slice = await source.fetchSlice(ctx)

        // 🛑 There is no queue on this path to re-enqueue onto, so a held cursor
        // has nowhere to go: the run stops and the fault is surfaced, exactly as
        // a provider fault stopped the walk before this refactor. The worker
        // (unit 4) re-enqueues instead and loses no ground.
        if (slice.commit === 'partial-retriable') {
          throw (
            source.lastRetriableFault() ??
            new UnprocessableEntityError(
              'The accounting provider could not be read, so the sync stopped where it was.',
              { organizationId }
            )
          )
        }

        if (!slice.hasMore || !slice.nextCursor) break
        cursor = slice.nextCursor
      }

      const progress = source.progress()
      const result: ProviderSyncOutcome = {
        from: progress.from,
        to: input.to,
        providerId: progress.providerId,
        currency: progress.currency,
        chunks: progress.chunks,
        written: sum(progress.chunks, (o) => o.written),
        alreadyPosted: sum(progress.chunks, (o) => o.alreadyPosted),
        reversed: sum(progress.chunks, (o) => o.reversed),
        deferredToClosedMonths: progress.chunks.flatMap((o) => o.deferredToClosedMonths),
        refusals: progress.chunks.flatMap((o) => o.refusals),
        syncedThrough: progress.syncedThrough,
      }

      logger.info("Synced the accounting provider's general ledger", {
        organizationId,
        providerId: result.providerId,
        from: result.from,
        to: result.to,
        chunks: result.chunks.length,
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

function sum<T>(items: readonly T[], of: (item: T) => number): number {
  return items.reduce((total, item) => total + of(item), 0)
}
