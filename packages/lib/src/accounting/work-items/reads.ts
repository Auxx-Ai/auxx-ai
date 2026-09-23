// packages/lib/src/accounting/work-items/reads.ts

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, asc, eq, gt, inArray, isNull, or, type SQL, sql } from 'drizzle-orm'
import { ok, type Result } from 'neverthrow'
import {
  EXTERNAL_REF_GROUPED_CODES,
  groupsByExternalRef,
  WORK_ITEM_CODES,
  type WorkItemCode,
  type WorkItemStage,
  workItemStatus,
} from './codes'
import type { WorkItemGroupKey } from './wake'

type Db = Database | Transaction

export type WorkItemRow = typeof schema.AccountingWorkItem.$inferSelect

/** The Outbox categories a work item can fall under - `ExportAvenue`'s blocked subset. */
export type WorkItemCategory =
  | 'receipt'
  | 'refund'
  | 'vendorPayment'
  | 'fulfillment'
  | 'creditMemo'
  | 'payout'

export interface WorkItemFilters {
  categories?: readonly WorkItemCategory[]
  search?: string
  /** `YYYY-MM-DD`, on the day the row was last written, cut in `bookTimeZone`. */
  from?: string
  to?: string
  bookTimeZone?: string
}

/** One Blocked-tab row: every item sharing a code and its wake keys (91 §4.6). */
export interface WorkItemGroup extends WorkItemGroupKey {
  externalRef: string | null
  count: number
  /** Items whose `nextAttemptAt` has come: woken, waiting for the sweep. */
  dueCount: number
  sourceKinds: string[]
  /** The newest write in the group. */
  latestAt: Date
  railName: string | null
  glAccountName: string | null
}

/** One item inside a group, with enough of its source to render and open it. */
export interface WorkItemListRow extends WorkItemRow {
  /** The record's display name, or the movement's party. */
  label: string | null
  /** The record's definition, for entity-backed sources. */
  recordDefinitionId: string | null
  /** The movement behind a `money_transaction` or an acceptance row. */
  moneyTransactionId: string | null
  purpose: string | null
  amountMinor: number | null
  currency: string | null
}

const SKIPPED_CODES = (Object.keys(WORK_ITEM_CODES) as WorkItemCode[]).filter(
  (code) => workItemStatus(code) === 'skipped'
)

/** The joins every list read needs: the movement, the acceptance, the record, the party. */
function fromItems() {
  return sql`"AccountingWorkItem" w
    LEFT JOIN "FinancialSourceAcceptance" acc ON w."sourceKind" = 'financial_source_acceptance'
      AND acc."organizationId" = w."organizationId" AND acc."id" = w."sourceId"
    LEFT JOIN "MoneyTransaction" mt ON mt."organizationId" = w."organizationId"
      AND mt."id" = CASE WHEN w."sourceKind" = 'money_transaction' THEN w."sourceId"
        ELSE acc."moneyTransactionId" END
    LEFT JOIN "EntityInstance" rec ON w."sourceKind" IN ('fulfillment','credit_memo','payout')
      AND rec."organizationId" = w."organizationId" AND rec."id" = w."sourceId"
    LEFT JOIN "EntityInstance" party ON party."organizationId" = w."organizationId"
      AND party."id" = mt."partyInstanceId"`
}

function categoryCondition(category: WorkItemCategory): SQL {
  switch (category) {
    case 'receipt':
      return sql`(mt."purpose" = 'customer_receipt' OR (w."sourceKind" = 'financial_source_acceptance' AND mt."id" IS NULL))`
    case 'refund':
      return sql`mt."purpose" = 'customer_refund'`
    case 'vendorPayment':
      return sql`mt."purpose" IN ('vendor_payment','vendor_refund')`
    case 'fulfillment':
      return sql`w."sourceKind" = 'fulfillment'`
    case 'creditMemo':
      return sql`w."sourceKind" = 'credit_memo'`
    case 'payout':
      return sql`w."sourceKind" = 'payout'`
  }
}

function whereItems(organizationId: string, filters: WorkItemFilters, extra: SQL[] = []): SQL {
  const zone = filters.bookTimeZone ?? 'UTC'
  const day = sql`(w."updatedAt" AT TIME ZONE ${zone})::date`
  const conditions: SQL[] = [sql`w."organizationId" = ${organizationId}`, ...extra]
  if (filters.categories?.length)
    conditions.push(
      sql`(${sql.join(
        filters.categories.map((category) => categoryCondition(category)),
        sql` OR `
      )})`
    )
  if (filters.from) conditions.push(sql`${day} >= ${filters.from}::date`)
  if (filters.to) conditions.push(sql`${day} <= ${filters.to}::date`)
  if (filters.search)
    conditions.push(
      sql`strpos(lower(concat_ws(' ', w."reasonCode", w."role", w."externalRef", rec."displayName", party."displayName", mt."reference", w."detail"::text)), lower(${filters.search})) > 0`
    )
  return sql.join(conditions, sql` AND `)
}

/** The `externalRef` half of the group key: the value for codes that group by it, else null. */
function groupExternalRef(): SQL {
  if (EXTERNAL_REF_GROUPED_CODES.length === 0) return sql`NULL::text`
  return sql`CASE WHEN w."reasonCode" IN (${sql.join(
    EXTERNAL_REF_GROUPED_CODES.map((code) => sql`${code}`),
    sql`, `
  )}) THEN w."externalRef" END`
}

function groupWhere(group: WorkItemGroupKey): SQL {
  const same = (column: string, value: string | null) =>
    value === null
      ? sql`w.${sql.identifier(column)} IS NULL`
      : sql`w.${sql.identifier(column)} = ${value}`
  const ref = groupsByExternalRef(group.reasonCode)
    ? sql` AND ${same('externalRef', group.externalRef ?? null)}`
    : sql``
  return sql`w."reasonCode" = ${group.reasonCode} AND ${same('role', group.role)} AND ${same('railId', group.railId)} AND ${same('glAccountId', group.glAccountId)}${ref}`
}

/** The Blocked tab: one row per `(reasonCode, role, railId, glAccountId[, externalRef])`, newest first. */
export async function listWorkItemGroups(
  db: Db,
  organizationId: string,
  options: WorkItemFilters & { limit: number; offset?: number }
): Promise<Result<{ items: WorkItemGroup[]; nextOffset?: number }, Error>> {
  const offset = options.offset ?? 0
  const result = await db.execute(sql`
    SELECT w."reasonCode", w."role", w."railId", w."glAccountId",
      ${groupExternalRef()} AS "externalRef",
      count(*)::int AS "count", max(w."updatedAt") AS "latestAt",
      (count(*) FILTER (WHERE w."nextAttemptAt" <= now()))::int AS "dueCount",
      array_agg(DISTINCT w."sourceKind") AS "sourceKinds",
      max(rail."displayName") AS "railName", max(gl."displayName") AS "glAccountName"
    FROM ${fromItems()}
    LEFT JOIN "EntityInstance" rail ON rail."organizationId" = w."organizationId" AND rail."id" = w."railId"
    LEFT JOIN "EntityInstance" gl ON gl."organizationId" = w."organizationId" AND gl."id" = w."glAccountId"
    WHERE ${whereItems(organizationId, options)}
    GROUP BY w."reasonCode", w."role", w."railId", w."glAccountId", 5
    ORDER BY max(w."updatedAt") DESC, w."reasonCode" ASC, w."role" ASC NULLS FIRST, 5 ASC NULLS FIRST
    LIMIT ${options.limit + 1} OFFSET ${offset}
  `)
  const rows = (
    result.rows as Array<{
      reasonCode: string
      role: string | null
      railId: string | null
      glAccountId: string | null
      externalRef: string | null
      count: number
      dueCount: number
      latestAt: string | Date
      sourceKinds: string[] | string
      railName: string | null
      glAccountName: string | null
    }>
  ).map((row) => ({
    ...row,
    count: Number(row.count),
    dueCount: Number(row.dueCount ?? 0),
    latestAt: new Date(row.latestAt),
    sourceKinds: Array.isArray(row.sourceKinds)
      ? row.sourceKinds
      : String(row.sourceKinds).replace(/[{}]/g, '').split(',').filter(Boolean),
  }))
  const more = rows.length > options.limit
  return ok({
    items: rows.slice(0, options.limit),
    ...(more ? { nextOffset: offset + options.limit } : {}),
  })
}

/** One group expanded: its items, newest first, paged. */
export async function listWorkItemsInGroup(
  db: Db,
  organizationId: string,
  group: WorkItemGroupKey,
  options: WorkItemFilters & { limit: number; offset?: number }
): Promise<Result<{ items: WorkItemListRow[]; nextOffset?: number }, Error>> {
  const offset = options.offset ?? 0
  const result = await db.execute(sql`
    SELECT w.*, COALESCE(rec."displayName", party."displayName", acc."orderExternalId") AS "label",
      rec."entityDefinitionId" AS "recordDefinitionId", mt."id" AS "moneyTransactionId",
      mt."purpose" AS "purpose", mt."amountMinor" AS "amountMinor", mt."currency" AS "currency"
    FROM ${fromItems()}
    WHERE ${whereItems(organizationId, options, [groupWhere(group)])}
    ORDER BY w."updatedAt" DESC, w."id" ASC
    LIMIT ${options.limit + 1} OFFSET ${offset}
  `)
  const rows = (result.rows as Array<Record<string, unknown>>).map(toListRow)
  const more = rows.length > options.limit
  return ok({
    items: rows.slice(0, options.limit),
    ...(more ? { nextOffset: offset + options.limit } : {}),
  })
}

function toDate(value: unknown): Date | null {
  return value === null || value === undefined ? null : new Date(value as string)
}

function toListRow(row: Record<string, unknown>): WorkItemListRow {
  return {
    id: row.id as string,
    organizationId: row.organizationId as string,
    sourceKind: row.sourceKind as string,
    sourceId: row.sourceId as string,
    occurrence: Number(row.occurrence ?? 0),
    stage: row.stage as WorkItemRow['stage'],
    reasonCode: row.reasonCode as string,
    role: (row.role as string | null) ?? null,
    railId: (row.railId as string | null) ?? null,
    glAccountId: (row.glAccountId as string | null) ?? null,
    periodKey: (row.periodKey as string | null) ?? null,
    externalRef: (row.externalRef as string | null) ?? null,
    detail: (row.detail as Record<string, unknown> | null) ?? {},
    attempts: Number(row.attempts ?? 0),
    nextAttemptAt: toDate(row.nextAttemptAt),
    createdAt: toDate(row.createdAt) ?? new Date(0),
    updatedAt: toDate(row.updatedAt) ?? new Date(0),
    label: (row.label as string | null) ?? null,
    recordDefinitionId: (row.recordDefinitionId as string | null) ?? null,
    moneyTransactionId: (row.moneyTransactionId as string | null) ?? null,
    purpose: (row.purpose as string | null) ?? null,
    amountMinor:
      row.amountMinor === null || row.amountMinor === undefined ? null : Number(row.amountMinor),
    currency: (row.currency as string | null) ?? null,
  }
}

/**
 * The drawer's read: every row naming this source. A movement also gets the rows of
 * the acceptances that stand behind it, because those are what it waits on.
 */
export async function listWorkItemsForSource(
  db: Db,
  organizationId: string,
  input: { sourceKind: string; sourceId: string }
): Promise<Result<WorkItemRow[], Error>> {
  const t = schema.AccountingWorkItem
  const own = and(eq(t.sourceKind, input.sourceKind), eq(t.sourceId, input.sourceId))
  const behind =
    input.sourceKind === 'money_transaction'
      ? and(
          eq(t.sourceKind, 'financial_source_acceptance'),
          sql`${t.sourceId} IN (SELECT acc."id" FROM ${schema.FinancialSourceAcceptance} acc
            WHERE acc."organizationId" = ${organizationId}
              AND acc."moneyTransactionId" = ${input.sourceId})`
        )
      : undefined
  const rows = await db
    .select()
    .from(t)
    .where(and(eq(t.organizationId, organizationId), behind ? or(own, behind) : own))
    .orderBy(asc(t.stage), asc(t.createdAt))
  return ok(rows)
}

/** The Blocked badge: groups a person can act on, skipped ones excluded. */
export async function countWorkItemGroups(
  db: Db,
  organizationId: string
): Promise<Result<number, Error>> {
  const result = await db.execute(sql`
    SELECT count(*)::int AS "total" FROM (
      SELECT 1 FROM "AccountingWorkItem" w
      WHERE w."organizationId" = ${organizationId}
        ${
          SKIPPED_CODES.length
            ? sql`AND w."reasonCode" NOT IN (${sql.join(
                SKIPPED_CODES.map((code) => sql`${code}`),
                sql`, `
              )})`
            : sql``
        }
      GROUP BY w."reasonCode", w."role", w."railId", w."glAccountId", ${groupExternalRef()}
    ) groups
  `)
  return ok(Number((result.rows[0] as { total?: number } | undefined)?.total ?? 0))
}

/**
 * Of these sources, the ones whose row at `stage` is not due yet - a candidate list
 * subtracts them so a pass does not re-refuse what is waiting on a wake.
 */
export async function listParkedSourceIds(
  db: Db,
  organizationId: string,
  input: { sourceKind: string; stage: WorkItemStage; sourceIds: readonly string[]; now?: Date }
): Promise<Result<Set<string>, Error>> {
  const ids = [...new Set(input.sourceIds)]
  if (ids.length === 0) return ok(new Set())
  const t = schema.AccountingWorkItem
  const rows = await db
    .select({ sourceId: t.sourceId })
    .from(t)
    .where(
      and(
        eq(t.organizationId, organizationId),
        eq(t.sourceKind, input.sourceKind),
        eq(t.stage, input.stage),
        inArray(t.sourceId, ids),
        or(isNull(t.nextAttemptAt), gt(t.nextAttemptAt, input.now ?? new Date()))
      )
    )
  return ok(new Set(rows.map((row) => row.sourceId)))
}
