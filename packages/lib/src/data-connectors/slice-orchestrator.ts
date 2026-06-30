// packages/lib/src/data-connectors/slice-orchestrator.ts
// Step 4 — the worker-facing continuation engine for sliced backfills. Turns a
// connector backfill into a CHAIN of short, crash-safe slices (large-dataset §4.1):
//   startConnectorSync → claim, provision, pin the mapping snapshot, open one run,
//   seed the completion latch, enqueue the first slice per stream.
//   runBackfillSlice  → load the pinned chain, build the SyncSource, run ONE slice
//   via runSyncSlice, and act on its directive (re-enqueue with a throttle-paced
//   delay / stop / release on failure). The chain is the worker re-invoking this.
//   sweepStaleConnectorRuns → H5: fail runs whose checkpoint heartbeat went cold and
//   release the connector claim, so a crashed chain can never strand a connector.
// The orchestration lives here (lib) so the worker handler stays a thin shim.

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, lt } from 'drizzle-orm'
import type { ThrottleHandle } from '../sync-core/contracts'
import { runSyncSlice } from '../sync-core/slice-runner'
import { prepareConnectorFetch } from './connector-runtime'
import { createConnectorStreamSyncSource, type SyncSourceStream } from './connector-sync-source'
import {
  type BackfillSliceJobData,
  enqueueBackfillSlice,
  enqueueConnectorSync,
} from './data-connector-queue'
import { materializeConnectorTargets } from './provisioning'
import { publishConnectorSync } from './realtime'
import {
  claimForSync,
  finalizeConnector,
  getRunFetched,
  initConnectorBackfillLatch,
  loadConnector,
  openRun,
  parkBackfillAtCeiling,
  parkConnectorSampleIfLastStream,
  persistStreamState,
  setRunRateLimited,
} from './service'
import { createConnectorRunLedger, createStreamSyncStateStore } from './sync-core-adapters'
import type { ConnectorStreamState } from './types'

const logger = createScopedLogger('data-connector-slice-orchestrator')

// ── Tunables ────────────────────────────────────────────────────────────────────

/**
 * Per-slice work budget (§4.1). A slice stops at whichever limit it hits first, at a
 * PAGE boundary — never mid-page, never sleeping on a throttle. `maxMs` is well under
 * the worker `lockDuration` (2–3×) so a slice never outlives its lock.
 */
export const SLICE_BUDGET = { maxPages: 20, maxRecords: 5_000, maxMs: 25_000 } as const

/** BullMQ `lockDuration` for the slice job — 2–3× the realistic slice wall-clock. */
export const SLICE_LOCK_DURATION_MS = 90_000

/**
 * Per-run ingest ceiling (§3). A backfill stops re-enqueuing once its run-level
 * `fetched` count crosses this, so a mis-targeted or unexpectedly huge source can't
 * ingest unbounded volume + flood downstream jobs on shared infra. SOFT bound: the
 * check runs at slice (page) boundaries, so the actual stop overshoots by up to one
 * slice's worth of records — it's a guardrail, not an exact cap. The run parks
 * `partial` and the connector goes `paused`; "resume" (re-trigger) continues from the
 * checkpoint. NOT to be confused with `SLICE_BUDGET.maxRecords` (per-slice, not per-run).
 */
export const MAX_BACKFILL_RECORDS = 9_000

/**
 * A run is presumed dead once its checkpoint heartbeat (`heartbeatAt`, bumped every
 * slice) is older than this. Generous vs. `maxMs` + queue latency so an alive-but-slow
 * chain is never swept. The sweep keys off the heartbeat, NOT `startedAt` (a chain
 * spans many short jobs — shared-sync-core-plan §3.4).
 */
export const STALE_RUN_MS = 5 * 60 * 1_000

/** A no-op throttle handle. The DC source does per-request 429 handling in the
 *  transport; the cross-request `connection:operation` throttle threads in later. */
const NO_THROTTLE: ThrottleHandle = { run: (fn) => fn() }

// ── The pinned chain snapshot stored on the run (B2) ────────────────────────────

interface ChainSnapshot {
  streams: SyncSourceStream[]
  /**
   * Reconciliation sweep (Step 8C). A full id-crawl whose purpose is catching deletes
   * that webhooks/the watermark poll missed. Runs as a backfill chain (resumable,
   * archive-after-final-slice) but with `ctx.sweep` set so `reconcileOrphans` archives
   * orphans even for incremental streams. Threaded onto every slice's `SyncCtx`.
   */
  sweep?: boolean
}

/** Reset a stream's durable state to a fresh backfill (re-backfill / first run). */
export function freshBackfillState(
  prev: ConnectorStreamState,
  startedAtIso: string,
  backfillFloor?: string
): ConnectorStreamState {
  return {
    ...prev,
    phase: 'backfill',
    backfillCursor: undefined,
    backfillStartedAt: startedAtIso,
    recordsSeen: 0,
    watermark: undefined,
    backfillComplete: false,
    // Step 9 §1.2 — pin the window floor ONCE so every slice injects the same value
    // (no per-slice `now` drift). Undefined ⇒ span 'all' / no window ⇒ full history.
    backfillFloor,
  }
}

type BackfillWindowSpan = 'all' | 'last_90_days' | 'last_12_months'

/**
 * Compute the pinned backfill-window floor (Step 9 §1.2). `span` is the connector's
 * plain-language choice; `format` comes from the stream's `backfillWindow`. Computed
 * ONCE per fresh backfill so the whole chain shares one floor. `'all'`/absent ⇒ no
 * floor (crawl full history — current behavior).
 */
function computeBackfillFloor(
  span: BackfillWindowSpan | undefined,
  format: 'iso' | 'unix' = 'iso'
): string | undefined {
  if (!span || span === 'all') return undefined
  const floor = new Date()
  if (span === 'last_90_days') floor.setDate(floor.getDate() - 90)
  else floor.setMonth(floor.getMonth() - 12) // last_12_months
  return format === 'unix' ? String(Math.floor(floor.getTime() / 1000)) : floor.toISOString()
}

// ── Start a connector sync (backfill or steady) ──────────────────────────────────

export interface StartConnectorSyncOptions {
  trigger?: 'manual' | 'scheduled' | 'webhook' | 'backfill' | 'sweep'
  /**
   * Per-stream sample cap (trial-sync §4). Set ⇒ a SAMPLE run: each stream backfills
   * only this many records, then the run parks for review. Always forces the backfill
   * phase (you can't "sample" a steady delta) and is persisted per-run, never on the
   * connector — the "Sync everything" resume passes no cap and runs to completion.
   */
  sampleLimit?: number | null
}

/**
 * Begin a connector backfill as a continuation chain. Sweeps a stale prior run,
 * claims the connector, provisions the target schema, decides the phase (backfill vs
 * steady — see below), opens ONE run pinned to the decoded mapping snapshot (B2),
 * seeds the completion latch (B1), and enqueues the first slice per stream. Returns
 * false when the connector is missing/unmapped or already syncing.
 *
 * Setup runs BEFORE `openRun` (sweep, provision, claim) — a throw there (e.g. a
 * relationship-edge provisioning collision) would otherwise leave NO run row and the
 * connector stuck reading `live`, so the failure never surfaces and BullMQ just retries
 * silently. The public {@link startConnectorSync} wraps this to stamp `connector.error`
 * on any such pre-run throw; once a run is open, `runBackfillSlice` owns the bookkeeping.
 */
async function startConnectorSyncInner(
  db: Database,
  organizationId: string,
  dataConnectorId: string,
  options: StartConnectorSyncOptions = {}
): Promise<boolean> {
  // A sweep is a full reconciling re-crawl (Step 8C): force the backfill phase even
  // for an incremental connector that's been running steady deltas, so it lists every
  // id and archives the ones that vanished. `ctx.sweep` flows from the run snapshot.
  const isSweep = options.trigger === 'sweep'
  // Clear a crashed prior chain first so its stuck claim can't block us (H5).
  await sweepStaleConnectorRuns(db, { dataConnectorId })

  // Provision `provision`-hint fields BEFORE loadConnector (the generic-rest template
  // path — e.g. stripe). Runs on the RAW rows so it executes before `decodeMapping`
  // (which throws on a null-def row) and `loadConnector` (which filters those out).
  // Idempotent (fields keyed by appFieldKey, backfill only fills null refs). App-owned
  // defs aren't created here — they're installed via the entity-template flow (v6); an
  // unbound owned row is simply skipped until its def is installed.
  await materializeConnectorTargets(db, organizationId, dataConnectorId)

  const loaded = await loadConnector(db, organizationId, dataConnectorId)
  if (!loaded) {
    logger.warn('startConnectorSync: connector not found or has no mappings', { dataConnectorId })
    return false
  }
  const { connector, streams } = loaded
  if (streams.length === 0) {
    // `loadConnector` drops untargeted/unnamed streams, so a connector that slipped
    // past the readiness guard (e.g. an enqueue from before the guard, or a config
    // edit that emptied the last usable stream) lands here. Surface the silent no-op
    // instead of returning `true` from a run that touches nothing.
    logger.warn(
      'startConnectorSync: connector has no usable streams (no targeted mappings or unnamed) — nothing to sync',
      { dataConnectorId }
    )
    return false
  }

  const claimed = await claimForSync(db, dataConnectorId)
  if (!claimed) {
    logger.info('startConnectorSync: already syncing, skipping', { dataConnectorId })
    return false
  }

  // Target schema is provisioned + ref-backfilled by `materializeConnectorTargets` above
  // (runs before `loadConnector`, on the raw rows). The connection `@app:` live-resolution
  // in the sink is a separate, unaffected concern.

  // Phase decision (homogeneous per connector, G2):
  //  - Incremental connector (every stream `syncMode='incremental'`): backfill ONCE
  //    (resume mid-chain if a prior run crashed), then run STEADY watermark deltas
  //    forever. Steady runs do NOT reset state.
  //  - Snapshot connector (any non-incremental stream): re-crawl in FULL every run
  //    so orphan reconciliation stays correct — always (re)backfill, reset cursors.
  // A sample run is always a bounded BACKFILL — there's no "sampling" a steady delta,
  // and a sample must never commit a watermark floor (trial-sync §2.1).
  const isSample = options.sampleLimit != null
  const incrementalConnector = streams.every((s) => s.syncMode === 'incremental')
  const streamStates = streams.map((s) => (s.stream.state as ConnectorStreamState) ?? {})
  const phase: 'backfill' | 'steady' =
    !isSweep &&
    !isSample &&
    incrementalConnector &&
    streamStates.every((st) => st.phase === 'steady')
      ? 'steady'
      : 'backfill'

  // Reset to a fresh backfill unless we're resuming a crashed incremental backfill
  // (keep its cursor) or running steady (keep its watermark).
  const startedAtIso = new Date().toISOString()
  if (phase === 'backfill') {
    const span = connector.config?.backfillWindowSpan
    for (const [i, s] of streams.entries()) {
      const st = streamStates[i] ?? {}
      const resumable = incrementalConnector && st.phase === 'backfill' && !!st.backfillCursor
      if (resumable) continue
      // Pin the floor per stream — the param is connector-level but the format is
      // declared per stream; streams without a `backfillWindow` get no floor.
      const window = s.stream.requestConfig?.backfillWindow
      const floor = window ? computeBackfillFloor(span, window.format) : undefined
      await persistStreamState(db, s.stream.id, freshBackfillState(st, startedAtIso, floor))
    }
  }

  // The pinned snapshot — decoded streams + (now-stamped) mappings. The mutable
  // stream `state`/cursor is deliberately NOT captured; it stays live.
  const snapshot: ChainSnapshot = {
    streams: streams.map((s) => ({
      streamId: s.stream.id,
      streamKey: s.stream.streamKey ?? '',
      syncMode: s.syncMode,
      requestConfig: s.stream.requestConfig ?? undefined,
      mappings: s.mappings,
    })),
    sweep: isSweep,
  }

  const run = await openRun(db, {
    dataConnectorId,
    organizationId,
    trigger: options.trigger ?? (phase === 'steady' ? 'scheduled' : 'backfill'),
    mode: phase === 'steady' ? 'incremental' : 'snapshot',
    phase,
    chainSnapshot: snapshot as unknown as Record<string, unknown>,
    cursorBefore: connector.state,
    sampleLimit: options.sampleLimit ?? null,
  })

  // Seed the completion latch to the stream count (B1) BEFORE enqueuing slices, so the
  // first stream to finish can't fire the connector finalize prematurely. Covers both
  // phases — the last stream (backfill OR steady) releases the connector.
  await initConnectorBackfillLatch(db, dataConnectorId, streams.length)

  for (const s of streams) {
    await enqueueBackfillSlice({
      connectorId: dataConnectorId,
      organizationId,
      streamId: s.stream.id,
      runId: run.id,
    })
  }

  logger.info('startConnectorSync: chain enqueued', {
    dataConnectorId,
    runId: run.id,
    phase,
    streams: streams.length,
  })
  // Light up every open detail view immediately — including for a webhook/scheduled
  // run the 4s poll never armed for (it only polls when status already reads syncing).
  await publishConnectorSync(db, organizationId, dataConnectorId, 'run-started')
  return true
}

/**
 * Public entry. Runs the orchestration and, on any throw during setup (before a run
 * exists to record its own failure), stamps `connector.status = 'error'` with the
 * message + logs the underlying `cause` (which the neverthrow `fromDatabase` wrapper
 * otherwise hides) so the connector page shows "failed + why" instead of silently
 * reading `live` while the job loops through BullMQ retries. Re-throws so the job is
 * still recorded as failed.
 */
export async function startConnectorSync(
  db: Database,
  organizationId: string,
  dataConnectorId: string,
  options: StartConnectorSyncOptions = {}
): Promise<boolean> {
  try {
    return await startConnectorSyncInner(db, organizationId, dataConnectorId, options)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('startConnectorSync failed during setup — marking connector errored', {
      dataConnectorId,
      organizationId,
      error: err.message,
      cause: err.cause instanceof Error ? err.cause.message : err.cause,
    })
    await finalizeConnector(db, dataConnectorId, { ok: false, error: err.message })
    await publishConnectorSync(db, organizationId, dataConnectorId, 'run-finished')
    throw err
  }
}

// ── Backfill a pending mapping-edit change (Layer 2 — "Backfill now") ─────────────

/**
 * Trigger the deferred full re-crawl for a pending structural edit (the banner's
 * "Backfill now", or the only place a `rebackfill`/`rebind` edit's expensive
 * re-projection is requested). Resets the `resyncPending.streamIds` streams to a
 * fresh backfill so the re-crawl re-projects + re-binds history, then enqueues a
 * sync. `startConnectorSync` re-derives the phase from the reset states (any reset
 * stream forces the backfill phase), and the backfill finalize clears
 * `resyncPending` — so we deliberately do NOT clear it here (a failed sync must keep
 * the banner). Returns false when the connector is gone.
 */
export async function backfillPendingChange(
  db: Database,
  organizationId: string,
  dataConnectorId: string
): Promise<boolean> {
  const connector = await db.query.DataConnector.findFirst({
    where: and(
      eq(schema.DataConnector.id, dataConnectorId),
      eq(schema.DataConnector.organizationId, organizationId)
    ),
    columns: { id: true, resyncPending: true },
  })
  if (!connector) return false

  const streamIds = connector.resyncPending?.streamIds ?? []
  if (streamIds.length > 0) {
    const startedAtIso = new Date().toISOString()
    const streamRows = await db.query.DataConnectorStream.findMany({
      where: and(
        eq(schema.DataConnectorStream.dataConnectorId, dataConnectorId),
        inArray(schema.DataConnectorStream.id, streamIds)
      ),
    })
    for (const s of streamRows) {
      const st = (s.state as ConnectorStreamState) ?? {}
      await persistStreamState(db, s.id, freshBackfillState(st, startedAtIso))
    }
  }

  await enqueueConnectorSync({ connectorId: dataConnectorId, organizationId, trigger: 'backfill' })
  return true
}

// ── Run one slice (continuation unit) ────────────────────────────────────────────

/**
 * Run ONE backfill slice and continue the chain. Loads the run + pinned snapshot,
 * builds the stream's `SyncSource`, runs a single slice through the core runner, and
 * acts on the directive: re-enqueue the next slice (throttle-paced), stop on
 * completion (the source finalized the run/connector on its last stream), or release
 * the connector on a hard failure. A no-op when the run is gone or no longer running
 * (cancelled / failed by a sibling / already finished).
 */
export async function runBackfillSlice(
  db: Database,
  data: Omit<BackfillSliceJobData, 'type'>,
  signal?: AbortSignal
): Promise<void> {
  const { connectorId, organizationId, streamId, runId } = data

  const run = await db.query.DataConnectorRun.findFirst({
    where: eq(schema.DataConnectorRun.id, runId),
  })
  if (!run || run.status !== 'running') {
    logger.info('runBackfillSlice: run not active, stopping chain', {
      runId,
      streamId,
      status: run?.status,
    })
    return
  }

  const snapshot = run.chainSnapshot as ChainSnapshot | null
  const streamSnap = snapshot?.streams.find((s) => s.streamId === streamId)
  if (!streamSnap) {
    logger.warn('runBackfillSlice: stream not in pinned snapshot, stopping', { runId, streamId })
    return
  }

  const connector = await db.query.DataConnector.findFirst({
    where: and(
      eq(schema.DataConnector.id, connectorId),
      eq(schema.DataConnector.organizationId, organizationId)
    ),
  })
  if (!connector) {
    logger.warn('runBackfillSlice: connector gone, stopping', { connectorId })
    return
  }

  const { definition, credential } = await prepareConnectorFetch(
    db,
    organizationId,
    connector,
    connector.createdById ?? 'system'
  )

  const source = createConnectorStreamSyncSource({
    db,
    organizationId,
    connector,
    definition,
    credential,
    config: connector.config,
    run: { id: runId, startedAt: run.startedAt },
    stream: streamSnap,
    allStreams: snapshot?.streams ?? [streamSnap],
    sweep: snapshot?.sweep ?? false,
    // A sample run that exhausts a stream before the cap parks via the source's
    // natural-completion path; thread the cap so it parks instead of going live.
    sampleLimit: run.sampleLimit,
  })

  // Trial-sync §4.2: bound a sample slice's per-slice record budget to the cap, so the
  // FIRST slice stops near `sampleLimit` (a page boundary's overshoot) instead of
  // running the full per-slice budget and importing thousands before the chain-level
  // cap check below ever sees them. Backfill phase only — steady runs sample nothing.
  const budget =
    run.sampleLimit != null && run.phase === 'backfill'
      ? { ...SLICE_BUDGET, maxRecords: Math.min(SLICE_BUDGET.maxRecords, run.sampleLimit) }
      : SLICE_BUDGET

  const outcome = await runSyncSlice({
    source,
    stateStore: createStreamSyncStateStore(db, streamId),
    ledger: createConnectorRunLedger(db, { id: runId, startedAt: run.startedAt }, streamId),
    throttle: NO_THROTTLE,
    budget,
    signal: signal ?? new AbortController().signal,
  })

  if (outcome.action === 'reenqueue') {
    // A cancelled chain (worker shutdown / connector delete) — leave the cursor
    // checkpointed and stop; a later trigger or the sweep resumes it.
    if (signal?.aborted) {
      logger.info('runBackfillSlice: cancelled, not re-enqueuing', { runId, streamId })
      return
    }

    // Trial-sync §4.2 per-stream sample cap: stop THIS stream's chain once it has seen
    // enough, BEFORE re-enqueuing. The slice already checkpointed the cursor, so the
    // chain is resumable — "Sync everything" continues mid-chain past the sample. The
    // B1 latch coordinates: only the last stream to stop parks the run + connector.
    if (run.phase === 'backfill' && run.sampleLimit != null) {
      const streamRow = await db.query.DataConnectorStream.findFirst({
        where: eq(schema.DataConnectorStream.id, streamId),
        columns: { state: true },
      })
      const seen = (streamRow?.state as ConnectorStreamState | null)?.recordsSeen ?? 0
      if (seen >= run.sampleLimit) {
        logger.info('runBackfillSlice: sample cap reached for stream, stopping chain', {
          runId,
          connectorId,
          streamId,
          seen,
          sampleLimit: run.sampleLimit,
        })
        await parkConnectorSampleIfLastStream(db, {
          runId,
          dataConnectorId: connectorId,
          sampleLimit: run.sampleLimit,
          startedAt: run.startedAt,
        })
        await publishConnectorSync(db, organizationId, connectorId, 'run-finished')
        return
      }
    }

    // §3 ingest ceiling: park the backfill before re-enqueuing once the run crosses
    // the per-run record cap. Backfill phase only — steady deltas are naturally
    // bounded by the watermark. Parking releases the connector to `paused` and keeps
    // the cursor, so a later resume continues mid-chain (NOT page 1).
    if (run.phase === 'backfill') {
      const fetched = await getRunFetched(db, runId)
      if (fetched >= MAX_BACKFILL_RECORDS) {
        logger.warn('runBackfillSlice: ingest ceiling reached, parking run', {
          runId,
          connectorId,
          fetched,
          ceiling: MAX_BACKFILL_RECORDS,
        })
        await parkBackfillAtCeiling(db, {
          runId,
          dataConnectorId: connectorId,
          fetched,
          ceiling: MAX_BACKFILL_RECORDS,
          startedAt: run.startedAt,
        })
        await publishConnectorSync(db, organizationId, connectorId, 'run-finished')
        return
      }
    }
    // Surface the throttle to the status line: set `rateLimited.until` when the next
    // slice is delayed on a 429, clear it on a clean re-enqueue (Step 9 §3.1).
    const throttledMs = outcome.retryAfterMs && outcome.retryAfterMs > 0 ? outcome.retryAfterMs : 0
    await setRunRateLimited(
      db,
      runId,
      throttledMs > 0 ? new Date(Date.now() + throttledMs).toISOString() : null
    )
    await enqueueBackfillSlice(
      { connectorId, organizationId, streamId, runId },
      { delayMs: outcome.retryAfterMs }
    )
    // Live counter motion — the slice folded its counts + persisted stream state, so
    // the snapshot read reflects this slice. Throttled per-connector.
    await publishConnectorSync(db, organizationId, connectorId, 'progress')
    return
  }

  if (outcome.action === 'failed') {
    // The runner already failed the run; release the connector so it isn't stuck
    // 'syncing'. Sibling streams will see the run no longer 'running' and stop.
    await finalizeConnector(db, connectorId, { ok: false, error: outcome.error.message })
    await publishConnectorSync(db, organizationId, connectorId, 'run-finished')
    return
  }

  // 'complete'. For BACKFILL the source already finalized the run + released the
  // connector on its last stream (via the runner's `finalizeBackfill`). For STEADY
  // the runner closed the run, but connector release is handler-owned — fire the
  // last-stream finalize here (no-op for non-last streams via the B1 latch).
  if (outcome.completedPhase === 'steady') {
    await source.finalizeSteady()
  }
  // A stream finished. For the LAST stream the connector is now live/finalized; for
  // an earlier one it's still syncing with this stream done. Either way the snapshot
  // tells the truth — emit a lifecycle frame so the history panel + freshness refetch.
  await publishConnectorSync(db, organizationId, connectorId, 'run-finished')
}

// ── Stale-run sweep (H5) ──────────────────────────────────────────────────────────

/**
 * Fail any `running` run whose checkpoint heartbeat has gone cold, and release its
 * connector claim. Without this a crashed continuation chain strands the connector
 * `syncing` forever (no slice ever re-enqueues to release it). Scoped to one
 * connector when `dataConnectorId` is given (run at chain start), else global (cron).
 */
export async function sweepStaleConnectorRuns(
  db: Database,
  opts: { dataConnectorId?: string; staleMs?: number } = {}
): Promise<number> {
  const threshold = new Date(Date.now() - (opts.staleMs ?? STALE_RUN_MS))
  const T = schema.DataConnectorRun

  const stale = await db
    .update(T)
    .set({
      status: 'failed',
      errorSample: [{ externalId: '', error: 'sync stalled — checkpoint heartbeat went cold' }],
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(T.status, 'running'),
        lt(T.heartbeatAt, threshold),
        ...(opts.dataConnectorId ? [eq(T.dataConnectorId, opts.dataConnectorId)] : [])
      )
    )
    .returning({ id: T.id, dataConnectorId: T.dataConnectorId, organizationId: T.organizationId })

  for (const run of stale) {
    await finalizeConnector(db, run.dataConnectorId, { ok: false, error: 'sync stalled' })
    // Unstick any open detail view that was watching the crashed chain.
    await publishConnectorSync(db, run.organizationId, run.dataConnectorId, 'run-finished')
  }
  if (stale.length > 0) {
    logger.warn('sweepStaleConnectorRuns: failed stale runs + released connectors', {
      count: stale.length,
      runIds: stale.map((r) => r.id),
    })
  }
  return stale.length
}
