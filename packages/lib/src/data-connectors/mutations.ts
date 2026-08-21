// packages/lib/src/data-connectors/mutations.ts
// Functional mutation + setup helpers over the Data Connector control tables.
// Drizzle + neverthrow, no model classes (project convention). The tRPC router
// (apps/web) consumes these; the engine/orchestrator stays read-only here. Scheduler
// re-registration is driven from create/update (pause/resume is a `status` patch
// through update) so a cadence or lifecycle change is reflected in BullMQ immediately.

import { listCredentials } from '@auxx/credentials/store'
import {
  type CatalogDataConnector,
  type CatalogPayload,
  type Database,
  schema,
  type Transaction,
} from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import {
  getFieldDefinitionId,
  isAppFieldRef,
  toAppFieldRef,
  toResourceFieldId,
} from '@auxx/types/field'
import { generateId } from '@auxx/utils'
import { and, eq, inArray, isNull, ne } from 'drizzle-orm'
import { getCachedCustomFields, getCachedEntityDefId } from '../cache'
import { onCacheEvent } from '../cache/invalidate'
import { notifyEntityDefChanged } from '../entity-definitions/notify'
import { BadRequestError, NotFoundError } from '../errors'
import { toRecordId } from '../resources/resource-id'
import {
  appCatalogStreamSchema,
  buildContributingAutoBindings,
  buildContributingConnectionAppFields,
  buildContributingFieldBindings,
  buildContributingMatchBindings,
} from './app-catalog'
import { removeConnectorScheduler, syncConnectorScheduler } from './data-connector-scheduler'
import {
  classifyConnectorChange,
  classifyMappingChange,
  classifyStreamRequestChange,
  type StructuralImpact,
} from './edit-impact'
import { materializeConnectorTargets } from './provisioning'
import {
  countConnectorItems,
  countMappingItems,
  type DataConnectorMappingRow,
  type DataConnectorRow,
  type DataConnectorStreamRow,
  type DbOrTx,
  loadConnector,
  stampResyncPending,
} from './service'
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
import { requiredSteerTokens } from './webhook-steer'

const logger = createScopedLogger('data-connector-mutations')

// ── Mapping-edit safety (Layer 1) ─────────────────────────────────────────────
// Auto-save edits stay instant, but a structural edit that invalidates already-synced
// data must apply its safety BEFORE any later (possibly scheduled) sync runs — so the
// classify + safety run INSIDE the same transaction as the write. The banner (Layer 3)
// only defers the expensive re-crawl; it never gates the safety. See
// plans/data-connectors/v4/mapping-edit-safety-plan.md.

/** Whether a loaded connector runs as an incremental connector (every stream incremental). */
function isIncrementalConnector(streams: { syncMode: string }[]): boolean {
  return streams.length > 0 && streams.every((s) => s.syncMode === 'incremental')
}

/**
 * Apply the safety action for a structural MAPPING edit. The only edit that can be
 * `rebind` (the identity key / target def changed): on an INCREMENTAL connector the
 * stale `DataConnectorItem` binds are deleted so the next sync can't duplicate +
 * mass-archive, and OWNED instances are archived for a clean replace (contributing
 * instances are user-owned — never archived). On a SNAPSHOT connector the existing
 * full re-crawl self-heals, so binds are left alone. Either way `resyncPending` is
 * stamped so the banner surfaces the pending re-crawl. Skipped entirely for a
 * never-synced connector (nothing to protect).
 */
async function applyMappingEditSafety(
  tx: Transaction,
  organizationId: string,
  mapping: DataConnectorMappingRow,
  impact: StructuralImpact
): Promise<void> {
  if (impact.level === 'cosmetic') return

  const stream = await tx.query.DataConnectorStream.findFirst({
    where: eq(schema.DataConnectorStream.id, mapping.dataConnectorStreamId),
    columns: { id: true, dataConnectorId: true },
  })
  if (!stream) return
  const loaded = await loadConnector(tx, organizationId, stream.dataConnectorId)
  if (!loaded || !loaded.connector.lastSyncedAt) return // Q2 — never-synced ⇒ skip

  const incremental = isIncrementalConnector(loaded.streams.map((s) => ({ syncMode: s.syncMode })))
  const dataConnectorId = stream.dataConnectorId

  let itemCount: number
  if (impact.level === 'rebind' && incremental) {
    // The old (mappingId, externalId) binds are provably wrong now. Archive OWNED
    // instances (clean replace), then delete the binds so reconcile can't archive
    // what it can't list and the next backfill re-creates + re-binds.
    const items = await tx.query.DataConnectorItem.findMany({
      where: and(
        eq(schema.DataConnectorItem.dataConnectorId, dataConnectorId),
        eq(schema.DataConnectorItem.mappingId, mapping.id)
      ),
      columns: { entityInstanceId: true },
    })
    itemCount = items.length
    if (mapping.targetMode === 'owned') {
      const now = new Date()
      for (const it of items) {
        if (it.entityInstanceId) {
          await tx
            .update(schema.EntityInstance)
            .set({ archivedAt: now })
            .where(eq(schema.EntityInstance.id, it.entityInstanceId))
        }
      }
    }
    await tx
      .delete(schema.DataConnectorItem)
      .where(
        and(
          eq(schema.DataConnectorItem.dataConnectorId, dataConnectorId),
          eq(schema.DataConnectorItem.mappingId, mapping.id)
        )
      )
  } else {
    itemCount = await countMappingItems(tx, dataConnectorId, mapping.id)
  }

  await stampResyncPending(tx, dataConnectorId, {
    level: impact.level === 'rebind' ? 'rebind' : 'rebackfill',
    reasons: impact.reasons,
    streamIds: [mapping.dataConnectorStreamId],
    itemCount,
    at: new Date().toISOString(),
  })
}

/**
 * Stamp `resyncPending` for a CONNECTOR or STREAM edit. Neither can be `rebind`
 * (identity lives on the mapping), so the action is always: stamp `rebackfill` across
 * the affected streams. Skipped for a never-synced connector.
 */
async function stampConnectorResync(
  tx: Transaction,
  dataConnectorId: string,
  impact: StructuralImpact,
  streamIds: string[],
  itemCount: number
): Promise<void> {
  if (impact.level === 'cosmetic' || streamIds.length === 0) return
  await stampResyncPending(tx, dataConnectorId, {
    level: 'rebackfill',
    reasons: impact.reasons,
    streamIds,
    itemCount,
    at: new Date().toISOString(),
  })
}

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
  db: DbOrTx,
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
    if (isAppFieldRef(ref)) continue
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
    if (f.match) {
      mapping.identityRole = {
        kind: 'match',
        ...(typeof f.match === 'object' ? f.match : {}),
      }
    }
    // Provisioned field's name = its key (the stable appFieldKey the sync-time
    // provisioning + ref write-back match on).
    if (f.provision) mapping.provision = { name: f.key, ...f.provision }
    return mapping
  })
}

/**
 * Resolve the connection to auto-bind a fresh app connector to. Returns the id ONLY
 * when the org has exactly one org-scoped connection for this app installation — the
 * unambiguous case worth auto-linking. Zero (nothing to link) or two-plus (the user
 * must disambiguate) → `null`, so the connector is created unbound. Personal
 * (user-scoped) connections are excluded: a background sync must bind a shared org
 * connection so it doesn't break for other members.
 */
export async function resolveSoleAppConnection(
  organizationId: string,
  appInstallationId: string
): Promise<string | null> {
  const result = await listCredentials({
    organizationId,
    kind: 'app',
    appInstallationId,
    userId: null,
  })
  if (result.isErr()) return null
  const [sole] = result.value
  return result.value.length === 1 && sole ? sole.id : null
}

/**
 * Create a connector from an installed app's catalog declaration (create-sync-flow
 * §3.1, Tier 1). Mirrors {@link createConnectorFromTemplate}: an `app:<slug>`
 * connector + one pre-filled stream per declared catalog stream, each with the
 * declared source schema (from `exampleRecord`, else built from the field paths)
 * stamped `catalog`. The request is baked into the app (`fixed` model), so streams
 * carry no `requestConfig`.
 *
 * Owned default-mappings are seeded UNBOUND (v6 — install-target-defs-via-templates,
 * "Option A"): a `DataConnectorMapping` with `entityDefinitionId: null`, NO `provision`,
 * and `fieldMappings` carrying the connection-late-bound `@app:` ref
 * (`${apiSlug}:@app:${slug}:${fieldKey}`) per declared field. The owned
 * `EntityDefinition`s + columns + relationship edges are created when the user installs
 * the app's record-type templates from the Map step (the reused `EntityTemplateDialog`);
 * the install `onComplete` then sets each owned mapping's `entityDefinitionId` and
 * rewrites the late-bound refs to concrete field ids. Until installed, the owned mapping
 * is unbound (readiness flags it `no-mapping`) and the Map step offers the install/pick
 * affordance. `contributing` default-mappings are materialized here against the existing
 * system def (their identity-match keys pre-bound — multi-stream-setup-plan §5).
 */
export async function createConnectorFromAppCatalog(
  db: Database,
  organizationId: string,
  input: Omit<CreateConnectorInput, 'definitionKind' | 'templateId' | 'config'>,
  catalog: CatalogDataConnector
): Promise<DataConnectorRow> {
  // Auto-link the connection when the connector needs one and the org has EXACTLY one
  // for this app installation — the unambiguous case (e.g. a single Shopify account
  // already connected). Zero (nothing to link) or two-plus (ambiguous — the user must
  // choose) leaves it unbound, so the Connect step prompts a pick. Only when the caller
  // didn't already pass a credential.
  const credentialId =
    input.credentialId ??
    (catalog.requiresConnection && input.appInstallationId
      ? await resolveSoleAppConnection(organizationId, input.appInstallationId)
      : null)

  const connector = await createConnector(db, organizationId, {
    ...input,
    definitionKind: 'app',
    credentialId,
    // Stamp the webhook SIGNAL unconditionally — the dispatch job already gates on
    // `syncBehavior === 'webhook'`, and stamping always means the user can flip
    // modes later without a re-stamp (v9 §1).
    config: catalog.webhookTrigger
      ? { webhookTrigger: { triggerId: catalog.webhookTrigger.triggerId } }
      : {},
  })

  // The app slug namespaces the late-bound `@app:` field refs the owned mappings carry
  // (resolved at sync time against the connector's connection). `input.type` is `app:<slug>`.
  const appSlug = input.type.startsWith('app:') ? input.type.slice('app:'.length) : input.type

  for (const stream of catalog.streams) {
    const streamRow = await addStream(db, organizationId, connector.id, {
      streamKey: stream.key,
      ...appCatalogStreamSchema(stream),
      syncMode: stream.syncMode ?? 'snapshot',
      requestConfig: stream.webhookTrigger ? { webhookTrigger: stream.webhookTrigger } : null,
    })
    // Owned mappings first so a nested contributing mapping (e.g. order → customer)
    // can parent to the owned root it hangs off — the parentMappingId forms the fan-out
    // tree at sync AND anchors the install-created relationship edge.
    const ownedMappingIdByRootPath = await seedAppOwnedMappings(
      db,
      organizationId,
      streamRow.id,
      stream,
      appSlug,
      input.appInstallationId
    )
    await materializeAppContributingMappings(
      db,
      organizationId,
      streamRow.id,
      stream,
      appSlug,
      ownedMappingIdByRootPath
    )
  }

  return connector
}

/**
 * Re-project an app catalog's webhook binding onto existing app connectors after a
 * roll-forward — DataConnector.config.webhookTrigger + each matching stream's
 * requestConfig.webhookTrigger are overwritten from the catalog (manifest is source,
 * rows are projection). Streams are matched by streamKey; other requestConfig keys
 * (none exist for app streams today) are preserved via spread.
 */
export async function restampConnectorWebhookBindings(
  db: DbOrTx,
  organizationId: string,
  appInstallationId: string,
  catalog: CatalogDataConnector
): Promise<void> {
  const connectors = await db.query.DataConnector.findMany({
    where: and(
      eq(schema.DataConnector.appInstallationId, appInstallationId),
      eq(schema.DataConnector.organizationId, organizationId),
      eq(schema.DataConnector.definitionKind, 'app')
    ),
  })

  for (const connector of connectors) {
    const config = { ...(connector.config ?? {}) } as DataConnectorConfig
    if (catalog.webhookTrigger) {
      config.webhookTrigger = { triggerId: catalog.webhookTrigger.triggerId }
    } else {
      delete config.webhookTrigger
    }
    await db
      .update(schema.DataConnector)
      .set({ config, updatedAt: new Date() })
      .where(eq(schema.DataConnector.id, connector.id))

    const streamRows = await db.query.DataConnectorStream.findMany({
      where: and(
        eq(schema.DataConnectorStream.dataConnectorId, connector.id),
        eq(schema.DataConnectorStream.organizationId, organizationId)
      ),
    })
    const streamRowByKey = new Map(streamRows.map((row) => [row.streamKey, row]))

    for (const catalogStream of catalog.streams) {
      const row = streamRowByKey.get(catalogStream.key)
      if (!row) continue
      const requestConfig = { ...(row.requestConfig ?? {}) } as StreamRequestConfig
      if (catalogStream.webhookTrigger) {
        requestConfig.webhookTrigger = catalogStream.webhookTrigger
      } else {
        delete requestConfig.webhookTrigger
      }
      await db
        .update(schema.DataConnectorStream)
        .set({ requestConfig, updatedAt: new Date() })
        .where(eq(schema.DataConnectorStream.id, row.id))
    }
  }
}

/**
 * Re-stamp webhook bindings for every active installation currently on a deployment
 * — the app-layer counterpart of `invalidateOrgsByDeploymentId` (same
 * `currentDeploymentId` + `uninstalledAt IS NULL` query), called after a roll-forward
 * commits. `@auxx/services` (roll-forward's home) sits below `@auxx/lib` in the
 * package tiers and can't call back into it, so this runs as a separate best-effort
 * step from the app layer — same non-transactional posture as the cache invalidation
 * it runs alongside. No-ops when the deployment declares no data connectors.
 */
export async function restampWebhookBindingsForDeployment(
  deploymentId: string,
  db: Database
): Promise<void> {
  const deployment = await db.query.AppDeployment.findFirst({
    where: eq(schema.AppDeployment.id, deploymentId),
    columns: { catalog: true },
  })
  const dataConnectors = (deployment?.catalog as CatalogPayload | null)?.dataConnectors
  if (!dataConnectors?.length) return

  const installations = await db.query.AppInstallation.findMany({
    where: and(
      eq(schema.AppInstallation.currentDeploymentId, deploymentId),
      isNull(schema.AppInstallation.uninstalledAt)
    ),
    columns: { id: true, organizationId: true },
  })

  for (const installation of installations) {
    for (const connectorCatalog of dataConnectors) {
      await restampConnectorWebhookBindings(
        db,
        installation.organizationId,
        installation.id,
        connectorCatalog
      )
    }
  }
}

/**
 * Is `prefix` a path-boundary prefix of `path`? `''` prefixes everything; an exact
 * match counts; otherwise `path` must continue at a boundary (`.` or `[`) so
 * `line_items[]` matches `line_items[].sku` but NOT `line_items_extra[]`.
 */
function isBoundaryPrefix(path: string, prefix: string): boolean {
  if (prefix === '') return true
  if (!path.startsWith(prefix)) return false
  if (path.length === prefix.length) return true
  const next = path[prefix.length]
  return next === '.' || next === '['
}

/**
 * Strip a `rootPath` prefix off a `path`, leaving it relative to that subtree —
 * `('line_items[].sku', 'line_items[]') → 'sku'`. Used both to relativize a field's
 * sourcePath against its owning mapping AND to relativize a nested child mapping's
 * own (payload-absolute, manifest) rootPath against its parent's rootPath before it
 * is stored (`absolutePrefix`/`subtreeUnder`/`mapRecord` all expect parent-relative).
 * `rootPath` must be a boundary-prefix of `path` (the caller resolves it that way).
 */
export function relativeSourcePath(sourcePath: string, rootPath: string): string {
  if (rootPath === '') return sourcePath
  return sourcePath.slice(rootPath.length).replace(/^\./, '')
}

/**
 * The parent of `rootPath` among `all` is the mapping whose rootPath is the longest
 * PROPER boundary-prefix: `''` parents everything, `line_items[]` parents
 * `line_items[].variants[]`. A bare prefix that doesn't end on a path boundary
 * (`line_items` vs `line_items_extra[]`) is rejected. Returns null for a root mapping.
 */
export function ownedParentRootPath(rootPath: string, all: string[]): string | null {
  const parents = all.filter((p) => p !== rootPath && isBoundaryPrefix(rootPath, p))
  if (parents.length === 0) return null
  return parents.reduce((longest, p) => (p.length > longest.length ? p : longest))
}

/** A stream field assigned to an owned mapping, with its subtree-relative source path. */
export interface OwnedFieldEntry {
  field: CatalogDataConnector['streams'][number]['fields'][number]
  /** sourcePath relative to the owning mapping's rootPath (e.g. `sku`, not `line_items[].sku`). */
  relativeSourcePath: string
}

/**
 * Partition a stream's declared fields across its OWNED-upsert mappings (the multi-level
 * field split the relationship-provisioning plan deferred). Each field is assigned to the
 * mapping — of ANY mode — whose rootPath is the LONGEST boundary-prefix of its sourcePath;
 * only fields owned by an owned-upsert mapping are returned (those become real columns on
 * that mapping's def). A field claimed by a `contributing` branch (`customer.email`) or a
 * `reference` branch (`line_items[].product_id`, the id-only edge FK) is excluded — those
 * paths bind/stamp it themselves and must not surface as an owned-def column. Returned
 * sourcePaths are rewritten subtree-relative so `mapRecord` resolves them against each
 * extracted subtree. Pure + exported for unit coverage.
 */
export function partitionOwnedFields(
  fields: CatalogDataConnector['streams'][number]['fields'],
  mappings: NonNullable<CatalogDataConnector['streams'][number]['defaultMappings']>
): Record<string, OwnedFieldEntry[]> {
  const allRootPaths = mappings.map((m) => m.rootPath)
  const ownedUpsertRootPaths = new Set(
    mappings
      .filter((m) => m.target.mode === 'owned' && (m.linkMode ?? 'upsert') !== 'reference')
      .map((m) => m.rootPath)
  )

  const partition: Record<string, OwnedFieldEntry[]> = {}
  for (const field of fields) {
    const owners = allRootPaths.filter((r) => isBoundaryPrefix(field.sourcePath, r))
    if (owners.length === 0) continue
    const owner = owners.reduce((longest, r) => (r.length > longest.length ? r : longest))
    if (!ownedUpsertRootPaths.has(owner)) continue
    ;(partition[owner] ??= []).push({
      field,
      relativeSourcePath: relativeSourcePath(field.sourcePath, owner),
    })
  }
  return partition
}

/**
 * The id of an existing, non-archived app-owned def for `sourceKey` under this app
 * install, or `null` to fork a new one. Adoption REQUIRES the same `appInstallationId`:
 * owned field values sync through `@app:` refs resolved by `appFieldKey` + install (R1),
 * so a different install's columns wouldn't resolve — a different install forks instead.
 * `sourceKey === entity.key` (Phase 2). Ownership (`dataConnectorId`) is deliberately NOT
 * re-stamped — it stays with the def's first owner; the second connector just adds a
 * mapping. See `plans/data-connectors/v6/shared-definitions-across-connectors-plan.md`.
 */
export async function adoptSharedOwnedDefId(
  db: Database,
  organizationId: string,
  appInstallationId: string | null | undefined,
  sourceKey: string
): Promise<string | null> {
  if (!appInstallationId) return null
  const [existing] = await db
    .select({ id: schema.EntityDefinition.id })
    .from(schema.EntityDefinition)
    .where(
      and(
        eq(schema.EntityDefinition.organizationId, organizationId),
        eq(schema.EntityDefinition.appInstallationId, appInstallationId),
        eq(schema.EntityDefinition.sourceKey, sourceKey),
        isNull(schema.EntityDefinition.archivedAt)
      )
    )
    .limit(1)
  return existing?.id ?? null
}

/**
 * Seed the owned mappings for a catalog stream (v6 — install-target-defs-via-templates,
 * "Option A"). One `DataConnectorMapping` per owned default-mapping, with `fieldMappings`
 * carrying the connection-late-bound `@app:` ref per declared field.
 *
 * A mapping is seeded **bound** when an app-owned def for its record type already exists
 * for this app install — see `adoptSharedOwnedDefId`: a second connector for the SAME app
 * install (e.g. GitHub Issues repo 1 + repo 2) shares ONE def instead of forking, with
 * records kept attributable per-connector via `integrationSource`. Otherwise it is seeded
 * UNBOUND (`entityDefinitionId: null`) — no `EntityDefinition`s, columns, or relationship
 * edges are created here; they are created when the user installs the app's record-type
 * templates from the Map step (the reused `EntityTemplateDialog`), and the install
 * `onComplete` binds each mapping's def + concrete field refs.
 *
 * `parentMappingId` is wired from rootPath nesting (parents first) so the fan-out tree —
 * and the install-created relationship edge it anchors — forms before any def exists.
 */
async function seedAppOwnedMappings(
  db: Database,
  organizationId: string,
  streamId: string,
  stream: CatalogDataConnector['streams'][number],
  appSlug: string,
  appInstallationId: string | null | undefined
): Promise<Record<string, string>> {
  const allMappings = stream.defaultMappings ?? []
  const owned = allMappings.filter((m) => m.target.mode === 'owned')
  const allRootPaths = owned.map((m) => m.rootPath)
  // Each owned-upsert def gets ONLY its own subtree's fields (multi-level partition).
  const partition = partitionOwnedFields(stream.fields, allMappings)
  // Parents before children so a child's `parentMappingId` always resolves.
  const ordered = [...owned].sort((a, b) => a.rootPath.length - b.rootPath.length)

  const mappingIdByRootPath: Record<string, string> = {}

  for (const mapping of ordered) {
    if (mapping.target.mode !== 'owned') continue
    const { entity } = mapping.target
    // A `reference` owned mapping (id-only edge, e.g. line→product) owns no columns —
    // its entry list is empty; it only carries the structural link (parent + edge key).
    const entries = partition[mapping.rootPath] ?? []
    const linkMode = mapping.linkMode ?? ('upsert' as LinkMode)

    // Share an existing app-owned def for this record type instead of forking a new
    // one (null → the install banner creates it). The def's `sourceKey === entity.key`.
    const entityDefinitionId = await adoptSharedOwnedDefId(
      db,
      organizationId,
      appInstallationId,
      entity.key
    )

    const parentRootPath = ownedParentRootPath(mapping.rootPath, allRootPaths)
    const parentMappingId = parentRootPath != null ? mappingIdByRootPath[parentRootPath] : null
    // The edge field lives on the PARENT def — namespace the relationship key with the
    // parent's apiSlug (cosmetic), falling back to this mapping's own slug for a
    // top-level reference (no parent in scope).
    const parentManifest =
      parentRootPath != null ? owned.find((m) => m.rootPath === parentRootPath) : undefined
    const parentSlug =
      parentManifest?.target.mode === 'owned'
        ? parentManifest.target.entity.apiSlug
        : entity.apiSlug

    const row = await addMapping(db, organizationId, {
      dataConnectorStreamId: streamId,
      // STORE parent-relative. The manifest rootPath is payload-absolute (so
      // `ownedParentRootPath` can nest it: `'' ⊂ line_items[] ⊂ line_items[].product_id`),
      // but every consumer — `absolutePrefix`, `subtreeUnder`, and the sync `mapRecord`
      // subtree descent — treats a child's stored rootPath as relative to its parent.
      // Relativize against the parent we just resolved; top-level children (parent `''`)
      // are unchanged. NB: `mappingIdByRootPath` below stays keyed by the ABSOLUTE path,
      // because parent detection nests on absolute paths.
      rootPath:
        parentRootPath != null
          ? relativeSourcePath(mapping.rootPath, parentRootPath)
          : mapping.rootPath,
      linkMode,
      targetMode: 'owned' as TargetMode,
      entityDefinitionId,
      parentMappingId,
      relationshipFieldKey: appRelationshipFieldKey(
        mapping.relationshipFieldKey,
        appSlug,
        parentSlug
      ),
      // A `reference` edge carries only its External-ID anchor (the FK value IS the
      // related record's external id). An upsert mapping owns its subtree's columns:
      // late-bound refs key on the manifest apiSlug; the install rewrites them to
      // concrete `${defId}:${fieldId}` once the def exists (or fixes the slug segment
      // to the actual installed slug). Until then they resolve at sync via the `@app:`
      // path — so even an uninstalled-but-slug-matching def would still bind.
      fieldMappings:
        linkMode === 'reference'
          ? [buildReferenceAnchor()]
          : buildAppOwnedFieldMappings(entries, appSlug, entity.apiSlug),
      // Incremental connectors only see the delta each run, so unseen ≠ deleted —
      // never archive owned orphans automatically. Full-snapshot sweeps can still
      // reconcile; v1 keeps it safe.
      orphanBehavior: 'ignore' as OrphanBehavior,
    })

    mappingIdByRootPath[mapping.rootPath] = row.id
  }

  return mappingIdByRootPath
}

/**
 * Field mappings for an UNBOUND owned mapping (v6 — Option A). Each entry carries the
 * connection-late-bound `@app:` ref `${ownedApiSlug}:@app:${appSlug}:${fieldKey}` — the
 * fieldKey rides in the ref so the install `onComplete` can rewrite it to a concrete id
 * (`fieldIdMap[app:slug:ownedKey:fieldKey]`), and the ref also resolves at sync time
 * against the connector's connection (no rewrite needed when the installed def's slug
 * matches). The expression mirrors the manual editor — `{<relativeSourcePath>}` over an
 * identity `sourceFields` map — with the SUBTREE-relative path (`sku`, not
 * `line_items[].sku`) because `mapRecord` evaluates a child mapping against its subtree.
 */
export function buildAppOwnedFieldMappings(
  entries: OwnedFieldEntry[],
  appSlug: string,
  ownedApiSlug: string
): FieldMapping[] {
  // The manifest may flag one field as the owned record's External ID (`isExternalId`).
  // v1 allows at most one per owned def — first-wins, warn on extras — so the stamped
  // `identityRole` is unambiguous.
  let externalIdClaimed = false
  return entries.map(({ field, relativeSourcePath: relPath }) => {
    // Stamp the External-ID anchor onto the flagged field's mapping WITHOUT dropping its
    // column write: it keeps its `targetFieldRef` (writes the "Shopify ID" column) and
    // gains `identityRole: externalId` (drives record identity). `resolveExternalId` then
    // reads this same value — which equals the app's `ConnectorRecord.externalId` — so the
    // visible column and the record's identity agree by construction. `deriveLinkMode`
    // stays `upsert` (a real target write always wins), so this never flips an owned def
    // to `reference`.
    let isExternalId = field.isExternalId === true
    if (isExternalId && externalIdClaimed) {
      logger.warn('Multiple isExternalId fields on one owned def — ignoring extra', {
        appSlug,
        ownedApiSlug,
        fieldKey: field.fieldKey,
      })
      isExternalId = false
    }
    if (isExternalId) externalIdClaimed = true
    return {
      id: generateId(),
      targetFieldRef: toAppFieldRef(ownedApiSlug, appSlug, field.fieldKey),
      expression: `{${relPath}}`,
      sourceFields: { [relPath]: relPath },
      ...(isExternalId ? { identityRole: { kind: 'externalId' as const } } : {}),
    }
  })
}

/**
 * Wrap a manifest's BARE `relationshipFieldKey` (e.g. `product`) into the same
 * connection-late-bound `@app:` envelope the owned field refs use —
 * `${parentSlug}:@app:${appSlug}:${key}`. A bare token in a ref slot is ambiguous (it
 * could read as an apiSlug or a concrete field id); the envelope is self-describing and
 * carries the app slug so two apps sharing a key can't collide. The edge field lives on
 * the PARENT def, so the (cosmetic) leading segment is the parent's slug — the sink +
 * editor resolve def-keyed on `@app:${appSlug}:${key}` and never read the leading segment.
 * The manual editor already stores a concrete `defId:fieldId`, so after this no ref slot
 * ever holds a bare key. `null`/absent passes through.
 */
export function appRelationshipFieldKey(
  bareKey: string | null | undefined,
  appSlug: string,
  parentSlug: string
): string | null {
  return bareKey ? toAppFieldRef(parentSlug, appSlug, bareKey) : null
}

/**
 * The External-ID anchor a `reference` (id-only edge) mapping carries so the FK value
 * resolves to the related record's external id at sync. A bare scalar-rooted reference
 * (e.g. `line_items[].product_id → product`) declares no `fieldMappings` in the manifest
 * — but with an empty entry list the edge has nothing to anchor on and stays inert. This
 * synthesizes the same anchor the interactive `linkRelationship` ships (`{source}` over
 * the reference's own scalar, marked External ID), so a manifest-seeded reference resolves
 * identically with no manifest change. The seeder owns this default; the manifest stays
 * declarative.
 */
export function buildReferenceAnchor(): FieldMapping {
  return {
    id: generateId(),
    targetFieldRef: null,
    expression: '{source}',
    sourceFields: {},
    identityRole: { kind: 'externalId' },
  }
}

/**
 * Project the owned record types a connector's app catalog declares — one entry per
 * owned default-mapping (BOTH the upsert mapping that owns the def's columns AND any
 * `reference` link mapping pointing at the same owned key). The install `onComplete`
 * uses this to bind every owned mapping to the freshly-installed def by matching its
 * `ownedKey` (carried in the installed def's `app:<slug>:<key>` templateId) to the
 * mapping's `(streamKey, rootPath)`. Pure + exported for the router query + unit tests.
 */
export interface ConnectorOwnedTarget {
  /** Stable owner-scoped manifest key (the install templateId's last segment). */
  ownedKey: string
  /** Manifest apiSlug — the late-bound refs' first segment + slug-conflict fallback. */
  apiSlug: string
  /** The stream this owned mapping lives in (matches `DraftStream.streamKey`). */
  streamKey: string
  /** The owned mapping's rootPath within the stream (matches `DraftMapping.rootPath`). */
  rootPath: string
  /** The installable template id (`app:<slug>:<ownedKey>`). */
  templateId: string
}

export function projectConnectorOwnedTargets(
  appSlug: string,
  catalog: CatalogDataConnector
): ConnectorOwnedTarget[] {
  const targets: ConnectorOwnedTarget[] = []
  for (const stream of catalog.streams) {
    for (const m of stream.defaultMappings ?? []) {
      if (m.target.mode !== 'owned') continue
      targets.push({
        ownedKey: m.target.entity.key,
        apiSlug: m.target.entity.apiSlug,
        streamKey: stream.key,
        rootPath: m.rootPath,
        templateId: `app:${appSlug}:${m.target.entity.key}`,
      })
    }
  }
  return targets
}

/**
 * Materialize a catalog stream's `contributing` default-mappings into draft
 * `DataConnectorMapping` rows — the symmetric counterpart to
 * {@link provisionStreamOwnedDefs}. Unlike an owned target (the connector
 * provisions the def + binds every field), a contributing target merges INTO an
 * existing system def (e.g. `contact`), so we only resolve the def and best-effort
 * pre-bind the declared identity-match keys (`matchFieldKeys`, e.g. `['email']`). Any
 * key that doesn't resolve cleanly leaves the row a draft (`fieldMappings: []`) — the
 * setup overview flags it `needs-mapping` and the user authors it against the source
 * tree. A target def the org lacks (no system `contact`) is skipped, never failing
 * creation. See multi-stream-setup-plan §5.
 */
async function materializeAppContributingMappings(
  db: Database,
  organizationId: string,
  streamId: string,
  stream: CatalogDataConnector['streams'][number],
  /** Namespaces the late-bound `@app:` relationship-field refs (`app:<slug>`). */
  appSlug: string,
  /** rootPath → owned-mapping id, so a nested contributing branch can find its parent. */
  ownedMappingIdByRootPath: Record<string, string> = {}
): Promise<void> {
  const ownedRootPaths = Object.keys(ownedMappingIdByRootPath)
  for (const mapping of stream.defaultMappings ?? []) {
    if (mapping.target.mode !== 'contributing') continue
    const { entityKind, matchFieldKeys, fieldBindings, connectionAppFields } = mapping.target

    const entityDefinitionId = await getCachedEntityDefId(organizationId, entityKind)
    if (!entityDefinitionId) {
      logger.warn('Skipping contributing default-mapping — system entity not found', {
        organizationId,
        entityKind,
        streamId,
      })
      continue
    }

    const defFields = await getCachedCustomFields(organizationId, entityDefinitionId)
    // Identity-match bindings first; then author-declared non-identity field bindings,
    // skipping any target a match key already claimed (match's `identityRole` wins).
    const matchBindings = buildContributingMatchBindings(
      entityDefinitionId,
      mapping.rootPath,
      matchFieldKeys ?? [],
      stream.fields,
      defFields
    )
    const boundTargets = new Set(matchBindings.map((b) => b.targetFieldRef))
    // Author-declared `fieldBindings` win; if none were declared, fall back to the
    // zero-config name-match heuristic (automap-plan §5). Either way, drop any target a
    // match key already claimed (match's `identityRole` wins).
    const valueBindings = (
      (fieldBindings?.length ?? 0) > 0
        ? buildContributingFieldBindings(
            entityDefinitionId,
            appSlug,
            mapping.rootPath,
            fieldBindings ?? [],
            stream.fields,
            defFields
          )
        : buildContributingAutoBindings(
            entityDefinitionId,
            mapping.rootPath,
            stream.fields,
            defFields
          )
    ).filter((b) => !boundTargets.has(b.targetFieldRef))
    // Connection-metadata fields (e.g. `storeDomain`) — no source binding, so no
    // boundTargets filter applies; a declared connectionAppFields target never
    // collides with a match/value binding in practice (different app fields).
    const connMetaBindings = buildContributingConnectionAppFields(
      entityDefinitionId,
      appSlug,
      connectionAppFields ?? []
    )
    const linkMode = mapping.linkMode ?? ('upsert' as LinkMode)
    // A `reference` contributing edge owns no value columns — it carries only the
    // External-ID anchor (the FK resolves to the related record at sync), mirroring the
    // interactive `linkRelationship`. Otherwise bind match + author/auto value fields.
    const fieldMappings =
      linkMode === 'reference'
        ? [buildReferenceAnchor()]
        : [...matchBindings, ...valueBindings, ...connMetaBindings]

    // A nested contributing branch (e.g. the order stream's embedded `customer`)
    // hangs off the owned root it's drilled from. Wiring `parentMappingId` makes
    // mapRecord emit the parent→child relation at sync; the edge field itself is
    // created when the owned def is installed via the entity-template flow (v6) — the
    // sink resolves the link def-keyed by `relationshipFieldKey`.
    const parentRootPath = ownedParentRootPath(mapping.rootPath, ownedRootPaths)
    const parentMappingId =
      parentRootPath != null ? (ownedMappingIdByRootPath[parentRootPath] ?? null) : null
    // The edge field lives on the PARENT def — namespace the relationship key with the
    // parent's slug (cosmetic), falling back to this mapping's own entity for a top-level
    // contributing reference.
    const parentManifest =
      parentRootPath != null
        ? (stream.defaultMappings ?? []).find((m) => m.rootPath === parentRootPath)
        : undefined
    const parentSlug =
      parentManifest?.target.mode === 'owned'
        ? parentManifest.target.entity.apiSlug
        : parentManifest?.target.mode === 'contributing'
          ? parentManifest.target.entityKind
          : entityKind

    await addMapping(db, organizationId, {
      dataConnectorStreamId: streamId,
      // STORE parent-relative (see `seedAppOwnedMappings`): only when a parent was
      // resolved — top-level contributing branches keep their absolute (== relative)
      // path. `ownedMappingIdByRootPath` lookups stay keyed ABSOLUTE.
      rootPath:
        parentRootPath != null
          ? relativeSourcePath(mapping.rootPath, parentRootPath)
          : mapping.rootPath,
      linkMode,
      targetMode: 'contributing' as TargetMode,
      entityDefinitionId,
      parentMappingId,
      relationshipFieldKey: appRelationshipFieldKey(
        mapping.relationshipFieldKey,
        appSlug,
        parentSlug
      ),
      fieldMappings,
      orphanBehavior: 'ignore' as OrphanBehavior,
    })
  }
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
  // scheduleConfig is mode-scoped (v9 §5): sync cadence for 'scheduled', SWEEP cadence
  // for 'webhook' (null = default nightly, {triggerInterval:'off'} = no sweep). Only
  // 'manual' force-clears it — selecting webhook must NOT null out a sweep cadence.
  const scheduleConfig =
    patch.syncBehavior === 'manual' ? null : (patch.scheduleConfig ?? undefined)

  // The write + edit-safety stamp run in one transaction so a structural edit can't
  // half-apply (BullMQ scheduler + webhook are external — they run after commit).
  const { row } = await db.transaction(async (tx) => {
    const prior = await loadConnectorRow(tx, organizationId, id)
    const impact = classifyConnectorChange(prior, patch)
    const [row] = await tx
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

    // A credential/config change invalidates the cursor against the source → stamp
    // rebackfill across the connector's streams (never-synced ⇒ skipped). The
    // pause/resume/name/schedule patches are cosmetic and stamp nothing.
    if (impact.level !== 'cosmetic' && prior.lastSyncedAt) {
      const loaded = await loadConnector(tx, organizationId, id)
      const streamIds = loaded?.streams.map((s) => s.stream.id) ?? []
      await stampConnectorResync(tx, id, impact, streamIds, await countConnectorItems(tx, id))
    }
    return { row, prior }
  })

  await syncConnectorScheduler(row)

  // Webhook-sync connectors need no platform-side provider registration: app triggers are
  // registered by the app, and generic WebhookEndpoints are user-pasted URLs. The binding
  // lives in the stream's `requestConfig.webhookTrigger` and drives the dispatch matcher.
  return row
}

/**
 * Finish first-run setup WITHOUT triggering a sync — flip a `pending` connector to
 * `ready` (configured, idle, never synced, scheduler-eligible). Idempotent and
 * one-directional: only `pending → ready` is applied, so a connector a scheduled fire
 * already advanced (`pending → syncing`) — or one already past setup — is returned
 * untouched; Finish can never regress a live/syncing connector. The scheduler was
 * registered at create time and `ready ≠ paused`, so a scheduled connector stays
 * eligible with no re-registration. See optional-first-sync-plan §3.4.
 *
 * Before flipping to `ready` it provisions the connector's `provision`-hint fields
 * inline (`materializeConnectorTargets`, the generic-rest template path) so the columns
 * exist before any sync. App-owned defs are installed separately via the entity-template
 * flow (v6). The status is stamped `provisioning` during the (fast, inline) provision,
 * then `ready`. Idempotent, so a subsequent first sync re-running it is a no-op.
 */
export async function finishConnectorSetup(
  db: Database,
  organizationId: string,
  id: string
): Promise<DataConnectorRow> {
  const row = await loadConnectorRow(db, organizationId, id)
  if (row.status !== 'pending') return row
  await db
    .update(schema.DataConnector)
    .set({ status: 'provisioning', updatedAt: new Date() })
    .where(eq(schema.DataConnector.id, id))
  // Field provisioning is pure schema work (no source fetch), but a field-name clash
  // can still throw. Roll the status back to `pending` on failure so the connector is
  // never stranded mid-`provisioning` — the `!== 'pending'` guard above would otherwise
  // make this a permanent dead-end no later call can clear. Re-throw so the tRPC
  // mutation surfaces the reason to the wizard.
  try {
    await materializeConnectorTargets(db, organizationId, id, row.type)
  } catch (error) {
    await db
      .update(schema.DataConnector)
      .set({ status: 'pending', updatedAt: new Date() })
      .where(eq(schema.DataConnector.id, id))
    throw error
  }
  const [updated] = await db
    .update(schema.DataConnector)
    .set({ status: 'ready', updatedAt: new Date() })
    .where(eq(schema.DataConnector.id, id))
    .returning()
  if (!updated) throw new Error('Failed to finish connector setup')
  return updated
}

export type DeleteSyncedDataBehavior = 'keep' | 'archive' | 'delete'

/**
 * Delete a connector. The provisioned def/fields and synced entity records are the
 * user's CRM data — we never auto-delete them. `behavior` governs the entity records
 * this connector CREATED, identified by the `integrationSource = connector.id` stamp
 * the sink writes on every minted instance (owned and contributing alike):
 *   - 'keep'    → leave records untouched (default).
 *   - 'archive' → soft-delete the created instances (set archivedAt).
 *   - 'delete'  → hard-delete the created instances.
 *
 * Records the connector merely ENRICHED — a pre-existing Contact/Ticket it matched
 * and contributed fields to — carry a different/no `integrationSource`, so they are
 * ALWAYS kept regardless of `behavior`; their per-cell `FieldValue.managedByConnectorId`
 * markers are nulled automatically by the FK `set null` when the connector row cascades.
 *
 * The DataConnector row + its streams/mappings/items/runs cascade on delete. For
 * `keep`/`archive` the `dataConnectorId` FK on EntityDefinition/CustomField is `set null`,
 * so provisioned schema survives as an ordinary user-owned def/field. For `delete` (a full
 * wipe) the provisioned SCHEMA is torn down too — owned defs (+ their columns/records and
 * the inverse relationship fields they planted on shared defs like Contacts) and any
 * contributing columns added to shared defs — so nothing is left stranded to collide when
 * the connector is set up again.
 */
export async function deleteConnector(
  db: Database,
  organizationId: string,
  userId: string,
  id: string,
  behavior: DeleteSyncedDataBehavior = 'keep'
): Promise<{ success: boolean }> {
  // Existence guard (throws NotFound if missing) — no longer need the row itself.
  await loadConnectorRow(db, organizationId, id)
  await removeConnectorScheduler(id)

  // v9 inventory bridge: drop the managed inventory rule(s) for this connector's target defs
  // (the watermark rows cascade via FK on the connector-row delete below). Lazy import — the
  // rule helper pulls the record-rules/cache barrels that would break this module's mocked
  // unit tests at load. Best-effort.
  try {
    const targetDefs = await db
      .selectDistinct({ defId: schema.DataConnectorMapping.entityDefinitionId })
      .from(schema.DataConnectorMapping)
      .innerJoin(
        schema.DataConnectorStream,
        eq(schema.DataConnectorStream.id, schema.DataConnectorMapping.dataConnectorStreamId)
      )
      .where(eq(schema.DataConnectorStream.dataConnectorId, id))
    const defIds = targetDefs.map((r) => r.defId).filter((d): d is string => d != null)
    if (defIds.length > 0) {
      const { removeInventoryDeductionRule } = await import('./inventory-bridge-rule')
      for (const sourceDefId of defIds) {
        await removeInventoryDeductionRule(db, organizationId, { sourceDefId })
      }
    }
  } catch {
    // Rule cleanup is best-effort; an orphan managed rule is harmless (it no-ops without links).
  }

  if (behavior !== 'keep') {
    // archive/delete applies to records THIS connector CREATED — owned mirror rows
    // AND contributing instances it minted — identified by the sticky
    // `DataConnectorItem.mintedInstance` flag the sink sets on create (replaces the
    // retired `EntityInstance.integrationSource` stamp). Records the connector merely
    // ENRICHED (a pre-existing Contact/Ticket it matched) carry `mintedInstance=false`
    // and are ALWAYS kept; their per-cell `FieldValue.managedByConnectorId` markers
    // null automatically via the FK.
    const created = await db
      .selectDistinct({
        id: schema.EntityInstance.id,
        defId: schema.EntityInstance.entityDefinitionId,
      })
      .from(schema.DataConnectorItem)
      .innerJoin(
        schema.EntityInstance,
        eq(schema.EntityInstance.id, schema.DataConnectorItem.entityInstanceId)
      )
      .where(
        and(
          eq(schema.DataConnectorItem.organizationId, organizationId),
          eq(schema.DataConnectorItem.dataConnectorId, id),
          eq(schema.DataConnectorItem.mintedInstance, true)
        )
      )
    if (created.length > 0) {
      // Route through the UnifiedCrudHandler (NOT a raw db.delete) so each record
      // archive/delete fires the same side-effects as a UI delete: FieldValue cleanup,
      // comment removal, pre-delete hooks, and the domain +
      // realtime (`record:archived` / `record:deleted`) events. Lazy-imported so the
      // pure-helper exports of this module stay loadable without the crud chain.
      const { UnifiedCrudHandler } = await import('../resources/crud/unified-handler')
      const crud = new UnifiedCrudHandler(organizationId, userId, db)
      const recordIds = created.map((r) => toRecordId(r.defId, r.id))
      if (behavior === 'archive') {
        await crud.bulkArchive(recordIds)
      } else {
        await crud.bulkDelete(recordIds)
      }
    }
  }

  // Full wipe (behavior='delete'): tear down the provisioned SCHEMA too, so a re-setup
  // starts clean instead of tripping over a stranded def/relationship. 'keep'/'archive'
  // deliberately leave the schema in place (the FK just nulls), keeping the synced data as
  // ordinary user-owned entities.
  if (behavior === 'delete') {
    // Route every teardown through the sanctioned service entry points (NOT raw db.delete)
    // so each one busts the org cache (resources / customFields / entityDefs) and fires the
    // same events a UI delete would. Connector fields aren't protected (no
    // appInstallationId / systemAttribute), so the services delete them cleanly. Lazy-import
    // to keep this module's pure-helper exports loadable without the teardown chains.
    const { EntityDefinitionService } = await import('../entity-definitions')
    const { deleteCustomField, notifyCustomFieldChanged, toFieldError } = await import(
      '../custom-fields'
    )

    // Owned defs first: `delete()` runs the deep teardown (columns, records, items,
    // mappings, AND the inverse relationship fields planted on shared defs) and busts the
    // entity-def + custom-field projections. Still tagged with this connector's id here —
    // the FK set-null fires only on the connector-row delete below.
    const ownedDefs = await db
      .select({ id: schema.EntityDefinition.id })
      .from(schema.EntityDefinition)
      .where(
        and(
          eq(schema.EntityDefinition.organizationId, organizationId),
          eq(schema.EntityDefinition.dataConnectorId, id)
        )
      )
    // A def SHARED with another connector (that connector still maps to it — e.g. GitHub
    // Issues repo 1 + repo 2 into one def) must NOT be torn down: `delete()` cascades the
    // other connector's mappings AND every record in the def, blowing past the per-record
    // `integrationSource` scoping. For a shared def we keep it, reassign ownership to a
    // surviving connector (stays `'connector'`-locked + survives this row's delete), and
    // let the record wipe above (scoped to `integrationSource = id`) remove only THIS
    // connector's rows. See shared-definitions-across-connectors-plan.md.
    const defService = new EntityDefinitionService(organizationId, userId)
    const keptSharedDefIds = new Set<string>()
    for (const ownedDef of ownedDefs) {
      const otherOwners = await db
        .selectDistinct({ connectorId: schema.DataConnectorStream.dataConnectorId })
        .from(schema.DataConnectorMapping)
        .innerJoin(
          schema.DataConnectorStream,
          eq(schema.DataConnectorStream.id, schema.DataConnectorMapping.dataConnectorStreamId)
        )
        .where(
          and(
            eq(schema.DataConnectorMapping.entityDefinitionId, ownedDef.id),
            eq(schema.DataConnectorMapping.organizationId, organizationId),
            ne(schema.DataConnectorStream.dataConnectorId, id)
          )
        )
      if (otherOwners.length === 0) {
        await defService.delete(ownedDef.id)
        continue
      }
      // Reassign to a deterministic survivor. Move the def AND its columns owned by THIS
      // connector (so the stray-field sweep below skips them and they stay locked under
      // the survivor). Do this BEFORE the connector-row delete so its FK set-null can't
      // fire on the reassigned rows.
      const survivorId = [...otherOwners.map((o) => o.connectorId)].sort()[0]
      await db
        .update(schema.EntityDefinition)
        .set({ dataConnectorId: survivorId, updatedAt: new Date() })
        .where(eq(schema.EntityDefinition.id, ownedDef.id))
      await db
        .update(schema.CustomField)
        .set({ dataConnectorId: survivorId, updatedAt: new Date() })
        .where(
          and(
            eq(schema.CustomField.entityDefinitionId, ownedDef.id),
            eq(schema.CustomField.dataConnectorId, id)
          )
        )
      keptSharedDefIds.add(ownedDef.id)
      await notifyEntityDefChanged(organizationId, ownedDef.id, 'updated')
      await onCacheEvent('custom-field.updated', { orgId: organizationId })
    }

    // Then any contributing columns the connector added to SHARED defs (e.g. fields on the
    // system Contact def) — tagged by `dataConnectorId` but not owned by a torn-down def.
    // `deleteField` handles values + relationship inverses + display-field cleanup and busts
    // the custom-field cache. Skip columns on a kept shared def — they were reassigned above.
    const strayFields = await db
      .select({
        id: schema.CustomField.id,
        entityDefinitionId: schema.CustomField.entityDefinitionId,
      })
      .from(schema.CustomField)
      .where(
        and(
          eq(schema.CustomField.organizationId, organizationId),
          eq(schema.CustomField.dataConnectorId, id)
        )
      )
    for (const stray of strayFields) {
      if (!stray.entityDefinitionId) continue
      if (keptSharedDefIds.has(stray.entityDefinitionId)) continue
      const deleted = await deleteCustomField({
        resourceFieldId: toResourceFieldId(stray.entityDefinitionId, stray.id),
        organizationId,
      })
      if (deleted.isErr()) throw toFieldError(deleted.error)
      await notifyCustomFieldChanged(organizationId, stray.entityDefinitionId, 'deleted')
    }
  }

  await db.delete(schema.DataConnector).where(eq(schema.DataConnector.id, id))

  logger.info('Deleted data connector', { id, behavior })
  return { success: true }
}

/**
 * Owned-def ids of `connectorId` that ANOTHER connector also maps to — the defs a
 * `delete` KEEPS (reassigning ownership) instead of tearing down (see `deleteConnector`'s
 * shared-def guard). Powers the "shared → kept" delete-confirm copy. Empty when the
 * connector owns no defs or none are shared.
 */
export async function listSharedOwnedDefIds(
  db: Database,
  organizationId: string,
  connectorId: string
): Promise<string[]> {
  const ownedDefs = await db
    .select({ id: schema.EntityDefinition.id })
    .from(schema.EntityDefinition)
    .where(
      and(
        eq(schema.EntityDefinition.organizationId, organizationId),
        eq(schema.EntityDefinition.dataConnectorId, connectorId)
      )
    )
  if (ownedDefs.length === 0) return []
  const ownedIds = ownedDefs.map((d) => d.id)
  const shared = await db
    .selectDistinct({ defId: schema.DataConnectorMapping.entityDefinitionId })
    .from(schema.DataConnectorMapping)
    .innerJoin(
      schema.DataConnectorStream,
      eq(schema.DataConnectorStream.id, schema.DataConnectorMapping.dataConnectorStreamId)
    )
    .where(
      and(
        inArray(schema.DataConnectorMapping.entityDefinitionId, ownedIds),
        eq(schema.DataConnectorMapping.organizationId, organizationId),
        ne(schema.DataConnectorStream.dataConnectorId, connectorId)
      )
    )
  return shared.map((s) => s.defId).filter((defId): defId is string => defId != null)
}

// ── Streams ─────────────────────────────────────────────────────────────────

/**
 * Reject a steering config whose request template references a `{token}` not declared in
 * the steering `paths`. At runtime such a token never resolves (the steer context is built
 * only from the declared paths), so the fetch would fail `assertResolved` on EVERY delivery
 * and dead-letter silently. Catching it at save turns that footgun into an edit-time error.
 */
function assertSteeringConfigValid(requestConfig: StreamRequestConfig | null | undefined): void {
  const wt = requestConfig?.webhookTrigger
  if (!wt || (wt.paths?.length ?? 0) === 0) return
  const declared = new Set(wt.paths)
  const missing = requiredSteerTokens(requestConfig).filter((t) => !declared.has(t))
  if (missing.length > 0) {
    throw new BadRequestError(
      `Webhook steering references undeclared token(s) {${missing.join('}, {')}}. ` +
        'Add them to the steering payload paths, or remove them from the request.'
    )
  }
}

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
  assertSteeringConfigValid(input.requestConfig)
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

/**
 * Update a stream's `streamKey` and/or `enabled` flag.
 *
 * Toggling `enabled` is non-structural (cosmetic per `edit-impact.ts`) — the next
 * sync includes/excludes the stream naturally, so no cursor invalidation or
 * record archiving happens here. Use `setStreamRequestConfig` for steering changes
 * that carry cursor side effects.
 */
export async function updateStream(
  db: Database,
  organizationId: string,
  streamId: string,
  input: { streamKey?: string; enabled?: boolean }
): Promise<DataConnectorStreamRow> {
  await loadStreamRow(db, organizationId, streamId)
  const [row] = await db
    .update(schema.DataConnectorStream)
    .set({
      ...(input.streamKey !== undefined ? { streamKey: input.streamKey } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.DataConnectorStream.id, streamId))
    .returning()
  if (!row) throw new Error('Failed to update stream')
  return row
}

/** Load a stream org-scoped or throw. */
async function loadStreamRow(
  db: DbOrTx,
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
  assertSteeringConfigValid(input.requestConfig)
  return db.transaction(async (tx) => {
    const existing = await loadStreamRow(tx, organizationId, streamId)
    const impact = classifyStreamRequestChange(existing, input)
    const [row] = await tx
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

    // A request-config / sync-mode change invalidates the cursor against the source.
    if (impact.level !== 'cosmetic') {
      const connector = await tx.query.DataConnector.findFirst({
        where: eq(schema.DataConnector.id, existing.dataConnectorId),
        columns: { id: true, lastSyncedAt: true },
      })
      if (connector?.lastSyncedAt) {
        await stampConnectorResync(
          tx,
          existing.dataConnectorId,
          impact,
          [streamId],
          await countConnectorItems(tx, existing.dataConnectorId)
        )
      }
    }
    return row
  })
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
  /**
   * Null for an unbound app-owned mapping (its def is installed via the entity-template
   * flow, v6); set for contributing mappings (their system def exists).
   */
  entityDefinitionId: string | null
  parentMappingId?: string | null
  relationshipFieldKey?: string | null
  fieldMappings?: FieldMapping[]
  orphanBehavior?: OrphanBehavior
}

/**
 * Derive a relationship branch's `linkMode` from its field bindings
 * (relationship-linking v3 §9.6a) — there is no user toggle. A branch that maps
 * only its External ID (or nothing) is a lazy `reference` (point at someone else's
 * record); a branch that writes any non-identity field is an `upsert` (contribute
 * the record). Only applied to a related branch (has a parent + a drilled edge);
 * the root mapping stays whatever was requested (always `upsert`).
 */
function deriveLinkMode(
  parentMappingId: string | null | undefined,
  relationshipFieldKey: string | null | undefined,
  fieldMappings: FieldMapping[],
  fallback: LinkMode
): LinkMode {
  if (!parentMappingId || !relationshipFieldKey) return fallback
  // A binding to a real target field means we WRITE/contribute the related record
  // (upsert) — even when that field is ALSO the External ID (e.g. a drilled
  // `email → Contact.Email` keyed by email). Only a TARGET-LESS External-ID anchor
  // (point-at-someone-else's record by id, `targetFieldRef: null`) keeps it `reference`.
  const writesField = fieldMappings.some(
    (fm) => fm.targetFieldRef != null && (fm.mergeStrategy ?? 'overwrite') !== 'ignore'
  )
  if (writesField) return 'upsert'
  // `reference` (point at someone else's record by id) is only meaningful once an
  // External ID anchor is designated. A freshly-drilled, still-unconfigured branch
  // has neither fields nor an anchor — treat it as `upsert` so it never trips the
  // anchor guard at creation (the §9.7 deadlock). It flips to `reference` the moment
  // the user marks an External ID and maps nothing else (the link-only case).
  const hasAnchor = fieldMappings.some((fm) => fm.identityRole?.kind === 'externalId')
  return hasAnchor ? 'reference' : 'upsert'
}

/**
 * Correctness guard (relationship-linking v3 §9.7): a `reference` branch — point at
 * another record by id — MUST designate an External ID to anchor the link, or it can
 * never resolve (the §3.2 dangling-link bug). An embedded `upsert` child is never
 * blocked (it always has the synthetic `parent:index` fallback). The editor sets the
 * anchor atomically on link creation, so this is a backstop for a hand-cleared anchor.
 */
function assertReferenceAnchored(
  linkMode: LinkMode,
  parentMappingId: string | null | undefined,
  relationshipFieldKey: string | null | undefined,
  fieldMappings: FieldMapping[]
): void {
  if (linkMode !== 'reference' || !parentMappingId || !relationshipFieldKey) return
  const hasAnchor = fieldMappings.some((fm) => fm.identityRole?.kind === 'externalId')
  if (!hasAnchor) {
    throw new BadRequestError(
      'This relationship link points at another record by id, so it needs an External ID field to resolve. Mark the id field as the External ID.'
    )
  }
}

/** Create a mapping (one target def a fetch lands in). */
export async function addMapping(
  db: Database,
  organizationId: string,
  input: AddMappingInput
): Promise<DataConnectorMappingRow> {
  await loadStreamRow(db, organizationId, input.dataConnectorStreamId)
  assertFieldRefsMatchDef(input.entityDefinitionId, input.fieldMappings)
  const fieldMappings = input.fieldMappings ?? []
  const linkMode = deriveLinkMode(
    input.parentMappingId,
    input.relationshipFieldKey,
    fieldMappings,
    input.linkMode ?? 'upsert'
  )
  assertReferenceAnchored(
    linkMode,
    input.parentMappingId,
    input.relationshipFieldKey,
    fieldMappings
  )
  const [row] = await db
    .insert(schema.DataConnectorMapping)
    .values({
      dataConnectorStreamId: input.dataConnectorStreamId,
      organizationId,
      rootPath: input.rootPath ?? '',
      linkMode,
      targetMode: input.targetMode,
      entityDefinitionId: input.entityDefinitionId,
      parentMappingId: input.parentMappingId ?? null,
      relationshipFieldKey: input.relationshipFieldKey ?? null,
      fieldMappings,
      orphanBehavior: input.orphanBehavior ?? 'ignore',
    })
    .returning()
  if (!row) throw new Error('Failed to add mapping')
  return row
}

/** Load a mapping org-scoped or throw. */
async function loadMappingRow(
  db: DbOrTx,
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
  return db.transaction(async (tx) => {
    // Load `prev` INSIDE the transaction so a concurrent edit can't slip a stale
    // classification through (the safety must reflect the row we actually write over).
    const existing = await loadMappingRow(tx, organizationId, mappingId)
    // Validate refs against the EFFECTIVE def (a same-call def change applies first).
    const effectiveDefId =
      patch.entityDefinitionId !== undefined
        ? patch.entityDefinitionId
        : existing.entityDefinitionId
    assertFieldRefsMatchDef(effectiveDefId, patch.fieldMappings)
    const impact = classifyMappingChange(existing, patch)
    // `linkMode` is derived, never user-set (§9.6a): recompute it from the EFFECTIVE
    // branch (a field-binding or relationship edit can flip id-only ⇄ has-fields).
    const effectiveFieldMappings = patch.fieldMappings ?? existing.fieldMappings ?? []
    const effectiveParent =
      patch.parentMappingId !== undefined ? patch.parentMappingId : existing.parentMappingId
    const effectiveRelRef =
      patch.relationshipFieldKey !== undefined
        ? patch.relationshipFieldKey
        : existing.relationshipFieldKey
    const linkMode = deriveLinkMode(
      effectiveParent,
      effectiveRelRef,
      effectiveFieldMappings,
      (patch.linkMode ?? existing.linkMode) as LinkMode
    )
    assertReferenceAnchored(linkMode, effectiveParent, effectiveRelRef, effectiveFieldMappings)
    const [row] = await tx
      .update(schema.DataConnectorMapping)
      .set({
        ...(patch.rootPath !== undefined ? { rootPath: patch.rootPath } : {}),
        linkMode,
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

    // Classify against the PRE-edit row, then apply the safety (stamp resyncPending;
    // for a rebind on an incremental connector, neutralize the stale binds). The
    // banner only defers the re-crawl — this safety always runs.
    await applyMappingEditSafety(tx, organizationId, existing, impact)
    return row
  })
}

/**
 * Remove a mapping. The `mappingId` FK cascades its `DataConnectorItem` binds, but
 * `entityInstanceId` is `set null` — so an OWNED mapping's `EntityInstance` rows would
 * dangle (no connector context, re-created as duplicates on a later re-add). Mirror the
 * rebind safety: for an owned mapping on a synced connector, archive (soft-delete) the
 * bound instances BEFORE the delete cascades the items away. Contributing instances are
 * user-owned — never touched. Never-synced connectors have nothing to clean up.
 */
export async function removeMapping(
  db: Database,
  organizationId: string,
  mappingId: string
): Promise<{ success: boolean }> {
  return db.transaction(async (tx) => {
    const mapping = await loadMappingRow(tx, organizationId, mappingId)

    if (mapping.targetMode === 'owned') {
      const stream = await tx.query.DataConnectorStream.findFirst({
        where: eq(schema.DataConnectorStream.id, mapping.dataConnectorStreamId),
        columns: { dataConnectorId: true },
      })
      const loaded = stream && (await loadConnector(tx, organizationId, stream.dataConnectorId))
      // Only a synced connector has bound instances worth archiving (Q2 — never-synced ⇒ skip).
      if (stream && loaded && loaded.connector.lastSyncedAt) {
        // Archive the owned instances bound through this mapping before the cascade
        // strips their `DataConnectorItem` rows (which would set-null the back-link).
        // Single bulk update over a subselect of the bound instance ids.
        await tx
          .update(schema.EntityInstance)
          .set({ archivedAt: new Date() })
          .where(
            inArray(
              schema.EntityInstance.id,
              tx
                .select({ id: schema.DataConnectorItem.entityInstanceId })
                .from(schema.DataConnectorItem)
                .where(
                  and(
                    eq(schema.DataConnectorItem.dataConnectorId, stream.dataConnectorId),
                    eq(schema.DataConnectorItem.mappingId, mappingId)
                  )
                )
            )
          )
      }
    }

    await tx
      .delete(schema.DataConnectorMapping)
      .where(eq(schema.DataConnectorMapping.id, mappingId))
    return { success: true }
  })
}
