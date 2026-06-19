// packages/lib/src/data-connectors/mutations.ts
// Functional mutation + setup helpers over the Data Connector control tables.
// Drizzle + neverthrow, no model classes (project convention). The tRPC router
// (apps/web) consumes these; the engine/orchestrator stays read-only here. Scheduler
// re-registration is driven from create/update (pause/resume is a `status` patch
// through update) so a cadence or lifecycle change is reflected in BullMQ immediately.

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { BadRequestError, NotFoundError } from '../errors'
import { removeConnectorScheduler, syncConnectorScheduler } from './data-connector-scheduler'
import type { DataConnectorMappingRow, DataConnectorRow, DataConnectorStreamRow } from './service'
import type { ConnectorTemplate } from './templates'
import type {
  DataConnectorConfig,
  DataConnectorType,
  FieldMapping,
  FieldMergeStrategy,
  LinkMode,
  OrphanBehavior,
  ScheduledTriggerConfig,
  StreamRequestConfig,
  SyncMode,
  TargetMode,
} from './types'

const logger = createScopedLogger('data-connector-mutations')

// ── Connector lifecycle ───────────────────────────────────────────────────────

export interface CreateConnectorInput {
  name: string
  type: DataConnectorType
  definitionKind?: 'builtin' | 'app'
  /** Provenance when seeded from a first-party connector template (05c). */
  templateId?: string | null
  config?: DataConnectorConfig
  credentialId?: string | null
  appInstallationId?: string | null
  syncBehavior?: 'manual' | 'scheduled' | 'webhook'
  scheduleConfig?: ScheduledTriggerConfig | null
  createdById?: string | null
}

/** Load a connector or throw NotFoundError (org-scoped). */
async function loadConnectorRow(
  db: Database,
  organizationId: string,
  id: string
): Promise<DataConnectorRow> {
  const row = await db.query.DataConnector.findFirst({
    where: and(
      eq(schema.DataConnector.id, id),
      eq(schema.DataConnector.organizationId, organizationId)
    ),
  })
  if (!row) throw new NotFoundError(`Data connector '${id}' not found`)
  return row
}

/** Create a connector (status 'pending'). Registers its scheduler if scheduled. */
export async function createConnector(
  db: Database,
  organizationId: string,
  input: CreateConnectorInput
): Promise<DataConnectorRow> {
  const [row] = await db
    .insert(schema.DataConnector)
    .values({
      organizationId,
      name: input.name,
      type: input.type,
      definitionKind: input.definitionKind ?? (input.type.startsWith('app:') ? 'app' : 'builtin'),
      templateId: input.templateId ?? null,
      config: input.config ?? {},
      credentialId: input.credentialId ?? null,
      appInstallationId: input.appInstallationId ?? null,
      syncBehavior: input.syncBehavior ?? 'manual',
      scheduleConfig: input.scheduleConfig ?? null,
      status: 'pending',
      createdById: input.createdById ?? null,
    })
    .returning()
  if (!row) throw new Error('Failed to create data connector')
  await syncConnectorScheduler(row)
  return row
}

/**
 * Create a connector seeded from a first-party connector template (05c §5). A
 * template instance *is* a `generic-rest` connector — this is pure composition
 * over the existing write helpers (`createConnector` + `addStream`), the same
 * sequence the manual setup UI drives, run from declared data:
 *   - the connector's `config` (base URL + shared headers + pagination) and
 *   - each stream's source schema + request config, pre-filled and editable.
 *
 * v1 seeds config + streams only; entity mappings stay user-authored (the root
 * mapping `addStream` seeds is the spine, exactly as for a blank connector). The
 * `templateId` stamp is provenance — seed-and-forget, no live link back.
 */
export async function createConnectorFromTemplate(
  db: Database,
  organizationId: string,
  input: Omit<CreateConnectorInput, 'type' | 'definitionKind' | 'templateId' | 'config'>,
  template: ConnectorTemplate
): Promise<DataConnectorRow> {
  const connector = await createConnector(db, organizationId, {
    ...input,
    type: 'generic-rest',
    // definitionKind stays 'builtin' (default) — a template instance is generic-rest.
    templateId: template.id,
    config: template.config,
  })
  for (const stream of template.streams) {
    await addStream(db, organizationId, connector.id, {
      streamKey: stream.streamKey,
      sourceSchema: stream.sourceSchema ?? null,
      schemaSource: 'catalog',
      syncMode: stream.syncMode,
      requestConfig: stream.requestConfig,
    })
  }
  return connector
}

export interface UpdateConnectorInput {
  name?: string
  config?: DataConnectorConfig
  credentialId?: string | null
  appInstallationId?: string | null
  syncBehavior?: 'manual' | 'scheduled' | 'webhook'
  scheduleConfig?: ScheduledTriggerConfig | null
  // Lifecycle toggle. 'paused' stops scheduled fires (cadence retained); 'live'
  // resumes. Other states are engine-owned and not settable here.
  status?: 'paused' | 'live'
}

/**
 * Update a connector; re-register the scheduler to match the new cadence/status.
 * `syncConnectorScheduler` keys off the returned row's `status`/`syncBehavior`, so
 * toggling `status` to 'paused'/'live' transparently removes/re-registers the
 * BullMQ scheduler — no separate pause/resume path needed.
 */
export async function updateConnector(
  db: Database,
  organizationId: string,
  id: string,
  patch: UpdateConnectorInput
): Promise<DataConnectorRow> {
  await loadConnectorRow(db, organizationId, id)
  // Selecting manual/webhook clears the cadence so the scheduler is removed.
  const scheduleConfig =
    patch.syncBehavior && patch.syncBehavior !== 'scheduled'
      ? null
      : (patch.scheduleConfig ?? undefined)
  const [row] = await db
    .update(schema.DataConnector)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.config !== undefined ? { config: patch.config } : {}),
      ...(patch.credentialId !== undefined ? { credentialId: patch.credentialId } : {}),
      ...(patch.appInstallationId !== undefined
        ? { appInstallationId: patch.appInstallationId }
        : {}),
      ...(patch.syncBehavior !== undefined ? { syncBehavior: patch.syncBehavior } : {}),
      ...(scheduleConfig !== undefined ? { scheduleConfig } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.DataConnector.id, id))
    .returning()
  if (!row) throw new Error('Failed to update data connector')
  await syncConnectorScheduler(row)
  return row
}

export type DeleteSyncedDataBehavior = 'keep' | 'archive' | 'delete'

/**
 * Delete a connector. The provisioned def/fields and synced entity records are the
 * user's CRM data — we never auto-delete them. `behavior` governs the bound
 * EntityInstances (via DataConnectorItem):
 *   - 'keep'    → leave records untouched (default).
 *   - 'archive' → soft-delete the bound instances (set archivedAt).
 *   - 'delete'  → hard-delete the bound instances.
 * The DataConnector row + its streams/mappings/items/runs cascade on delete; the
 * `dataConnectorId` FK on EntityDefinition/CustomField is `set null`, so provisioned
 * schema survives (now an ordinary user-owned def/field).
 */
export async function deleteConnector(
  db: Database,
  organizationId: string,
  id: string,
  behavior: DeleteSyncedDataBehavior = 'keep'
): Promise<{ success: boolean }> {
  await loadConnectorRow(db, organizationId, id)
  await removeConnectorScheduler(id)

  if (behavior !== 'keep') {
    const items = await db.query.DataConnectorItem.findMany({
      where: eq(schema.DataConnectorItem.dataConnectorId, id),
      columns: { entityInstanceId: true },
    })
    const instanceIds = items.map((i) => i.entityInstanceId).filter((v): v is string => v !== null)
    if (instanceIds.length > 0) {
      if (behavior === 'archive') {
        for (const instanceId of instanceIds) {
          await db
            .update(schema.EntityInstance)
            .set({ archivedAt: new Date() })
            .where(eq(schema.EntityInstance.id, instanceId))
        }
      } else {
        for (const instanceId of instanceIds) {
          await db.delete(schema.EntityInstance).where(eq(schema.EntityInstance.id, instanceId))
        }
      }
    }
  }

  await db.delete(schema.DataConnector).where(eq(schema.DataConnector.id, id))
  logger.info('Deleted data connector', { id, behavior })
  return { success: true }
}

// ── Streams ─────────────────────────────────────────────────────────────────

export interface AddStreamInput {
  /** Omitted for a blank, not-yet-named stream — the user names it inline later. */
  streamKey?: string | null
  sourceSchema?: Record<string, unknown> | null
  schemaSource?: 'catalog' | 'inferred' | 'manual'
  syncMode?: SyncMode
  requestConfig?: StreamRequestConfig | null
  enabled?: boolean
}

/** Create a stream under a connector. */
export async function addStream(
  db: Database,
  organizationId: string,
  dataConnectorId: string,
  input: AddStreamInput
): Promise<DataConnectorStreamRow> {
  await loadConnectorRow(db, organizationId, dataConnectorId)
  const [row] = await db
    .insert(schema.DataConnectorStream)
    .values({
      dataConnectorId,
      organizationId,
      streamKey: input.streamKey ?? null,
      sourceSchema: input.sourceSchema ?? null,
      schemaSource: input.schemaSource ?? 'catalog',
      syncMode: input.syncMode ?? 'snapshot',
      requestConfig: input.requestConfig ?? null,
      enabled: input.enabled ?? true,
    })
    .returning()
  if (!row) throw new Error('Failed to add stream')

  // Seed the single root mapping (source-first model — one spine per stream). No
  // schema yet, so `rootPath: ''`; the UI self-heals it to '[]' for an array root.
  // No target def yet — the user picks one in the mapping editor.
  await db.insert(schema.DataConnectorMapping).values({
    dataConnectorStreamId: row.id,
    organizationId,
    rootPath: '',
    linkMode: 'upsert',
    targetMode: 'contributing',
    entityDefinitionId: null,
    fieldMappings: {},
    mergeStrategies: {},
    orphanBehavior: 'ignore',
  })
  return row
}

/** Rename a stream (update its streamKey). */
export async function updateStream(
  db: Database,
  organizationId: string,
  streamId: string,
  input: { streamKey?: string }
): Promise<DataConnectorStreamRow> {
  await loadStreamRow(db, organizationId, streamId)
  const [row] = await db
    .update(schema.DataConnectorStream)
    .set({
      ...(input.streamKey !== undefined ? { streamKey: input.streamKey } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.DataConnectorStream.id, streamId))
    .returning()
  if (!row) throw new Error('Failed to update stream')
  return row
}

/** Load a stream org-scoped or throw. */
async function loadStreamRow(
  db: Database,
  organizationId: string,
  streamId: string
): Promise<DataConnectorStreamRow> {
  const row = await db.query.DataConnectorStream.findFirst({
    where: and(
      eq(schema.DataConnectorStream.id, streamId),
      eq(schema.DataConnectorStream.organizationId, organizationId)
    ),
  })
  if (!row) throw new NotFoundError(`Data connector stream '${streamId}' not found`)
  return row
}

/** Set a stream's source schema + provenance (Layer A, 05 §4). */
export async function setStreamSchema(
  db: Database,
  organizationId: string,
  streamId: string,
  input: {
    sourceSchema: Record<string, unknown>
    schemaSource: 'catalog' | 'inferred' | 'manual'
    sampleRunId?: string | null
  }
): Promise<DataConnectorStreamRow> {
  await loadStreamRow(db, organizationId, streamId)
  const [row] = await db
    .update(schema.DataConnectorStream)
    .set({
      sourceSchema: input.sourceSchema,
      schemaSource: input.schemaSource,
      ...(input.sampleRunId !== undefined ? { sampleRunId: input.sampleRunId } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.DataConnectorStream.id, streamId))
    .returning()
  if (!row) throw new Error('Failed to set stream schema')
  return row
}

/** Set a stream's generic-rest request config + sync mode. */
export async function setStreamRequestConfig(
  db: Database,
  organizationId: string,
  streamId: string,
  input: { requestConfig: StreamRequestConfig; syncMode?: SyncMode; enabled?: boolean }
): Promise<DataConnectorStreamRow> {
  await loadStreamRow(db, organizationId, streamId)
  const [row] = await db
    .update(schema.DataConnectorStream)
    .set({
      requestConfig: input.requestConfig,
      ...(input.syncMode !== undefined ? { syncMode: input.syncMode } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.DataConnectorStream.id, streamId))
    .returning()
  if (!row) throw new Error('Failed to set stream request config')
  return row
}

/** Remove a stream (its mappings + items cascade on delete). */
export async function removeStream(
  db: Database,
  organizationId: string,
  streamId: string
): Promise<{ success: boolean }> {
  await loadStreamRow(db, organizationId, streamId)
  await db.delete(schema.DataConnectorStream).where(eq(schema.DataConnectorStream.id, streamId))
  return { success: true }
}

// ── Mappings ──────────────────────────────────────────────────────────────────

export interface AddMappingInput {
  dataConnectorStreamId: string
  rootPath?: string
  linkMode?: LinkMode
  targetMode: TargetMode
  entityDefinitionId: string
  parentMappingId?: string | null
  relationshipFieldKey?: string | null
  fieldMappings?: Record<string, FieldMapping>
  mergeStrategies?: Record<string, FieldMergeStrategy>
  orphanBehavior?: OrphanBehavior
}

/** Create a mapping (one target def a fetch lands in). */
export async function addMapping(
  db: Database,
  organizationId: string,
  input: AddMappingInput
): Promise<DataConnectorMappingRow> {
  await loadStreamRow(db, organizationId, input.dataConnectorStreamId)
  const [row] = await db
    .insert(schema.DataConnectorMapping)
    .values({
      dataConnectorStreamId: input.dataConnectorStreamId,
      organizationId,
      rootPath: input.rootPath ?? '',
      linkMode: input.linkMode ?? 'upsert',
      targetMode: input.targetMode,
      entityDefinitionId: input.entityDefinitionId,
      parentMappingId: input.parentMappingId ?? null,
      relationshipFieldKey: input.relationshipFieldKey ?? null,
      fieldMappings: input.fieldMappings ?? {},
      mergeStrategies: input.mergeStrategies ?? {},
      orphanBehavior: input.orphanBehavior ?? 'ignore',
    })
    .returning()
  if (!row) throw new Error('Failed to add mapping')
  return row
}

/** Load a mapping org-scoped or throw. */
async function loadMappingRow(
  db: Database,
  organizationId: string,
  mappingId: string
): Promise<DataConnectorMappingRow> {
  const row = await db.query.DataConnectorMapping.findFirst({
    where: and(
      eq(schema.DataConnectorMapping.id, mappingId),
      eq(schema.DataConnectorMapping.organizationId, organizationId)
    ),
  })
  if (!row) throw new NotFoundError(`Data connector mapping '${mappingId}' not found`)
  return row
}

export interface UpdateMappingInput {
  rootPath?: string
  linkMode?: LinkMode
  parentMappingId?: string | null
  relationshipFieldKey?: string | null
  orphanBehavior?: OrphanBehavior
  // Target binding + policy columns (folded in from the old granular setters).
  entityDefinitionId?: string | null
  targetMode?: TargetMode
  fieldMappings?: Record<string, FieldMapping>
  mergeStrategies?: Record<string, FieldMergeStrategy>
}

/** Patch any subset of a mapping's columns. The single mapping write surface. */
export async function updateMapping(
  db: Database,
  organizationId: string,
  mappingId: string,
  patch: UpdateMappingInput
): Promise<DataConnectorMappingRow> {
  await loadMappingRow(db, organizationId, mappingId)
  const [row] = await db
    .update(schema.DataConnectorMapping)
    .set({
      ...(patch.rootPath !== undefined ? { rootPath: patch.rootPath } : {}),
      ...(patch.linkMode !== undefined ? { linkMode: patch.linkMode } : {}),
      ...(patch.parentMappingId !== undefined ? { parentMappingId: patch.parentMappingId } : {}),
      ...(patch.relationshipFieldKey !== undefined
        ? { relationshipFieldKey: patch.relationshipFieldKey }
        : {}),
      ...(patch.orphanBehavior !== undefined ? { orphanBehavior: patch.orphanBehavior } : {}),
      ...(patch.entityDefinitionId !== undefined
        ? { entityDefinitionId: patch.entityDefinitionId }
        : {}),
      ...(patch.targetMode !== undefined ? { targetMode: patch.targetMode } : {}),
      ...(patch.fieldMappings !== undefined ? { fieldMappings: patch.fieldMappings } : {}),
      ...(patch.mergeStrategies !== undefined ? { mergeStrategies: patch.mergeStrategies } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.DataConnectorMapping.id, mappingId))
    .returning()
  if (!row) throw new Error('Failed to update mapping')
  return row
}

/** Remove a mapping (its items cascade on delete). */
export async function removeMapping(
  db: Database,
  organizationId: string,
  mappingId: string
): Promise<{ success: boolean }> {
  const row = await loadMappingRow(db, organizationId, mappingId)
  // The root mapping is the stream's spine (seeded on create) — it's removed only
  // by deleting the stream, never on its own. The UI hides its delete button; this
  // guards the API.
  if (row.parentMappingId === null) {
    throw new BadRequestError('The root mapping cannot be removed; delete the stream instead.')
  }
  await db.delete(schema.DataConnectorMapping).where(eq(schema.DataConnectorMapping.id, mappingId))
  return { success: true }
}
