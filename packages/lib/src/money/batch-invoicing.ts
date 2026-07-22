// packages/lib/src/money/batch-invoicing.ts

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { RecordId } from '@auxx/types/resource'
import { parseRecordId, toRecordId } from '@auxx/types/resource'
import { and, eq, gte, inArray, lte, ne } from 'drizzle-orm'
import type { ConditionGroup } from '../conditions'
import { FieldValueService } from '../field-values/field-value-service'
import { expandOccurrences, type RecurrencePattern } from '../recurrence'
import { UnifiedCrudHandler } from '../resources/crud'
import { createRecurringCharge, createVisitInvoice } from './billing-commands'
import { batchReadSystemValues, computeWorkOrderBillingProjection } from './billing-projection'
import { listUninvoicedLines } from './gather'
import type { WorkOrderBillingBasis } from './types'

const logger = createScopedLogger('money:batch-invoicing')

/** Wall-clock instant window a batch operates over — the caller's concern to compute (e.g. an
 * org-timezone month preset); this module takes `from`/`to` verbatim. */
export interface InvoiceBatchRange {
  from: Date
  to: Date
}

/** One work order's outcome in a batch preview — billable (`amount`/`visitCount` or
 * `occurrenceCount` set) or excluded (`excludedReason` set, `amount` is `0`). */
export interface InvoiceBatchRow {
  workOrderRecordId: RecordId
  contactName: string | null
  basis: WorkOrderBillingBasis
  visitCount?: number
  occurrenceCount?: number
  amount: number
  excludedReason?: string
}

export interface PreviewInvoiceBatchInput {
  organizationId: string
  userId: string
  range: InvoiceBatchRange
  filters: ConditionGroup[]
}

export interface PreviewInvoiceBatchResult {
  rows: InvoiceBatchRow[]
  totalCount: number
  totalAmount: number
}

export interface RunInvoiceBatchInput {
  organizationId: string
  userId: string
  range: InvoiceBatchRange
  workOrderRecordIds: RecordId[]
}

/** One work order's outcome in a batch run. `invoiceRecordId` is the last invoice created for
 * this work order; `invoiceRecordIds` carries every invoice created (`recurring_flat` can
 * produce more than one when several occurrences fall due in the same range). */
export interface InvoiceBatchItemResult {
  workOrderRecordId: RecordId
  ok: boolean
  invoiceRecordId?: RecordId
  invoiceRecordIds?: RecordId[]
  error?: string
}

export interface RunInvoiceBatchResult {
  results: InvoiceBatchItemResult[]
}

interface GatheredWorkOrder {
  workOrderInstanceId: string
  workOrderRecordId: RecordId
  contactName: string | null
  basis: WorkOrderBillingBasis
  amount: number
  visitCount?: number
  occurrenceCount?: number
  visitIds?: string[]
  occurrenceDates?: string[]
  excludedReason?: string
}

const FIXED_CONTRACT_EXCLUDED_REASON =
  'Fixed-contract billing is not supported by the batch — use the work order billing dialog'
const NO_SCHEDULE_EXCLUDED_REASON =
  'Configure a custom invoice schedule before batch billing this work order'
const NOTHING_DUE_ERROR = 'No billable visits or occurrences in this period'

function toPublicRow(item: GatheredWorkOrder): InvoiceBatchRow {
  return {
    workOrderRecordId: item.workOrderRecordId,
    contactName: item.contactName,
    basis: item.basis,
    visitCount: item.visitCount,
    occurrenceCount: item.occurrenceCount,
    amount: item.amount,
    excludedReason: item.excludedReason,
  }
}

/** Resolve work-order EntityInstance ids matching the caller's condition-system filters. */
async function resolveWorkOrderInstanceIds(input: {
  organizationId: string
  userId: string
  filters: ConditionGroup[]
}): Promise<string[]> {
  const handler = new UnifiedCrudHandler(input.organizationId, input.userId)
  const { ids, total } = await handler.listFiltered({
    entityDefinitionId: 'work_order',
    filters: input.filters,
    limit: 1000,
    mode: 'oneshot',
  })
  if (total > ids.length) {
    logger.warn('Invoice batch truncated to first 1000 matching work orders', {
      organizationId: input.organizationId,
      total,
    })
  }
  return ids
}

/** Contact display name per work order, batched (one field-value read, one name lookup). */
async function loadContactNames(input: {
  organizationId: string
  userId: string
  workOrderInstanceIds: string[]
}): Promise<Map<string, string | null>> {
  const contactValuesById = await batchReadSystemValues({
    service: new FieldValueService(input.organizationId, input.userId),
    organizationId: input.organizationId,
    entityType: 'work_order',
    entityInstanceIds: input.workOrderInstanceIds,
    attributes: ['work_order_contact'] as const,
  })
  const contactInstanceIdByWorkOrder = new Map<string, string>()
  const contactInstanceIds = new Set<string>()
  for (const workOrderInstanceId of input.workOrderInstanceIds) {
    const contactValue = contactValuesById.get(workOrderInstanceId)?.get('work_order_contact')
    if (typeof contactValue === 'string' && contactValue.includes(':')) {
      const { entityInstanceId } = parseRecordId(contactValue as RecordId)
      contactInstanceIdByWorkOrder.set(workOrderInstanceId, entityInstanceId)
      contactInstanceIds.add(entityInstanceId)
    }
  }
  const contactRows = contactInstanceIds.size
    ? await database
        .select({ id: schema.EntityInstance.id, displayName: schema.EntityInstance.displayName })
        .from(schema.EntityInstance)
        .where(inArray(schema.EntityInstance.id, [...contactInstanceIds]))
    : []
  const contactNameById = new Map(contactRows.map((row) => [row.id, row.displayName]))
  const result = new Map<string, string | null>()
  for (const workOrderInstanceId of input.workOrderInstanceIds) {
    const contactInstanceId = contactInstanceIdByWorkOrder.get(workOrderInstanceId)
    result.set(
      workOrderInstanceId,
      contactInstanceId ? (contactNameById.get(contactInstanceId) ?? null) : null
    )
  }
  return result
}

/** Non-canceled visits overlapping `range`, minus visits already holding an active base
 * `InvoiceVisitAllocation` — grouped by work order. Same overlap-query shape as
 * `dispatch/board.ts`'s `getBoard` range read. */
async function loadUninvoicedVisitsByWorkOrder(input: {
  organizationId: string
  range: InvoiceBatchRange
  workOrderInstanceIds: string[]
}): Promise<Map<string, (typeof schema.WorkOrderVisit.$inferSelect)[]>> {
  const rangeVisits = await database.query.WorkOrderVisit.findMany({
    where: and(
      eq(schema.WorkOrderVisit.organizationId, input.organizationId),
      inArray(schema.WorkOrderVisit.workOrderId, input.workOrderInstanceIds),
      ne(schema.WorkOrderVisit.status, 'canceled'),
      gte(schema.WorkOrderVisit.endTime, input.range.from),
      lte(schema.WorkOrderVisit.startTime, input.range.to)
    ),
  })
  const visitIds = rangeVisits.map((visit) => visit.id)
  const activeBaseAllocations = visitIds.length
    ? await database.query.InvoiceVisitAllocation.findMany({
        where: and(
          eq(schema.InvoiceVisitAllocation.organizationId, input.organizationId),
          inArray(schema.InvoiceVisitAllocation.visitId, visitIds),
          eq(schema.InvoiceVisitAllocation.status, 'active'),
          eq(schema.InvoiceVisitAllocation.kind, 'base')
        ),
        columns: { visitId: true },
      })
    : []
  const allocatedVisitIds = new Set(activeBaseAllocations.map((row) => row.visitId))
  const visitsByWorkOrder = new Map<string, (typeof schema.WorkOrderVisit.$inferSelect)[]>()
  for (const visit of rangeVisits) {
    if (allocatedVisitIds.has(visit.id)) continue
    const list = visitsByWorkOrder.get(visit.workOrderId) ?? []
    list.push(visit)
    visitsByWorkOrder.set(visit.workOrderId, list)
  }
  return visitsByWorkOrder
}

/** Custom-schedule `invoice_drafts` recurrence rules for these work orders, plus the occurrence
 * dates already claimed by an active `InvoiceScheduleAllocation` per rule. */
async function loadScheduleState(input: {
  organizationId: string
  workOrderInstanceIds: string[]
}): Promise<{
  ruleByWorkOrder: Map<string, typeof schema.RecurrenceRule.$inferSelect>
  allocatedOccurrencesByRule: Map<string, Set<string>>
}> {
  const rules = await database.query.RecurrenceRule.findMany({
    where: and(
      eq(schema.RecurrenceRule.organizationId, input.organizationId),
      eq(schema.RecurrenceRule.subjectType, 'invoice_drafts'),
      inArray(schema.RecurrenceRule.subjectId, input.workOrderInstanceIds)
    ),
  })
  const ruleByWorkOrder = new Map(rules.map((rule) => [rule.subjectId, rule]))
  const ruleIds = rules.map((rule) => rule.id)
  const allocations = ruleIds.length
    ? await database.query.InvoiceScheduleAllocation.findMany({
        where: and(
          eq(schema.InvoiceScheduleAllocation.organizationId, input.organizationId),
          inArray(schema.InvoiceScheduleAllocation.recurrenceRuleId, ruleIds),
          eq(schema.InvoiceScheduleAllocation.status, 'active')
        ),
        columns: { recurrenceRuleId: true, occurrenceDate: true },
      })
    : []
  const allocatedOccurrencesByRule = new Map<string, Set<string>>()
  for (const row of allocations) {
    const set = allocatedOccurrencesByRule.get(row.recurrenceRuleId) ?? new Set<string>()
    set.add(row.occurrenceDate)
    allocatedOccurrencesByRule.set(row.recurrenceRuleId, set)
  }
  return { ruleByWorkOrder, allocatedOccurrencesByRule }
}

/**
 * Per-work-order billable candidates for `range`, shared verbatim by `previewInvoiceBatch` and
 * `runInvoiceBatch` so the two can't drift. Work orders with nothing due in `range` (an empty
 * uninvoiced-visit set, or a `recurring_flat` schedule with no due occurrence) are omitted
 * entirely, not returned as excluded rows — only a genuine configuration problem (fixed-contract
 * basis, or a `recurring_flat` work order with no `custom_schedule` rule) is.
 */
async function gatherInvoiceBatchWorkOrders(input: {
  organizationId: string
  userId: string
  range: InvoiceBatchRange
  workOrderInstanceIds: string[]
}): Promise<GatheredWorkOrder[]> {
  const { organizationId, userId, range, workOrderInstanceIds } = input
  if (workOrderInstanceIds.length === 0) return []

  const [contactNameByWorkOrder, visitsByWorkOrder, scheduleState] = await Promise.all([
    loadContactNames({ organizationId, userId, workOrderInstanceIds }),
    loadUninvoicedVisitsByWorkOrder({ organizationId, range, workOrderInstanceIds }),
    loadScheduleState({ organizationId, workOrderInstanceIds }),
  ])
  const { ruleByWorkOrder, allocatedOccurrencesByRule } = scheduleState

  const results: GatheredWorkOrder[] = []
  for (const workOrderInstanceId of workOrderInstanceIds) {
    const workOrderRecordId = toRecordId('work_order', workOrderInstanceId)
    const contactName = contactNameByWorkOrder.get(workOrderInstanceId) ?? null
    const projection = await computeWorkOrderBillingProjection({
      organizationId,
      userId,
      workOrderInstanceId,
    })

    if (projection.basis === 'per_visit') {
      const candidates = visitsByWorkOrder.get(workOrderInstanceId) ?? []
      if (candidates.length === 0) continue
      const candidateVisitIds = new Set(candidates.map((visit) => visit.id))
      const uninvoicedLines = await listUninvoicedLines({
        organizationId,
        userId,
        workOrderInstanceId,
      })
      const extrasTotal = uninvoicedLines
        .filter(
          (line) =>
            line.visitId !== undefined &&
            candidateVisitIds.has(line.visitId) &&
            (line.lineTotal ?? 0) > 0
        )
        .reduce((sum, line) => sum + (line.lineTotal ?? 0), 0)
      results.push({
        workOrderInstanceId,
        workOrderRecordId,
        contactName,
        basis: 'per_visit',
        amount: candidates.length * projection.billingAmount + extrasTotal,
        visitCount: candidates.length,
        visitIds: candidates.map((visit) => visit.id),
      })
      continue
    }

    if (projection.basis === 'recurring_flat') {
      const rule =
        projection.timing === 'custom_schedule'
          ? ruleByWorkOrder.get(workOrderInstanceId)
          : undefined
      if (!rule) {
        results.push({
          workOrderInstanceId,
          workOrderRecordId,
          contactName,
          basis: 'recurring_flat',
          amount: 0,
          excludedReason: NO_SCHEDULE_EXCLUDED_REASON,
        })
        continue
      }
      const occurrences = expandOccurrences(rule.pattern as unknown as RecurrencePattern, {
        anchor: rule.anchor,
        timezone: rule.timezone,
        from: range.from,
        to: range.to,
        startMinute: 0,
      })
      const allocatedDates = allocatedOccurrencesByRule.get(rule.id) ?? new Set<string>()
      const dueOccurrences = occurrences.filter(
        (occurrence) => !allocatedDates.has(occurrence.occurrenceDate)
      )
      if (dueOccurrences.length === 0) continue
      results.push({
        workOrderInstanceId,
        workOrderRecordId,
        contactName,
        basis: 'recurring_flat',
        amount: dueOccurrences.length * projection.billingAmount,
        occurrenceCount: dueOccurrences.length,
        occurrenceDates: dueOccurrences.map((occurrence) => occurrence.occurrenceDate),
      })
      continue
    }

    results.push({
      workOrderInstanceId,
      workOrderRecordId,
      contactName,
      basis: projection.basis,
      amount: 0,
      excludedReason: FIXED_CONTRACT_EXCLUDED_REASON,
    })
  }

  return results
}

/**
 * Preview which work orders a batch will invoice for `range` + `filters` (condition-system
 * filters on the work-order entity def, resource mode) — the office's "invoice all of August"
 * check before generating drafts. Amounts are computed by running the billing projection per
 * work order (fine at the tens-of-work-orders scale a batch period covers; revisit if orgs grow
 * into the hundreds).
 */
export async function previewInvoiceBatch(
  input: PreviewInvoiceBatchInput
): Promise<PreviewInvoiceBatchResult> {
  const workOrderInstanceIds = await resolveWorkOrderInstanceIds(input)
  const gathered = await gatherInvoiceBatchWorkOrders({ ...input, workOrderInstanceIds })
  const rows = gathered.map(toPublicRow)
  const billableRows = rows.filter((row) => !row.excludedReason)
  return {
    rows,
    totalCount: billableRows.length,
    totalAmount: billableRows.reduce((sum, row) => sum + row.amount, 0),
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const direct = 'code' in error ? (error as { code?: unknown }).code : undefined
  if (direct === '23505') return true
  const cause = 'cause' in error ? (error as { cause?: unknown }).cause : undefined
  return Boolean(
    cause &&
      typeof cause === 'object' &&
      'code' in cause &&
      (cause as { code?: unknown }).code === '23505'
  )
}

/**
 * Generate draft invoices for `workOrderRecordIds` over `range` — re-derives each work order's
 * billable visits/occurrences at run time (the same gather `previewInvoiceBatch` uses) rather
 * than trusting client-sent visit ids. Sequential, one work order at a time; each underlying
 * command (`createVisitInvoice` with `advance: true`, `createRecurringCharge` per due
 * occurrence) keeps its own serializable-retry transaction — there is no cross-invoice
 * transaction, so a failure on one work order never rolls back drafts already created for
 * others. A unique-violation on an allocation (raced by a concurrent manual invoice) is reported
 * as a per-item skip, not a batch failure.
 */
export async function runInvoiceBatch(input: RunInvoiceBatchInput): Promise<RunInvoiceBatchResult> {
  const workOrderInstanceIds = input.workOrderRecordIds.map(
    (recordId) => parseRecordId(recordId).entityInstanceId
  )
  const gathered = await gatherInvoiceBatchWorkOrders({
    organizationId: input.organizationId,
    userId: input.userId,
    range: input.range,
    workOrderInstanceIds,
  })
  const gatheredByWorkOrder = new Map(gathered.map((item) => [item.workOrderInstanceId, item]))

  const results: InvoiceBatchItemResult[] = []
  for (const workOrderRecordId of input.workOrderRecordIds) {
    const { entityInstanceId: workOrderInstanceId } = parseRecordId(workOrderRecordId)
    const item = gatheredByWorkOrder.get(workOrderInstanceId)
    if (!item || item.excludedReason) {
      results.push({
        workOrderRecordId,
        ok: false,
        error: item?.excludedReason ?? NOTHING_DUE_ERROR,
      })
      continue
    }
    try {
      if (item.basis === 'per_visit' && item.visitIds?.length) {
        const invoice = await createVisitInvoice({
          organizationId: input.organizationId,
          userId: input.userId,
          workOrderInstanceId,
          visitIds: item.visitIds,
          advance: true,
        })
        results.push({ workOrderRecordId, ok: true, invoiceRecordId: invoice.recordId })
      } else if (item.basis === 'recurring_flat' && item.occurrenceDates?.length) {
        const invoiceRecordIds: RecordId[] = []
        for (const occurrenceDate of item.occurrenceDates) {
          const invoice = await createRecurringCharge({
            organizationId: input.organizationId,
            userId: input.userId,
            workOrderInstanceId,
            occurrenceDate,
          })
          invoiceRecordIds.push(invoice.recordId)
        }
        results.push({
          workOrderRecordId,
          ok: true,
          invoiceRecordId: invoiceRecordIds.at(-1),
          invoiceRecordIds,
        })
      } else {
        results.push({ workOrderRecordId, ok: false, error: NOTHING_DUE_ERROR })
      }
    } catch (error) {
      const skipped = isUniqueViolation(error)
      logger.warn('Batch invoice item failed', {
        organizationId: input.organizationId,
        workOrderInstanceId,
        skipped,
        error: error instanceof Error ? error.message : String(error),
      })
      results.push({
        workOrderRecordId,
        ok: false,
        error: skipped
          ? 'Already invoiced by a concurrent action'
          : error instanceof Error
            ? error.message
            : 'Failed to create invoice',
      })
    }
  }
  return { results }
}
