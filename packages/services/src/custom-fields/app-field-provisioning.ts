// packages/services/src/custom-fields/app-field-provisioning.ts

import {
  type CatalogAppField,
  type CatalogPayload,
  type Database,
  database,
  schema,
  type Transaction,
} from '@auxx/database'
import type { FieldType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { type CreateCustomFieldInput, createCustomField } from './create-field'
import type { SelectOption } from './types'

const logger = createScopedLogger('app-fields')

/**
 * Resolve an `EntityRefKind` to the org's `EntityDefinition.id`. The kind **is**
 * the `entityType` (there is one def per entityType per org). Returns null when
 * no def matches (caller logs + skips).
 *
 * Stays a DB query: this runs at install/connection time on the tier-2 services
 * layer, which can't import the tier-3 org cache. The hot read path
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
  /** WorkflowCredentials.id for `scope: 'connection'` fields; omit for installation scope. */
  connectionId?: string
}

/**
 * Provision one declared app field. Idempotent: `createCustomField` returns
 * DUPLICATE_FIELD_NAME when a field already exists for this
 * `(appInstallationId, connectionId?, appFieldKey)` — treated as a no-op.
 *
 * RELATIONSHIP fields are not supported in v1 (their inverse-field wiring isn't
 * covered) — logged and skipped.
 */
export async function provisionAppField(
  field: CatalogAppField,
  ctx: ProvisionContext,
  tx?: Transaction
): Promise<void> {
  if (field.type === 'RELATIONSHIP') {
    logger.warn('skipping RELATIONSHIP field — not supported in v1', {
      appFieldKey: field.appFieldKey,
      appInstallationId: ctx.appInstallationId,
    })
    return
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
    return
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
      ...capabilitiesToColumns(field.capabilities),
    },
    tx
  )

  if (result.isErr() && result.error.code !== 'DUPLICATE_FIELD_NAME') {
    // Don't silently lose a declared field — surface real failures.
    throw new Error(`Failed to provision app field "${field.appFieldKey}": ${result.error.message}`)
  }
}

/**
 * Provision every declared field of a given scope from a deployment catalog.
 * For `connection` scope the caller must assert the connection is org-scoped
 * (`WorkflowCredentials.userId IS NULL`) first — see decision 8.
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

/**
 * Load the active deployment's catalog for an installation (used by the
 * connection lifecycle, which doesn't already have the catalog in hand).
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
