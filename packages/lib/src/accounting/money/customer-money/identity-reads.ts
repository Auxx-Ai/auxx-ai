// packages/lib/src/accounting/money/customer-money/identity-reads.ts

/**
 * `RecordIdentity` reverse lookups for the money lane (task 79 §4.3).
 *
 * A provider namespace alone cannot distinguish two connected merchant
 * accounts, so only a hit unique across the org resolves; callers treat an
 * ambiguous one as unresolved rather than picking a side.
 */

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, inArray, isNull } from 'drizzle-orm'

type Db = Database | Transaction

/** The live records of `kind` this org holds under `(source, externalId)`, capped at two. */
export async function readRecordIdentityMatches(
  db: Db,
  organizationId: string,
  input: { source: string; kind: string; externalId: string; connectionId?: string }
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ id: schema.EntityInstance.id })
    .from(schema.RecordIdentity)
    .innerJoin(
      schema.EntityInstance,
      and(
        eq(schema.EntityInstance.id, schema.RecordIdentity.entityInstanceId),
        eq(schema.EntityInstance.organizationId, schema.RecordIdentity.organizationId)
      )
    )
    .innerJoin(
      schema.EntityDefinition,
      eq(schema.EntityDefinition.id, schema.EntityInstance.entityDefinitionId)
    )
    .where(
      and(
        eq(schema.RecordIdentity.organizationId, organizationId),
        eq(schema.RecordIdentity.source, input.source),
        input.connectionId ? eq(schema.RecordIdentity.connectionId, input.connectionId) : undefined,
        eq(schema.RecordIdentity.externalId, input.externalId),
        eq(schema.EntityDefinition.entityType, input.kind),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .limit(2)
  return rows.map((row) => row.id)
}

/** The same lookup for a batch, keyed by external id; ambiguous ids are omitted. */
export async function readUniqueRecordIdentities(
  db: Db,
  organizationId: string,
  input: { source: string; kind: string; externalIds: readonly string[] }
): Promise<Map<string, string>> {
  const wanted = [...new Set(input.externalIds)]
  if (!wanted.length) return new Map()
  const rows = await db
    .selectDistinct({
      externalId: schema.RecordIdentity.externalId,
      id: schema.EntityInstance.id,
    })
    .from(schema.RecordIdentity)
    .innerJoin(
      schema.EntityInstance,
      and(
        eq(schema.EntityInstance.id, schema.RecordIdentity.entityInstanceId),
        eq(schema.EntityInstance.organizationId, schema.RecordIdentity.organizationId)
      )
    )
    .innerJoin(
      schema.EntityDefinition,
      eq(schema.EntityDefinition.id, schema.EntityInstance.entityDefinitionId)
    )
    .where(
      and(
        eq(schema.RecordIdentity.organizationId, organizationId),
        eq(schema.RecordIdentity.source, input.source),
        inArray(schema.RecordIdentity.externalId, wanted),
        eq(schema.EntityDefinition.entityType, input.kind),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
  const resolved = new Map<string, string>()
  const ambiguous = new Set<string>()
  for (const row of rows) {
    const seen = resolved.get(row.externalId)
    if (seen && seen !== row.id) ambiguous.add(row.externalId)
    else resolved.set(row.externalId, row.id)
  }
  for (const externalId of ambiguous) resolved.delete(externalId)
  return resolved
}
