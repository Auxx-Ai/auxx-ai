// packages/lib/src/data-connectors/mutations.ts
// Functional mutation + setup helpers over the Data Connector control tables.
// Drizzle + neverthrow, no model classes (project convention). The tRPC router
// (apps/web) consumes these; the engine/orchestrator stays read-only here. Scheduler
// re-registration is driven from create/update (pause/resume is a `status` patch
// through update) so a cadence or lifecycle change is reflected in BullMQ immediately.

import { type CatalogDataConnector, type Database, schema, type Transaction } from '@auxx/database'
import type { FieldType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { getFieldDefinitionId, getFieldId, toResourceFieldId } from '@auxx/types/field'
import { generateId } from '@auxx/utils'
import { and, eq, inArray } from 'drizzle-orm'
import { getCachedCustomFields, getCachedEntityDefId } from '../cache'
import { BadRequestError, NotFoundError } from '../errors'
import { toRecordId } from '../resources/resource-id'
import {
  appCatalogStreamSchema,
  buildContributingAutoBindings,
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
  ConnectorMappingTargetSpec,
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
 * Create a connector from an installed app's catalog declaration (create-sync-flow
 * §3.1, Tier 1). Mirrors {@link createConnectorFromTemplate}: an `app:<slug>`
 * connector + one pre-filled stream per declared catalog stream, each with the
 * declared source schema (from `exampleRecord`, else built from the field paths)
 * stamped `catalog`. The request is baked into the app (`fixed` model), so streams
 * carry no `requestConfig`.
 *
 * Owned default-mappings are created as LAZY rows here (05e — connector-target-resources
 * -splice): a `DataConnectorMapping` with `entityDefinitionId: null`, the persisted
 * `targetSpec` (owned-def shell + relationship edge), and `fieldMappings` carrying a
 * `provision` spec + null ref per field. The owned `EntityDefinition`s + columns + edges
 * are NOT created here — they materialize at finish/first sync (`materializeConnectorTargets`),
 * so abandoning setup leaves no orphan defs and the mapping editor shows the POTENTIAL
 * entity until it exists. `contributing` default-mappings are ALSO materialized (as draft
 * rows — multi-stream-setup-plan §5): they merge into an existing system def, so the def +
 * declared identity-match keys are wired up front; any unresolved field is left for the
 * setup overview to surface as `needs-mapping`.
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
    const streamRow = await addStream(db, organizationId, connector.id, {
      streamKey: stream.key,
      ...appCatalogStreamSchema(stream),
      syncMode: stream.syncMode ?? 'snapshot',
    })
    await createLazyStreamOwnedMappings(db, organizationId, streamRow.id, stream)
    await materializeAppContributingMappings(db, organizationId, streamRow.id, stream)
  }

  return connector
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

/** Strip a mapping's rootPath off a field's sourcePath, leaving a subtree-relative path. */
function relativeSourcePath(sourcePath: string, rootPath: string): string {
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
 * Create the LAZY owned mappings for a catalog stream (05e). One
 * `DataConnectorMapping` per owned default-mapping, with `entityDefinitionId: null`,
 * the persisted `targetSpec` (owned-def shell + relationship edge), and `fieldMappings`
 * carrying a `provision` spec + null ref per declared field. NO `EntityDefinition`s,
 * columns, or relationship edges are created here — those materialize at finish/first
 * sync via `materializeConnectorTargets`. `parentMappingId` is still wired from rootPath
 * nesting (parents first) so the fan-out tree forms before any def exists.
 */
async function createLazyStreamOwnedMappings(
  db: Database,
  organizationId: string,
  streamId: string,
  stream: CatalogDataConnector['streams'][number]
): Promise<void> {
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
    // its entry list is empty; it still carries the owned-def shell + edge in targetSpec.
    const entries = partition[mapping.rootPath] ?? []

    const parentRootPath = ownedParentRootPath(mapping.rootPath, allRootPaths)
    const parentMappingId = parentRootPath != null ? mappingIdByRootPath[parentRootPath] : null

    const targetSpec: ConnectorMappingTargetSpec = {
      ownedDef: {
        apiSlug: entity.apiSlug,
        singular: entity.singular,
        plural: entity.plural,
        primaryDisplayFieldKey: entity.primaryDisplayField,
      },
    }
    // The forward edge lives on the PARENT def; with no parent (a root mapping) there's
    // nothing to attach to, so the relationship is only persisted on a child mapping.
    if (mapping.relationship && parentRootPath != null) {
      targetSpec.relationship = {
        fieldKey: mapping.relationship.fieldKey,
        name: mapping.relationship.name,
        cardinality: mapping.relationship.cardinality,
        inverseName: mapping.relationship.inverseName,
        targetRef: mapping.relationship.targetRef,
      }
    }

    const row = await addMapping(db, organizationId, {
      dataConnectorStreamId: streamId,
      rootPath: mapping.rootPath,
      linkMode: mapping.linkMode ?? ('upsert' as LinkMode),
      targetMode: 'owned' as TargetMode,
      entityDefinitionId: null,
      parentMappingId,
      relationshipFieldKey: mapping.relationshipFieldKey ?? null,
      fieldMappings: buildLazyOwnedFieldMappings(entries),
      targetSpec,
      // Incremental connectors only see the delta each run, so unseen ≠ deleted —
      // never archive owned orphans automatically. Full-snapshot sweeps can still
      // reconcile; v1 keeps it safe.
      orphanBehavior: 'ignore' as OrphanBehavior,
    })

    mappingIdByRootPath[mapping.rootPath] = row.id
  }
}

/**
 * Lazy field mappings for an owned mapping (05e): instead of a concrete provisioned
 * ref, each entry carries `targetFieldRef: null` + a `provision` spec (the column to
 * create at materialize, keyed by the stable `appFieldKey`). The expression mirrors
 * the manual editor — `{<relativeSourcePath>}` over an identity `sourceFields` map —
 * with the SUBTREE-relative path (`sku`, not `line_items[].sku`) because `mapRecord`
 * evaluates a child mapping's fields against its extracted subtree. The concrete ref
 * is stamped by `backfillProvisionedFieldRefs` once the column exists.
 */
export function buildLazyOwnedFieldMappings(entries: OwnedFieldEntry[]): FieldMapping[] {
  return entries.map(({ field, relativeSourcePath: relPath }) => ({
    id: generateId(),
    targetFieldRef: null,
    expression: `{${relPath}}`,
    sourceFields: { [relPath]: relPath },
    provision: {
      name: field.name,
      appFieldKey: field.fieldKey,
      type: field.type as FieldType,
      isHidden: field.capabilities?.hidden ?? false,
    },
  }))
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
  stream: CatalogDataConnector['streams'][number]
): Promise<void> {
  for (const mapping of stream.defaultMappings ?? []) {
    if (mapping.target.mode !== 'contributing') continue
    const { entityKind, matchFieldKeys, fieldBindings } = mapping.target

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
    const fieldMappings = [...matchBindings, ...valueBindings]

    await addMapping(db, organizationId, {
      dataConnectorStreamId: streamId,
      rootPath: mapping.rootPath,
      linkMode: mapping.linkMode ?? ('upsert' as LinkMode),
      targetMode: 'contributing' as TargetMode,
      entityDefinitionId,
      relationshipFieldKey: mapping.relationshipFieldKey ?? null,
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
  // Selecting manual/webhook clears the cadence so the scheduler is removed.
  const scheduleConfig =
    patch.syncBehavior && patch.syncBehavior !== 'scheduled'
      ? null
      : (patch.scheduleConfig ?? undefined)

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
 * Before flipping to `ready` it materializes the connector's LAZY owned targets inline
 * (05e — `materializeConnectorTargets`): "Finish without syncing" still creates the
 * owned defs/fields/edges so the entities show in nav. The status is stamped
 * `provisioning` during the (fast, inline) materialize, then `ready`. Idempotent, so a
 * subsequent first sync re-running materialize is a no-op.
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
  await materializeConnectorTargets(db, organizationId, id)
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
 * The DataConnector row + its streams/mappings/items/runs cascade on delete; the
 * `dataConnectorId` FK on EntityDefinition/CustomField is `set null`, so provisioned
 * schema survives (now an ordinary user-owned def/field).
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

  if (behavior !== 'keep') {
    // archive/delete applies to records THIS connector CREATED — owned mirror rows
    // AND contributing instances it minted — identified by the instance-level
    // `integrationSource = connector.id` stamp the sink writes on create. Records the
    // connector merely enriched (a pre-existing Contact/Ticket it matched) carry a
    // different/no `integrationSource` and are ALWAYS kept; their per-cell
    // `FieldValue.managedByConnectorId` markers null automatically via the FK.
    const created = await db
      .select({ id: schema.EntityInstance.id, defId: schema.EntityInstance.entityDefinitionId })
      .from(schema.EntityInstance)
      .where(
        and(
          eq(schema.EntityInstance.organizationId, organizationId),
          eq(schema.EntityInstance.integrationSource, id)
        )
      )
    if (created.length > 0) {
      // Route through the UnifiedCrudHandler (NOT a raw db.delete) so each record
      // archive/delete fires the same side-effects as a UI delete: FieldValue cleanup,
      // comment removal, pre-delete hooks, snapshot invalidation, and the domain +
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

  await db.delete(schema.DataConnector).where(eq(schema.DataConnector.id, id))

  logger.info('Deleted data connector', { id, behavior })
  return { success: true }
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
   * Null for a LAZILY-provisioned owned mapping (the def is created at finish/first
   * sync from `targetSpec`); set for contributing mappings (their system def exists).
   */
  entityDefinitionId: string | null
  parentMappingId?: string | null
  relationshipFieldKey?: string | null
  fieldMappings?: FieldMapping[]
  /** Persisted owned-def + edge declaration for lazy materialization (05e). */
  targetSpec?: ConnectorMappingTargetSpec | null
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
      targetSpec: input.targetSpec ?? null,
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
