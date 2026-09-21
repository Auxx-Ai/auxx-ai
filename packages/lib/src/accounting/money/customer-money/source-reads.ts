// packages/lib/src/accounting/money/customer-money/source-reads.ts

/**
 * Every read of the `FinancialSource*` tables (`plans/accounting/LIB-READS.md` §2.3).
 *
 * Reads only; the writes are in `source-writes.ts`. `readLiveSourceAccountIds`
 * stays in `ledger/roles/source-scope.ts` — it is the role map's own rule.
 *
 * No permission checks here; the router asserts (`docs/lib-module-guide.md` §6).
 */

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, inArray, type SQL, sql } from 'drizzle-orm'

type Db = Database | Transaction

export type SourceAccountRow = typeof schema.FinancialSourceAccount.$inferSelect
export type SourceObjectRow = typeof schema.FinancialSourceObject.$inferSelect
export type SourceObservationRow = typeof schema.FinancialSourceObservation.$inferSelect
export type SourceAcceptanceRow = typeof schema.FinancialSourceAcceptance.$inferSelect
export type SourceCoverageRow = typeof schema.FinancialSourceCoverage.$inferSelect

/** The source accounts of this org among `ids`, keyed by id. */
export async function readSourceAccounts(
  db: Db,
  organizationId: string,
  ids: readonly string[]
): Promise<Map<string, SourceAccountRow>> {
  const wanted = [...new Set(ids)]
  if (!wanted.length) return new Map()
  const rows = await db
    .select()
    .from(schema.FinancialSourceAccount)
    .where(
      and(
        eq(schema.FinancialSourceAccount.organizationId, organizationId),
        inArray(schema.FinancialSourceAccount.id, wanted)
      )
    )
  return new Map(rows.map((row) => [row.id, row]))
}

/** One source account, or `null` when it is outside this organization. */
export async function readSourceAccount(
  db: Db,
  organizationId: string,
  id: string
): Promise<SourceAccountRow | null> {
  return (await readSourceAccounts(db, organizationId, [id])).get(id) ?? null
}

/** The source objects of this org among `ids`, keyed by id. */
export async function readSourceObjects(
  db: Db,
  organizationId: string,
  ids: readonly string[]
): Promise<Map<string, SourceObjectRow>> {
  const wanted = [...new Set(ids)]
  if (!wanted.length) return new Map()
  const rows = await db
    .select()
    .from(schema.FinancialSourceObject)
    .where(
      and(
        eq(schema.FinancialSourceObject.organizationId, organizationId),
        inArray(schema.FinancialSourceObject.id, wanted)
      )
    )
  return new Map(rows.map((row) => [row.id, row]))
}

/** One source object, or `null` when it is outside this organization. */
export async function readSourceObject(
  db: Db,
  organizationId: string,
  id: string
): Promise<SourceObjectRow | null> {
  return (await readSourceObjects(db, organizationId, [id])).get(id) ?? null
}

/** The five columns of `FinancialSourceObject_identity_key`. */
export interface SourceObjectIdentity {
  sourceAccountId: string
  objectType: string
  externalId: string
  componentKey: string
}

/**
 * One source object by its full identity. `componentKey` is part of the unique
 * key and is required here — a lookup that omits it can return a sibling row.
 */
export async function findSourceObjectByIdentity(
  db: Db,
  organizationId: string,
  identity: SourceObjectIdentity
): Promise<SourceObjectRow | null> {
  const [row] = await db
    .select()
    .from(schema.FinancialSourceObject)
    .where(
      and(
        eq(schema.FinancialSourceObject.organizationId, organizationId),
        eq(schema.FinancialSourceObject.sourceAccountId, identity.sourceAccountId),
        eq(schema.FinancialSourceObject.objectType, identity.objectType),
        eq(schema.FinancialSourceObject.externalId, identity.externalId),
        eq(schema.FinancialSourceObject.componentKey, identity.componentKey)
      )
    )
    .limit(1)
  return row ?? null
}

/** One acceptance, or `null` when it is outside this organization. */
export async function readAcceptance(
  db: Db,
  organizationId: string,
  id: string
): Promise<SourceAcceptanceRow | null> {
  const [row] = await db
    .select()
    .from(schema.FinancialSourceAcceptance)
    .where(
      and(
        eq(schema.FinancialSourceAcceptance.organizationId, organizationId),
        eq(schema.FinancialSourceAcceptance.id, id)
      )
    )
    .limit(1)
  return row ?? null
}

/**
 * The one definition of "the current observation of a source object": no newer
 * `(observedAt, id)` exists. A batch write stamps one `new Date()` across every
 * row, so ordering on `observedAt` alone is a coin flip (LIB-READS §0.1 bug 4).
 */
export function currentObservationFilter(): SQL {
  const o = schema.FinancialSourceObservation
  return sql`NOT EXISTS (SELECT 1 FROM ${o} newer WHERE newer."organizationId" = ${o.organizationId} AND newer."sourceObjectId" = ${o.sourceObjectId} AND (newer."observedAt", newer."id") > (${o.observedAt}, ${o.id}))`
}

/** The current observation of each source object among `sourceObjectIds`, keyed by object id. */
export async function readCurrentObservations(
  db: Db,
  organizationId: string,
  sourceObjectIds: readonly string[]
): Promise<Map<string, SourceObservationRow>> {
  const wanted = [...new Set(sourceObjectIds)]
  if (!wanted.length) return new Map()
  const rows = await db
    .select()
    .from(schema.FinancialSourceObservation)
    .where(
      and(
        eq(schema.FinancialSourceObservation.organizationId, organizationId),
        inArray(schema.FinancialSourceObservation.sourceObjectId, wanted),
        currentObservationFilter()
      )
    )
  return new Map(rows.map((row) => [row.sourceObjectId, row]))
}

/** The `order_transactions` coverage row for one order on one source account, or `null`. */
export async function readOrderCoverageRow(
  db: Db,
  organizationId: string,
  where: { sourceAccountId: string; orderInstanceId: string }
): Promise<SourceCoverageRow | null> {
  const [row] = await db
    .select()
    .from(schema.FinancialSourceCoverage)
    .where(
      and(
        eq(schema.FinancialSourceCoverage.organizationId, organizationId),
        eq(schema.FinancialSourceCoverage.sourceAccountId, where.sourceAccountId),
        eq(schema.FinancialSourceCoverage.streamKey, 'order_transactions'),
        eq(schema.FinancialSourceCoverage.windowKey, where.orderInstanceId)
      )
    )
    .limit(1)
  return row ?? null
}
