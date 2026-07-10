// packages/lib/src/dispatch/board.ts
//
// The board's read path (07 §B.6). Indexed range scan + a bounded, hand-written FieldValue
// query for the visible work-order set — deliberately NOT the generic record-list machinery
// (UnifiedCrudHandler), which fans out over every field/view config for a query this narrow.

import { database, schema } from '@auxx/database'
import { and, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm'
import { getOrgCache } from '../cache'
import { extractFieldValueScalar } from '../field-values'
import { type DispatchWorkerWithUser, listDispatchWorkers } from './workers'

type WorkOrderVisitRow = typeof schema.WorkOrderVisit.$inferSelect

/** Inclusive date range for a board query. */
export interface GetBoardRange {
  from: Date
  to: Date
}

/** Slim work-order projection for the visible visit set — display fields only. */
export interface BoardWorkOrder {
  id: string
  displayName: string | null
  number: string | null
  status: string | null
  contactDisplayName: string | null
}

/** `getBoard` result — workers, visits (range + backlog), and their slim work orders. */
export interface BoardResult {
  workers: DispatchWorkerWithUser[]
  visits: WorkOrderVisitRow[]
  workOrders: BoardWorkOrder[]
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
          .select({ id: schema.EntityInstance.id, displayName: schema.EntityInstance.displayName })
          .from(schema.EntityInstance)
          .where(inArray(schema.EntityInstance.id, contactIds))
      : []
  const contactNameById = new Map(contacts.map((c) => [c.id, c.displayName]))

  return instances.map((instance) => {
    const rows = valuesByWorkOrder.get(instance.id) ?? []
    const numberRow = cf.work_order_number
      ? rows.find((r) => r.fieldId === cf.work_order_number!.id)
      : undefined
    const statusRow = cf.work_order_status
      ? rows.find((r) => r.fieldId === cf.work_order_status!.id)
      : undefined
    const contactRow = contactFieldId ? rows.find((r) => r.fieldId === contactFieldId) : undefined
    const contactRelatedId = contactRow?.relatedEntityId ?? null

    return {
      id: instance.id,
      displayName: instance.displayName,
      number: numberRow ? (extractFieldValueScalar(numberRow) as string | null) : null,
      status: statusRow ? (extractFieldValueScalar(statusRow) as string | null) : null,
      contactDisplayName: contactRelatedId ? (contactNameById.get(contactRelatedId) ?? null) : null,
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
