// packages/lib/src/postings/provider-sync/run-state.ts
//
// The provider-sync implementations of two sync-core seams - `SyncStateStore`
// (where the walk is) and `RunLedger` (how the run is going) - both folded into
// ONE organization setting, `providerSync.state` (55 §4.4, §4.5).
//
// 🛑 This is NOT `accounting.providerSyncedThrough`. That key means "this range
// has been read completely", is written once per clean chunk through
// `marker-writes.ts`, and correctly takes the org-wide accounting lock. This
// blob means "where the walk is and how it is going", is written after every
// slice, and must never take that lock - hence the `providerSync.` prefix.
//
// ⚠️ Everything here is jsonb: ISO strings, never `Date`.

import type { Result } from 'neverthrow'
import type {
  RunLedger,
  SliceLedgerEntry,
  SyncRunCounters,
  SyncState,
  SyncStateStore,
} from '../../sync-core/contracts'
import type { ProviderSyncRunRecord, ProviderSyncRunStatus, ProviderSyncStateBlob } from './client'
import { guard } from './guard'
import { loadProviderSyncBlob, saveProviderSyncBlob } from './run-state-io'

/** Soft cap: the sample is evidence for the panel, not a log. */
const ERROR_SAMPLE_CAP = 50

function emptyCounters(): SyncRunCounters {
  return { fetched: 0, created: 0, updated: 0, skipped: 0, archived: 0, deleted: 0, failed: 0 }
}

/** Project the blob onto the core's state. Never run ⇒ `backfill`, no cursor. */
export function syncStateFromBlob(blob: ProviderSyncStateBlob): SyncState {
  return { phase: 'backfill', ...blob.sync }
}

/** Merge the core's state back in, spread-first so keys the core does not own survive. */
export function applySyncStateToBlob(
  prev: ProviderSyncStateBlob,
  sync: SyncState
): ProviderSyncStateBlob {
  return { ...prev, sync }
}

/**
 * Fold one slice into the run identified by `startedAt`, opening it if this is
 * its first slice.
 *
 * 🛑 Idempotent on `entry.checkpointKey` (H4). A BullMQ replay presents the key
 * the committed fold already stamped; folding it twice double-counts
 * `created`/`updated`. An absent key (a held-cursor retry, a single-shot steady
 * pass) always folds. The heartbeat bumps either way - a skipped replay is
 * still a sign of life.
 */
export function recordSliceInBlob(
  prev: ProviderSyncStateBlob,
  entry: SliceLedgerEntry,
  startedAt: string,
  now: string
): ProviderSyncStateBlob {
  const open = prev.currentRun?.startedAt === startedAt ? prev.currentRun : undefined
  const run: ProviderSyncRunRecord = open ?? {
    startedAt,
    heartbeatAt: now,
    status: 'running',
    counters: emptyCounters(),
    errorSample: [],
    pagesProcessed: 0,
    rateLimitWaitMs: 0,
  }
  // A run we did not open is abandoned (a worker died mid-chain); keep it as
  // history rather than dropping it on the floor.
  const lastRun = open ? prev.lastRun : (prev.currentRun ?? prev.lastRun)

  if (entry.checkpointKey && run.lastCheckpointKey === entry.checkpointKey) {
    return { ...prev, currentRun: { ...run, heartbeatAt: now }, lastRun }
  }

  const counters = { ...run.counters }
  for (const [key, delta] of Object.entries(entry.counters ?? {})) {
    counters[key] = (counters[key] ?? 0) + (delta ?? 0)
  }

  const errorSample =
    run.errorSample.length < ERROR_SAMPLE_CAP && entry.errorSample?.length
      ? [...run.errorSample, ...entry.errorSample]
      : run.errorSample

  return {
    ...prev,
    currentRun: {
      ...run,
      heartbeatAt: now,
      counters,
      errorSample,
      pagesProcessed: run.pagesProcessed + (entry.pagesProcessed ?? 0),
      rateLimitWaitMs: run.rateLimitWaitMs + (entry.rateLimitWaitMs ?? 0),
      lastCheckpointKey: entry.checkpointKey ?? run.lastCheckpointKey,
    },
    lastRun,
  }
}

/** `'derive'` reads the status off the run's own `failed` counter. */
type RunTerminal = { status: ProviderSyncRunStatus; error?: string } | 'derive'

/**
 * Close the run identified by `startedAt`, moving it to `lastRun`. A blob whose
 * current run is somebody else's (or already closed) is returned untouched -
 * the analog of `ConnectorRunLedger`'s `eq(status, 'running')` guard.
 */
export function closeRunInBlob(
  prev: ProviderSyncStateBlob,
  startedAt: string,
  now: string,
  terminal: RunTerminal
): ProviderSyncStateBlob {
  const run = prev.currentRun
  if (!run || run.startedAt !== startedAt || run.status !== 'running') return prev

  const closed = terminal === 'derive' ? { status: derivedStatus(run) } : terminal
  return {
    ...prev,
    currentRun: undefined,
    lastRun: {
      ...run,
      ...closed,
      finishedAt: now,
      durationMs: Date.parse(now) - Date.parse(run.startedAt),
    },
  }
}

/**
 * A slice that gave up on a record leaves the run partial, not completed.
 *
 * 🛑 The second clause is `ConnectorRunLedger`'s and is not redundant: a sample
 * can be written without `failed` moving. A divergence is the case - our own
 * entry edited in the provider, where nothing failed and nothing was refused -
 * and without this a run carrying one closes as cleanly `completed`. `'skipped'`
 * is excluded because a deferral is a decision, not an incompleteness.
 */
function derivedStatus(run: ProviderSyncRunRecord): ProviderSyncRunStatus {
  if (run.counters.failed > 0) return 'partial'
  return run.errorSample.some((sample) => sample.tier !== 'skipped') ? 'partial' : 'completed'
}

/** The core's cursor/phase/watermark over `providerSync.state`. */
export function createProviderSyncStateStore(organizationId: string): SyncStateStore {
  return {
    load: async () => syncStateFromBlob(await loadProviderSyncBlob(organizationId)),
    save: async (sync) => {
      // Read-modify-write, unlocked: one walk per org at a time, which the
      // door's `assertNoOpenRun` holds rather than the queue's concurrency.
      const prev = await loadProviderSyncBlob(organizationId)
      await saveProviderSyncBlob(organizationId, applySyncStateToBlob(prev, sync))
    },
  }
}

/** The run counters over the SAME blob - `runStartedAt` identifies the run. */
export function createProviderSyncRunLedger(organizationId: string, runStartedAt: Date): RunLedger {
  const startedAt = runStartedAt.toISOString()

  const close = async (terminal: RunTerminal): Promise<void> => {
    const prev = await loadProviderSyncBlob(organizationId)
    const next = closeRunInBlob(prev, startedAt, new Date().toISOString(), terminal)
    if (next === prev) return
    await saveProviderSyncBlob(organizationId, next)
  }

  return {
    recordSlice: async (entry) => {
      const prev = await loadProviderSyncBlob(organizationId)
      const next = recordSliceInBlob(prev, entry, startedAt, new Date().toISOString())
      await saveProviderSyncBlob(organizationId, next)
    },
    finalize: () => close('derive'),
    fail: (error) => close({ status: 'failed', error: error.message }),
  }
}

/**
 * Is this run's marker already blocked by an earlier slice of it?
 *
 * 🛑 The worker builds a fresh source per slice, so the source's own flag cannot
 * carry the answer across jobs (§7.3). Scoped to `runStartedAt`: a NEW run is
 * unblocked, or one bad month would pin the marker permanently.
 */
export async function isMarkerBlockedForRun(
  organizationId: string,
  runStartedAt: string
): Promise<boolean> {
  const blob = await loadProviderSyncBlob(organizationId)
  return blob.markerBlockedRun === runStartedAt
}

/** Record that this run's marker has stopped. Read-modify-write; unknown keys survive. */
export async function blockMarkerForRun(
  organizationId: string,
  runStartedAt: string
): Promise<void> {
  const prev = await loadProviderSyncBlob(organizationId)
  if (prev.markerBlockedRun === runStartedAt) return
  await saveProviderSyncBlob(organizationId, { ...prev, markerBlockedRun: runStartedAt })
}

/**
 * What the sync panel renders (unit 5). `currentRun` is what to show while a
 * walk is open; a heartbeat older than a slice's worth of time means the chain
 * died and the run will never close itself (§7.4).
 */
export async function readProviderSyncRunState(
  organizationId: string
): Promise<Result<ProviderSyncStateBlob, Error>> {
  return guard(() => loadProviderSyncBlob(organizationId), 'Failed to read the provider sync run', {
    organizationId,
  })
}
