// packages/lib/src/dispatch/board.ts
//
// The board's read path (07 §B.6). Indexed range scan + a bounded, hand-written FieldValue
// query for the visible work-order set — deliberately NOT the generic record-list machinery
// (UnifiedCrudHandler), which fans out over every field/view config for a query this narrow.

import { database, schema } from '@auxx/database'
import { type RecordId, toRecordId } from '@auxx/types/resource'
import { and, eq, gte, inArray, isNull, lt, lte, ne, sql } from 'drizzle-orm'
import { getOrgCache } from '../cache'
import { extractFieldValueScalar } from '../field-values'
import { type DispatchWorkerWithUser, listDispatchWorkers } from './workers'

type WorkOrderVisitRow = typeof schema.WorkOrderVisit.$inferSelect

/** Inclusive date range for a board query. */
export interface GetBoardRange {
  from: Date
  to: Date
}

export interface GetVisitDayMarkersOptions {
  /** Plan 30 §B.1 — mirrors the sidebar footer's "Show canceled" toggle. Default false
   * (canceled rows excluded), so the mini-calendar's dots agree with the board's own
   * client-side canceled filter. */
  includeCanceled?: boolean
}

/** Slim work-order projection for the visible visit set — display fields only. */
export interface BoardWorkOrder {
  id: string
  displayName: string | null
  number: string | null
  status: string | null
  /** Full `RecordId` (contact def + instance) so clients can hydrate via `useRecord`. */
  contactId: RecordId | null
  contactDisplayName: string | null
}

/** `getBoard` result — workers, visits (range + backlog), and their slim work orders. */
export interface BoardResult {
  workers: DispatchWorkerWithUser[]
  visits: WorkOrderVisitRow[]
  workOrders: BoardWorkOrder[]
}

/** Minimal per-visit projection for the mini-calendar's day-marker dots (v3 sidebar §1.4) —
 * no work-order enrichment, just enough to bucket by local day and filter by worker client-side. */
export interface VisitDayMarker {
  visitId: string
  startTime: Date
  assigneeUserId: string | null
}

/**
 * Resolve slim work-order projections (number/status/contact display name) for a bounded
 * set of work-order instance ids — one narrow `FieldValue` query filtered to that set and
 * only the needed field ids, plus one bounded follow-up query to resolve the contact
 * relationship's display name. Both queries are bounded by the visible board set, never the
 * org's full record count.
 */
async function getSlimWorkOrderProjections(
  organizationId: string,
  workOrderIds: string[]
): Promise<BoardWorkOrder[]> {
  const [instances, cf] = await Promise.all([
    database
      .select({ id: schema.EntityInstance.id, displayName: schema.EntityInstance.displayName })
      .from(schema.EntityInstance)
      .where(
        and(
          eq(schema.EntityInstance.organizationId, organizationId),
          inArray(schema.EntityInstance.id, workOrderIds)
        )
      ),
    getOrgCache()
      .from(organizationId, 'customFields')
      .bySystemAttributes([
        'work_order_number',
        'work_order_status',
        'work_order_contact',
      ] as const),
  ])

  const fieldIds = [cf.work_order_number, cf.work_order_status, cf.work_order_contact]
    .filter((f): f is NonNullable<typeof f> => Boolean(f))
    .map((f) => f.id)

  const values =
    fieldIds.length > 0
      ? await database
          .select()
          .from(schema.FieldValue)
          .where(
            and(
              inArray(schema.FieldValue.entityId, workOrderIds),
              inArray(schema.FieldValue.fieldId, fieldIds)
            )
          )
      : []

  const valuesByWorkOrder = new Map<string, typeof values>()
  for (const value of values) {
    const list = valuesByWorkOrder.get(value.entityId) ?? []
    list.push(value)
    valuesByWorkOrder.set(value.entityId, list)
  }

  const contactFieldId = cf.work_order_contact?.id
  const contactIds = contactFieldId
    ? Array.from(
        new Set(
          values
            .filter((v) => v.fieldId === contactFieldId && v.relatedEntityId)
            .map((v) => v.relatedEntityId as string)
        )
      )
    : []
  const contacts =
    contactIds.length > 0
      ? await database
          .select({
            id: schema.EntityInstance.id,
            displayName: schema.EntityInstance.displayName,
            entityDefinitionId: schema.EntityInstance.entityDefinitionId,
          })
          .from(schema.EntityInstance)
          .where(inArray(schema.EntityInstance.id, contactIds))
      : []
  const contactById = new Map(contacts.map((c) => [c.id, c]))

  return instances.map((instance) => {
    const rows = valuesByWorkOrder.get(instance.id) ?? []
    const numberRow = cf.work_order_number
      ? rows.find((r) => r.fieldId === cf.work_order_number!.id)
      : undefined
    const statusRow = cf.work_order_status
      ? rows.find((r) => r.fieldId === cf.work_order_status!.id)
      : undefined
    const contactRow = contactFieldId ? rows.find((r) => r.fieldId === contactFieldId) : undefined
    const contact = contactRow?.relatedEntityId
      ? contactById.get(contactRow.relatedEntityId)
      : undefined

    return {
      id: instance.id,
      displayName: instance.displayName,
      number: numberRow ? (extractFieldValueScalar(numberRow) as string | null) : null,
      status: statusRow ? (extractFieldValueScalar(statusRow) as string | null) : null,
      contactId: contact ? toRecordId(contact.entityDefinitionId, contact.id) : null,
      contactDisplayName: contact?.displayName ?? null,
    }
  })
}

/**
 * The board's single read (07 §B.6): active workers, visits overlapping `[from, to]` PLUS
 * the unscheduled backlog (never range-filtered), and slim work-order projections for the
 * visible set. `dispatch.getBoard` (member read-only) is the only tRPC caller.
 */
export async function getBoard(organizationId: string, range: GetBoardRange): Promise<BoardResult> {
  const [workers, rangeVisits, backlogVisits] = await Promise.all([
    listDispatchWorkers(organizationId).then((rows) => rows.filter((w) => w.isActive)),
    database
      .select()
      .from(schema.WorkOrderVisit)
      .where(
        and(
          eq(schema.WorkOrderVisit.organizationId, organizationId),
          gte(schema.WorkOrderVisit.endTime, range.from),
          lte(schema.WorkOrderVisit.startTime, range.to)
        )
      ),
    database
      .select()
      .from(schema.WorkOrderVisit)
      .where(
        and(
          eq(schema.WorkOrderVisit.organizationId, organizationId),
          isNull(schema.WorkOrderVisit.startTime),
          eq(schema.WorkOrderVisit.status, 'scheduled')
        )
      ),
  ])

  const visits = [...rangeVisits, ...backlogVisits]
  const workOrderIds = Array.from(new Set(visits.map((v) => v.workOrderId)))
  const workOrders =
    workOrderIds.length > 0 ? await getSlimWorkOrderProjections(organizationId, workOrderIds) : []

  return { workers, visits, workOrders }
}

/**
 * Minimal rows for scheduled visits starting in the half-open window `[range.from, range.to)` —
 * the mini-calendar's day-marker dots (dispatch v3 sidebar plan §1.4). Day-bucketing is CLIENT-
 * computed (the `getBoard`/`listMyVisits` convention — the server stays timezone-naive), so this
 * intentionally returns un-bucketed rows rather than a `Record<dateKey, number>`. "Scheduled"
 * means `startTime` is set — the `gte`/`lt` filter on `startTime` excludes backlog rows without
 * needing an explicit `isNull` check. `options.includeCanceled` (plan 30 §B.1, default false)
 * excludes canceled visits to match the board's own client-side "Show canceled" filter — unlike
 * `getBoard`'s range visit query above (`rangeVisits`, line 139), which never filters by `status`
 * (the board keeps fetching canceled rows so the sidebar toggle stays instant, no refetch).
 * `dispatch.getVisitDayMarkers` (member read-only, same gating as `getBoard`) is the only tRPC
 * caller.
 */
export async function getVisitDayMarkers(
  organizationId: string,
  range: GetBoardRange,
  options: GetVisitDayMarkersOptions = {}
): Promise<VisitDayMarker[]> {
  const rows = await database
    .select({
      visitId: schema.WorkOrderVisit.id,
      startTime: schema.WorkOrderVisit.startTime,
      assigneeUserId: schema.WorkOrderVisit.assigneeUserId,
    })
    .from(schema.WorkOrderVisit)
    .where(
      and(
        eq(schema.WorkOrderVisit.organizationId, organizationId),
        gte(schema.WorkOrderVisit.startTime, range.from),
        lt(schema.WorkOrderVisit.startTime, range.to),
        options.includeCanceled ? undefined : ne(schema.WorkOrderVisit.status, 'canceled')
      )
    )

  return rows.map((row) => ({
    visitId: row.visitId,
    startTime: row.startTime as Date,
    assigneeUserId: row.assigneeUserId,
  }))
}

/**
 * All visits for one work order, oldest-scheduled-first (unscheduled rows last) — the M2b
 * job view's Schedule/Upcoming/History sections (07 §F.3). Uses the `(workOrderId)` index.
 */
export async function listVisitsForWorkOrder(
  organizationId: string,
  workOrderId: string
): Promise<WorkOrderVisitRow[]> {
  return database
    .select()
    .from(schema.WorkOrderVisit)
    .where(
      and(
        eq(schema.WorkOrderVisit.organizationId, organizationId),
        eq(schema.WorkOrderVisit.workOrderId, workOrderId)
      )
    )
    .orderBy(sql`${schema.WorkOrderVisit.startTime} ASC NULLS LAST`)
}
