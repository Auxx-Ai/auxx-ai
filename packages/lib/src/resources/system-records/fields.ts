// packages/lib/src/resources/system-records/fields.ts

import { type Database, schema, type Transaction } from '@auxx/database'
import type { CustomFieldEntity } from '@auxx/database/types'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { PgTransaction } from 'drizzle-orm/pg-core'
import { getCachedEntityDefId, getOrgCache } from '../../cache'
import { UnprocessableEntityError } from '../../errors'

/** The def and the fields one system entity's reads are scoped by; `fields[attr]` is `null` where the org lacks the field. */
export interface SystemFieldContext<A extends string> {
  defId: string
  fields: Record<A, CustomFieldEntity | null>
}

/**
 * The entity def id for `entityType`, from the org cache or — inside a
 * transaction — from that transaction's own snapshot.
 *
 * A committing write must see the def the rest of its transaction sees; the
 * cache can be a commit behind. Callers outside a transaction pay nothing.
 */
export async function systemDefId(
  db: Database | Transaction | undefined,
  organizationId: string,
  entityType: string
): Promise<string | null> {
  if (!(db instanceof PgTransaction))
    return (await getCachedEntityDefId(organizationId, entityType)) ?? null
  const rows = await db.query.EntityDefinition.findMany({
    where: and(
      eq(schema.EntityDefinition.organizationId, organizationId),
      eq(schema.EntityDefinition.entityType, entityType),
      isNull(schema.EntityDefinition.archivedAt)
    ),
    columns: { id: true },
    limit: 2,
  })
  if (rows.length > 1)
    throw new UnprocessableEntityError(`Ambiguous entity definition: ${entityType}`)
  return rows[0]?.id ?? null
}

/** The fields behind `attributes`, cached outside a transaction and read from the transaction's snapshot inside one — see {@link systemDefId}. */
export async function systemFieldMap<A extends string>(
  db: Database | Transaction | undefined,
  organizationId: string,
  attributes: readonly A[]
): Promise<Record<A, CustomFieldEntity | null>> {
  if (!(db instanceof PgTransaction)) {
    return (await getOrgCache()
      .from(organizationId, 'customFields')
      .bySystemAttributes([...attributes])) as Record<A, CustomFieldEntity | null>
  }
  const rows = await db.query.CustomField.findMany({
    where: and(
      eq(schema.CustomField.organizationId, organizationId),
      inArray(schema.CustomField.systemAttribute, [...attributes])
    ),
  })
  for (const attribute of attributes) {
    if (rows.filter((row) => row.systemAttribute === attribute).length > 1)
      throw new UnprocessableEntityError(`Ambiguous field definition: ${attribute}`)
  }
  return Object.fromEntries(
    attributes.map((attribute) => [
      attribute,
      rows.find((row) => row.systemAttribute === attribute) ?? null,
    ])
  ) as Record<A, CustomFieldEntity | null>
}

/** What makes a context unavailable beyond the def itself, and what to say when it is. */
export interface SystemFieldsOptions<A extends string> {
  /**
   * Attributes whose field must exist. A surface whose required field is
   * missing is a constant, not a partial answer: `systemFields` reads that as
   * unavailable (`null`) and `requireSystemFields` refuses.
   */
  required?: readonly A[]
  /** The domain refusal `requireSystemFields` throws instead of the generic sentence. */
  message?: string
}

/** The def and fields for one system entity, or `null` when the def or a `required` field is missing — a caller that must refuse wants {@link requireSystemFields}. */
export async function systemFields<A extends string>(
  db: Database | Transaction | undefined,
  organizationId: string,
  entityType: string,
  attributes: readonly A[],
  options: SystemFieldsOptions<NoInfer<A>> = {}
): Promise<SystemFieldContext<A> | null> {
  const defId = await systemDefId(db, organizationId, entityType)
  if (!defId) return null
  const fields = await systemFieldMap(db, organizationId, attributes)
  if (missingRequired(fields, options.required).length > 0) return null
  return { defId, fields }
}

/** {@link systemFields}, as the refusal a write path needs: `UnprocessableEntityError` naming the entity type and any missing required attribute. */
export async function requireSystemFields<A extends string>(
  db: Database | Transaction | undefined,
  organizationId: string,
  entityType: string,
  attributes: readonly A[],
  options: SystemFieldsOptions<NoInfer<A>> = {}
): Promise<SystemFieldContext<A>> {
  const defId = await systemDefId(db, organizationId, entityType)
  if (!defId)
    throw new UnprocessableEntityError(
      options.message ?? `The ${entityType} entity is not provisioned for this organization`
    )
  const fields = await systemFieldMap(db, organizationId, attributes)
  const missing = missingRequired(fields, options.required)
  if (missing.length > 0)
    throw new UnprocessableEntityError(
      options.message ??
        `The ${entityType} entity is missing required fields: ${missing.join(', ')}`
    )
  return { defId, fields }
}

function missingRequired<A extends string>(
  fields: Record<A, CustomFieldEntity | null>,
  required: readonly A[] | undefined
): A[] {
  return required ? required.filter((attribute) => !fields[attribute]) : []
}
