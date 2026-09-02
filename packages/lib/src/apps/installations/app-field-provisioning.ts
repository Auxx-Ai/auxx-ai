// packages/lib/src/apps/installations/app-field-provisioning.ts
// App-registered custom-field provisioning: the manifest-field provisioner + the
// create/drift/orphan reconciler (the authoritative provisioning path), plus the
// catalog-loading entry points callers use. Moved from @auxx/services so it can use
// the org cache directly (kind→def resolution, post-reconcile invalidation).

import {
  type CatalogAppField,
  type CatalogEntity,
  type CatalogPayload,
  type Database,
  database,
  schema,
  type Transaction,
} from '@auxx/database'
import type { CustomFieldEntity, FieldType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import type { SelectOption } from '@auxx/types/custom-field'
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { getCachedEntityDefId } from '../../cache'
import { onCacheEvent } from '../../cache/invalidate'
import { type CreateCustomFieldInput, createCustomField } from '../../custom-fields'

const logger = createScopedLogger('app-fields')

/**
 * Map a catalog field's author-set capabilities → `CustomField` column flags.
 * Deliberately NOT the registry's `mapCapabilities` — that takes the required-prop
 * `FieldCapabilities` shape, while catalog capabilities are all-optional. The
 * column names and defaults match, so the two stay trivially in sync.
 */
function capabilitiesToColumns(caps: CatalogAppField['capabilities']) {
  return {
    required: caps?.required ?? false,
    isUnique: caps?.unique ?? false,
    isCreatable: caps?.creatable ?? true,
    isUpdatable: caps?.updatable ?? true,
    isComputed: caps?.computed ?? false,
    isSortable: caps?.sortable ?? true,
    isFilterable: caps?.filterable ?? true,
    isHidden: caps?.hidden ?? false,
  }
}

/** Build the `createCustomField` options payload from a catalog field. */
function buildFieldOptions(field: CatalogAppField): CreateCustomFieldInput['options'] {
  if (
    field.options &&
    (field.type === 'SINGLE_SELECT' || field.type === 'MULTI_SELECT' || field.type === 'TAGS')
  ) {
    // Catalog options have an optional label/free-string color; normalize to
    // SelectOption (label defaults to value; color is a constrained palette).
    return field.options.map((o) => ({
      value: o.value,
      label: o.label ?? o.value,
      color: o.color,
    })) as SelectOption[]
  }
  if (field.calc)
    return { calc: { expression: field.calc.expression } } as CreateCustomFieldInput['options']
  return undefined
}

export interface ProvisionContext {
  appInstallationId: string
  organizationId: string
  /** Credential.id for `scope: 'connection'` fields; omit for installation scope. */
  connectionId?: string
  /** The app's slug (e.g. 'shopify') — stamped onto identity-flagged fields as
   *  `CustomField.appSlug`, the `RecordIdentity.source` value. */
  appSlug: string
}

/** Outcome of a single `provisionAppField` call — lets the reconciler tally creates
 *  without treating an idempotent no-op (a field that already exists) or an
 *  unsupported/unresolvable field as a failure. */
export type ProvisionOutcome = 'created' | 'duplicate' | 'skipped'

/**
 * Resolve a manifest RELATIONSHIP field's target to an `EntityDefinition.id` —
 * `{ entityKind }` resolves through the org cache (a platform kind, one def per
 * entityType per org); `{ entityKey }` resolves to the SAME app installation's own
 * `defineEntity` def by its stable `sourceKey` (mirrors `adoptSharedOwnedDefId`'s
 * lookup for the connector-owned path). Undefined when unresolvable.
 */
async function resolveManifestRelationshipTarget(
  db: Database | Transaction,
  ctx: ProvisionContext,
  target: NonNullable<CatalogAppField['relationship']>['target']
): Promise<string | undefined> {
  if ('entityKind' in target) {
    return getCachedEntityDefId(ctx.organizationId, target.entityKind)
  }
  const def = await db.query.EntityDefinition.findFirst({
    where: and(
      eq(schema.EntityDefinition.organizationId, ctx.organizationId),
      eq(schema.EntityDefinition.appInstallationId, ctx.appInstallationId),
      eq(schema.EntityDefinition.sourceKey, target.entityKey),
      isNull(schema.EntityDefinition.archivedAt)
    ),
    columns: { id: true },
  })
  return def?.id
}

/**
 * Provision one declared app field. Idempotent: `createCustomField` returns
 * DUPLICATE_FIELD_NAME when a field already exists for this
 * `(appInstallationId, connectionId?, appFieldKey)` — reported as `'duplicate'`.
 * A genuine (non-duplicate) create failure THROWS — the reconciler wraps the call
 * and records it as a field-level error (which parks the sync).
 *
 * RELATIONSHIP fields are provisioned through `createCustomField`'s relationship
 * branch (`createRelationshipFieldWithInverse`), the same path the entity-template
 * installer uses — the target resolves via {@link resolveManifestRelationshipTarget}.
 * Drift on an existing field is NOT handled here; the reconciler's `update` action
 * owns that (single source of truth).
 *
 * @param resolvedEntityDefinitionId - Skip the `targetEntity` cache lookup and write
 *   straight to this def. Used by {@link reconcileAppEntityFields}: an entity-owned
 *   field's target is the entity's OWN def (already known from its `sourceKey`), not
 *   a platform kind the `entityDefs` cache resolves.
 */
export async function provisionAppField(
  field: CatalogAppField,
  ctx: ProvisionContext,
  tx?: Transaction,
  resolvedEntityDefinitionId?: string
): Promise<ProvisionOutcome> {
  const db = tx ?? database

  // The catalog `targetEntity` IS the entityType (one def per entityType per org).
  // Cache-resolved; defs pre-exist any install/sync transaction, so a tx caller
  // never needs read-your-writes here.
  const entityDefinitionId =
    resolvedEntityDefinitionId ??
    (await getCachedEntityDefId(ctx.organizationId, field.targetEntity))
  if (!entityDefinitionId) {
    logger.warn('cannot resolve targetEntity — skipping field', {
      appFieldKey: field.key,
      targetEntity: field.targetEntity,
      appInstallationId: ctx.appInstallationId,
    })
    return 'skipped'
  }

  let relationship: CreateCustomFieldInput['relationship']
  if (field.type === 'RELATIONSHIP') {
    if (!field.relationship) {
      logger.warn('RELATIONSHIP field missing relationship config — skipping', {
        appFieldKey: field.key,
        appInstallationId: ctx.appInstallationId,
      })
      return 'skipped'
    }
    const relatedResourceId = await resolveManifestRelationshipTarget(
      db,
      ctx,
      field.relationship.target
    )
    if (!relatedResourceId) {
      logger.warn('cannot resolve relationship target — skipping field', {
        appFieldKey: field.key,
        target: field.relationship.target,
        appInstallationId: ctx.appInstallationId,
      })
      return 'skipped'
    }
    relationship = {
      relatedResourceId,
      relationshipType: field.relationship.cardinality,
      inverseName: field.relationship.inverseName ?? field.name,
    }
  }

  const result = await createCustomField(
    {
      organizationId: ctx.organizationId,
      name: field.name,
      type: field.type as FieldType,
      description: field.description,
      entityDefinitionId,
      options: buildFieldOptions(field),
      appInstallationId: ctx.appInstallationId,
      connectionId: ctx.connectionId,
      appFieldKey: field.key,
      isIdentity: field.identity ?? false,
      appSlug: ctx.appSlug,
      relationship,
      ...capabilitiesToColumns(field.capabilities),
    },
    tx
  )

  if (result.isErr()) {
    if (result.error.code !== 'DUPLICATE_FIELD_NAME') {
      // Don't silently lose a declared field — surface real failures to the reconciler.
      throw new Error(`Failed to provision app field "${field.key}": ${result.error.message}`)
    }
    return 'duplicate'
  }
  return 'created'
}

// ── Reconciler (create / drift / orphan) ─────────────────────────────────────────

/**
 * Universe filter for the reconciler. Two provisioning universes share the
 * `(appInstallationId, appFieldKey)` namespace and the reconciler must only ever
 * touch the one it owns:
 *
 *  1. MANIFEST app fields (the app's `fields.ts`) — created by
 *     {@link provisionAppField}, `dataConnectorId` always NULL, living on org defs
 *     resolved by entity kind. The reconciler's universe.
 *  2. Connector-machinery columns — template-installed owned-def columns (v6) and
 *     provisioned connector columns (v5), stamped with `dataConnectorId` at create.
 *     Owned by template install / `materializeConnectorTargets`; the reconciler must
 *     never touch these (its orphan sweep would eat them — their keys are absent
 *     from `catalog.fields` by construction).
 *
 * `dataConnectorId` alone is NOT a stable discriminator: connector delete with
 * keep/archive `set null`s the FK while `appInstallationId` (and `appFieldKey`, the
 * reconnect-adoption anchor) survive, so a kept owned-def column would masquerade as
 * a manifest field. Manifest fields can never live on an APP-OWNED def (their
 * `targetEntity` resolves by entity kind), and def-level `appInstallationId` survives
 * connector deletion — so rows on app-owned defs are excluded too.
 */
export function isManifestAppFieldRow(
  row: { dataConnectorId: string | null; entityDefinitionId: string | null },
  appOwnedDefIds: ReadonlySet<string>
): boolean {
  if (row.dataConnectorId != null) return false
  if (row.entityDefinitionId != null && appOwnedDefIds.has(row.entityDefinitionId)) return false
  return true
}

/** The existing-row projection the pure diff reads — a subset of `CustomFieldEntity`. */
export type ExistingAppFieldRow = Pick<
  CustomFieldEntity,
  | 'id'
  | 'appFieldKey'
  | 'connectionId'
  | 'type'
  | 'name'
  | 'description'
  | 'isIdentity'
  | 'appSlug'
  | 'options'
  | 'required'
  | 'isUnique'
  | 'isCreatable'
  | 'isUpdatable'
  | 'isComputed'
  | 'isSortable'
  | 'isFilterable'
  | 'isHidden'
>

/** The columns a drift `update` may write — only the ones the reconciler diffs. */
export type AppFieldUpdateChanges = Partial<
  Pick<
    CustomFieldEntity,
    | 'name'
    | 'description'
    | 'isIdentity'
    | 'appSlug'
    | 'options'
    | 'required'
    | 'isUnique'
    | 'isCreatable'
    | 'isUpdatable'
    | 'isComputed'
    | 'isSortable'
    | 'isFilterable'
    | 'isHidden'
  >
>

export interface AppFieldReconcileAction {
  kind: 'create' | 'update' | 'orphan-delete' | 'orphan-hide'
  appFieldKey: string
  /** null for installation-scope; the owning connection for connection-scope. */
  connectionId: string | null
  /** create/update source field. */
  field?: CatalogAppField
  /** update/orphan target row. */
  existingFieldId?: string
  /** update: only the drifted columns. */
  changes?: AppFieldUpdateChanges
}

export interface AppFieldReconcileError {
  appFieldKey: string
  reason: string
}

/**
 * Deterministic key-sorted JSON serialization. jsonb round-trips reorder object
 * keys, so a naive `JSON.stringify` equality check false-positives on drift — a
 * known repo trap. Skips `undefined`-valued keys to match jsonb semantics (a
 * `{ color: undefined }` in-memory value is stored as an absent key).
 */
function stableStringify(value: unknown): string {
  if (value === undefined || value === null) return 'null'
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}

/** Pull the select-option list out of a stored `options` blob (array or `{ options }`). */
function extractSelectOptions(stored: unknown): unknown[] | undefined {
  if (Array.isArray(stored)) return stored
  if (stored && typeof stored === 'object') {
    const inner = (stored as { options?: unknown }).options
    if (Array.isArray(inner)) return inner
  }
  return undefined
}

/**
 * Compute the drifted `options` value for a field, or null when unchanged. Only
 * option-bearing types (SELECT/MULTI_SELECT/TAGS + CALC) can drift; anything else
 * never touches `options`. Preserves the existing options wrapper (`icon`,
 * `isCustom`, …) — only the select list / calc block is replaced.
 */
function computeOptionsChange(field: CatalogAppField, existingOptions: unknown): unknown | null {
  const desired = buildFieldOptions(field)
  const base =
    existingOptions && typeof existingOptions === 'object' && !Array.isArray(existingOptions)
      ? (existingOptions as Record<string, unknown>)
      : {}

  if (Array.isArray(desired)) {
    const existingList = extractSelectOptions(existingOptions) ?? []
    if (stableStringify(desired) === stableStringify(existingList)) return null
    return { ...base, options: desired }
  }
  if (desired && typeof desired === 'object' && 'calc' in desired) {
    const desiredCalc = (desired as { calc: unknown }).calc
    const existingCalc = (base as { calc?: unknown }).calc
    if (stableStringify(desiredCalc) === stableStringify(existingCalc)) return null
    return { ...base, calc: desiredCalc }
  }
  return null
}

const CAPABILITY_KEYS = [
  'required',
  'isUnique',
  'isCreatable',
  'isUpdatable',
  'isComputed',
  'isSortable',
  'isFilterable',
  'isHidden',
] as const

/** Diff a catalog field against its existing row → only the drifted columns. */
function diffFieldColumns(
  field: CatalogAppField,
  existing: ExistingAppFieldRow,
  appSlug: string
): AppFieldUpdateChanges {
  const changes: AppFieldUpdateChanges = {}
  if (existing.name !== field.name) changes.name = field.name
  const desiredDescription = field.description ?? null
  if ((existing.description ?? null) !== desiredDescription)
    changes.description = desiredDescription
  const desiredIdentity = field.identity ?? false
  if (existing.isIdentity !== desiredIdentity) changes.isIdentity = desiredIdentity
  if ((existing.appSlug ?? null) !== appSlug) changes.appSlug = appSlug
  const optionsChange = computeOptionsChange(field, existing.options)
  if (optionsChange !== null) changes.options = optionsChange
  const caps = capabilitiesToColumns(field.capabilities)
  for (const key of CAPABILITY_KEYS) {
    if (existing[key] !== caps[key]) changes[key] = caps[key]
  }
  return changes
}

const cellKey = (appFieldKey: string, connectionId: string | null): string =>
  `${appFieldKey} ${connectionId ?? ''}`

/**
 * Pure diff (DB-free, unit-testable) — the desired cells (each declared field ×
 * its scope's slots) vs the existing rows. Emits create/update actions and drift
 * `errors` (a type change parks the sync), plus orphan-handling for rows whose
 * `appFieldKey` no longer appears in the catalog.
 *
 * A *cell* is one `(appFieldKey, connectionId)` slot: installation-scope fields
 * take `connectionId: null`; connection-scope fields take one slot per entry in
 * `connectionIds`.
 */
export function computeAppFieldReconcileActions(params: {
  catalogFields: CatalogAppField[]
  existingRows: ExistingAppFieldRow[]
  connectionIds: string[]
  /** Pre-computed by the executor — does a candidate-orphan field id have any values? */
  hasValues: (fieldId: string) => boolean
  appSlug: string
}): { actions: AppFieldReconcileAction[]; errors: AppFieldReconcileError[] } {
  const { catalogFields, existingRows, connectionIds, hasValues, appSlug } = params
  const actions: AppFieldReconcileAction[] = []
  const errors: AppFieldReconcileError[] = []

  const catalogKeys = new Set(catalogFields.map((f) => f.key))
  const rowByCell = new Map<string, ExistingAppFieldRow>()
  for (const row of existingRows) {
    if (!row.appFieldKey) continue
    rowByCell.set(cellKey(row.appFieldKey, row.connectionId ?? null), row)
  }

  for (const field of catalogFields) {
    // RELATIONSHIP manifest fields are provisioned the same as any other field
    // (app-fields-and-entities-plan §4.2) — no special-case skip. Connector-template
    // relationship fields are a different universe and never reach this diff (see
    // isManifestAppFieldRow).
    const cellConnectionIds: (string | null)[] =
      field.scope === 'connection' ? connectionIds : [null]

    for (const connectionId of cellConnectionIds) {
      const existing = rowByCell.get(cellKey(field.key, connectionId))
      if (!existing) {
        actions.push({ kind: 'create', appFieldKey: field.key, connectionId, field })
        continue
      }
      if (existing.type !== field.type) {
        errors.push({
          appFieldKey: field.key,
          reason: `type changed ${existing.type} → ${field.type} — not auto-converted`,
        })
        continue
      }
      const changes = diffFieldColumns(field, existing, appSlug)
      if (Object.keys(changes).length > 0) {
        actions.push({
          kind: 'update',
          appFieldKey: field.key,
          connectionId,
          existingFieldId: existing.id,
          changes,
        })
      }
    }
  }

  // Orphans — rows whose `appFieldKey` no longer appears in the catalog. v1 rule
  // (see plan §1a.5): only orphan by missing key; leave connectionId-mismatch rows
  // alone (connection deletion already cascades them). Hide rows that hold values
  // (reversible, no name-collision), delete empty ones. The keyless-row skip is
  // defensive — post-`isManifestAppFieldRow` nothing keyless should reach this diff.
  for (const row of existingRows) {
    if (!row.appFieldKey || catalogKeys.has(row.appFieldKey)) continue
    if (hasValues(row.id)) {
      if (row.isHidden) continue // already at rest
      actions.push({
        kind: 'orphan-hide',
        appFieldKey: row.appFieldKey,
        connectionId: row.connectionId ?? null,
        existingFieldId: row.id,
      })
    } else {
      actions.push({
        kind: 'orphan-delete',
        appFieldKey: row.appFieldKey,
        connectionId: row.connectionId ?? null,
        existingFieldId: row.id,
      })
    }
  }

  return { actions, errors }
}

export interface ReconcileResult {
  created: number
  updated: number
  orphaned: number
  errors: AppFieldReconcileError[]
}

/**
 * Full app-field reconciler — the authoritative provisioning path (called at sync
 * setup and, best-effort, from lifecycle warm-ups). Loads the installation's
 * MANIFEST app-field rows (connector-machinery columns are excluded — see
 * {@link isManifestAppFieldRow}) + its org-scoped connections, computes the
 * create/update/orphan diff, and executes it. Returns counts + per-field errors.
 *
 * Does NOT invalidate the org cache itself: no-tx callers should use
 * {@link reconcileInstallationAppFields} (which busts when anything changed);
 * tx callers must bust AFTER their transaction commits — invalidating mid-tx lets a
 * concurrent read refill the cache from pre-commit rows.
 */
export async function reconcileAppFields(
  catalog: CatalogPayload | null | undefined,
  ctx: { appInstallationId: string; organizationId: string; appSlug: string },
  tx?: Transaction
): Promise<ReconcileResult> {
  const db = tx ?? database
  const catalogFields = catalog?.fields ?? []

  const loadedRows = await db.query.CustomField.findMany({
    where: eq(schema.CustomField.appInstallationId, ctx.appInstallationId),
    columns: {
      id: true,
      appFieldKey: true,
      connectionId: true,
      dataConnectorId: true,
      entityDefinitionId: true,
      type: true,
      name: true,
      description: true,
      isIdentity: true,
      appSlug: true,
      options: true,
      required: true,
      isUnique: true,
      isCreatable: true,
      isUpdatable: true,
      isComputed: true,
      isSortable: true,
      isFilterable: true,
      isHidden: true,
    },
  })

  // Partition off the connector-machinery universe. The filter runs in JS (rows per
  // installation number in the dozens) so `isManifestAppFieldRow` stays a pure,
  // unit-testable predicate — and NULL `entityDefinitionId` needs no SQL NOT-IN care.
  const rowDefIds = [
    ...new Set(loadedRows.map((r) => r.entityDefinitionId).filter((d): d is string => d != null)),
  ]
  const appOwnedDefIds = new Set<string>()
  if (rowDefIds.length > 0) {
    const ownedDefs = await db.query.EntityDefinition.findMany({
      where: and(
        inArray(schema.EntityDefinition.id, rowDefIds),
        isNotNull(schema.EntityDefinition.appInstallationId)
      ),
      columns: { id: true },
    })
    for (const def of ownedDefs) appOwnedDefIds.add(def.id)
  }
  const existingRows: ExistingAppFieldRow[] = loadedRows.filter((row) =>
    isManifestAppFieldRow(row, appOwnedDefIds)
  )

  // Nothing declared and nothing provisioned — cheapest exit.
  if (catalogFields.length === 0 && existingRows.length === 0) {
    return { created: 0, updated: 0, orphaned: 0, errors: [] }
  }

  // Only org-scoped (`userId IS NULL`) connections get connection-scoped fields — a
  // visitor's identity must be one truth for the org, not vary by teammate.
  const connections = await db.query.Credential.findMany({
    where: and(
      eq(schema.Credential.appInstallationId, ctx.appInstallationId),
      eq(schema.Credential.kind, 'app'),
      isNull(schema.Credential.userId)
    ),
    columns: { id: true },
  })
  const connectionIds = connections.map((c) => c.id)

  // Pre-compute `hasValues` for candidate-orphan fields (missing from the catalog)
  // so the pure diff can decide hide-vs-delete without a DB call.
  const catalogKeys = new Set(catalogFields.map((f) => f.key))
  const candidateOrphanIds = existingRows
    .filter((r) => r.appFieldKey && !catalogKeys.has(r.appFieldKey))
    .map((r) => r.id)
  const fieldsWithValues = new Set<string>()
  if (candidateOrphanIds.length > 0) {
    const valueRows = await db
      .selectDistinct({ fieldId: schema.FieldValue.fieldId })
      .from(schema.FieldValue)
      .where(inArray(schema.FieldValue.fieldId, candidateOrphanIds))
    for (const v of valueRows) fieldsWithValues.add(v.fieldId)
  }

  const { actions, errors } = computeAppFieldReconcileActions({
    catalogFields,
    existingRows,
    connectionIds,
    hasValues: (id) => fieldsWithValues.has(id),
    appSlug: ctx.appSlug,
  })

  let created = 0
  let updated = 0
  let orphaned = 0
  const execErrors: AppFieldReconcileError[] = [...errors]

  for (const action of actions) {
    try {
      if (action.kind === 'create' && action.field) {
        const outcome = await provisionAppField(
          action.field,
          {
            appInstallationId: ctx.appInstallationId,
            organizationId: ctx.organizationId,
            connectionId: action.connectionId ?? undefined,
            appSlug: ctx.appSlug,
          },
          tx
        )
        if (outcome === 'created') created++
      } else if (action.kind === 'update' && action.existingFieldId) {
        await db
          .update(schema.CustomField)
          .set({ ...action.changes, updatedAt: new Date() })
          .where(eq(schema.CustomField.id, action.existingFieldId))
        updated++
      } else if (action.kind === 'orphan-hide' && action.existingFieldId) {
        await db
          .update(schema.CustomField)
          .set({ isHidden: true, updatedAt: new Date() })
          .where(eq(schema.CustomField.id, action.existingFieldId))
        orphaned++
        logger.info('reconcileAppFields: hid orphaned app field (has values)', {
          appFieldKey: action.appFieldKey,
          fieldId: action.existingFieldId,
          appInstallationId: ctx.appInstallationId,
        })
      } else if (action.kind === 'orphan-delete' && action.existingFieldId) {
        await db.delete(schema.CustomField).where(eq(schema.CustomField.id, action.existingFieldId))
        orphaned++
        logger.info('reconcileAppFields: deleted orphaned app field (no values)', {
          appFieldKey: action.appFieldKey,
          fieldId: action.existingFieldId,
          appInstallationId: ctx.appInstallationId,
        })
      }
    } catch (error) {
      execErrors.push({
        appFieldKey: action.appFieldKey,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return { created, updated, orphaned, errors: execErrors }
}

/**
 * Roll forward one already-installed `defineEntity` entity's fields against its
 * catalog declaration — the entity-template analogue of {@link reconcileAppFields}.
 * Reuses the SAME pure diff ({@link computeAppFieldReconcileActions}) so a new field
 * added to an app's entity in a redeployed catalog creates/drifts/orphans exactly
 * like a manifest field does, but resolves the target directly to the entity's own
 * `entityDefinitionId` (via `sourceKey`) instead of through `provisionAppField`'s
 * entity-KIND cache lookup — an app-owned custom entity has no `entityDefs` cache
 * entry (that cache is keyed by system `entityType`, not `sourceKey`).
 *
 * Entities with no existing def are skipped entirely: creating one without consent
 * is exactly what the install-time consent step (app-fields-and-entities-plan
 * §4.1 item 3) exists to gate. This only adds/drifts/orphans FIELDS on a def that
 * install (or a prior roll-forward) already created.
 */
export async function reconcileAppEntityFields(
  entity: CatalogEntity,
  ctx: { appInstallationId: string; organizationId: string; appSlug: string },
  tx?: Transaction
): Promise<ReconcileResult> {
  const db = tx ?? database

  const existingDef = await db.query.EntityDefinition.findFirst({
    where: and(
      eq(schema.EntityDefinition.organizationId, ctx.organizationId),
      eq(schema.EntityDefinition.appInstallationId, ctx.appInstallationId),
      eq(schema.EntityDefinition.sourceKey, entity.key),
      isNull(schema.EntityDefinition.archivedAt)
    ),
    columns: { id: true },
  })
  if (!existingDef) return { created: 0, updated: 0, orphaned: 0, errors: [] }

  // `targetEntity` is unused below — the target is always `existingDef.id`, passed
  // explicitly to `provisionAppField`'s `resolvedEntityDefinitionId` override.
  const catalogFields: CatalogAppField[] = entity.fields.map((f) => ({
    ...f,
    scope: 'installation',
    targetEntity: entity.key,
  }))

  const loadedRows = await db.query.CustomField.findMany({
    where: and(
      eq(schema.CustomField.appInstallationId, ctx.appInstallationId),
      eq(schema.CustomField.entityDefinitionId, existingDef.id)
    ),
    columns: {
      id: true,
      appFieldKey: true,
      connectionId: true,
      type: true,
      name: true,
      description: true,
      isIdentity: true,
      appSlug: true,
      options: true,
      required: true,
      isUnique: true,
      isCreatable: true,
      isUpdatable: true,
      isComputed: true,
      isSortable: true,
      isFilterable: true,
      isHidden: true,
    },
  })
  const existingRows: ExistingAppFieldRow[] = loadedRows

  if (catalogFields.length === 0 && existingRows.length === 0) {
    return { created: 0, updated: 0, orphaned: 0, errors: [] }
  }

  const catalogKeys = new Set(catalogFields.map((f) => f.key))
  const candidateOrphanIds = existingRows
    .filter((r) => r.appFieldKey && !catalogKeys.has(r.appFieldKey))
    .map((r) => r.id)
  const fieldsWithValues = new Set<string>()
  if (candidateOrphanIds.length > 0) {
    const valueRows = await db
      .selectDistinct({ fieldId: schema.FieldValue.fieldId })
      .from(schema.FieldValue)
      .where(inArray(schema.FieldValue.fieldId, candidateOrphanIds))
    for (const v of valueRows) fieldsWithValues.add(v.fieldId)
  }

  const { actions, errors } = computeAppFieldReconcileActions({
    catalogFields,
    existingRows,
    // Entity-owned fields have no connection-scope concept (that's a manifest
    // `defineFields` feature) — every cell is installation-scoped.
    connectionIds: [],
    hasValues: (id) => fieldsWithValues.has(id),
    appSlug: ctx.appSlug,
  })

  let created = 0
  let updated = 0
  let orphaned = 0
  const execErrors: AppFieldReconcileError[] = [...errors]

  for (const action of actions) {
    try {
      if (action.kind === 'create' && action.field) {
        const outcome = await provisionAppField(
          action.field,
          {
            appInstallationId: ctx.appInstallationId,
            organizationId: ctx.organizationId,
            appSlug: ctx.appSlug,
          },
          tx,
          existingDef.id
        )
        if (outcome === 'created') created++
      } else if (action.kind === 'update' && action.existingFieldId) {
        await db
          .update(schema.CustomField)
          .set({ ...action.changes, updatedAt: new Date() })
          .where(eq(schema.CustomField.id, action.existingFieldId))
        updated++
      } else if (action.kind === 'orphan-hide' && action.existingFieldId) {
        await db
          .update(schema.CustomField)
          .set({ isHidden: true, updatedAt: new Date() })
          .where(eq(schema.CustomField.id, action.existingFieldId))
        orphaned++
      } else if (action.kind === 'orphan-delete' && action.existingFieldId) {
        await db.delete(schema.CustomField).where(eq(schema.CustomField.id, action.existingFieldId))
        orphaned++
      }
    } catch (error) {
      execErrors.push({
        appFieldKey: action.appFieldKey,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return { created, updated, orphaned, errors: execErrors }
}

/**
 * Standard no-tx entry: run the reconciler for an installation against its ACTIVE
 * deployment catalog — loads the catalog + app slug, reconciles, and busts the
 * customFields org cache when anything changed (a stale entry would leave a freshly
 * provisioned field unresolvable by the `@app:` rail for up to the TTL).
 *
 * Used by the authoritative sync-setup call site (throws on `result.errors` → parks
 * the connector) and the connection-save warm-up (logs and continues) — the caller
 * decides what to do with the returned errors.
 */
export async function reconcileInstallationAppFields(params: {
  appInstallationId: string
  organizationId: string
}): Promise<ReconcileResult> {
  const installation = await database.query.AppInstallation.findFirst({
    where: eq(schema.AppInstallation.id, params.appInstallationId),
    with: { app: { columns: { slug: true } } },
  })
  const catalog = await getInstallationCatalog(params.appInstallationId)
  const result = await reconcileAppFields(catalog, {
    appInstallationId: params.appInstallationId,
    organizationId: params.organizationId,
    appSlug: installation?.app?.slug ?? '',
  })
  if (result.created + result.updated + result.orphaned > 0) {
    await onCacheEvent('custom-field.created', { orgId: params.organizationId })
  }
  return result
}

/**
 * Warm-up event: "a catalog version became active" (install / reactivate / deploy
 * roll-forward). Runs the full reconcile best-effort — a bad catalog field must
 * never abort an install or block a deploy, because the authoritative sync-setup
 * reconcile will park the connector visibly anyway. Never throws.
 *
 * Runs inside the caller's transaction — the caller busts the customFields org
 * cache AFTER commit (see {@link reconcileAppFields} on why not mid-tx).
 */
export async function applyInstallationCatalog(
  params: {
    appInstallationId: string
    organizationId: string
    appSlug: string
    catalog: CatalogPayload | null
  },
  tx?: Transaction
): Promise<void> {
  try {
    const result = await reconcileAppFields(
      params.catalog,
      {
        appInstallationId: params.appInstallationId,
        organizationId: params.organizationId,
        appSlug: params.appSlug,
      },
      tx
    )
    if (result.errors.length > 0) {
      logger.warn('applyInstallationCatalog: reconcile completed with field errors', {
        appInstallationId: params.appInstallationId,
        appSlug: params.appSlug,
        errors: result.errors,
      })
    }
  } catch (error) {
    logger.error('applyInstallationCatalog: reconcile threw — continuing (sync will re-check)', {
      appInstallationId: params.appInstallationId,
      appSlug: params.appSlug,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  // Roll forward already-installed `defineEntity` entities' fields too (§4.1 item 3).
  // Runs for BOTH install (a reactivated installation may already own entity defs
  // from before it was uninstalled) and roll-forward — this is the shared warm-up
  // both call sites use. Entities the org never installed are skipped (see
  // {@link reconcileAppEntityFields}), so this never creates a def without consent.
  for (const entity of params.catalog?.entities ?? []) {
    try {
      const result = await reconcileAppEntityFields(
        entity,
        {
          appInstallationId: params.appInstallationId,
          organizationId: params.organizationId,
          appSlug: params.appSlug,
        },
        tx
      )
      if (result.errors.length > 0) {
        logger.warn('applyInstallationCatalog: entity field reconcile completed with errors', {
          appInstallationId: params.appInstallationId,
          appSlug: params.appSlug,
          entityKey: entity.key,
          errors: result.errors,
        })
      }
    } catch (error) {
      logger.error(
        'applyInstallationCatalog: entity field reconcile threw — continuing (sync will re-check)',
        {
          appInstallationId: params.appInstallationId,
          appSlug: params.appSlug,
          entityKey: entity.key,
          error: error instanceof Error ? error.message : String(error),
        }
      )
    }
  }
}

/**
 * Load the active deployment's catalog for an installation (used by the
 * connection lifecycle + sync setup, which don't already have the catalog in hand).
 */
export async function getInstallationCatalog(
  appInstallationId: string,
  db: Database | Transaction = database
): Promise<CatalogPayload | null> {
  const installation = await db.query.AppInstallation.findFirst({
    where: eq(schema.AppInstallation.id, appInstallationId),
    columns: { currentDeploymentId: true },
  })
  if (!installation?.currentDeploymentId) return null

  const deployment = await db.query.AppDeployment.findFirst({
    where: eq(schema.AppDeployment.id, installation.currentDeploymentId),
    columns: { catalog: true },
  })
  return (deployment?.catalog as CatalogPayload | null) ?? null
}
