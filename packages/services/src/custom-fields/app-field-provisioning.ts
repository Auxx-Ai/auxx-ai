// packages/services/src/custom-fields/app-field-provisioning.ts

import {
  type CatalogAppField,
  type CatalogPayload,
  type Database,
  database,
  schema,
  type Transaction,
} from '@auxx/database'
import type { CustomFieldEntity, FieldType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { type CreateCustomFieldInput, createCustomField } from './create-field'
import type { SelectOption } from './types'

const logger = createScopedLogger('app-fields')

/**
 * Resolve an `EntityRefKind` to the org's `EntityDefinition.id`. The kind **is**
 * the `entityType` (there is one def per entityType per org). Returns null when
 * no def matches (caller logs + skips).
 *
 * Stays a DB query: this runs at install/connection/sync time on the tier-2
 * services layer, which can't import the tier-3 org cache. The hot read path
 * (`apps/api` value-I/O routes) uses `getCachedEntityDefId` instead.
 */
export async function resolveEntityDefinitionIdByKind(
  params: { kind: string; organizationId: string },
  db: Database | Transaction = database
): Promise<string | null> {
  const def = await db.query.EntityDefinition.findFirst({
    where: (defs, { eq: e, and: a }) =>
      a(e(defs.organizationId, params.organizationId), e(defs.entityType, params.kind)),
    columns: { id: true },
  })
  return def?.id ?? null
}

/**
 * Map a catalog field's author-set capabilities → `CustomField` column flags.
 * Mirrors `@auxx/lib` `mapCapabilities` (which tier-2 services can't import);
 * the column names are the same so this stays trivially in sync.
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
 * Provision one declared app field. Idempotent: `createCustomField` returns
 * DUPLICATE_FIELD_NAME when a field already exists for this
 * `(appInstallationId, connectionId?, appFieldKey)` — reported as `'duplicate'`.
 * A genuine (non-duplicate) create failure THROWS — the reconciler wraps the call
 * and records it as a field-level error (which parks the sync).
 *
 * RELATIONSHIP fields are not supported in v1 (their inverse-field wiring isn't
 * covered) — logged and skipped. Drift on an existing field is NOT handled here;
 * the reconciler's `update` action owns that (single source of truth).
 */
export async function provisionAppField(
  field: CatalogAppField,
  ctx: ProvisionContext,
  tx?: Transaction
): Promise<ProvisionOutcome> {
  if (field.type === 'RELATIONSHIP') {
    logger.warn('skipping RELATIONSHIP field — not supported in v1', {
      appFieldKey: field.appFieldKey,
      appInstallationId: ctx.appInstallationId,
    })
    return 'skipped'
  }

  const entityDefinitionId = await resolveEntityDefinitionIdByKind(
    { kind: field.targetEntity, organizationId: ctx.organizationId },
    tx
  )
  if (!entityDefinitionId) {
    logger.warn('cannot resolve targetEntity — skipping field', {
      appFieldKey: field.appFieldKey,
      targetEntity: field.targetEntity,
      appInstallationId: ctx.appInstallationId,
    })
    return 'skipped'
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
      appFieldKey: field.appFieldKey,
      isIdentity: field.identity ?? false,
      appSlug: ctx.appSlug,
      ...capabilitiesToColumns(field.capabilities),
    },
    tx
  )

  if (result.isErr()) {
    if (result.error.code !== 'DUPLICATE_FIELD_NAME') {
      // Don't silently lose a declared field — surface real failures to the reconciler.
      throw new Error(
        `Failed to provision app field "${field.appFieldKey}": ${result.error.message}`
      )
    }
    return 'duplicate'
  }
  return 'created'
}

/**
 * Provision every declared field of a given scope from a deployment catalog.
 * Thin helper over {@link provisionAppField}; the full reconciler
 * ({@link reconcileAppFields}) is the authoritative path — this stays for callers
 * that only want the plain create pass for a single scope.
 */
export async function provisionAppFields(
  catalog: CatalogPayload | null | undefined,
  scope: 'installation' | 'connection',
  ctx: ProvisionContext,
  tx?: Transaction
): Promise<void> {
  const fields = (catalog?.fields ?? []).filter((f) => f.scope === scope)
  for (const field of fields) {
    await provisionAppField(field, ctx, tx)
  }
}

// ── Reconciler (create / drift / orphan) ─────────────────────────────────────────

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
  `${appFieldKey} ${connectionId ?? ''}`

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

  const catalogKeys = new Set(catalogFields.map((f) => f.appFieldKey))
  const rowByCell = new Map<string, ExistingAppFieldRow>()
  for (const row of existingRows) {
    if (!row.appFieldKey) continue
    rowByCell.set(cellKey(row.appFieldKey, row.connectionId ?? null), row)
  }

  for (const field of catalogFields) {
    // RELATIONSHIP fields aren't provisioned in v1 (their inverse wiring isn't
    // covered) — skip create/update; their key stays in the catalog so their rows
    // are never orphaned either.
    if (field.type === 'RELATIONSHIP') continue

    const cellConnectionIds: (string | null)[] =
      field.scope === 'connection' ? connectionIds : [null]

    for (const connectionId of cellConnectionIds) {
      const existing = rowByCell.get(cellKey(field.appFieldKey, connectionId))
      if (!existing) {
        actions.push({ kind: 'create', appFieldKey: field.appFieldKey, connectionId, field })
        continue
      }
      if (existing.type !== field.type) {
        errors.push({
          appFieldKey: field.appFieldKey,
          reason: `type changed ${existing.type} → ${field.type} — not auto-converted`,
        })
        continue
      }
      const changes = diffFieldColumns(field, existing, appSlug)
      if (Object.keys(changes).length > 0) {
        actions.push({
          kind: 'update',
          appFieldKey: field.appFieldKey,
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
  // (reversible, no name-collision), delete empty ones.
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
 * setup and, best-effort, from lifecycle warm-ups). Loads the installation's app
 * fields + its org-scoped connections, computes the create/update/orphan diff,
 * and executes it. Returns counts + per-field errors; does NOT invalidate the org
 * cache (tier-2 services can't import the tier-3 cache) — lib-side callers do that
 * when any action executed.
 */
export async function reconcileAppFields(
  catalog: CatalogPayload | null | undefined,
  ctx: { appInstallationId: string; organizationId: string; appSlug: string },
  tx?: Transaction
): Promise<ReconcileResult> {
  const db = tx ?? database
  const catalogFields = catalog?.fields ?? []

  const existingRows: ExistingAppFieldRow[] = await db.query.CustomField.findMany({
    where: eq(schema.CustomField.appInstallationId, ctx.appInstallationId),
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
  const catalogKeys = new Set(catalogFields.map((f) => f.appFieldKey))
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
 * Warm-up event: "a catalog version became active" (install / reactivate / deploy
 * roll-forward). Runs the full reconcile best-effort — a bad catalog field must
 * never abort an install or block a deploy, because the authoritative sync-setup
 * reconcile will park the connector visibly anyway. Never throws.
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
