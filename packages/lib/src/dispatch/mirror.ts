// packages/lib/src/dispatch/mirror.ts
//
// Visit → field mirror (01 §3, 07 §B.3) — the `meeting-entity-service.ts` recipe:
// `getCachedCustomFields` (via `bySystemAttributes`) keyed by systemAttribute →
// `FieldValueService.setValuesForEntity` with `publishEvents: false`. The dispatch service
// is the only writer of visits; after every mutation it mirrors onto the work order record
// so table views/filters/dashboards/record rules/Kopilot keep working on plain fields.

import { database, schema } from '@auxx/database'
import { extractValue } from '@auxx/types'
import { toRecordId } from '@auxx/types/resource'
import { and, asc, eq, gte, isNotNull, ne } from 'drizzle-orm'
import { getOrgCache } from '../cache'
import { FieldValueService } from '../field-values/field-value-service'

type WorkOrderVisitRow = typeof schema.WorkOrderVisit.$inferSelect

/**
 * Resolve the visit whose fields should mirror onto the work order: the next-upcoming
 * non-canceled visit (min `startTime`, future), else — for a `one_off` job only — the oldest
 * NON-CANCELED visit that exists at all. Written next-upcoming-aware from day one (07 §B.3)
 * even though M2a's one-visit-per-work-order invariant makes "the visit" and "next-upcoming"
 * coincide — the M2c recurring engine (many visits per work order) needs no fork on the
 * upcoming query itself.
 *
 * The fallback excludes `canceled` too (07 §H acceptance: canceling a work order's only
 * visit must null the mirrors, not keep showing the stale pre-cancel schedule) — a canceled
 * visit carries no active schedule, so it's never a valid mirror source, only ever a
 * candidate when NOTHING else is available.
 *
 * `isRecurring` (06-recurring-engine.md §4.2) skips the fallback entirely: a paused or
 * exhausted recurring engagement has no upcoming visit, and falling back to the oldest past
 * visit would show a stale schedule instead of nulling the mirror.
 */
async function resolveMirrorSourceVisit(
  organizationId: string,
  workOrderId: string,
  opts: { isRecurring: boolean }
): Promise<WorkOrderVisitRow | null> {
  const upcoming = await database.query.WorkOrderVisit.findFirst({
    where: and(
      eq(schema.WorkOrderVisit.organizationId, organizationId),
      eq(schema.WorkOrderVisit.workOrderId, workOrderId),
      ne(schema.WorkOrderVisit.status, 'canceled'),
      isNotNull(schema.WorkOrderVisit.startTime),
      gte(schema.WorkOrderVisit.startTime, new Date())
    ),
    orderBy: asc(schema.WorkOrderVisit.startTime),
  })
  if (upcoming) return upcoming
  if (opts.isRecurring) return null

  const fallback = await database.query.WorkOrderVisit.findFirst({
    where: and(
      eq(schema.WorkOrderVisit.organizationId, organizationId),
      eq(schema.WorkOrderVisit.workOrderId, workOrderId),
      ne(schema.WorkOrderVisit.status, 'canceled')
    ),
    orderBy: asc(schema.WorkOrderVisit.createdAt),
  })
  return fallback ?? null
}

/**
 * Mirror the visit-machinery source-of-truth fields onto the work order record (01 §3):
 * `startTime → work_order_scheduled_start`, `endTime → work_order_scheduled_end`,
 * `assigneeUserId → work_order_assignee`. `publishEvents: false` — this is a system mirror
 * of read-only fields (`work-order-fields.ts` marks them `creatable:false/updatable:false`),
 * not a user edit worth a timeline entry.
 */
export async function mirrorVisitOntoWorkOrder(
  organizationId: string,
  userId: string,
  workOrderId: string
): Promise<void> {
  const cf = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([
      'work_order_scheduled_start',
      'work_order_scheduled_end',
      'work_order_assignee',
      'work_order_job_type',
    ] as const)

  const fieldValueService = new FieldValueService(organizationId, userId)

  let isRecurring = false
  if (cf.work_order_job_type) {
    const jobTypeTyped = await fieldValueService.getValue({
      recordId: toRecordId('work_order', workOrderId),
      fieldId: cf.work_order_job_type.id,
    })
    const jobTypeFirst = Array.isArray(jobTypeTyped) ? jobTypeTyped[0] : jobTypeTyped
    isRecurring = jobTypeFirst ? extractValue(jobTypeFirst) === 'recurring' : false
  }

  const source = await resolveMirrorSourceVisit(organizationId, workOrderId, { isRecurring })

  const values: Array<{ fieldId: string; value: unknown }> = []
  if (cf.work_order_scheduled_start) {
    values.push({
      fieldId: cf.work_order_scheduled_start.id,
      value: source?.startTime ? source.startTime.toISOString() : null,
    })
  }
  if (cf.work_order_scheduled_end) {
    values.push({
      fieldId: cf.work_order_scheduled_end.id,
      value: source?.endTime ? source.endTime.toISOString() : null,
    })
  }
  if (cf.work_order_assignee) {
    values.push({
      fieldId: cf.work_order_assignee.id,
      value: source?.assigneeUserId ?? null,
    })
  }
  if (values.length === 0) return

  await fieldValueService.setValuesForEntity({
    recordId: toRecordId('work_order', workOrderId),
    values,
    publishEvents: false,
  })
}
