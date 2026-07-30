// packages/lib/src/money/billing-projection.ts

import { randomUUID } from 'node:crypto'
import { type Database, database, schema } from '@auxx/database'
import type { TypedFieldValue } from '@auxx/types'
import { extractValue } from '@auxx/types'
import { parseRecordId, toRecordId } from '@auxx/types/resource'
import { fromZonedTime } from 'date-fns-tz'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { getEntityDefIdResolver, getOrgCache } from '../cache'
import { FieldValueService } from '../field-values/field-value-service'
import { expandOccurrences, RECURRENCE_HORIZON_DAYS, type RecurrencePattern } from '../recurrence'
import { UnifiedCrudHandler } from '../resources/crud'
import { isBillingConfigurationCompatible } from './billing-config'
import type {
  InvoiceBillingKind,
  WorkOrderBillingBasis,
  WorkOrderBillingProjection,
  WorkOrderInvoiceTiming,
} from './types'

type WorkOrderVisitDateRow = { id: string; occurrenceDate: string | null; startTime: Date | null }

/** Local calendar date (`YYYY-MM-DD`, local midnight in `timezone`) as a UTC instant — same
 * local-date/UTC-instant convention used by `recurrence/expand.ts` and `auto-invoice.ts`'s
 * materializer. Duplicated locally (not imported/exported) because it's a tiny pure helper and
 * the M2c/MI2 files it mirrors are a pattern to copy, not a shared dependency. */
function localDateStartUtc(dateIso: string, timezone: string): Date {
  const parts = dateIso.split('-')
  const year = Number(parts[0])
  const month = Number(parts[1])
  const day = Number(parts[2])
  return fromZonedTime(new Date(year, month - 1, day), timezone)
}

/** `WorkOrderVisit.occurrenceDate` else the local date part of `startTime` — the same
 * fallback used throughout money/gather.ts and billing-state.ts. */
function visitDateKey(visit: WorkOrderVisitDateRow): string | undefined {
  return visit.occurrenceDate ?? visit.startTime?.toISOString().split('T')[0]
}

const WORK_ORDER_PROJECTION_ATTRS = [
  'work_order_billing_state',
  'work_order_billing_amount',
  'work_order_amount_drafted',
  'work_order_amount_invoiced',
  'work_order_uninvoiced_amount',
  'work_order_balance_due',
  'work_order_invoice_count',
  'work_order_next_invoice_date',
  'work_order_billing_revision',
] as const

const INVOICE_PROJECTION_ATTRS = [
  'invoice_billing_kind',
  'invoice_service_period_start',
  'invoice_service_period_end',
  'invoice_visit_count',
  'invoice_progress_percent',
  'invoice_installment_name',
] as const

const CONTACT_PROJECTION_ATTRS = [
  'contact_balance_due',
  'contact_uninvoiced_amount',
  'contact_billing_revision',
] as const

const BILLING_PROJECTION_BYPASS = new Set([
  ...WORK_ORDER_PROJECTION_ATTRS,
  ...INVOICE_PROJECTION_ATTRS,
  ...CONTACT_PROJECTION_ATTRS,
])

function firstTyped(
  entry: TypedFieldValue | TypedFieldValue[] | undefined
): TypedFieldValue | undefined {
  return Array.isArray(entry) ? entry[0] : entry
}

function extractFieldValue(
  values: Map<string, TypedFieldValue | TypedFieldValue[]>,
  field?: { id: string } | null
): unknown {
  const typed = field ? firstTyped(values.get(field.id)) : undefined
  return typed ? extractValue(typed) : undefined
}

function asNumber(value: unknown): number {
  const number = Number(value ?? 0)
  return Number.isFinite(number) ? number : 0
}

async function readSystemValues(
  handler: UnifiedCrudHandler,
  organizationId: string,
  recordId: ReturnType<typeof toRecordId>,
  attributes: readonly string[]
) {
  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(attributes as never)
  const fieldIds = Object.values(fields as Record<string, { id: string } | null>)
    .filter(Boolean)
    .map((field) => field!.id)
  const values = await handler.getFieldValues(recordId, fieldIds)
  const result = new Map<string, unknown>()
  for (const attribute of attributes) {
    result.set(
      attribute,
      extractFieldValue(values, (fields as Record<string, { id: string } | null>)[attribute])
    )
  }
  return result
}

/** Exported so `billing-state.ts` and `billing-commands.ts` can replace their per-row
 * `handler.getFieldValues` loops with one batched read (plan §4.7 fixed query counts). */
export async function batchReadSystemValues(input: {
  service: FieldValueService
  organizationId: string
  entityType: 'line_item' | 'invoice' | 'work_order'
  entityInstanceIds: string[]
  attributes: readonly string[]
}): Promise<Map<string, Map<string, unknown>>> {
  const result = new Map<string, Map<string, unknown>>()
  if (input.entityInstanceIds.length === 0) return result
  const fields = (await getOrgCache()
    .from(input.organizationId, 'customFields')
    .bySystemAttributes(input.attributes as never)) as Record<string, { id: string } | null>
  const fieldRefs = input.attributes
    .map((attribute) => fields[attribute]?.id)
    .filter(Boolean)
    .map((fieldId) => `${input.entityType}:${fieldId}` as never)
  const batch = await input.service.batchGetValues({
    recordIds: input.entityInstanceIds.map((id) => toRecordId(input.entityType, id)),
    fieldReferences: fieldRefs,
  })
  const attributeByFieldId = new Map(
    input.attributes.map((attribute) => [fields[attribute]?.id, attribute])
  )
  for (const row of batch.values) {
    const instanceId = parseRecordId(row.recordId).entityInstanceId
    const fieldRef = String(row.fieldRef)
    const fieldId = fieldRef.slice(fieldRef.indexOf(':') + 1)
    const attribute = attributeByFieldId.get(fieldId)
    if (!attribute) continue
    const typed = firstTyped(row.value ?? undefined)
    const values = result.get(instanceId) ?? new Map<string, unknown>()
    values.set(attribute, typed ? extractValue(typed) : undefined)
    result.set(instanceId, values)
  }
  return result
}

async function listWorkOrderSourceLines(input: {
  handler: UnifiedCrudHandler
  db: Database
  organizationId: string
  workOrderId: string
}) {
  const { ids } = await input.handler.listFiltered({
    entityDefinitionId: 'line_item',
    filters: [
      {
        id: 'billing-work-order-lines',
        logicalOperator: 'AND',
        conditions: [
          {
            id: 'billing-work-order-lines-parent',
            fieldId: 'line_item:workOrder',
            operator: 'is',
            value: toRecordId('work_order', input.workOrderId),
          },
        ],
      },
    ],
    limit: 1000,
  })
  const valuesById = await batchReadSystemValues({
    service: new FieldValueService(input.organizationId, undefined, input.db),
    organizationId: input.organizationId,
    entityType: 'line_item',
    entityInstanceIds: ids,
    attributes: ['line_item_line_total', 'line_item_visit_id'],
  })
  return ids.map((id) => {
    const values = valuesById.get(id) ?? new Map<string, unknown>()
    return {
      id,
      amount: asNumber(values.get('line_item_line_total')),
      visitId: (values.get('line_item_visit_id') as string | undefined) || undefined,
    }
  })
}

/** Compute authoritative work-order billing state without writing projected entity fields. */
export async function computeWorkOrderBillingProjection(input: {
  db?: Database
  organizationId: string
  userId: string
  workOrderInstanceId: string
}): Promise<WorkOrderBillingProjection> {
  const db = input.db ?? database
  const handler = new UnifiedCrudHandler(input.organizationId, input.userId, db)
  const workOrderValues = await readSystemValues(
    handler,
    input.organizationId,
    toRecordId('work_order', input.workOrderInstanceId),
    ['work_order_pricing_model', 'work_order_invoice_timing', 'work_order_status']
  )
  const basis =
    (workOrderValues.get('work_order_pricing_model') as WorkOrderBillingBasis | undefined) ??
    'per_visit'
  const timing =
    (workOrderValues.get('work_order_invoice_timing') as WorkOrderInvoiceTiming | undefined) ??
    'as_needed'
  const workOrderStatus = workOrderValues.get('work_order_status') as string | undefined
  const lines = await listWorkOrderSourceLines({
    handler,
    db,
    organizationId: input.organizationId,
    workOrderId: input.workOrderInstanceId,
  })
  const templateLines = lines.filter((line) => !line.visitId)
  const billingAmount = templateLines.reduce((total, line) => total + line.amount, 0)

  const [
    lineAllocations,
    visitAllocations,
    visits,
    installments,
    linkedInvoices,
    scheduleRule,
    scheduleAllocations,
  ] = await Promise.all([
    db.query.InvoiceLineAllocation.findMany({
      where: and(
        eq(schema.InvoiceLineAllocation.organizationId, input.organizationId),
        eq(schema.InvoiceLineAllocation.workOrderId, input.workOrderInstanceId),
        eq(schema.InvoiceLineAllocation.status, 'active')
      ),
    }),
    db.query.InvoiceVisitAllocation.findMany({
      where: and(
        eq(schema.InvoiceVisitAllocation.organizationId, input.organizationId),
        eq(schema.InvoiceVisitAllocation.workOrderId, input.workOrderInstanceId),
        eq(schema.InvoiceVisitAllocation.status, 'active'),
        eq(schema.InvoiceVisitAllocation.kind, 'base')
      ),
    }),
    db.query.WorkOrderVisit.findMany({
      where: and(
        eq(schema.WorkOrderVisit.organizationId, input.organizationId),
        eq(schema.WorkOrderVisit.workOrderId, input.workOrderInstanceId),
        eq(schema.WorkOrderVisit.status, 'done')
      ),
      columns: { id: true, occurrenceDate: true, startTime: true },
    }),
    db.query.WorkOrderBillingInstallment.findMany({
      where: and(
        eq(schema.WorkOrderBillingInstallment.organizationId, input.organizationId),
        eq(schema.WorkOrderBillingInstallment.workOrderId, input.workOrderInstanceId)
      ),
      orderBy: [asc(schema.WorkOrderBillingInstallment.sortOrder)],
    }),
    handler.listFiltered({
      entityDefinitionId: 'invoice',
      filters: [
        {
          id: 'billing-linked-invoices',
          logicalOperator: 'AND',
          conditions: [
            {
              id: 'billing-linked-invoices-parent',
              fieldId: 'invoice:workOrder',
              operator: 'is',
              value: toRecordId('work_order', input.workOrderInstanceId),
            },
          ],
        },
      ],
      limit: 1000,
    }),
    // Recurring/per-visit custom-schedule visibility (plan §4.1/§5.3): the `invoice_drafts`
    // RecurrenceRule is the schedule cursor's home, not a source-line/installment table.
    db.query.RecurrenceRule.findFirst({
      where: and(
        eq(schema.RecurrenceRule.organizationId, input.organizationId),
        eq(schema.RecurrenceRule.subjectType, 'invoice_drafts'),
        eq(schema.RecurrenceRule.subjectId, input.workOrderInstanceId)
      ),
    }),
    db.query.InvoiceScheduleAllocation.findMany({
      where: and(
        eq(schema.InvoiceScheduleAllocation.organizationId, input.organizationId),
        eq(schema.InvoiceScheduleAllocation.workOrderId, input.workOrderInstanceId),
        eq(schema.InvoiceScheduleAllocation.status, 'active')
      ),
      columns: { occurrenceDate: true },
    }),
  ])

  let amountDrafted = 0
  let amountInvoiced = 0
  let balanceDue = 0
  let draftCount = 0
  let issuedCount = 0
  let paidCount = 0
  let invoiceCount = 0
  const invoiceValuesById = await batchReadSystemValues({
    service: new FieldValueService(input.organizationId, input.userId, db),
    organizationId: input.organizationId,
    entityType: 'invoice',
    entityInstanceIds: linkedInvoices.ids,
    attributes: ['invoice_status', 'invoice_total', 'invoice_balance'],
  })
  for (const invoiceId of linkedInvoices.ids) {
    const values = invoiceValuesById.get(invoiceId) ?? new Map<string, unknown>()
    const status = values.get('invoice_status') as string | undefined
    if (status === 'void') continue
    const total = asNumber(values.get('invoice_total'))
    invoiceCount++
    if (status === 'draft') {
      draftCount++
      amountDrafted += total
    } else {
      issuedCount++
      amountInvoiced += total
      balanceDue += asNumber(values.get('invoice_balance'))
      if (status === 'paid') paidCount++
    }
  }

  const allocatedBySource = new Map<string, number>()
  for (const allocation of lineAllocations) {
    allocatedBySource.set(
      allocation.sourceLineItemId,
      (allocatedBySource.get(allocation.sourceLineItemId) ?? 0) + allocation.amount
    )
  }
  const allocatedVisitIds = new Set(visitAllocations.map((row) => row.visitId))
  let attentionReason: string | undefined
  if (!isBillingConfigurationCompatible(basis, timing)) {
    attentionReason = 'Billing basis and invoice timing are incompatible'
  }
  for (const line of templateLines) {
    if ((allocatedBySource.get(line.id) ?? 0) > line.amount && basis === 'fixed_contract') {
      attentionReason = 'Contract source value is below its active allocations'
      break
    }
  }

  // Custom-schedule occurrence visibility (plan §4.1/§5.3): expand the `invoice_drafts`
  // RecurrenceRule bounded to [materializedUntil ?? anchor, now + horizon] — the same cursor
  // convention `materializeInvoiceDrafts` uses, so this never rescans from account creation and
  // never treats an occurrence the sweep hasn't reached yet as "due". `dueOccurrenceDate` is the
  // earliest past/current occurrence with no active `InvoiceScheduleAllocation` (recurring_flat
  // idempotency unit); `cutoffOccurrenceDate` is the latest past/current occurrence regardless
  // of allocation (per_visit has no occurrence-identity allocation — the schedule only gates the
  // visit cutoff window); `nextScheduleOccurrenceDate` is the earliest future occurrence.
  let dueOccurrenceDate: string | null = null
  let cutoffOccurrenceDate: string | null = null
  let nextScheduleOccurrenceDate: string | null = null
  if (scheduleRule) {
    const now = new Date()
    const boundary =
      scheduleRule.materializedUntil ??
      localDateStartUtc(scheduleRule.anchor, scheduleRule.timezone)
    const horizonEnd = new Date(now.getTime() + RECURRENCE_HORIZON_DAYS * 24 * 60 * 60 * 1000)
    const occurrences =
      boundary <= horizonEnd
        ? expandOccurrences(scheduleRule.pattern as unknown as RecurrencePattern, {
            anchor: scheduleRule.anchor,
            timezone: scheduleRule.timezone,
            from: boundary,
            to: horizonEnd,
            startMinute: 0,
          })
        : []
    const pastDue = occurrences.filter((occurrence) => occurrence.start <= now)
    const future = occurrences.filter((occurrence) => occurrence.start > now)
    const allocatedOccurrenceDates = new Set(scheduleAllocations.map((row) => row.occurrenceDate))
    dueOccurrenceDate =
      pastDue.find((occurrence) => !allocatedOccurrenceDates.has(occurrence.occurrenceDate))
        ?.occurrenceDate ?? null
    cutoffOccurrenceDate = pastDue.at(-1)?.occurrenceDate ?? null
    nextScheduleOccurrenceDate = future.at(0)?.occurrenceDate ?? null
  }

  let uninvoicedAmount = 0
  if (basis === 'fixed_contract') {
    uninvoicedAmount = templateLines.reduce(
      (total, line) => total + Math.max(0, line.amount - (allocatedBySource.get(line.id) ?? 0)),
      0
    )
  } else if (basis === 'per_visit') {
    // Plan money/19 §A: readiness counts performed work only. `visits` is already the WO's
    // DONE visits, so extras pinned to scheduled/canceled/dangling visit ids are excluded —
    // they stay deliberately billable through `createExtraWorkInvoice`, but a planned extra
    // is not a receivable and must not flip the badge to ready_to_invoice.
    const doneVisitIds = new Set(visits.map((visit) => visit.id))
    const eligibleVisitCount = visits.filter((visit) => !allocatedVisitIds.has(visit.id)).length
    const additions = lines
      .filter(
        (line) => line.visitId && doneVisitIds.has(line.visitId) && !allocatedBySource.has(line.id)
      )
      .reduce((total, line) => total + line.amount, 0)
    uninvoicedAmount = eligibleVisitCount * billingAmount + additions
  } else if (basis === 'recurring_flat') {
    if (timing === 'as_needed') {
      uninvoicedAmount = billingAmount
    } else if (timing === 'custom_schedule' && dueOccurrenceDate) {
      // Currently eligible only — a future scheduled occurrence is not hypothetical revenue
      // (plan §4.1), so it does not count until it's actually due.
      uninvoicedAmount = billingAmount
    }
  }

  const pendingInstallment = installments.find((row) => row.status === 'pending')
  if (pendingInstallment && basis === 'fixed_contract') {
    uninvoicedAmount = Math.max(uninvoicedAmount, pendingInstallment.amount)
  }
  const scheduleNextInvoiceDate =
    timing === 'custom_schedule' && (basis === 'per_visit' || basis === 'recurring_flat')
      ? (dueOccurrenceDate ?? nextScheduleOccurrenceDate)
      : null
  const nextInvoiceDate =
    installments.find((row) => row.status === 'pending' && row.scheduledDate)?.scheduledDate ??
    scheduleNextInvoiceDate
  const perVisitScheduleReady = (() => {
    if (timing !== 'custom_schedule' || basis !== 'per_visit' || cutoffOccurrenceDate === null) {
      return false
    }
    const cutoff = cutoffOccurrenceDate
    return visits.some((visit) => {
      if (allocatedVisitIds.has(visit.id)) return false
      const dateKey = visitDateKey(visit)
      return dateKey !== undefined && dateKey <= cutoff
    })
  })()
  const timingReady =
    timing === 'as_needed' ||
    (timing === 'on_completion' && ['completed', 'ended'].includes(workOrderStatus ?? '')) ||
    (timing === 'per_visit_completed' && basis === 'per_visit') ||
    Boolean(pendingInstallment) ||
    (timing === 'custom_schedule' && basis === 'recurring_flat' && Boolean(dueOccurrenceDate)) ||
    perVisitScheduleReady
  const ready = uninvoicedAmount > 0 && timingReady
  const state = attentionReason
    ? 'attention_required'
    : ready
      ? 'ready_to_invoice'
      : draftCount > 0
        ? 'draft_pending'
        : balanceDue > 0
          ? 'awaiting_payment'
          : nextInvoiceDate
            ? 'scheduled'
            : invoiceCount > 0 && issuedCount === paidCount
              ? 'paid'
              : 'not_ready'

  return {
    basis,
    timing,
    state,
    billingAmount,
    amountDrafted,
    amountInvoiced,
    uninvoicedAmount,
    balanceDue,
    invoiceCount,
    nextInvoiceDate,
    attentionReason,
  }
}

async function writeChangedProjection(input: {
  organizationId: string
  userId: string
  entityType: 'work_order' | 'invoice' | 'contact'
  entityInstanceId: string
  values: Record<string, unknown>
}): Promise<boolean> {
  const handler = new UnifiedCrudHandler(input.organizationId, input.userId)
  const recordId = toRecordId(input.entityType, input.entityInstanceId)
  const current = await readSystemValues(
    handler,
    input.organizationId,
    recordId,
    Object.keys(input.values)
  )
  const writes = Object.entries(input.values)
    .filter(([attribute, value]) => current.get(attribute) !== value)
    .map(([fieldId, value]) => ({ fieldId, value }))
  if (writes.length === 0) return false
  const resolveDefId = await getEntityDefIdResolver(input.organizationId)
  const service = new FieldValueService(input.organizationId, input.userId, database, undefined, {
    bypassFieldGuards: BILLING_PROJECTION_BYPASS,
  })
  await service.setValuesForEntity({
    recordId: toRecordId(resolveDefId(input.entityType), input.entityInstanceId),
    values: writes,
    publishEvents: true,
  })
  return true
}

async function projectionHasChanges(input: {
  organizationId: string
  userId: string
  entityType: 'work_order' | 'invoice' | 'contact'
  entityInstanceId: string
  values: Record<string, unknown>
}): Promise<boolean> {
  const handler = new UnifiedCrudHandler(input.organizationId, input.userId)
  const current = await readSystemValues(
    handler,
    input.organizationId,
    toRecordId(input.entityType, input.entityInstanceId),
    Object.keys(input.values)
  )
  return Object.entries(input.values).some(([attribute, value]) => current.get(attribute) !== value)
}

/** Synchronize allocation truth onto work-order projection fields. */
export async function syncWorkOrderBillingProjection(input: {
  db?: Database
  organizationId: string
  userId: string
  workOrderInstanceId: string
  bumpRevision?: boolean
}): Promise<WorkOrderBillingProjection> {
  const projection = await computeWorkOrderBillingProjection(input)
  const values: Record<string, unknown> = {
    work_order_billing_state: projection.state,
    work_order_billing_amount: projection.billingAmount,
    work_order_amount_drafted: projection.amountDrafted,
    work_order_amount_invoiced: projection.amountInvoiced,
    work_order_uninvoiced_amount: projection.uninvoicedAmount,
    work_order_balance_due: projection.balanceDue,
    work_order_invoice_count: projection.invoiceCount,
    work_order_next_invoice_date: projection.nextInvoiceDate,
  }
  const changed = await projectionHasChanges({
    organizationId: input.organizationId,
    userId: input.userId,
    entityType: 'work_order',
    entityInstanceId: input.workOrderInstanceId,
    values,
  })
  if (changed && input.bumpRevision !== false) values.work_order_billing_revision = randomUUID()
  const wrote = await writeChangedProjection({
    organizationId: input.organizationId,
    userId: input.userId,
    entityType: 'work_order',
    entityInstanceId: input.workOrderInstanceId,
    values,
  })
  // Cascade to the contact aggregate only when the work-order projection actually changed —
  // most sweep/hook triggers are no-ops, and `contact_uninvoiced_amount`/`contact_balance_due`
  // can only have moved if a linked work order's own projection moved first (plan §4.4 "a
  // projection repair that finds no changes does not create event churn").
  if (wrote) {
    const handler = new UnifiedCrudHandler(input.organizationId, input.userId)
    const workOrder = await readSystemValues(
      handler,
      input.organizationId,
      toRecordId('work_order', input.workOrderInstanceId),
      ['work_order_contact']
    )
    const contactValue = workOrder.get('work_order_contact')
    if (typeof contactValue === 'string' && contactValue.includes(':')) {
      await syncContactBillingProjection({
        organizationId: input.organizationId,
        userId: input.userId,
        contactInstanceId: parseRecordId(contactValue as never).entityInstanceId,
      })
    }
  }
  return projection
}

/** Rebuild allocation-derived context fields on an invoice. */
export async function syncInvoiceBillingProjection(input: {
  db?: Database
  organizationId: string
  userId: string
  invoiceInstanceId: string
}): Promise<void> {
  const db = input.db ?? database
  const [lines, visits, schedule, installment] = await Promise.all([
    db.query.InvoiceLineAllocation.findMany({
      where: and(
        eq(schema.InvoiceLineAllocation.organizationId, input.organizationId),
        eq(schema.InvoiceLineAllocation.invoiceId, input.invoiceInstanceId),
        eq(schema.InvoiceLineAllocation.status, 'active')
      ),
    }),
    db.query.InvoiceVisitAllocation.findMany({
      where: and(
        eq(schema.InvoiceVisitAllocation.organizationId, input.organizationId),
        eq(schema.InvoiceVisitAllocation.invoiceId, input.invoiceInstanceId),
        eq(schema.InvoiceVisitAllocation.status, 'active')
      ),
    }),
    db.query.InvoiceScheduleAllocation.findFirst({
      where: and(
        eq(schema.InvoiceScheduleAllocation.organizationId, input.organizationId),
        eq(schema.InvoiceScheduleAllocation.invoiceId, input.invoiceInstanceId),
        eq(schema.InvoiceScheduleAllocation.status, 'active')
      ),
    }),
    db.query.WorkOrderBillingInstallment.findFirst({
      where: and(
        eq(schema.WorkOrderBillingInstallment.organizationId, input.organizationId),
        eq(schema.WorkOrderBillingInstallment.invoiceId, input.invoiceInstanceId)
      ),
    }),
  ])
  let kind: InvoiceBillingKind = 'standalone'
  if (installment) kind = 'progress'
  else if (schedule) kind = 'recurring_flat'
  else if (visits.some((row) => row.kind === 'base')) kind = 'visit'
  else if (visits.length > 0 || lines.some((row) => row.kind === 'visit_addition'))
    kind = 'extra_work'
  else if (lines.some((row) => row.kind === 'contract')) kind = 'full_contract'

  const visitDates = visits.length
    ? await db.query.WorkOrderVisit.findMany({
        where: inArray(
          schema.WorkOrderVisit.id,
          visits.map((visit) => visit.visitId)
        ),
        columns: { occurrenceDate: true, startTime: true },
      })
    : []
  const dates = visitDates
    .map((visit) => visit.occurrenceDate ?? visit.startTime?.toISOString().split('T')[0])
    .filter(Boolean) as string[]
  if (schedule) dates.push(schedule.occurrenceDate)
  dates.sort()

  let progressPercent: number | null = null
  if (installment?.percentageBasisPoints) {
    progressPercent = installment.percentageBasisPoints / 100
  }
  await writeChangedProjection({
    organizationId: input.organizationId,
    userId: input.userId,
    entityType: 'invoice',
    entityInstanceId: input.invoiceInstanceId,
    values: {
      invoice_billing_kind: kind,
      invoice_service_period_start: dates.at(0) ?? null,
      invoice_service_period_end: dates.at(-1) ?? null,
      invoice_visit_count: new Set(visits.map((visit) => visit.visitId)).size,
      invoice_progress_percent: progressPercent,
      invoice_installment_name: installment?.name ?? null,
    },
  })

  let workOrderId =
    lines.at(0)?.workOrderId ?? visits.at(0)?.workOrderId ?? schedule?.workOrderId ?? null
  if (!workOrderId) {
    // Releasing the invoice's LAST active allocation leaves no row to name the work order,
    // but that release is exactly when the work order's drafted/uninvoiced amounts change —
    // fall back to the invoice's own work-order relation.
    const handler = new UnifiedCrudHandler(input.organizationId, input.userId, db)
    const invoiceValues = await readSystemValues(
      handler,
      input.organizationId,
      toRecordId('invoice', input.invoiceInstanceId),
      ['invoice_work_order']
    )
    const relation = invoiceValues.get('invoice_work_order')
    if (typeof relation === 'string' && relation.includes(':')) {
      workOrderId = parseRecordId(relation as never).entityInstanceId
    }
  }
  if (workOrderId) {
    await syncWorkOrderBillingProjection({
      organizationId: input.organizationId,
      userId: input.userId,
      workOrderInstanceId: workOrderId,
    })
  }
}

/** Synchronize customer-level billing totals from linked work orders and invoices. */
export async function syncContactBillingProjection(input: {
  db?: Database
  organizationId: string
  userId: string
  contactInstanceId: string
}): Promise<void> {
  const db = input.db ?? database
  const handler = new UnifiedCrudHandler(input.organizationId, input.userId, db)
  const contactRecordId = toRecordId('contact', input.contactInstanceId)
  const [workOrders, invoices] = await Promise.all([
    handler.listFiltered({
      entityDefinitionId: 'work_order',
      filters: [
        {
          id: 'contact-billing-work-orders',
          logicalOperator: 'AND',
          conditions: [
            {
              id: 'contact-billing-work-orders-contact',
              fieldId: 'work_order:contact',
              operator: 'is',
              value: contactRecordId,
            },
          ],
        },
      ],
      limit: 1000,
    }),
    handler.listFiltered({
      entityDefinitionId: 'invoice',
      filters: [
        {
          id: 'contact-billing-invoices',
          logicalOperator: 'AND',
          conditions: [
            {
              id: 'contact-billing-invoices-contact',
              fieldId: 'invoice:contact',
              operator: 'is',
              value: contactRecordId,
            },
          ],
        },
      ],
      limit: 1000,
    }),
  ])
  let uninvoicedAmount = 0
  for (const workOrderInstanceId of workOrders.ids) {
    const projection = await computeWorkOrderBillingProjection({
      db,
      organizationId: input.organizationId,
      userId: input.userId,
      workOrderInstanceId,
    })
    uninvoicedAmount += projection.uninvoicedAmount
  }
  let balanceDue = 0
  for (const invoiceInstanceId of invoices.ids) {
    const values = await readSystemValues(
      handler,
      input.organizationId,
      toRecordId('invoice', invoiceInstanceId),
      ['invoice_status', 'invoice_balance']
    )
    if (values.get('invoice_status') !== 'void') {
      balanceDue += asNumber(values.get('invoice_balance'))
    }
  }
  const values = {
    contact_balance_due: balanceDue,
    contact_uninvoiced_amount: uninvoicedAmount,
  }
  const changed = await projectionHasChanges({
    organizationId: input.organizationId,
    userId: input.userId,
    entityType: 'contact',
    entityInstanceId: input.contactInstanceId,
    values,
  })
  await writeChangedProjection({
    organizationId: input.organizationId,
    userId: input.userId,
    entityType: 'contact',
    entityInstanceId: input.contactInstanceId,
    values: changed ? { ...values, contact_billing_revision: randomUUID() } : values,
  })
}

/** Cursor-based, idempotent repair of work-order billing projections for one organization. */
export async function rebuildOrganizationBillingProjections(input: {
  organizationId: string
  userId: string
  cursor?: string
  limit?: number
}): Promise<{ repaired: number; nextCursor?: string }> {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500)
  const resolveDefId = await getEntityDefIdResolver(input.organizationId)
  const rows = await database.query.EntityInstance.findMany({
    where: and(
      eq(schema.EntityInstance.organizationId, input.organizationId),
      eq(schema.EntityInstance.entityDefinitionId, resolveDefId('work_order')),
      input.cursor ? sql`${schema.EntityInstance.id} > ${input.cursor}` : undefined
    ),
    orderBy: [asc(schema.EntityInstance.id)],
    limit: limit + 1,
    columns: { id: true },
  })
  const page = rows.slice(0, limit)
  for (const row of page) {
    await syncWorkOrderBillingProjection({
      organizationId: input.organizationId,
      userId: input.userId,
      workOrderInstanceId: row.id,
      bumpRevision: false,
    })
  }
  return {
    repaired: page.length,
    nextCursor: rows.length > limit ? page.at(-1)?.id : undefined,
  }
}
