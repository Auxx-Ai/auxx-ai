// packages/lib/src/accounting/money/customer-money/source-writes.ts

/**
 * Every write of the `FinancialSource*` tables (`plans/accounting/LIB-READS.md` §2.3),
 * shared by the payout lane (`record-storage.ts`) and the order-transaction lane
 * (`record-evidence.ts`) — two doors by design, one set of statements.
 *
 * `source-write-errors.ts` stays raw: it is an audit-only `onConflictDoNothing`
 * that runs after the attempted transaction has rolled back.
 */

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, inArray, type SQL, sql } from 'drizzle-orm'
import type {
  SourceAcceptanceRow,
  SourceAccountRow,
  SourceObjectRow,
  SourceObservationRow,
} from './source-reads'

type Db = Database | Transaction

/** Upsert source accounts on their `(org, providerKey, externalAccountId, environment)` identity. */
export async function upsertSourceAccounts(
  tx: Db,
  organizationId: string,
  accounts: readonly Omit<typeof schema.FinancialSourceAccount.$inferInsert, 'organizationId'>[]
): Promise<SourceAccountRow[]> {
  if (!accounts.length) return []
  return tx
    .insert(schema.FinancialSourceAccount)
    .values(accounts.map((account) => ({ ...account, organizationId })))
    .onConflictDoUpdate({
      target: [
        schema.FinancialSourceAccount.organizationId,
        schema.FinancialSourceAccount.providerKey,
        schema.FinancialSourceAccount.externalAccountId,
        schema.FinancialSourceAccount.environment,
      ],
      set: { externalAccountId: sql`excluded."externalAccountId"` },
    })
    .returning()
}

/** Upsert source objects on the five columns of `FinancialSourceObject_identity_key`. */
export async function upsertSourceObjects(
  tx: Db,
  organizationId: string,
  objects: readonly Omit<typeof schema.FinancialSourceObject.$inferInsert, 'organizationId'>[]
): Promise<SourceObjectRow[]> {
  if (!objects.length) return []
  return tx
    .insert(schema.FinancialSourceObject)
    .values(objects.map((object) => ({ ...object, organizationId })))
    .onConflictDoUpdate({
      target: [
        schema.FinancialSourceObject.organizationId,
        schema.FinancialSourceObject.sourceAccountId,
        schema.FinancialSourceObject.objectType,
        schema.FinancialSourceObject.externalId,
        schema.FinancialSourceObject.componentKey,
      ],
      set: { externalId: sql`excluded."externalId"` },
    })
    .returning()
}

/** Insert observations, returning the stored row for a `(sourceObjectId, contentHash)` already seen. */
export async function insertObservations(
  tx: Db,
  organizationId: string,
  observations: readonly Omit<
    typeof schema.FinancialSourceObservation.$inferInsert,
    'organizationId'
  >[]
): Promise<SourceObservationRow[]> {
  if (!observations.length) return []
  return tx
    .insert(schema.FinancialSourceObservation)
    .values(observations.map((observation) => ({ ...observation, organizationId })))
    .onConflictDoUpdate({
      target: [
        schema.FinancialSourceObservation.organizationId,
        schema.FinancialSourceObservation.sourceObjectId,
        schema.FinancialSourceObservation.contentHash,
      ],
      set: { contentHash: sql`excluded."contentHash"` },
    })
    .returning()
}

/** Upsert coverage rows on `(org, sourceAccountId, streamKey, windowKey)`. */
export async function upsertCoverage(
  tx: Db,
  organizationId: string,
  rows: readonly Omit<typeof schema.FinancialSourceCoverage.$inferInsert, 'organizationId'>[]
): Promise<void> {
  if (!rows.length) return
  await tx
    .insert(schema.FinancialSourceCoverage)
    .values(rows.map((row) => ({ ...row, organizationId })))
    .onConflictDoUpdate({
      target: [
        schema.FinancialSourceCoverage.organizationId,
        schema.FinancialSourceCoverage.sourceAccountId,
        schema.FinancialSourceCoverage.streamKey,
        schema.FinancialSourceCoverage.windowKey,
      ],
      set: {
        requestedBoundary: sql`excluded."requestedBoundary"`,
        fetchedBoundary: sql`excluded."fetchedBoundary"`,
        fetchedCount: sql`excluded."fetchedCount"`,
        acceptedCount: sql`excluded."acceptedCount"`,
        rejectedCount: sql`excluded."rejectedCount"`,
        pendingCount: sql`excluded."pendingCount"`,
        complete: sql`excluded.complete`,
        updatedAt: sql`excluded."updatedAt"`,
      },
    })
}

/** One order's acceptance tally on one source account. */
export interface OrderAcceptanceCounts {
  sourceAccountId: string
  orderInstanceId: string
  fetchedCount: number
  acceptedCount: number
  rejectedCount: number
  pendingCount: number
}

/**
 * The ONE coverage predicate (LIB-READS §0.1 bug 3): acceptances keyed by the
 * order they actually resolved to, through their object's source account. An
 * acceptance whose `orderInstanceId` is still null is not coverage of any order.
 */
export async function countOrderAcceptanceStates(
  db: Db,
  organizationId: string,
  where: { orderInstanceIds: readonly string[]; sourceAccountId?: string }
): Promise<OrderAcceptanceCounts[]> {
  const orders = [...new Set(where.orderInstanceIds)]
  if (!orders.length) return []
  const state = schema.FinancialSourceAcceptance.state
  const rows = await db
    .select({
      sourceAccountId: schema.FinancialSourceObject.sourceAccountId,
      orderInstanceId: schema.FinancialSourceAcceptance.orderInstanceId,
      fetchedCount: sql<number>`count(*)::int`,
      acceptedCount: sql<number>`count(*) FILTER (WHERE ${state} = 'accepted')::int`,
      rejectedCount: sql<number>`count(*) FILTER (WHERE ${state} = 'rejected')::int`,
    })
    .from(schema.FinancialSourceAcceptance)
    .innerJoin(
      schema.FinancialSourceObject,
      and(
        eq(
          schema.FinancialSourceObject.organizationId,
          schema.FinancialSourceAcceptance.organizationId
        ),
        eq(schema.FinancialSourceObject.id, schema.FinancialSourceAcceptance.sourceObjectId)
      )
    )
    .where(
      and(
        eq(schema.FinancialSourceAcceptance.organizationId, organizationId),
        inArray(schema.FinancialSourceAcceptance.orderInstanceId, orders),
        where.sourceAccountId
          ? eq(schema.FinancialSourceObject.sourceAccountId, where.sourceAccountId)
          : undefined
      )
    )
    .groupBy(
      schema.FinancialSourceObject.sourceAccountId,
      schema.FinancialSourceAcceptance.orderInstanceId
    )
  return rows.flatMap((row) =>
    row.orderInstanceId
      ? [
          {
            sourceAccountId: row.sourceAccountId,
            orderInstanceId: row.orderInstanceId,
            fetchedCount: row.fetchedCount,
            acceptedCount: row.acceptedCount,
            rejectedCount: row.rejectedCount,
            pendingCount: row.fetchedCount - row.acceptedCount - row.rejectedCount,
          },
        ]
      : []
  )
}

/** `complete` compares the STORED `fetchedCount` to the new total: a coverage row whose tally moved is not complete. */
async function applyOrderCoverageCounts(
  db: Db,
  organizationId: string,
  counts: readonly OrderAcceptanceCounts[]
): Promise<void> {
  if (!counts.length) return
  const values = counts.map(
    (row) =>
      sql`(${row.orderInstanceId}::text, ${row.sourceAccountId}::text, ${row.fetchedCount}::int, ${row.acceptedCount}::int, ${row.rejectedCount}::int, ${row.pendingCount}::int)`
  )
  await db.execute(sql`UPDATE "FinancialSourceCoverage" c SET
   "fetchedCount"=s.total,"acceptedCount"=s.accepted,"rejectedCount"=s.rejected,"pendingCount"=s.pending,
   complete=(COALESCE((c."fetchedBoundary"->>'sourceComplete')::boolean,false) AND c."fetchedCount"=s.total AND s.pending=0 AND s.rejected=0),"updatedAt"=now()
 FROM (VALUES ${sql.join(values, sql`,`)}) AS s(owner, account, total, accepted, rejected, pending)
 WHERE c."organizationId"=${organizationId} AND c."sourceAccountId"=s.account AND c."streamKey"='order_transactions' AND c."windowKey"=s.owner`)
}

/** Recount one order's `order_transactions` coverage on one source account. */
export async function refreshOrderCoverageCounts(
  tx: Db,
  organizationId: string,
  where: { sourceAccountId: string; orderInstanceId: string }
): Promise<void> {
  const counts = await countOrderAcceptanceStates(tx, organizationId, {
    orderInstanceIds: [where.orderInstanceId],
    sourceAccountId: where.sourceAccountId,
  })
  await applyOrderCoverageCounts(tx, organizationId, counts)
}

/** Recount a set of orders' `order_transactions` coverage across every source account. */
export async function refreshOrderCoverageCountsForOrders(
  db: Db,
  organizationId: string,
  orderInstanceIds: readonly string[]
): Promise<void> {
  const counts = await countOrderAcceptanceStates(db, organizationId, { orderInstanceIds })
  await applyOrderCoverageCounts(db, organizationId, counts)
}

/** Upsert acceptances on `(org, sourceObjectId)`. */
export async function upsertAcceptances(
  tx: Db,
  organizationId: string,
  rows: readonly Omit<typeof schema.FinancialSourceAcceptance.$inferInsert, 'organizationId'>[]
): Promise<void> {
  if (!rows.length) return
  await tx
    .insert(schema.FinancialSourceAcceptance)
    .values(rows.map((row) => ({ ...row, organizationId })))
    .onConflictDoUpdate({
      target: [
        schema.FinancialSourceAcceptance.organizationId,
        schema.FinancialSourceAcceptance.sourceObjectId,
      ],
      set: {
        observationId: sql`excluded."observationId"`,
        orderInstanceId: sql`excluded."orderInstanceId"`,
        state: sql`excluded.state`,
        reason: sql`excluded.reason`,
        unresolvedReferences: sql`excluded."unresolvedReferences"`,
        nextAttemptAt: sql`excluded."nextAttemptAt"`,
        updatedAt: new Date(),
      },
    })
}

/** Patch one acceptance, org-scoped (LIB-READS §0.1 bug 6). `guard` narrows a compare-and-set. */
export async function updateAcceptance(
  tx: Db,
  organizationId: string,
  id: string,
  patch: Partial<SourceAcceptanceRow>,
  guard?: SQL
): Promise<void> {
  await tx
    .update(schema.FinancialSourceAcceptance)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(
        eq(schema.FinancialSourceAcceptance.organizationId, organizationId),
        eq(schema.FinancialSourceAcceptance.id, id),
        guard
      )
    )
}

/** Patch every acceptance of these source objects. */
export async function updateAcceptancesBySourceObjects(
  tx: Db,
  organizationId: string,
  sourceObjectIds: readonly string[],
  patch: Partial<SourceAcceptanceRow>
): Promise<void> {
  const ids = [...new Set(sourceObjectIds)]
  if (!ids.length) return
  await tx
    .update(schema.FinancialSourceAcceptance)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(
        eq(schema.FinancialSourceAcceptance.organizationId, organizationId),
        inArray(schema.FinancialSourceAcceptance.sourceObjectId, ids)
      )
    )
}
