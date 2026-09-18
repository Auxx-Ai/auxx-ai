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

/** The def and fields for one system entity, or `null` when the org has not provisioned the def — a caller that must refuse wants {@link requireSystemFields}. */
export async function systemFields<A extends string>(
  db: Database | Transaction | undefined,
  organizationId: string,
  entityType: string,
  attributes: readonly A[]
): Promise<SystemFieldContext<A> | null> {
  const defId = await systemDefId(db, organizationId, entityType)
  if (!defId) return null
  return { defId, fields: await systemFieldMap(db, organizationId, attributes) }
}

/** {@link systemFields}, as the refusal a write path needs: `UnprocessableEntityError` naming the entity type. */
export async function requireSystemFields<A extends string>(
  db: Database | Transaction | undefined,
  organizationId: string,
  entityType: string,
  attributes: readonly A[]
): Promise<SystemFieldContext<A>> {
  const ctx = await systemFields(db, organizationId, entityType, attributes)
  if (!ctx)
    throw new UnprocessableEntityError(
      `The ${entityType} entity is not provisioned for this organization`
    )
  return ctx
}
