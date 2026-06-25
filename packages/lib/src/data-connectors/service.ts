// packages/lib/src/data-connectors/service.ts
// Functional service layer over the 5 Data Connector control tables. Drizzle +
// neverthrow; no model classes (project convention). The orchestrator, sink, and
// (later) tRPC router consume these helpers. Policy unions (identity/merge/link)
// are stored as jsonb/text and cast to the canonical lib types at this boundary.

import { type Database, database as defaultDb, schema, type Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, count, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { maxLevel } from './edit-impact'
import type {
  FieldMapping,
  LinkMode,
  OrphanBehavior,
  ResyncPending,
  SyncMode,
  TargetMode,
} from './types'

const logger = createScopedLogger('data-connector-service')

/** Either the pooled connection or an open transaction — for helpers that run both. */
export type DbOrTx = Database | Transaction

// ── Row types (DB select) + decoded policy shapes ─────────────────────────────

export type DataConnectorRow = typeof schema.DataConnector.$inferSelect
export type DataConnectorStreamRow = typeof schema.DataConnectorStream.$inferSelect
export type DataConnectorMappingRow = typeof schema.DataConnectorMapping.$inferSelect
export type DataConnectorItemRow = typeof schema.DataConnectorItem.$inferSelect
export type DataConnectorRunRow = typeof schema.DataConnectorRun.$inferSelect

/** A mapping with its jsonb/text policy columns decoded to canonical lib types. */
export interface DecodedMapping {
  row: DataConnectorMappingRow
  rootPath: string
  linkMode: LinkMode
  targetMode: TargetMode
  entityDefinitionId: string
  parentMappingId: string | null
  relationshipFieldKey: string | null
  orphanBehavior: OrphanBehavior
  fieldMappings: FieldMapping[]
}

/** A stream with its enabled mappings, decoded. */
export interface StreamWithMappings {
  stream: DataConnectorStreamRow
  syncMode: SyncMode
  mappings: DecodedMapping[]
}

/** A fully-loaded connector ready for a sync run. */
export interface LoadedConnector {
  connector: DataConnectorRow
  streams: StreamWithMappings[]
}

/**
 * Decode a mapping row's jsonb/text policy columns into canonical lib unions.
 * Untargeted mappings (no `entityDefinitionId` — created before the user picked a
 * def) are never synced — callers filter them out before decoding, so a null here
 * is a programming error.
 */
export function decodeMapping(row: DataConnectorMappingRow): DecodedMapping {
  if (row.entityDefinitionId === null) {
    throw new Error(`decodeMapping called on untargeted mapping '${row.id}'`)
  }
  return {
    row,
    rootPath: row.rootPath,
    linkMode: row.linkMode as LinkMode,
    targetMode: row.targetMode as TargetMode,
    entityDefinitionId: row.entityDefinitionId,
    parentMappingId: row.parentMappingId ?? null,
    relationshipFieldKey: row.relationshipFieldKey ?? null,
    orphanBehavior: row.orphanBehavior as OrphanBehavior,
    fieldMappings: row.fieldMappings ?? [],
  }
}

// ── Load ──────────────────────────────────────────────────────────────────────

/**
 * Load a connector plus its enabled streams and their mappings. Returns null
 * when the connector doesn't exist (or belongs to another org). Streams with no
 * mappings are dropped — a fetch with nowhere to land is a no-op.
 */
export async function loadConnector(
  db: DbOrTx,
  organizationId: string,
  dataConnectorId: string
): Promise<LoadedConnector | null> {
  const connector = await db.query.DataConnector.findFirst({
    where: and(
      eq(schema.DataConnector.id, dataConnectorId),
      eq(schema.DataConnector.organizationId, organizationId)
    ),
  })
  if (!connector) return null

  const streamRows = await db.query.DataConnectorStream.findMany({
    where: and(
      eq(schema.DataConnectorStream.dataConnectorId, dataConnectorId),
      eq(schema.DataConnectorStream.organizationId, organizationId),
      eq(schema.DataConnectorStream.enabled, true)
    ),
  })

  const streamIds = streamRows.map((s) => s.id)
  const mappingRows =
    streamIds.length === 0
      ? []
      : await db.query.DataConnectorMapping.findMany({
          where: and(
            eq(schema.DataConnectorMapping.organizationId, organizationId),
            inArray(schema.DataConnectorMapping.dataConnectorStreamId, streamIds)
          ),
        })
  const byStream = new Map<string, DataConnectorMappingRow[]>()
  for (const m of mappingRows) {
    const list = byStream.get(m.dataConnectorStreamId) ?? []
    list.push(m)
    byStream.set(m.dataConnectorStreamId, list)
  }

  const streams: StreamWithMappings[] = streamRows
    .map((stream) => ({
      stream,
      syncMode: stream.syncMode as SyncMode,
      // Drop untargeted mappings (created before the user picked a def) — a fetch
      // with nowhere to land is a no-op.
      mappings: (byStream.get(stream.id) ?? [])
        .filter((m) => m.entityDefinitionId !== null)
        .map(decodeMapping),
    }))
    // Skip unconfigured streams: no targeted mappings, or not yet named (a blank
    // stream has no streamKey, so there's nothing to fetch).
    .filter((s) => s.mappings.length > 0 && !!s.stream.streamKey)

  return { connector, streams }
}

// ── Concurrency guard (mirror runSourceSync) ──────────────────────────────────

/**
 * Atomically claim the connector for a run by flipping `status → 'syncing'` only
 * if it isn't already syncing. Returns true on claim, false when another run
 * holds it. Manual-click and scheduled-fire dedup.
 */
export async function claimForSync(db: Database, dataConnectorId: string): Promise<boolean> {
  const [claimed] = await db
    .update(schema.DataConnector)
    .set({ status: 'syncing', updatedAt: new Date() })
    .where(
      and(eq(schema.DataConnector.id, dataConnectorId), ne(schema.DataConnector.status, 'syncing'))
    )
    .returning({ id: schema.DataConnector.id })
  return !!claimed
}

// ── Backfill completion latch (B1 — multi-stream coordination) ────────────────

/**
 * Initialize the connector-level backfill completion latch to the number of
 * stream chains that will run. The relationship two-pass + orphan reconciliation
 * are connector-level but each stream backfills as its own continuation chain, so
 * the connector finalize must fire only after the LAST stream completes — never a
 * read-then-act count of sibling streams (which races). The latch is an atomic
 * counter on `DataConnector.state`; the worker calls this once when it enqueues a
 * connector's backfill (Step 4). Stored in the `state` jsonb (no migration).
 */
export async function initConnectorBackfillLatch(
  db: Database,
  dataConnectorId: string,
  streamCount: number
): Promise<void> {
  const T = schema.DataConnector
  await db
    .update(T)
    .set({
      state: sql`jsonb_set(coalesce(${T.state}, '{}'::jsonb), '{backfillStreamsRemaining}', to_jsonb(${streamCount}::int))`,
      updatedAt: new Date(),
    })
    .where(eq(T.id, dataConnectorId))
}

/**
 * Atomically decrement the backfill latch and return the REMAINING count (H3-safe:
 * a single `UPDATE … RETURNING` is row-atomic, so two concurrent final slices can
 * never both read the same pre-decrement value). The stream whose decrement returns
 * `0` is the last to finish and owns the connector-level finalize. Returns `null`
 * when the latch was never initialized — the caller treats that as "finalize now"
 * (a single-stream connector or a legacy run with no latch should still reconcile).
 */
export async function decrementConnectorBackfillLatch(
  db: Database,
  dataConnectorId: string
): Promise<number | null> {
  const T = schema.DataConnector
  const [row] = await db
    .update(T)
    .set({
      state: sql`jsonb_set(${T.state}, '{backfillStreamsRemaining}', to_jsonb(GREATEST((${T.state}->>'backfillStreamsRemaining')::int - 1, 0)))`,
      updatedAt: new Date(),
    })
    .where(
      and(eq(T.id, dataConnectorId), sql`jsonb_exists(${T.state}, 'backfillStreamsRemaining')`)
    )
    .returning({ remaining: sql<number>`(${T.state}->>'backfillStreamsRemaining')::int` })
  return row?.remaining ?? null
}

// ── Runs ────────────────────────────────────────────────────────────────────

/** Mutable counters accumulated across a run, flushed in `finalizeRun`. */
export interface RunCounters {
  fetched: number
  created: number
  updated: number
  skipped: number
  archived: number
  deleted: number
  failed: number
  relationshipWarnings: number
  // `tier` classifies the failure for the two-tier error UI (Step 9 §1.1):
  // 'invalid' = bad shape / missing identity, dropped before the write;
  // 'rejected' = the entity write itself threw. Omitted ⇒ engine-level error
  // (stale sweep / ledger fail), rendered under a neutral "Error" bucket.
  errorSample: Array<{ externalId: string; error: string; tier?: 'invalid' | 'rejected' }>
}

export function newRunCounters(): RunCounters {
  return {
    fetched: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    archived: 0,
    deleted: 0,
    failed: 0,
    relationshipWarnings: 0,
    errorSample: [],
  }
}

/** Open a DataConnectorRun row (status 'running'). */
export async function openRun(
  db: Database,
  input: {
    dataConnectorId: string
    organizationId: string
    trigger: 'manual' | 'scheduled' | 'webhook' | 'backfill' | 'sweep'
    mode: 'snapshot' | 'incremental'
    cursorBefore?: unknown
    /** Engine lifecycle phase (sliced runs); omitted for legacy single-shot runs. */
    phase?: 'backfill' | 'steady'
    /** Pinned decoded stream+mapping snapshot the continuation chain runs against (B2). */
    chainSnapshot?: Record<string, unknown>
    /** Per-stream sample cap (trial-sync §4.1) — set ⇒ a SAMPLE run that parks for review. */
    sampleLimit?: number | null
  }
): Promise<DataConnectorRunRow> {
  const [run] = await db
    .insert(schema.DataConnectorRun)
    .values({
      dataConnectorId: input.dataConnectorId,
      organizationId: input.organizationId,
      trigger: input.trigger,
      mode: input.mode,
      status: 'running',
      phase: input.phase ?? null,
      chainSnapshot: input.chainSnapshot ?? null,
      cursorBefore: input.cursorBefore ?? null,
      sampleLimit: input.sampleLimit ?? null,
    })
    .returning()
  if (!run) throw new Error('Failed to open DataConnectorRun')
  return run
}

/** Finalize a run with accumulated counts + duration. */
export async function finalizeRun(
  db: Database,
  runId: string,
  input: {
    status: 'completed' | 'failed' | 'partial'
    counters: RunCounters
    cursorAfter?: unknown
    startedAt: Date
  }
): Promise<void> {
  const c = input.counters
  await db
    .update(schema.DataConnectorRun)
    .set({
      status: input.status,
      fetched: c.fetched,
      created: c.created,
      updated: c.updated,
      skipped: c.skipped,
      archived: c.archived,
      deleted: c.deleted,
      failed: c.failed,
      relationshipWarnings: c.relationshipWarnings,
      errorSample: c.errorSample.length > 0 ? c.errorSample.slice(0, 50) : null,
      cursorAfter: input.cursorAfter ?? null,
      finishedAt: new Date(),
      durationMs: Date.now() - input.startedAt.getTime(),
    })
    .where(eq(schema.DataConnectorRun.id, runId))
}

/**
 * Set or clear the run's transient "rate-limited" progress signal (Step 9 §3.1).
 * Written at the slice re-enqueue site: set to `{ until }` when the next slice is
 * delayed on a 429 (so the status line can show a live "retrying in 0:28"
 * countdown), cleared on the next clean slice. Uses `jsonb_set` / key-removal on the
 * `{rateLimited}` path so it never clobbers the sibling `{checkpoints}` the ledger
 * writes into the same `progress` jsonb.
 */
export async function setRunRateLimited(
  db: Database,
  runId: string,
  untilIso: string | null
): Promise<void> {
  const T = schema.DataConnectorRun
  const progress = untilIso
    ? sql`jsonb_set(coalesce(${T.progress}, '{}'::jsonb), '{rateLimited}', jsonb_build_object('until', ${untilIso}::text), true)`
    : sql`coalesce(${T.progress}, '{}'::jsonb) - 'rateLimited'`
  await db.update(T).set({ progress }).where(eq(T.id, runId))
}

/** Finalize the connector lifecycle after a run (success → live, else error). */
export async function finalizeConnector(
  db: Database,
  dataConnectorId: string,
  input: { ok: boolean; itemCount?: number; error?: string }
): Promise<void> {
  if (input.ok) {
    await db
      .update(schema.DataConnector)
      .set({
        status: 'live',
        lastSyncedAt: new Date(),
        itemCount: input.itemCount ?? 0,
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.DataConnector.id, dataConnectorId))
  } else {
    // A crashed/swept/failed run never ran the success bookkeeping, so the connector
    // would report `itemCount: 0` / "never synced" even when records DID land (a stale
    // sweep after a partial backfill). Refresh the count from the bound items so the
    // connector tells the truth, and stamp `lastSyncedAt` when anything was ingested
    // (kept null on a zero-ingest failure → still shows "never synced").
    const itemCount = await countConnectorItems(db, dataConnectorId)
    await db
      .update(schema.DataConnector)
      .set({
        status: 'error',
        error: input.error ?? 'Unknown error',
        itemCount,
        ...(itemCount > 0 ? { lastSyncedAt: new Date() } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.DataConnector.id, dataConnectorId))
  }
}

/** Current run-level fetched count (the per-run ingest total folded by the ledger). */
export async function getRunFetched(db: Database, runId: string): Promise<number> {
  const row = await db.query.DataConnectorRun.findFirst({
    where: eq(schema.DataConnectorRun.id, runId),
    columns: { fetched: true },
  })
  return row?.fetched ?? 0
}

/**
 * Park a backfill that crossed the per-run ingest ceiling (§3). Marks the run
 * `partial` (NOT `failed` — it's a clean stop, not an error) with a `paused` note for
 * the status line, and releases the connector to `paused` (NOT left `syncing` — that's
 * the §1 strand trap). The stream cursor is left checkpointed, so a later "resume"
 * (re-trigger after bumping the ceiling) continues mid-chain instead of from page 1.
 */
export async function parkBackfillAtCeiling(
  db: Database,
  input: {
    runId: string
    dataConnectorId: string
    fetched: number
    ceiling: number
    startedAt: Date
  }
): Promise<void> {
  const message = `Backfill paused at ${input.fetched} records (limit ${input.ceiling}). Raise the limit or narrow the source, then resume.`
  const T = schema.DataConnectorRun
  await db
    .update(T)
    .set({
      status: 'partial',
      finishedAt: new Date(),
      durationMs: Date.now() - input.startedAt.getTime(),
      progress: sql`jsonb_set(coalesce(${T.progress}, '{}'::jsonb), '{paused}', jsonb_build_object('reason', 'ingest-ceiling', 'atRecords', ${input.fetched}::int, 'ceiling', ${input.ceiling}::int), true)`,
    })
    .where(eq(T.id, input.runId))
  // A parked backfill has ingested records (it hit the ceiling), so reflect the real
  // count + stamp `lastSyncedAt` — don't leave the connector showing "0 / never synced".
  const itemCount = await countConnectorItems(db, input.dataConnectorId)
  await db
    .update(schema.DataConnector)
    .set({
      status: 'paused',
      error: message,
      itemCount,
      ...(itemCount > 0 ? { lastSyncedAt: new Date() } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.DataConnector.id, input.dataConnectorId))
}

/**
 * Park a backfill that hit its per-stream SAMPLE cap (trial-sync §4.2). The same
 * mechanism as `parkBackfillAtCeiling` — `partial` run, `paused` connector, cursors
 * left checkpointed so "Sync everything" resumes mid-chain — but stamped
 * `paused.reason = 'sample'` with friendlier copy, since a sample park is a positive,
 * voluntary stop ("here are a few, review them"), not a guardrail trip. Called by the
 * LAST stream to stop (gated through `parkConnectorSampleIfLastStream`).
 */
export async function parkBackfillAtSample(
  db: Database,
  input: {
    runId: string
    dataConnectorId: string
    fetched: number
    sampleLimit: number
    startedAt: Date
  }
): Promise<void> {
  const message = `Sample of ${input.fetched} records imported. Review them, then sync everything.`
  const T = schema.DataConnectorRun
  await db
    .update(T)
    .set({
      status: 'partial',
      finishedAt: new Date(),
      durationMs: Date.now() - input.startedAt.getTime(),
      progress: sql`jsonb_set(coalesce(${T.progress}, '{}'::jsonb), '{paused}', jsonb_build_object('reason', 'sample', 'atRecords', ${input.fetched}::int, 'sampleLimit', ${input.sampleLimit}::int), true)`,
    })
    .where(eq(T.id, input.runId))
  // A sample park has ingested real records, so reflect the count + stamp `lastSyncedAt`
  // — the sample is kept, not throwaway. The connector reads `paused`; the positive copy
  // is surfaced by the review banner (which discriminates on `paused.reason`).
  const itemCount = await countConnectorItems(db, input.dataConnectorId)
  await db
    .update(schema.DataConnector)
    .set({
      status: 'paused',
      error: message,
      itemCount,
      ...(itemCount > 0 ? { lastSyncedAt: new Date() } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.DataConnector.id, input.dataConnectorId))
}

/**
 * Coordinate a sample park across a connector's stream chains (trial-sync §4.2). Each
 * stream that stops sampling — whether it hit the cap (orchestrator) or naturally
 * exhausted first (sync-source `finalizeBackfill`) — calls this. It decrements the
 * shared B1 completion latch; only the LAST stream to stop (`remaining === 0`, or a
 * single-stream connector with no latch) actually parks the run + connector. A
 * non-last stream just leaves its cursor checkpointed and returns. No reconciliation
 * runs (a sample is partial by construction — archiving unreached records would be
 * the §3 ceiling-park danger); resolution happens on the full-sync resume's finalize.
 */
export async function parkConnectorSampleIfLastStream(
  db: Database,
  input: {
    runId: string
    dataConnectorId: string
    sampleLimit: number
    startedAt: Date
  }
): Promise<void> {
  const remaining = await decrementConnectorBackfillLatch(db, input.dataConnectorId)
  if (remaining !== null && remaining > 0) return
  const fetched = await getRunFetched(db, input.runId)
  await parkBackfillAtSample(db, { ...input, fetched })
}

/** Persist a stream's incremental cursor after the stream completes. */
export async function persistStreamState(
  db: Database,
  streamId: string,
  state: Record<string, unknown>
): Promise<void> {
  await db
    .update(schema.DataConnectorStream)
    .set({ state, updatedAt: new Date() })
    .where(eq(schema.DataConnectorStream.id, streamId))
}

// ── DataConnectorItem (the durable binding) ───────────────────────────────────

/** Count bound items for a connector via SQL `count()` (G7 — O(1), not select-all). */
export async function countConnectorItems(db: Database, dataConnectorId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(schema.DataConnectorItem)
    .where(eq(schema.DataConnectorItem.dataConnectorId, dataConnectorId))
  return row?.n ?? 0
}

/** Count bound items for a single mapping (mapping-edit banner message). */
export async function countMappingItems(
  db: DbOrTx,
  dataConnectorId: string,
  mappingId: string
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(schema.DataConnectorItem)
    .where(
      and(
        eq(schema.DataConnectorItem.dataConnectorId, dataConnectorId),
        eq(schema.DataConnectorItem.mappingId, mappingId)
      )
    )
  return row?.n ?? 0
}

// ── Pending re-sync marker (mapping-edit safety, Layer 2) ─────────────────────

/**
 * Stamp the pending re-sync marker, MERGING with any existing one so an escalating
 * sequence of edits (e.g. a `rebackfill` then a `rebind`) keeps the highest level
 * and the union of affected streams/reasons. Idempotent within a transaction.
 */
export async function stampResyncPending(
  db: DbOrTx,
  dataConnectorId: string,
  next: ResyncPending
): Promise<void> {
  const row = await db.query.DataConnector.findFirst({
    where: eq(schema.DataConnector.id, dataConnectorId),
    columns: { resyncPending: true },
  })
  const prev = row?.resyncPending ?? null
  const merged: ResyncPending = prev
    ? {
        level: maxLevel(prev.level, next.level),
        reasons: Array.from(new Set([...prev.reasons, ...next.reasons])),
        streamIds: Array.from(new Set([...prev.streamIds, ...next.streamIds])),
        itemCount: Math.max(prev.itemCount, next.itemCount),
        at: next.at,
      }
    : next
  await db
    .update(schema.DataConnector)
    .set({ resyncPending: merged, updatedAt: new Date() })
    .where(eq(schema.DataConnector.id, dataConnectorId))
}

/** Clear the pending re-sync marker (after a full backfill, or on Backfill now). */
export async function clearResyncPending(db: DbOrTx, dataConnectorId: string): Promise<void> {
  await db
    .update(schema.DataConnector)
    .set({ resyncPending: null, updatedAt: new Date() })
    .where(eq(schema.DataConnector.id, dataConnectorId))
}

/**
 * Stamp `lastWebhookEventAt` to NOW — the connector just processed an app-trigger
 * webhook delivery (sync-bridge §9 observability). Webhook syncs are point writes
 * that open no run + never touch `lastSyncedAt`, so this is the only liveness signal
 * a webhook-sync connector has. Stamped per received event (incl. filtered/delete/
 * no-op) so the connector never reads as inactive while deliveries are flowing.
 *
 * Self-heal: this is called only after a slice succeeds, so a healthy delivery also
 * clears a stale `error` left by a failed backfill/manual run — webhook syncs open no
 * run, so `finalizeConnector` never runs to reset status, and the connector would
 * otherwise show `error` forever while deliveries flow fine. The CASE reads the
 * pre-update row, so it touches ONLY an `error` status — never overriding a concurrent
 * `syncing`/`paused`/`live` (those self-resolve via their own paths).
 */
export async function stampWebhookEvent(db: Database, dataConnectorId: string): Promise<void> {
  const T = schema.DataConnector
  await db
    .update(T)
    .set({
      lastWebhookEventAt: new Date(),
      status: sql`CASE WHEN ${T.status} = 'error' THEN 'live' ELSE ${T.status} END`,
      error: sql`CASE WHEN ${T.status} = 'error' THEN NULL ELSE ${T.error} END`,
      updatedAt: new Date(),
    })
    .where(eq(T.id, dataConnectorId))
}

/** Exact-bind lookup: (dataConnectorId, mappingId, externalId) → item row. */
export async function findItem(
  db: Database,
  dataConnectorId: string,
  mappingId: string,
  externalId: string
): Promise<DataConnectorItemRow | null> {
  const row = await db.query.DataConnectorItem.findFirst({
    where: and(
      eq(schema.DataConnectorItem.dataConnectorId, dataConnectorId),
      eq(schema.DataConnectorItem.mappingId, mappingId),
      eq(schema.DataConnectorItem.externalId, externalId)
    ),
  })
  return row ?? null
}

/** All item rows for a mapping (orphan diffing). */
export async function listItemsForMapping(
  db: Database,
  dataConnectorId: string,
  mappingId: string
): Promise<DataConnectorItemRow[]> {
  return db.query.DataConnectorItem.findMany({
    where: and(
      eq(schema.DataConnectorItem.dataConnectorId, dataConnectorId),
      eq(schema.DataConnectorItem.mappingId, mappingId)
    ),
  })
}

/** Item rows for a mapping carrying unresolved pending relations (two-pass input). */
export async function listItemsWithPendingRelations(
  db: Database,
  dataConnectorId: string
): Promise<DataConnectorItemRow[]> {
  const rows = await db.query.DataConnectorItem.findMany({
    where: eq(schema.DataConnectorItem.dataConnectorId, dataConnectorId),
  })
  return rows.filter((r) => Array.isArray(r.pendingRelations) && r.pendingRelations.length > 0)
}

export interface PendingRelation {
  fieldKey: string
  targetMappingId: string
  targetExternalId: string
}

export interface UpsertItemInput {
  dataConnectorId: string
  organizationId: string
  mappingId: string
  externalId: string
  entityDefinitionId: string
  entityInstanceId: string
  contentHash: string
  managedFields: string[]
  pendingRelations?: PendingRelation[]
  upstreamUpdatedAt?: Date | null
  lastSeenRunId: string
}

/**
 * Create or update the binding keyed by (dataConnectorId, mappingId, externalId).
 * Clears `archivedAt`, stamps `lastSeenRunId`/`lastSyncedAt`, and merges the
 * supplied pending relations onto the row (resolved in the two-pass).
 */
export async function upsertItem(
  db: Database,
  input: UpsertItemInput
): Promise<DataConnectorItemRow> {
  const now = new Date()
  const existing = await findItem(db, input.dataConnectorId, input.mappingId, input.externalId)

  if (existing) {
    const [row] = await db
      .update(schema.DataConnectorItem)
      .set({
        entityInstanceId: input.entityInstanceId,
        entityDefinitionId: input.entityDefinitionId,
        contentHash: input.contentHash,
        managedFields: input.managedFields,
        pendingRelations: input.pendingRelations ?? existing.pendingRelations ?? null,
        upstreamUpdatedAt: input.upstreamUpdatedAt ?? existing.upstreamUpdatedAt,
        lastSeenRunId: input.lastSeenRunId,
        lastSyncedAt: now,
        archivedAt: null,
        error: null,
      })
      .where(eq(schema.DataConnectorItem.id, existing.id))
      .returning()
    return row!
  }

  const [row] = await db
    .insert(schema.DataConnectorItem)
    .values({
      dataConnectorId: input.dataConnectorId,
      organizationId: input.organizationId,
      mappingId: input.mappingId,
      externalId: input.externalId,
      entityDefinitionId: input.entityDefinitionId,
      entityInstanceId: input.entityInstanceId,
      contentHash: input.contentHash,
      managedFields: input.managedFields,
      pendingRelations: input.pendingRelations ?? null,
      upstreamUpdatedAt: input.upstreamUpdatedAt ?? null,
      lastSeenRunId: input.lastSeenRunId,
      lastSyncedAt: now,
    })
    .returning()
  return row!
}

/**
 * Stamp `lastSeenRunId` on an unchanged item (skip-unchanged path). When a newer
 * `upstreamUpdatedAt` is supplied it is advanced too, so the stored value stays a
 * true high-watermark even on a no-op content update — the out-of-order guard
 * (sync-bridge §9 Q7) needs the freshest version it has seen, not the last it wrote.
 */
export async function touchItem(
  db: Database,
  itemId: string,
  lastSeenRunId: string,
  upstreamUpdatedAt?: Date | null
): Promise<void> {
  await db
    .update(schema.DataConnectorItem)
    .set({
      lastSeenRunId,
      lastSyncedAt: new Date(),
      ...(upstreamUpdatedAt ? { upstreamUpdatedAt } : {}),
    })
    .where(eq(schema.DataConnectorItem.id, itemId))
}

/** Clear resolved pending relations on an item, leaving any still-unresolved. */
export async function setItemPendingRelations(
  db: Database,
  itemId: string,
  pendingRelations: PendingRelation[]
): Promise<void> {
  await db
    .update(schema.DataConnectorItem)
    .set({ pendingRelations: pendingRelations.length > 0 ? pendingRelations : null })
    .where(eq(schema.DataConnectorItem.id, itemId))
}

/** Mark an item archived (set archivedAt). */
export async function markItemArchived(
  db: Database,
  itemId: string,
  lastSeenRunId?: string
): Promise<void> {
  await db
    .update(schema.DataConnectorItem)
    .set({
      archivedAt: new Date(),
      ...(lastSeenRunId ? { lastSeenRunId } : {}),
    })
    .where(eq(schema.DataConnectorItem.id, itemId))
}

// ── Reads for the (later) tRPC router ─────────────────────────────────────────

/** List connectors for an org. */
export async function listConnectors(
  db: Database,
  organizationId: string
): Promise<DataConnectorRow[]> {
  return db.query.DataConnector.findMany({
    where: eq(schema.DataConnector.organizationId, organizationId),
    orderBy: desc(schema.DataConnector.createdAt),
  })
}

/** Get one connector by id, org-scoped. */
export async function getConnector(
  db: Database,
  organizationId: string,
  id: string
): Promise<Result<DataConnectorRow, Error>> {
  const row = await db.query.DataConnector.findFirst({
    where: and(
      eq(schema.DataConnector.id, id),
      eq(schema.DataConnector.organizationId, organizationId)
    ),
  })
  return row ? ok(row) : err(new Error(`DataConnector not found: ${id}`))
}

/** List runs for a connector, newest first. */
export async function listRuns(
  db: Database,
  organizationId: string,
  dataConnectorId: string,
  limit = 50
): Promise<DataConnectorRunRow[]> {
  return db.query.DataConnectorRun.findMany({
    where: and(
      eq(schema.DataConnectorRun.dataConnectorId, dataConnectorId),
      eq(schema.DataConnectorRun.organizationId, organizationId)
    ),
    orderBy: desc(schema.DataConnectorRun.startedAt),
    limit,
  })
}

/** A stream row with its raw (undecoded) mapping rows nested. */
export interface StreamWithRawMappings extends DataConnectorStreamRow {
  mappings: DataConnectorMappingRow[]
}

/**
 * List a connector's streams, each with its mapping rows nested. One batched
 * mapping query (not N per stream). Org-scoped on both queries as defense-in-depth
 * — callers also gate via `getConnector`, but the read shouldn't rely on that.
 */
export async function listStreams(
  db: Database,
  organizationId: string,
  dataConnectorId: string
): Promise<StreamWithRawMappings[]> {
  const streamRows = await db.query.DataConnectorStream.findMany({
    where: and(
      eq(schema.DataConnectorStream.dataConnectorId, dataConnectorId),
      eq(schema.DataConnectorStream.organizationId, organizationId)
    ),
    orderBy: asc(schema.DataConnectorStream.createdAt),
  })
  const ids = streamRows.map((s) => s.id)
  const mappingRows =
    ids.length === 0
      ? []
      : await db.query.DataConnectorMapping.findMany({
          where: and(
            eq(schema.DataConnectorMapping.organizationId, organizationId),
            inArray(schema.DataConnectorMapping.dataConnectorStreamId, ids)
          ),
          orderBy: asc(schema.DataConnectorMapping.createdAt),
        })
  const byStream = new Map<string, DataConnectorMappingRow[]>()
  for (const m of mappingRows) {
    const list = byStream.get(m.dataConnectorStreamId) ?? []
    list.push(m)
    byStream.set(m.dataConnectorStreamId, list)
  }
  return streamRows.map((s) => ({ ...s, mappings: byStream.get(s.id) ?? [] }))
}

export { defaultDb, logger as serviceLogger }
