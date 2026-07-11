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
import { parseRecordId, toRecordId } from '@auxx/types/resource'
import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm'
import { getOrgCache } from '../cache'
import { BadRequestError, ForbiddenError, NotFoundError } from '../errors'
import { extractFieldValueScalar } from '../field-values'
import { createInvoiceFromWorkOrder, listUninvoicedLines } from '../money/gather'
import { UnifiedCrudHandler } from '../resources/crud'
import type { VisitStatus } from './types'
import { setVisitStatus } from './visit-mutations'

type WorkOrderVisitRow = typeof schema.WorkOrderVisit.$inferSelect

/** Unwrap a `getFieldValues()` map entry — takes the first value if array-returned. */
function firstTyped(
  entry: TypedFieldValue | TypedFieldValue[] | undefined
): TypedFieldValue | undefined {
  if (!entry) return undefined
  return Array.isArray(entry) ? entry[0] : entry
}

/** Single-line rendering of an `AddressStruct` JSON value — null when every part is empty. */
function formatAddress(value: Record<string, unknown>): string | null {
  const part = (key: string) => (typeof value[key] === 'string' ? (value[key] as string) : '')
  const line1 = [part('street1'), part('street2')].filter(Boolean).join(' ')
  const line2 = [part('city'), part('state'), part('zipCode')].filter(Boolean).join(', ')
  const parts = [line1, line2, part('country')].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : null
}

/**
 * Load a visit and enforce the assignee guard (08 §6) — a worker touches only their own
 * visits. Shared by every worker-scoped mutation/read below except `listMyVisits`, which
 * filters by `assigneeUserId` in the query itself.
 *
 * @throws {NotFoundError} when the visit doesn't exist in this org.
 * @throws {ForbiddenError} when the visit isn't assigned to `userId`.
 */
async function loadOwnVisit(
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
 * Resolve display name + number for a bounded set of work orders — one narrow `FieldValue`
 * query filtered to that set (the `board.ts` `getSlimWorkOrderProjections` pattern, trimmed to
 * the single field this list needs).
 */
async function getWorkOrderTitles(
  organizationId: string,
  workOrderIds: string[]
): Promise<Map<string, WorkOrderTitle>> {
  const result = new Map<string, WorkOrderTitle>()
  if (workOrderIds.length === 0) return result

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
      .bySystemAttributes(['work_order_number'] as const),
  ])

  const numberByWorkOrder = new Map<string, string | null>()
  if (cf.work_order_number) {
    const values = await database
      .select()
      .from(schema.FieldValue)
      .where(
        and(
          inArray(schema.FieldValue.entityId, workOrderIds),
          eq(schema.FieldValue.fieldId, cf.work_order_number.id)
        )
      )
    for (const value of values) {
      numberByWorkOrder.set(value.entityId, extractFieldValueScalar(value) as string | null)
    }
  }

  for (const instance of instances) {
    result.set(instance.id, {
      id: instance.id,
      displayName: instance.displayName,
      number: numberByWorkOrder.get(instance.id) ?? null,
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
  const titles = await getWorkOrderTitles(organizationId, workOrderIds)

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

  const lines: MyVisitDetailLine[] = []
  for (const lineInstanceId of lineInstanceIds) {
    const lineRecordId = toRecordId('line_item', lineInstanceId)
    const lineValues = await handler.getFieldValues(lineRecordId, lineFieldIds)
    const lget = (f?: { id: string }) => (f ? firstTyped(lineValues.get(f.id)) : undefined)

    const nameTyped = lget(lineCf.line_item_name)
    const lineDescriptionTyped = lget(lineCf.line_item_description)
    const qtyTyped = lget(lineCf.line_item_qty)

    lines.push({
      name: nameTyped ? (extractValue(nameTyped) as string) : '',
      quantity: qtyTyped ? (extractValue(qtyTyped) as number) : 1,
      description: lineDescriptionTyped
        ? (extractValue(lineDescriptionTyped) as string)
        : undefined,
    })
  }

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

/** Input for {@link advanceMyVisit}. */
export interface AdvanceMyVisitInput {
  organizationId: string
  userId: string
  visitId: string
  to: VisitStatus
}

/**
 * Advance (or undo) the signed-in worker's own visit through the one-thumb status button (08
 * §1/§3): forward `scheduled→en_route`, `en_route→on_site`; undo `en_route→scheduled`,
 * `on_site→en_route`. Delegates to `setVisitStatus` so mirror/roll-up/broadcast/record-rules
 * fire identically to the board's admin path.
 *
 * @throws {BadRequestError} for any transition outside the allowed set.
 */
export async function advanceMyVisit(input: AdvanceMyVisitInput): Promise<WorkOrderVisitRow> {
  const { organizationId, userId, visitId, to } = input
  const visit = await loadOwnVisit(organizationId, userId, visitId)

  const allowed = ADVANCE_TRANSITIONS[visit.status] ?? []
  if (!allowed.includes(to)) {
    throw new BadRequestError(`Cannot advance visit from '${visit.status}' to '${to}'`)
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
 * job doesn't); `now` additionally gathers every uninvoiced line onto a draft invoice
 * (MI1's `listUninvoicedLines` → `createInvoiceFromWorkOrder`) — a no-op success when the MI2
 * per-visit auto-draft already consumed the lines, and a soft `no_contact` result (never a
 * thrown error) when the job has no contact yet.
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

  const lines = await listUninvoicedLines({
    organizationId,
    userId,
    workOrderInstanceId: updated.workOrderId,
  })
  if (lines.length === 0) return { invoiced: true } // per_visit auto-draft already consumed them

  try {
    await createInvoiceFromWorkOrder({
      organizationId,
      userId,
      workOrderInstanceId: updated.workOrderId,
      lineInstanceIds: lines.map((line) => line.instanceId),
    })
    return { invoiced: true }
  } catch (error) {
    if (error instanceof BadRequestError) {
      return { invoiced: false, invoiceError: 'no_contact' }
    }
    throw error
  }
}
