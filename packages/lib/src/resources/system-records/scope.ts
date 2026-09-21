// packages/lib/src/resources/system-records/scope.ts

import { schema } from '@auxx/database'
import { and, eq, isNull, type SQL } from 'drizzle-orm'

/** Bounded IN-list, the same 200 `readFieldScalars` uses: one predictable query shape per chunk. */
export const CHUNK = 200

/** The `EntityInstance` columns a record is built from. */
export type SystemInstanceRow = {
  id: string
  organizationId: string
  entityDefinitionId: string
  createdAt: Date
  updatedAt: Date
  archivedAt: Date | null
  /** The denormalised display value the field-value write path keeps in sync. */
  displayName: string | null
}

/** The `select()` shape a paginated caller hands back through `instances`. */
export const systemInstanceColumns = {
  id: schema.EntityInstance.id,
  organizationId: schema.EntityInstance.organizationId,
  entityDefinitionId: schema.EntityInstance.entityDefinitionId,
  createdAt: schema.EntityInstance.createdAt,
  updatedAt: schema.EntityInstance.updatedAt,
  archivedAt: schema.EntityInstance.archivedAt,
  displayName: schema.EntityInstance.displayName,
}

/** The org / def / archived predicate every read of a system record is scoped by — the one spelling, so a paging query cannot drop a third of it. */
export function systemRecordScope(
  organizationId: string,
  defId: string,
  options: { includeArchived?: boolean } = {}
): SQL {
  return and(
    eq(schema.EntityInstance.organizationId, organizationId),
    eq(schema.EntityInstance.entityDefinitionId, defId),
    ...(options.includeArchived ? [] : [isNull(schema.EntityInstance.archivedAt)])
  ) as SQL
}

export function chunked(ids: readonly string[]): string[][] {
  const unique = [...new Set(ids)]
  const out: string[][] = []
  for (let i = 0; i < unique.length; i += CHUNK) out.push(unique.slice(i, i + CHUNK))
  return out
}
