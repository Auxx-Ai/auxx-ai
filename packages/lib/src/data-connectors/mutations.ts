// packages/lib/src/data-connectors/mutations.ts
// Functional mutation + setup helpers over the Data Connector control tables.
// Drizzle + neverthrow, no model classes (project convention). The tRPC router
// (apps/web) consumes these; the engine/orchestrator stays read-only here. Scheduler
// re-registration is driven from create/update (pause/resume is a `status` patch
// through update) so a cadence or lifecycle change is reflected in BullMQ immediately.

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { NotFoundError } from '../errors'
import { removeConnectorScheduler, syncConnectorScheduler } from './data-connector-scheduler'
import type { DataConnectorMappingRow, DataConnectorRow, DataConnectorStreamRow } from './service'
import type {
  DataConnectorConfig,
  DataConnectorType,
  FieldMapping,
  FieldMergeStrategy,
  IdentityStrategy,
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
  streamKey: string
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
      streamKey: input.streamKey,
      sourceSchema: input.sourceSchema ?? null,
      schemaSource: input.schemaSource ?? 'catalog',
      syncMode: input.syncMode ?? 'snapshot',
      requestConfig: input.requestConfig ?? null,
      enabled: input.enabled ?? true,
    })
    .returning()
  if (!row) throw new Error('Failed to add stream')
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
  identityStrategy: IdentityStrategy
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
      identityStrategy: input.identityStrategy,
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
}

/** Patch a mapping's structural fields. */
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
  await loadMappingRow(db, organizationId, mappingId)
  await db.delete(schema.DataConnectorMapping).where(eq(schema.DataConnectorMapping.id, mappingId))
  return { success: true }
}

/** Set a mapping's target binding (def + targetMode + linkMode). */
export async function setMappingTarget(
  db: Database,
  organizationId: string,
  mappingId: string,
  input: { entityDefinitionId: string; targetMode: TargetMode; linkMode: LinkMode }
): Promise<DataConnectorMappingRow> {
  await loadMappingRow(db, organizationId, mappingId)
  const [row] = await db
    .update(schema.DataConnectorMapping)
    .set({
      entityDefinitionId: input.entityDefinitionId,
      targetMode: input.targetMode,
      linkMode: input.linkMode,
      updatedAt: new Date(),
    })
    .where(eq(schema.DataConnectorMapping.id, mappingId))
    .returning()
  if (!row) throw new Error('Failed to set mapping target')
  return row
}

/** Replace a mapping's per-field CALC mappings (Layer B, 05 §4). */
export async function setFieldMappings(
  db: Database,
  organizationId: string,
  mappingId: string,
  fieldMappings: Record<string, FieldMapping>
): Promise<DataConnectorMappingRow> {
  await loadMappingRow(db, organizationId, mappingId)
  const [row] = await db
    .update(schema.DataConnectorMapping)
    .set({ fieldMappings, updatedAt: new Date() })
    .where(eq(schema.DataConnectorMapping.id, mappingId))
    .returning()
  if (!row) throw new Error('Failed to set field mappings')
  return row
}

/** Set a mapping's identity strategy (02 §2). */
export async function setIdentityStrategy(
  db: Database,
  organizationId: string,
  mappingId: string,
  identityStrategy: IdentityStrategy
): Promise<DataConnectorMappingRow> {
  await loadMappingRow(db, organizationId, mappingId)
  const [row] = await db
    .update(schema.DataConnectorMapping)
    .set({
      identityStrategy,
      updatedAt: new Date(),
    })
    .where(eq(schema.DataConnectorMapping.id, mappingId))
    .returning()
  if (!row) throw new Error('Failed to set identity strategy')
  return row
}

/** Replace a mapping's per-field merge strategies (02 §3). */
export async function setMergeStrategies(
  db: Database,
  organizationId: string,
  mappingId: string,
  mergeStrategies: Record<string, FieldMergeStrategy>
): Promise<DataConnectorMappingRow> {
  await loadMappingRow(db, organizationId, mappingId)
  const [row] = await db
    .update(schema.DataConnectorMapping)
    .set({ mergeStrategies, updatedAt: new Date() })
    .where(eq(schema.DataConnectorMapping.id, mappingId))
    .returning()
  if (!row) throw new Error('Failed to set merge strategies')
  return row
}
