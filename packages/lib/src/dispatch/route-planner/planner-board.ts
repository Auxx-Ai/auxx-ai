// packages/lib/src/dispatch/route-planner/planner-board.ts
//
// The route planner's single read (plans/dispatch/09-route-planner.md §B/§F, build contract's
// `planner-board.ts`). Mirrors `board.ts`'s `getBoard`/`getSlimWorkOrderProjections` shape — a
// bounded FieldValue query, not the generic record-list machinery — extended with
// `work_order_address`/`work_order_tags` and each worker's availability day-start. `routeOrder`/
// `latitude`/`longitude` ride the visit row already selected (`schema.WorkOrderVisit`), no
// extra join.

import { database, schema } from '@auxx/database'
import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm'
import { resolveAvailability } from '../../availability'
import { getOrgCache } from '../../cache'
import { extractFieldValueScalar } from '../../field-values'
import { formatAddress } from '../address'
import { listDispatchWorkers } from '../workers'
import { resolveOrgDepot } from './depot'
import type { PlannerBoardResult, PlannerDayWindow, PlannerWorker, PlannerWorkOrder } from './types'

type FieldValueRow = typeof schema.FieldValue.$inferSelect

/** `HH:mm` 24h local clock string for minutes-since-midnight, or `null`. */
function minutesToClock(minutes: number | undefined): string | null {
  if (minutes === undefined) return null
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * Slim work-order projections for the planner's visible visit set — `board.ts`'s
 * `getSlimWorkOrderProjections` pattern, extended with `work_order_address` (joined display
 * string) and `work_order_tags` (TAGS, multi-row `optionId` values).
 */
async function getPlannerWorkOrderProjections(
  organizationId: string,
  workOrderIds: string[]
): Promise<PlannerWorkOrder[]> {
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
        'work_order_address',
        'work_order_tags',
      ] as const),
  ])

  const fieldIds = [
    cf.work_order_number,
    cf.work_order_status,
    cf.work_order_contact,
    cf.work_order_address,
    cf.work_order_tags,
  ]
    .filter((f): f is NonNullable<typeof f> => Boolean(f))
    .map((f) => f.id)

  const values: FieldValueRow[] =
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

  const valuesByWorkOrder = new Map<string, FieldValueRow[]>()
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
    const addressRow = cf.work_order_address
      ? rows.find((r) => r.fieldId === cf.work_order_address!.id)
      : undefined
    const addressValue = addressRow
      ? (extractFieldValueScalar(addressRow) as Record<string, unknown> | null)
      : null
    const tags = cf.work_order_tags
      ? rows
          .filter((r) => r.fieldId === cf.work_order_tags!.id && r.optionId)
          .map((r) => r.optionId as string)
      : []

    return {
      id: instance.id,
      displayName: instance.displayName,
      number: numberRow ? (extractFieldValueScalar(numberRow) as string | null) : null,
      status: statusRow ? (extractFieldValueScalar(statusRow) as string | null) : null,
      contactDisplayName: contactRelatedId ? (contactNameById.get(contactRelatedId) ?? null) : null,
      tags,
      addressText: addressValue ? formatAddress(addressValue) : null,
    }
  })
}

/**
 * The route planner's single read (build contract's `planner-board.ts`): active workers (each
 * with its availability day-start default for the Apply-times dialog), that day's visits
 * (assigned + unassigned, carrying `routeOrder`/`latitude`/`longitude`), the unscheduled
 * backlog, and slim work-order projections extended with tags/address. `workerIds`, when given,
 * narrows the returned `workers` array only — `visits`/`backlog` stay unfiltered so the
 * dispatcher can still see "does this fit better on another team's route" (design doc's stated
 * story) even while a subset of workers is checked in the filter. `dispatch.getRoutePlannerBoard`
 * is the only tRPC caller.
 */
export async function getRoutePlannerBoard(
  organizationId: string,
  window: PlannerDayWindow,
  workerIds?: string[]
): Promise<PlannerBoardResult> {
  const { from, to, dateKey } = window

  const allWorkers = await listDispatchWorkers(organizationId).then((rows) =>
    rows.filter((w) => w.isActive)
  )
  const filteredWorkers =
    workerIds && workerIds.length > 0
      ? allWorkers.filter((w) => workerIds.includes(w.userId))
      : allWorkers

  const [dayVisits, backlogVisits, availabilityDays, depot] = await Promise.all([
    database
      .select()
      .from(schema.WorkOrderVisit)
      .where(
        and(
          eq(schema.WorkOrderVisit.organizationId, organizationId),
          gte(schema.WorkOrderVisit.endTime, from),
          lte(schema.WorkOrderVisit.startTime, to)
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
    Promise.all(
      filteredWorkers.map((w) =>
        resolveAvailability(
          { type: 'worker', organizationId, userId: w.userId },
          { from: dateKey, to: dateKey }
        )
      )
    ),
    resolveOrgDepot(organizationId),
  ])

  const workers: PlannerWorker[] = filteredWorkers.map((w, i) => ({
    id: w.id,
    userId: w.userId,
    color: w.color,
    name: w.user?.name ?? null,
    email: w.user?.email ?? null,
    image: w.user?.image ?? null,
    availabilityStart: minutesToClock(availabilityDays[i]?.[0]?.ranges[0]?.start),
  }))

  const visits = [...dayVisits, ...backlogVisits]
  const workOrderIds = Array.from(new Set(visits.map((v) => v.workOrderId)))
  const workOrders =
    workOrderIds.length > 0
      ? await getPlannerWorkOrderProjections(organizationId, workOrderIds)
      : []

  return { workers, visits: dayVisits, backlog: backlogVisits, workOrders, depot }
}
