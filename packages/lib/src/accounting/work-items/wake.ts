// packages/lib/src/accounting/work-items/wake.ts

import { type Database, schema, type Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, type Column, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { groupsByExternalRef, type WorkItemCode, type WorkItemStage } from './codes'

const logger = createScopedLogger('accounting-work-items:wake')

type Db = Database | Transaction

/** A fix wakes exactly what it unblocks: those rows become due now (91 §4.6). */
async function wake(
  db: Db,
  organizationId: string,
  label: string,
  where: SQL | undefined
): Promise<Result<number, Error>> {
  try {
    // The app clock, the one the sweep's `nextAttemptAt <= now` reads with.
    const now = new Date()
    const rows = await db
      .update(schema.AccountingWorkItem)
      .set({ nextAttemptAt: now, updatedAt: now })
      .where(and(eq(schema.AccountingWorkItem.organizationId, organizationId), where))
      .returning({ id: schema.AccountingWorkItem.id })
    return ok(rows.length)
  } catch (error) {
    logger.error('A wake failed; the rows keep their own schedule', {
      organizationId,
      label,
      error: error instanceof Error ? error.message : String(error),
    })
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}

function code(reasonCode: WorkItemCode) {
  return eq(schema.AccountingWorkItem.reasonCode, reasonCode)
}

/** A role mapped: its `ROLE_UNMAPPED` rows, narrowed to the rail when the mapping names one. */
export async function wakeRoleUnmapped(
  db: Db,
  organizationId: string,
  input: { role: string; railId?: string | null }
): Promise<Result<number, Error>> {
  return wake(
    db,
    organizationId,
    'role',
    and(
      code('ROLE_UNMAPPED'),
      eq(schema.AccountingWorkItem.role, input.role),
      input.railId ? eq(schema.AccountingWorkItem.railId, input.railId) : undefined
    )
  )
}

/** A shipment's totals stamped. */
export async function wakeTotalsNotStamped(
  db: Db,
  organizationId: string,
  input: { fulfillmentIds: readonly string[] }
): Promise<Result<number, Error>> {
  if (input.fulfillmentIds.length === 0) return ok(0)
  return wake(
    db,
    organizationId,
    'totals',
    and(
      code('TOTALS_NOT_STAMPED'),
      eq(schema.AccountingWorkItem.sourceKind, 'fulfillment'),
      inArray(schema.AccountingWorkItem.sourceId, [...input.fulfillmentIds])
    )
  )
}

/** Orders arrived: the `ORDER_NOT_FOUND` rows carrying any of their external ids. */
export async function wakeArrivedOrders(
  db: Db,
  organizationId: string,
  input: { orderInstanceIds: readonly string[] }
): Promise<Result<number, Error>> {
  const ids = [...new Set(input.orderInstanceIds)]
  if (ids.length === 0) return ok(0)
  return wake(
    db,
    organizationId,
    'order',
    and(
      code('ORDER_NOT_FOUND'),
      sql`${schema.AccountingWorkItem.externalRef} IN (SELECT identity."externalId"
        FROM ${schema.RecordIdentity} identity
        WHERE identity."organizationId" = ${organizationId}
          AND identity."entityInstanceId" IN (${sql.join(
            ids.map((id) => sql`${id}`),
            sql`, `
          )}))`
    )
  )
}

/** Every row carrying one code - a fix with no narrower key, such as minting the guest customer. */
export async function wakeReasonCode(
  db: Db,
  organizationId: string,
  reasonCode: WorkItemCode
): Promise<Result<number, Error>> {
  return wake(db, organizationId, reasonCode, code(reasonCode))
}

/** The rows of these sources at one stage, e.g. the acceptances on an order that changed. */
export async function wakeSources(
  db: Db,
  organizationId: string,
  input: { sourceKind: string; sourceIds: readonly string[]; stage?: WorkItemStage }
): Promise<Result<number, Error>> {
  const ids = [...new Set(input.sourceIds)]
  if (ids.length === 0) return ok(0)
  return wake(
    db,
    organizationId,
    'sources',
    and(
      eq(schema.AccountingWorkItem.sourceKind, input.sourceKind),
      inArray(schema.AccountingWorkItem.sourceId, ids),
      input.stage ? eq(schema.AccountingWorkItem.stage, input.stage) : undefined
    )
  )
}

/** Every row, of any kind and stage, whose source is one of these records - a record just completed. */
export async function wakeRecords(
  db: Db,
  organizationId: string,
  input: { recordIds: readonly string[] }
): Promise<Result<number, Error>> {
  const ids = [...new Set(input.recordIds)]
  if (ids.length === 0) return ok(0)
  return wake(db, organizationId, 'records', inArray(schema.AccountingWorkItem.sourceId, ids))
}

/** One Blocked-tab group, or one source inside it: Retry all sets the time and returns. */
export interface WorkItemGroupKey {
  reasonCode: string
  role: string | null
  railId: string | null
  glAccountId: string | null
  /** Set only for codes that group by it (`groupsByExternalRef`); ignored otherwise. */
  externalRef?: string | null
}

export async function wakeWorkItemGroup(
  db: Db,
  organizationId: string,
  group: WorkItemGroupKey
): Promise<Result<number, Error>> {
  const t = schema.AccountingWorkItem
  const same = (column: Column, value: string | null) =>
    value === null ? isNull(column) : eq(column, value)
  return wake(
    db,
    organizationId,
    'group',
    and(
      eq(t.reasonCode, group.reasonCode),
      same(t.role, group.role),
      same(t.railId, group.railId),
      same(t.glAccountId, group.glAccountId),
      groupsByExternalRef(group.reasonCode)
        ? same(t.externalRef, group.externalRef ?? null)
        : undefined
    )
  )
}
