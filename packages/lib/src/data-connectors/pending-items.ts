// packages/lib/src/data-connectors/pending-items.ts
//
// A leaf read (no sink, no sync barrel): which connector items around a set of
// records still carry unresolved relationship edges.

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, inArray, isNotNull, isNull, or, type SQL, sql } from 'drizzle-orm'

/** One live connector item with unresolved edges. */
export interface PendingConnectorItem {
  itemId: string
  dataConnectorId: string
  connectorName: string
  entityDefinitionId: string
  entityInstanceId: string
  pendingRelations: Array<{
    fieldKey: string
    targetDef: string | null
    targetExternalId: string | null
  }>
}

const I = schema.DataConnectorItem
const COLUMNS = {
  itemId: I.id,
  dataConnectorId: I.dataConnectorId,
  connectorName: schema.DataConnector.name,
  entityDefinitionId: I.entityDefinitionId,
  entityInstanceId: I.entityInstanceId,
  externalId: I.externalId,
  pendingRelations: I.pendingRelations,
}

function selectItems(db: Database | Transaction, where: SQL | undefined) {
  return db
    .select(COLUMNS)
    .from(I)
    .innerJoin(schema.DataConnector, eq(schema.DataConnector.id, I.dataConnectorId))
    .where(and(isNull(I.archivedAt), isNotNull(I.entityInstanceId), where))
}

/**
 * Live items with unresolved edges that are bound to one of `instanceIds`, or, on a
 * def in `pointingFromDefIds`, whose pending edge points at one of them. The second
 * half matters: a child whose link to its parent is still pending cannot be reached
 * from the parent yet.
 */
export async function listPendingItemsAround(
  db: Database | Transaction,
  organizationId: string,
  input: { instanceIds: readonly string[]; pointingFromDefIds: readonly string[] }
): Promise<PendingConnectorItem[]> {
  const { instanceIds, pointingFromDefIds } = input
  if (instanceIds.length === 0) return []
  const org = eq(I.organizationId, organizationId)
  const bound = await selectItems(db, and(org, inArray(I.entityInstanceId, [...instanceIds])))

  const pointing =
    bound.length === 0 || pointingFromDefIds.length === 0
      ? []
      : await selectItems(
          db,
          and(
            org,
            inArray(I.entityDefinitionId, [...pointingFromDefIds]),
            or(
              ...bound.map((item) =>
                and(
                  eq(I.dataConnectorId, item.dataConnectorId),
                  sql`${I.pendingRelations} @> ${JSON.stringify([
                    { targetDef: item.entityDefinitionId, targetExternalId: item.externalId },
                  ])}::jsonb`
                )
              )
            )
          )
        )

  const out = new Map<string, PendingConnectorItem>()
  for (const row of [...bound, ...pointing]) {
    if (out.has(row.itemId) || !row.entityInstanceId) continue
    if (!Array.isArray(row.pendingRelations) || row.pendingRelations.length === 0) continue
    out.set(row.itemId, {
      itemId: row.itemId,
      dataConnectorId: row.dataConnectorId,
      connectorName: row.connectorName,
      entityDefinitionId: row.entityDefinitionId,
      entityInstanceId: row.entityInstanceId,
      pendingRelations: row.pendingRelations,
    })
  }
  return [...out.values()]
}
