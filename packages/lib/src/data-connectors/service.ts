// packages/lib/src/data-connectors/service.ts
// Functional service layer over the 5 Data Connector control tables. Drizzle +
// neverthrow; no model classes (project convention). The orchestrator, sink, and
// (later) tRPC router consume these helpers. Policy unions (identity/merge/link)
// are stored as jsonb/text and cast to the canonical lib types at this boundary.

import { type Database, database as defaultDb, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import type {
  FieldMapping,
  FieldMergeStrategy,
  LinkMode,
  OrphanBehavior,
  SyncMode,
  TargetMode,
} from './types'

const logger = createScopedLogger('data-connector-service')

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
  fieldMappings: Record<string, FieldMapping>
  mergeStrategies: Record<string, FieldMergeStrategy>
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
 * Untargeted mappings (no `entityDefinitionId`, e.g. a freshly-seeded root) are
 * never synced — callers filter them out before decoding, so a null here is a
 * programming error.
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
    fieldMappings: row.fieldMappings ?? {},
    mergeStrategies: row.mergeStrategies ?? {},
  }
}

// ── Load ──────────────────────────────────────────────────────────────────────

/**
 * Load a connector plus its enabled streams and their mappings. Returns null
 * when the connector doesn't exist (or belongs to another org). Streams with no
 * mappings are dropped — a fetch with nowhere to land is a no-op.
 */
export async function loadConnector(
  db: Database,
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
      // Drop untargeted mappings (a seeded root the user hasn't pointed at a def
      // yet) — a fetch with nowhere to land is a no-op.
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
  errorSample: Array<{ externalId: string; error: string }>
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
    trigger: 'manual' | 'scheduled' | 'webhook' | 'backfill'
    mode: 'snapshot' | 'incremental'
    cursorBefore?: unknown
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
      cursorBefore: input.cursorBefore ?? null,
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
    await db
      .update(schema.DataConnector)
      .set({ status: 'error', error: input.error ?? 'Unknown error', updatedAt: new Date() })
      .where(eq(schema.DataConnector.id, dataConnectorId))
  }
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

/** Stamp `lastSeenRunId` on an unchanged item (skip-unchanged path). */
export async function touchItem(
  db: Database,
  itemId: string,
  lastSeenRunId: string
): Promise<void> {
  await db
    .update(schema.DataConnectorItem)
    .set({ lastSeenRunId, lastSyncedAt: new Date() })
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
