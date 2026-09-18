// packages/lib/src/accounting/mirror/queue.ts
//
// The door onto `providerSyncQueue` and the payload one slice carries (brief 55
// §4.6). Nothing here reads a ledger; it hands the walk to the worker.

import { createScopedLogger } from '@auxx/logger'
import { ConflictError } from '../../errors'
import { jobId } from '../../jobs/job-id'
import { loadProviderSyncBlob } from './run-state-io'

const logger = createScopedLogger('postings:provider-sync:queue')

/** Long enough for a healthy Redis, short enough that a sick one is not a hang. */
const ENQUEUE_TIMEOUT_MS = 2_000

/**
 * How long a run may go without a heartbeat before a new press may take it over.
 *
 * One slice is one QuickBooks general-ledger report for one month, and a heavy
 * month behind a rate-limit wait is minutes rather than seconds; 30 is
 * comfortably past the worst slice we have measured while still letting a chain
 * killed by a worker restart (§7.4) be restarted the same working hour.
 */
export const PROVIDER_SYNC_RUN_STALE_MS = 30 * 60 * 1_000

export const PROVIDER_SYNC_JOB_NAME = 'provider-sync'

/**
 * The cadence's own job: it resolves the range and then calls
 * {@link enqueueProviderSync}, so a scheduled fire goes through the same door a
 * press does (brief 55 §5.1). Separate from {@link PROVIDER_SYNC_JOB_NAME}
 * because a job scheduler's payload is fixed at registration and this one's is
 * "today, in the book timezone" - a value that is wrong by the second fire.
 */
export const PROVIDER_SYNC_SCHEDULED_JOB_NAME = 'provider-sync-scheduled'

/** Which door opened this run. Only `pressed` surfaces a dropped enqueue. */
export type ProviderSyncTrigger = 'pressed' | 'scheduled' | 'webhook'

/**
 * One slice of one walk. Every field is carried forward unchanged by the
 * continuation chain - the only thing that moves between slices is the cursor,
 * and that lives in `providerSync.state`, not here.
 */
export interface ProviderSyncJobData {
  organizationId: string
  /** `YYYY-MM-DD`, or absent for "everything the sync is allowed to see". */
  from?: string
  /** `YYYY-MM-DD`, inclusive. */
  to: string
  trigger: ProviderSyncTrigger
  actorUserId?: string
  /**
   * Identity of the RUN every slice of this chain folds into, ISO. Stamped by
   * the first enqueue and never re-stamped: `recordSliceInBlob` keys the open
   * run on it, so a chain that re-stamped would close its own run every slice.
   */
  runStartedAt: string
}

/**
 * Open a walk over the connected provider's general ledger.
 *
 * 🛑 Returns whether the job was actually queued, and the caller must not
 * ignore that when the press came from a person. Delivery's equivalent may drop
 * a job silently because `sweepAccountingDeliveries` finds the rows nothing woke
 * up for; provider-sync has no sweep until §5's cadence exists, so a dropped
 * enqueue is a press that did nothing at all. A scheduled fire may ignore the
 * answer - the next one covers it.
 *
 * 🛑 Throws {@link ConflictError} when a run is already open for the org, and
 * that refusal is NOT the same answer as `false`: a drop is a press that can be
 * repeated, a refusal is a press that must not be. §4.6.1 wants one walk per
 * ORG, and neither lever below it delivers that - `jobId` only collapses a
 * second press while that one job still exists in BullMQ, and the worker's
 * `concurrency: 1` is per worker PROCESS. Today `infra/worker.ts` declares one
 * SST service with no `scaling` block, so there is one replica; nothing enforces
 * that, so this check is what makes a run org-singular.
 */
export async function enqueueProviderSync(input: {
  organizationId: string
  from?: string
  to: string
  trigger: ProviderSyncTrigger
  actorUserId?: string
}): Promise<boolean> {
  await assertNoOpenRun(input.organizationId)
  const data: ProviderSyncJobData = { ...input, runStartedAt: new Date().toISOString() }
  return addProviderSyncJob(data, {
    // One walk per org. A second press collapses onto the job already queued
    // rather than starting a rival chain against the same cursor and marker.
    jobId: jobId('provider-sync', input.organizationId),
  })
}

/**
 * Refuse a DOOR enqueue while this org's walk is still going.
 *
 * A stale heartbeat is deliberately allowed through: §7.4's chain killed
 * mid-slice leaves `currentRun` open with nothing to close it, and a guard that
 * respected that forever would lock the org out of its own sync. The takeover is
 * free - the new run gets its own `runStartedAt`, and `recordSliceInBlob` files
 * the abandoned one under `lastRun`.
 */
async function assertNoOpenRun(organizationId: string): Promise<void> {
  const run = (await loadProviderSyncBlob(organizationId)).currentRun
  if (!run || run.status !== 'running') return

  const silentMs = Date.now() - Date.parse(run.heartbeatAt)
  // A heartbeat we cannot parse gives `NaN`, which fails this test and so reads
  // as stale - the safe direction, since the alternative blocks the org for ever.
  if (!(silentMs < PROVIDER_SYNC_RUN_STALE_MS)) {
    logger.info('Taking over a provider sync run whose chain went quiet', {
      organizationId,
      startedAt: run.startedAt,
      heartbeatAt: run.heartbeatAt,
    })
    return
  }

  throw new ConflictError(
    `A provider sync is already running for this organization. It started at ${run.startedAt}, ` +
      `has read ${run.pagesProcessed} chunk(s) and ${run.counters.created} new entries, and last ` +
      `made progress at ${run.heartbeatAt}. Wait for it to finish before starting another.`
  )
}

/**
 * The next slice of a chain already running.
 *
 * 🛑 Deliberately UNGUARDED by {@link assertNoOpenRun}: this is the open run
 * continuing itself, so the run it would collide with is its own. Only the doors
 * check.
 *
 * 🛑 No `jobId`. The job doing the enqueueing still holds
 * `provider-sync-${organizationId}`, so a continuation under that id would be
 * de-duped against its own parent and the chain would stop dead one slice in.
 * Serialization is the queue's concurrency 1, not the id.
 */
export async function enqueueProviderSyncSlice(
  data: ProviderSyncJobData,
  opts: { delayMs?: number } = {}
): Promise<boolean> {
  return addProviderSyncJob(data, {
    delay: opts.delayMs && opts.delayMs > 0 ? opts.delayMs : undefined,
  })
}

/**
 * 🛑 BOUNDED, and this is the whole point of the function. `add()` talks to
 * Redis, and ioredis retries a refused connection forever rather than failing -
 * so an unbounded await hands the caller a new way to hang, which is precisely
 * what moving the sync off the request path was meant to remove. A sick queue
 * must cost this call a couple of seconds and nothing else.
 */
async function addProviderSyncJob(
  data: ProviderSyncJobData,
  opts: { jobId?: string; delay?: number }
): Promise<boolean> {
  try {
    const { getQueue, Queues } = await import('../../jobs/queues')
    const queued = getQueue(Queues.providerSyncQueue)
      .add(PROVIDER_SYNC_JOB_NAME, data, opts)
      .then(() => true)
      // Settled below either way; this keeps a late rejection from surfacing as
      // an unhandled one after the race has already moved on.
      .catch((error) => {
        logger.warn('Could not enqueue a provider sync slice', {
          organizationId: data.organizationId,
          error: message(error),
        })
        return false
      })

    let timer: ReturnType<typeof setTimeout> | undefined
    const expired = Symbol('expired')
    const result = await Promise.race([
      queued,
      new Promise<typeof expired>((resolve) => {
        timer = setTimeout(() => resolve(expired), ENQUEUE_TIMEOUT_MS)
      }),
    ])
    if (timer) clearTimeout(timer)
    if (result === expired) {
      logger.warn('Enqueueing a provider sync slice timed out', {
        organizationId: data.organizationId,
        timeoutMs: ENQUEUE_TIMEOUT_MS,
      })
      return false
    }
    return result
  } catch (error) {
    logger.warn('Could not enqueue a provider sync slice', {
      organizationId: data.organizationId,
      error: message(error),
    })
    return false
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
