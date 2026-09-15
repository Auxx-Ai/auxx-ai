// packages/lib/src/money/fulfillments/field-context.ts
import { type Database, schema, type Transaction } from '@auxx/database'
import type { CustomFieldEntity } from '@auxx/database/types'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { PgTransaction } from 'drizzle-orm/pg-core'
import { getCachedEntityDefId, getOrgCache } from '../../cache'
import { UnprocessableEntityError } from '../../errors'

/** Resolve accounting metadata from the same snapshot as a committing source read. */
export async function financialEntityDefId(
  organizationId: string,
  entityType: string,
  db?: Database | Transaction
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
    throw new UnprocessableEntityError(`Ambiguous accounting resource definition: ${entityType}`)
  return rows[0]?.id ?? null
}

/** Cached preview metadata; authoritative transaction metadata for accounting writes. */
export async function financialFields<A extends string>(
  organizationId: string,
  attributes: readonly A[],
  db?: Database | Transaction
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
      throw new UnprocessableEntityError(`Ambiguous accounting field definition: ${attribute}`)
  }
  return Object.fromEntries(
    attributes.map((attribute) => [
      attribute,
      rows.find((row) => row.systemAttribute === attribute) ?? null,
    ])
  ) as Record<A, CustomFieldEntity | null>
}
