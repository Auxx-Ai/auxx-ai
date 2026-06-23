// packages/lib/src/data-connectors/mutations.ts
// Functional mutation + setup helpers over the Data Connector control tables.
// Drizzle + neverthrow, no model classes (project convention). The tRPC router
// (apps/web) consumes these; the engine/orchestrator stays read-only here. Scheduler
// re-registration is driven from create/update (pause/resume is a `status` patch
// through update) so a cadence or lifecycle change is reflected in BullMQ immediately.

import { type CatalogDataConnector, type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getFieldDefinitionId, getFieldId, toResourceFieldId } from '@auxx/types/field'
import { generateId } from '@auxx/utils'
import { and, eq } from 'drizzle-orm'
import { getCachedCustomFields, getCachedEntityDefId } from '../cache'
import { BadRequestError, NotFoundError } from '../errors'
import { appCatalogStreamSchema } from './app-catalog'
import {
  registerConnectorWebhooks,
  unregisterConnectorWebhooks,
} from './connector-webhook-registration'
import { removeConnectorScheduler, syncConnectorScheduler } from './data-connector-scheduler'
import type { DataConnectorMappingRow, DataConnectorRow, DataConnectorStreamRow } from './service'
import type {
  ConnectorTemplate,
  ConnectorTemplateFieldMapping,
  ConnectorTemplateMapping,
} from './templates'
import type {
  DataConnectorConfig,
  DataConnectorType,
  FieldMapping,
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
 * When a stream declares `mappings` (05d), they're materialized into real
 * `DataConnectorMapping` rows — the same rows the manual editor produces — so the
 * connector is fully wired (target def + field mappings) on install. Streams
 * without declared mappings install with no mappings — the user authors them in
 * the editor against the source tree. The `templateId` stamp is provenance
 * — seed-and-forget, no live link back.
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
    const s = await addStream(db, organizationId, connector.id, {
      streamKey: stream.streamKey,
      sourceSchema: stream.sourceSchema ?? null,
      schemaSource: 'catalog',
      syncMode: stream.syncMode,
      requestConfig: stream.requestConfig,
    })
    if (stream.mappings?.length) {
      await seedTemplateMappings(db, organizationId, s.id, stream.mappings)
    }
  }
  return connector
}

/**
 * Assert every concrete `targetFieldRef` belongs to the mapping's own entity def
 * (a wrong-def ref is unrepresentable past this boundary). The late-bound `@app:`
 * form carries the app slug in its first segment (resolved at sync time), so it
 * skips the def-match check; `null` (draft / provisioned-awaiting-ref) is allowed.
 */
function assertFieldRefsMatchDef(
  entityDefinitionId: string | null | undefined,
  fieldMappings: FieldMapping[] | undefined
): void {
  if (!entityDefinitionId || !fieldMappings) return
  for (const fm of fieldMappings) {
    const ref = fm.targetFieldRef
    if (ref == null) continue
    if (getFieldId(ref).startsWith('@app:')) continue
    if (getFieldDefinitionId(ref) !== entityDefinitionId) {
      throw new BadRequestError(
        `Field mapping targetFieldRef '${ref}' does not belong to entity definition '${entityDefinitionId}'`
      )
    }
  }
}

/**
 * Materialize a stream's declared template mappings into rows. Streams are no
 * longer auto-seeded with a blank root, so every declared mapping is a fresh
 * insert. v1: contributing targets only — the `@system:*` ref resolves to a real
 * def id at install.
 */
async function seedTemplateMappings(
  db: Database,
  organizationId: string,
  streamId: string,
  mappings: ConnectorTemplateMapping[]
): Promise<void> {
  for (const mapping of mappings) {
    const entityDefinitionId = await resolveTemplateEntityRef(
      organizationId,
      mapping.target.entityRef
    )
    const fieldMappings = await buildTemplateFieldMappings(
      organizationId,
      entityDefinitionId,
      mapping.fields
    )
    await addMapping(db, organizationId, {
      dataConnectorStreamId: streamId,
      rootPath: mapping.rootPath,
      linkMode: mapping.linkMode ?? ('upsert' as LinkMode),
      targetMode: 'contributing' as TargetMode,
      entityDefinitionId,
      fieldMappings,
      orphanBehavior: mapping.orphanBehavior ?? ('ignore' as OrphanBehavior),
    })
  }
}

/** Resolve a template `@system:<entityType>` ref to a real def id (v1: system only). */
async function resolveTemplateEntityRef(
  organizationId: string,
  entityRef: string
): Promise<string> {
  if (!entityRef.startsWith('@system:')) {
    throw new BadRequestError(`Unsupported connector-template entityRef: ${entityRef}`)
  }
  const entityType = entityRef.slice('@system:'.length)
  const id = await getCachedEntityDefId(organizationId, entityType)
  if (!id) {
    throw new NotFoundError(`System entity "${entityType}" not found for organization`)
  }
  return id
}

/**
 * Build the CALC `fieldMappings` jsonb from a template mapping's field bindings.
 * Matches the shape the manual mapping editor produces: `sourceFields` is an
 * identity map (token = source path), and the expression references those tokens
 * as `{path}` (single-brace) — so `source: 'email'` becomes `{ expression: '{email}',
 * sourceFields: { email: 'email' } }`. Explicit `expression`/`sourceFields` pass
 * through verbatim for transforms (e.g. `{created} * 1000`).
 *
 * Target resolution: a **reused** field (no `provision` hint) resolves its
 * template `key` (a systemAttribute or display name) to a concrete
 * `ResourceFieldId` against the target def now. A **provisioned** field (`provision`
 * hint) doesn't exist yet → `targetFieldRef: null`; the sync-time provisioning
 * write-back fills the concrete ref once the field is created.
 */
async function buildTemplateFieldMappings(
  organizationId: string,
  entityDefinitionId: string,
  fields: ConnectorTemplateFieldMapping[]
): Promise<FieldMapping[]> {
  const defFields = await getCachedCustomFields(organizationId, entityDefinitionId)
  const fieldIdByKey = new Map<string, string>()
  for (const fld of defFields) {
    if (fld.systemAttribute) fieldIdByKey.set(fld.systemAttribute, fld.id)
    fieldIdByKey.set(fld.name, fld.id)
  }

  return fields.map((f) => {
    const expression = f.expression ?? (f.source ? `{${f.source}}` : '')
    const sourceFields = f.sourceFields ?? (f.source ? { [f.source]: f.source } : {})
    const reusedFieldId = f.provision ? undefined : fieldIdByKey.get(f.key)
    const mapping: FieldMapping = {
      id: generateId(),
      targetFieldRef: reusedFieldId ? toResourceFieldId(entityDefinitionId, reusedFieldId) : null,
      expression,
      sourceFields,
    }
    if (f.match) mapping.match = typeof f.match === 'object' ? f.match : {}
    // Provisioned field's name = its key (the stable appFieldKey the sync-time
    // provisioning + ref write-back match on).
    if (f.provision) mapping.provision = { name: f.key, ...f.provision }
    return mapping
  })
}

/**
 * Create a connector from an installed app's catalog declaration (create-sync-flow
 * §3.1, Tier 1). Mirrors {@link createConnectorFromTemplate}: an `app:<slug>`
 * connector + one pre-filled stream per declared catalog stream, each with the
 * declared source schema (from `exampleRecord`, else built from the field paths)
 * stamped `catalog`. The request is baked into the app (`fixed` model), so streams
 * carry no `requestConfig`.
 *
 * Default *mappings* are intentionally NOT materialized here: the first-party app
 * declarations are owned-mode + relationship fan-outs, and owned-mode provisioning
 * at setup is deferred (plan §6 / target-provisioning v1 is contributing-only). The
 * user maps in the stepper against the now-populated schema — assisted by the Tier 2
 * `suggestMappings` suggester, which works because the schema is present.
 */
export async function createConnectorFromAppCatalog(
  db: Database,
  organizationId: string,
  input: Omit<CreateConnectorInput, 'definitionKind' | 'templateId' | 'config'>,
  catalog: CatalogDataConnector
): Promise<DataConnectorRow> {
  const connector = await createConnector(db, organizationId, {
    ...input,
    definitionKind: 'app',
  })
  for (const stream of catalog.streams) {
    await addStream(db, organizationId, connector.id, {
      streamKey: stream.key,
      ...appCatalogStreamSchema(stream),
      syncMode: 'snapshot',
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
  const prior = await loadConnectorRow(db, organizationId, id)
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

  // Webhook registration follows the sync-behavior toggle (Step 8B). Enabling webhook
  // sync subscribes the provider (idempotent — also re-runs on a config change while
  // staying webhook); leaving it revokes. Best-effort: a provider error never fails
  // the mutation (the row + cadence already persisted).
  try {
    if (row.syncBehavior === 'webhook') {
      await registerConnectorWebhooks(db, organizationId, id)
    } else if (prior.syncBehavior === 'webhook') {
      await unregisterConnectorWebhooks(db, organizationId, id)
    }
  } catch (error) {
    logger.warn('connector webhook (un)registration failed', {
      connectorId: id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
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
  // Revoke provider webhooks before the row cascades away (Step 8B). Best-effort —
  // a dangling provider subscription is harmless once the handler row is gone.
  try {
    await unregisterConnectorWebhooks(db, organizationId, id)
  } catch (error) {
    logger.warn('connector webhook teardown failed', {
      connectorId: id,
      error: error instanceof Error ? error.message : String(error),
    })
  }

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

  // No mapping is seeded — the mapping editor renders the source schema as an
  // always-on tree and the user creates a mapping by picking the source row the
  // records live under (e.g. `data[]`). The payload root stays unmapped until then.
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
  fieldMappings?: FieldMapping[]
  orphanBehavior?: OrphanBehavior
}

/** Create a mapping (one target def a fetch lands in). */
export async function addMapping(
  db: Database,
  organizationId: string,
  input: AddMappingInput
): Promise<DataConnectorMappingRow> {
  await loadStreamRow(db, organizationId, input.dataConnectorStreamId)
  assertFieldRefsMatchDef(input.entityDefinitionId, input.fieldMappings)
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
      fieldMappings: input.fieldMappings ?? [],
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
  fieldMappings?: FieldMapping[]
}

/** Patch any subset of a mapping's columns. The single mapping write surface. */
export async function updateMapping(
  db: Database,
  organizationId: string,
  mappingId: string,
  patch: UpdateMappingInput
): Promise<DataConnectorMappingRow> {
  const existing = await loadMappingRow(db, organizationId, mappingId)
  // Validate refs against the EFFECTIVE def (a same-call def change applies first).
  const effectiveDefId =
    patch.entityDefinitionId !== undefined ? patch.entityDefinitionId : existing.entityDefinitionId
  assertFieldRefsMatchDef(effectiveDefId, patch.fieldMappings)
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
