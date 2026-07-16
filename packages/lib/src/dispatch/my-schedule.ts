// packages/lib/src/dispatch/my-schedule.ts
//
// The worker-scoped read/write path (08-worker-surface.md §6) — the Schedule page's backend.
// A worker only ever sees/touches visits assigned to them (`loadOwnVisit`'s guard); status
// advancement delegates to the shared `setVisitStatus` writer so mirror/roll-up/broadcast/
// record-rules fire identically to the board's admin path (§6 — "three writers, one
// function", the same seam M3's geofence auto-arrive will use). Money-hidden by construction:
// every payload below is hand-projected, never the full field-value set, so price/total/
// unitPrice can't leak onto this surface by accident.

import { database, schema } from '@auxx/database'
import type { TypedFieldValue } from '@auxx/types'
import { extractValue } from '@auxx/types'
import { parseResourceFieldId, toResourceFieldId } from '@auxx/types/field'
import { parseRecordId, toRecordId } from '@auxx/types/resource'
import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm'
import { getOrgCache } from '../cache'
import { BadRequestError, ForbiddenError, NotFoundError } from '../errors'
import { createVisitInvoice } from '../money/billing-commands'
import { computeWorkOrderBillingProjection } from '../money/billing-projection'
import { UnifiedCrudHandler } from '../resources/crud'
import { formatAddress } from './address'
import type { VisitStatus } from './types'
import { setVisitStatus } from './visit-mutations'
import { getWorkOrderProjections } from './work-order-fields'

type WorkOrderVisitRow = typeof schema.WorkOrderVisit.$inferSelect

/** Unwrap a `getFieldValues()` map entry — takes the first value if array-returned. */
function firstTyped(
  entry: TypedFieldValue | TypedFieldValue[] | undefined
): TypedFieldValue | undefined {
  if (!entry) return undefined
  return Array.isArray(entry) ? entry[0] : entry
}

/**
 * Load a visit and enforce the assignee guard (08 §6) — a worker touches only their own
 * visits. Shared by every worker-scoped mutation/read below except `listMyVisits`, which
 * filters by `assigneeUserId` in the query itself. Also reused by `qc.ts` for the worker-scoped
 * QC checklist fns (08 §5).
 *
 * @throws {NotFoundError} when the visit doesn't exist in this org.
 * @throws {ForbiddenError} when the visit isn't assigned to `userId`.
 */
export async function loadOwnVisit(
  organizationId: string,
  userId: string,
  visitId: string
): Promise<WorkOrderVisitRow> {
  const visit = await database.query.WorkOrderVisit.findFirst({
    where: and(
      eq(schema.WorkOrderVisit.id, visitId),
      eq(schema.WorkOrderVisit.organizationId, organizationId)
    ),
  })
  if (!visit) throw new NotFoundError('Visit not found')
  if (visit.assigneeUserId !== userId) {
    throw new ForbiddenError('This visit is not assigned to you')
  }
  return visit
}

/** Slim work-order title used by the list surface — display name + number only. */
interface WorkOrderTitle {
  id: string
  displayName: string | null
  number: string | null
}

/**
 * Resolve display name + number for a bounded set of work orders — `displayName` from
 * `EntityInstance`, `number` via the shared {@link getWorkOrderProjections} batch read.
 */
async function getWorkOrderTitles(
  organizationId: string,
  userId: string,
  workOrderIds: string[]
): Promise<Map<string, WorkOrderTitle>> {
  const result = new Map<string, WorkOrderTitle>()
  if (workOrderIds.length === 0) return result

  const [instances, projections] = await Promise.all([
    database
      .select({ id: schema.EntityInstance.id, displayName: schema.EntityInstance.displayName })
      .from(schema.EntityInstance)
      .where(
        and(
          eq(schema.EntityInstance.organizationId, organizationId),
          inArray(schema.EntityInstance.id, workOrderIds)
        )
      ),
    getWorkOrderProjections(organizationId, userId, workOrderIds, ['number']),
  ])

  for (const instance of instances) {
    result.set(instance.id, {
      id: instance.id,
      displayName: instance.displayName,
      number: projections.get(instance.id)?.number ?? null,
    })
  }
  return result
}

/** Input for {@link listMyVisits}. */
export interface ListMyVisitsInput {
  organizationId: string
  userId: string
  from: Date
  to: Date
}

/** One row of the Schedule page's visit list — slim, NO prices. */
export interface MyVisitListItem {
  id: string
  status: VisitStatus
  startTime: Date
  endTime: Date
  timezone: string
  workOrder: WorkOrderTitle
}

/**
 * List the signed-in worker's visits scheduled in `[from, to)`, oldest first (08 §2 "Data" —
 * the Schedule page's windowed fetch). Uses the `(assigneeUserId, startTime)` index.
 */
export async function listMyVisits(input: ListMyVisitsInput): Promise<MyVisitListItem[]> {
  const { organizationId, userId, from, to } = input

  const visits = await database
    .select()
    .from(schema.WorkOrderVisit)
    .where(
      and(
        eq(schema.WorkOrderVisit.organizationId, organizationId),
        eq(schema.WorkOrderVisit.assigneeUserId, userId),
        gte(schema.WorkOrderVisit.startTime, from),
        lt(schema.WorkOrderVisit.startTime, to)
      )
    )
    .orderBy(asc(schema.WorkOrderVisit.startTime))

  const workOrderIds = Array.from(new Set(visits.map((v) => v.workOrderId)))
  const titles = await getWorkOrderTitles(organizationId, userId, workOrderIds)

  return visits.map((visit) => ({
    id: visit.id,
    status: visit.status as VisitStatus,
    // Non-null: the range filter above only matches scheduled (non-null startTime/endTime) rows.
    startTime: visit.startTime as Date,
    endTime: visit.endTime as Date,
    timezone: visit.timezone,
    workOrder: titles.get(visit.workOrderId) ?? {
      id: visit.workOrderId,
      displayName: null,
      number: null,
    },
  }))
}

/** Input for {@link getMyVisitDetail}. */
export interface GetMyVisitDetailInput {
  organizationId: string
  userId: string
  visitId: string
}

/** The visit detail page's work-order section — NO prices. */
export interface MyVisitDetailWorkOrder {
  id: string
  displayName: string | null
  number: string | null
  instructions: string | null
  contactDisplayName: string | null
  serviceAddress: string | null
}

/** One line item projected to name/quantity/description ONLY — never price/total/unitPrice. */
export interface MyVisitDetailLine {
  name: string
  quantity: number
  description?: string
}

/** `getMyVisitDetail` result — the Visit tab's full payload. */
export interface MyVisitDetail {
  id: string
  status: VisitStatus
  startTime: Date | null
  endTime: Date | null
  timezone: string
  workOrder: MyVisitDetailWorkOrder
  lines: MyVisitDetailLine[]
}

/**
 * Full visit detail for the worker-mobile Visit tab (08 §3) — general info, instructions, and
 * money-hidden line items. Assignee-guarded via {@link loadOwnVisit}.
 */
export async function getMyVisitDetail(input: GetMyVisitDetailInput): Promise<MyVisitDetail> {
  const { organizationId, userId, visitId } = input
  const visit = await loadOwnVisit(organizationId, userId, visitId)

  const handler = new UnifiedCrudHandler(organizationId, userId)
  const cache = getOrgCache()
  const workOrderRecordId = toRecordId('work_order', visit.workOrderId)

  const [instance, cf] = await Promise.all([
    database.query.EntityInstance.findFirst({
      where: eq(schema.EntityInstance.id, visit.workOrderId),
      columns: { displayName: true },
    }),
    cache
      .from(organizationId, 'customFields')
      .bySystemAttributes([
        'work_order_number',
        'work_order_description',
        'work_order_contact',
        'work_order_address',
      ] as const),
  ])

  const woFieldIds = [
    cf.work_order_number,
    cf.work_order_description,
    cf.work_order_contact,
    cf.work_order_address,
  ]
    .filter(Boolean)
    .map((f) => f!.id)
  const woValues = await handler.getFieldValues(workOrderRecordId, woFieldIds)
  const get = (f?: { id: string }) => (f ? firstTyped(woValues.get(f.id)) : undefined)

  const numberTyped = get(cf.work_order_number)
  const descriptionTyped = get(cf.work_order_description)
  const contactTyped = get(cf.work_order_contact)
  const addressTyped = get(cf.work_order_address)

  const number = numberTyped ? (extractValue(numberTyped) as string) : null
  const instructions = descriptionTyped ? (extractValue(descriptionTyped) as string) : null
  const contactRecordId = contactTyped?.type === 'relationship' ? contactTyped.recordId : undefined
  const serviceAddress = addressTyped?.type === 'json' ? formatAddress(addressTyped.value) : null

  let contactDisplayName: string | null = null
  if (contactRecordId) {
    const { entityInstanceId } = parseRecordId(contactRecordId)
    const contact = await database.query.EntityInstance.findFirst({
      where: eq(schema.EntityInstance.id, entityInstanceId),
      columns: { displayName: true },
    })
    contactDisplayName = contact?.displayName ?? null
  }

  // Line items — reuses the gather.ts `line_item:workOrder` read, stripped to name/qty/
  // description only (money MI1/MI2's price fields never reach this surface, 08 §3).
  const lineCf = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes(['line_item_name', 'line_item_description', 'line_item_qty'] as const)
  const lineFieldIds = [lineCf.line_item_name, lineCf.line_item_description, lineCf.line_item_qty]
    .filter(Boolean)
    .map((f) => f!.id)

  const { ids: lineInstanceIds } = await handler.listFiltered({
    entityDefinitionId: 'line_item',
    filters: [
      {
        id: 'wo-lines',
        logicalOperator: 'AND',
        conditions: [
          {
            id: 'wo-lines-workorder',
            fieldId: 'line_item:workOrder',
            operator: 'is',
            value: workOrderRecordId,
          },
        ],
      },
    ],
    sorting: [{ id: 'sortOrder', desc: false }],
    limit: 1000,
    mode: 'oneshot',
  })

  // One batched read for every line item (was N+1: one getFieldValues per line). Group the
  // typed results by line instance id, then project each line in its listFiltered sort order.
  const lineValuesByInstance = new Map<string, Map<string, TypedFieldValue>>()
  if (lineInstanceIds.length > 0 && lineFieldIds.length > 0) {
    const { values } = await handler.fieldValueService.batchGetValues({
      recordIds: lineInstanceIds.map((id) => toRecordId('line_item', id)),
      fieldReferences: lineFieldIds.map((id) => toResourceFieldId('line_item', id)),
    })
    for (const row of values) {
      const { entityInstanceId } = parseRecordId(row.recordId)
      const fieldId =
        typeof row.fieldRef === 'string' ? parseResourceFieldId(row.fieldRef).fieldId : undefined
      const typed = firstTyped(row.value ?? undefined)
      if (!fieldId || !typed) continue
      const fields = lineValuesByInstance.get(entityInstanceId) ?? new Map()
      fields.set(fieldId, typed)
      lineValuesByInstance.set(entityInstanceId, fields)
    }
  }

  const lines: MyVisitDetailLine[] = lineInstanceIds.map((lineInstanceId) => {
    const fields = lineValuesByInstance.get(lineInstanceId)
    const lget = (f?: { id: string }) => (f ? fields?.get(f.id) : undefined)
    const nameTyped = lget(lineCf.line_item_name)
    const lineDescriptionTyped = lget(lineCf.line_item_description)
    const qtyTyped = lget(lineCf.line_item_qty)

    return {
      name: nameTyped ? (extractValue(nameTyped) as string) : '',
      quantity: qtyTyped ? (extractValue(qtyTyped) as number) : 1,
      description: lineDescriptionTyped
        ? (extractValue(lineDescriptionTyped) as string)
        : undefined,
    }
  })

  return {
    id: visit.id,
    status: visit.status as VisitStatus,
    startTime: visit.startTime,
    endTime: visit.endTime,
    timezone: visit.timezone,
    workOrder: {
      id: visit.workOrderId,
      displayName: instance?.displayName ?? null,
      number,
      instructions,
      contactDisplayName,
      serviceAddress,
    },
    lines,
  }
}

/** Allowed `advanceMyVisit` transitions (08 §6) — `→done` is NOT here, that's `closeMyVisit`. */
const ADVANCE_TRANSITIONS: Record<string, VisitStatus[]> = {
  scheduled: ['en_route'],
  en_route: ['scheduled', 'on_site'],
  on_site: ['en_route'],
}

/**
 * The subset of `ADVANCE_TRANSITIONS` that move a visit FORWARD (vs. the "Undo last" pair,
 * `en_route→scheduled`/`on_site→en_route`) — only forward advances are day-gated below.
 */
const FORWARD_TRANSITIONS = new Set<string>(['scheduled->en_route', 'en_route->on_site'])

/** Input for {@link advanceMyVisit}. */
export interface AdvanceMyVisitInput {
  organizationId: string
  userId: string
  visitId: string
  to: VisitStatus
  /**
   * The worker's client-local end-of-today (day boundaries are always client-computed in this
   * repo — never server `startOfDay`, a prod-TZ bug). Gates FORWARD advances only: a visit
   * scheduled after this instant is a future day, so "Start travel"/"Arrived" are rejected.
   * Undo transitions are exempt — they must keep working regardless of date.
   */
  clientDayEnd: Date
}

/**
 * Advance (or undo) the signed-in worker's own visit through the one-thumb status button (08
 * §1/§3): forward `scheduled→en_route`, `en_route→on_site`; undo `en_route→scheduled`,
 * `on_site→en_route`. Delegates to `setVisitStatus` so mirror/roll-up/broadcast/record-rules
 * fire identically to the board's admin path.
 *
 * @throws {BadRequestError} for any transition outside the allowed set, or for a FORWARD
 *   advance on a visit scheduled after `clientDayEnd` (a future day — day-of actions only).
 */
export async function advanceMyVisit(input: AdvanceMyVisitInput): Promise<WorkOrderVisitRow> {
  const { organizationId, userId, visitId, to, clientDayEnd } = input
  const visit = await loadOwnVisit(organizationId, userId, visitId)

  const allowed = ADVANCE_TRANSITIONS[visit.status] ?? []
  if (!allowed.includes(to)) {
    throw new BadRequestError(`Cannot advance visit from '${visit.status}' to '${to}'`)
  }

  if (FORWARD_TRANSITIONS.has(`${visit.status}->${to}`) && visit.startTime) {
    if (visit.startTime > clientDayEnd) {
      throw new BadRequestError('Visit is scheduled for a future day')
    }
  }

  return setVisitStatus({ organizationId, userId, visitId, status: to })
}

/** Input for {@link closeMyVisit}. */
export interface CloseMyVisitInput {
  organizationId: string
  userId: string
  visitId: string
  invoice: 'now' | 'later' | 'leave_open'
}

/** `closeMyVisit` result — the worker's "Invoice drafted ✓" confirmation (never amounts). */
export interface CloseMyVisitResult {
  invoiced: boolean
  invoiceError?: 'no_contact'
}

/**
 * Complete the signed-in worker's own visit via the close chooser (08 §1/§3): always marks the
 * visit `done`; `leave_open` suppresses the work-order roll-up (the visit still completes, the
 * job doesn't); `now` uses the allocation-backed per-visit command. Fixed-contract and
 * recurring-flat work remain office-controlled because completing a visit is not permission to
 * choose a progress amount or create a billing-period charge.
 */
export async function closeMyVisit(input: CloseMyVisitInput): Promise<CloseMyVisitResult> {
  const { organizationId, userId, visitId, invoice } = input
  await loadOwnVisit(organizationId, userId, visitId)

  const updated = await setVisitStatus({
    organizationId,
    userId,
    visitId,
    status: 'done',
    suppressRollUp: invoice === 'leave_open',
  })

  if (invoice !== 'now') return { invoiced: false }

  const billing = await computeWorkOrderBillingProjection({
    organizationId,
    userId,
    workOrderInstanceId: updated.workOrderId,
  })
  if (billing.basis !== 'per_visit') return { invoiced: false }
  const existingAllocation = await database.query.InvoiceVisitAllocation.findFirst({
    where: and(
      eq(schema.InvoiceVisitAllocation.organizationId, organizationId),
      eq(schema.InvoiceVisitAllocation.visitId, visitId),
      eq(schema.InvoiceVisitAllocation.kind, 'base'),
      eq(schema.InvoiceVisitAllocation.status, 'active')
    ),
    columns: { id: true },
  })
  if (existingAllocation) return { invoiced: true }

  try {
    await createVisitInvoice({
      organizationId,
      userId,
      workOrderInstanceId: updated.workOrderId,
      visitIds: [visitId],
    })
    return { invoiced: true }
  } catch (error) {
    if (error instanceof BadRequestError) {
      return { invoiced: false, invoiceError: 'no_contact' }
    }
    throw error
  }
}
