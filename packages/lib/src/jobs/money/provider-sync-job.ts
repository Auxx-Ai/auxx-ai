// packages/lib/src/jobs/money/provider-sync-job.ts
//
// One slice of the walk over the connected provider's general ledger, and the
// directive that decides whether there is another (brief 55 §4.6.4). The body is
// `runSyncSlice` and the wiring it needs - no ledger logic lives here.

import { database as db } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import {
  blockMarkerForRun,
  createProviderLedgerSyncSource,
  createProviderSyncRunLedger,
  createProviderSyncStateStore,
  enqueueProviderSyncSlice,
  isMarkerBlockedForRun,
  type ProviderSyncJobData,
} from '../../accounting/mirror'
import type { SliceBudget } from '../../sync-core/contracts'
import { runSyncSlice } from '../../sync-core/slice-runner'
import { createThrottleHandle } from '../../sync-core/throttle'
import { connectionQuota } from '../../utils/rate-limiter/quota'
import type { JobContext } from '../types'

const logger = createScopedLogger('jobs:money:provider-sync')

export { PROVIDER_SYNC_JOB_NAME, type ProviderSyncJobData } from '../../accounting/mirror'

/**
 * `maxPages: 1` is a fact about the QuickBooks report rather than a knob - one
 * slice is one report call by construction. The record and time caps are
 * uncapped because this source cannot stop halfway through a month without
 * leaving a hole; the queue's unit of work is the chunk, not the budget.
 */
const SLICE_BUDGET: SliceBudget = {
  maxPages: 1,
  maxRecords: Number.MAX_SAFE_INTEGER,
  maxMs: Number.MAX_SAFE_INTEGER,
}

/**
 * Run one slice and act on the `SliceOutcome`.
 *
 * **Never throws.** Every terminal state is already recorded in
 * `providerSync.state` by the runner's ledger, which is what the panel reads; a
 * throw here would earn a BullMQ retry on top of a chain that has already been
 * closed as failed.
 */
export const providerSyncJob = async (ctx: JobContext<ProviderSyncJobData>) => {
  const data = ctx.data
  const { organizationId, runStartedAt } = data
  const ledger = createProviderSyncRunLedger(organizationId, new Date(runStartedAt))

  try {
    const source = await createProviderLedgerSyncSource(db, organizationId, {
      from: data.from,
      to: data.to,
      actorUserId: data.actorUserId,
      // 🛑 §7.3. This source is built fresh every job, so "an earlier chunk of
      // this run was unclean" has to come out of the blob - otherwise a clean
      // July would advance the marker past a broken June and claim it had been
      // read completely.
      markerBlocked: await isMarkerBlockedForRun(organizationId, runStartedAt),
      onMarkerBlocked: () => blockMarkerForRun(organizationId, runStartedAt),
    })

    const signal = ctx.signal ?? new AbortController().signal
    const outcome = await runSyncSlice({
      source,
      stateStore: createProviderSyncStateStore(organizationId),
      ledger,
      // The provider COMPANY's bucket, not the org's: it is what identifies the
      // upstream account whose rate limit this walk spends.
      throttle: createThrottleHandle(connectionQuota(source.throttleKey), { signal }),
      budget: SLICE_BUDGET,
      signal,
    })

    if (outcome.action === 'reenqueue') {
      // A worker shutdown mid-chain: the cursor is checkpointed, so a later
      // press (or §5's cadence) resumes from it rather than from the marker.
      if (signal.aborted) {
        logger.info('Provider sync cancelled mid-chain; not re-enqueuing', { organizationId })
        return outcome
      }
      const queued = await enqueueProviderSyncSlice(data, { delayMs: outcome.retryAfterMs })
      if (!queued)
        logger.warn('Could not continue a provider sync chain; the run is left open', {
          organizationId,
          reason: outcome.reason,
        })
      return outcome
    }

    // 🛑 The runner does NOT close a run that completed its BACKFILL - it hands
    // that to `finalizeBackfill`, because a data-connector backfill spans many
    // chains sharing one run. This one does not: one chain is one walk, so the
    // chain's last slice is the run's end, and without this the blob would show
    // a run still going for ever (§7.4).
    if (outcome.action === 'complete' && outcome.completedPhase === 'backfill')
      await ledger.finalize()

    return outcome
  } catch (error) {
    // Only reachable BEFORE the first slice - nothing connected, no cutoff, an
    // ambiguous account map. `runSyncSlice` closes the run itself for anything
    // after that. The fold opens the run so the close has something to close;
    // without it the press leaves no trace at all and the panel shows nothing.
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Provider sync slice failed', { organizationId, error: err.message })
    await ledger
      .recordSlice({
        counters: { failed: 1 },
        errorSample: [{ externalId: '', error: err.message }],
      })
      .catch(() => {})
    await ledger.fail(err).catch(() => {})
    return undefined
  }
}
