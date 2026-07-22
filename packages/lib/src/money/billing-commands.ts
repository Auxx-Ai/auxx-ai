// packages/lib/src/money/billing-commands.ts

import { type Database, database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { toRecordId } from '@auxx/types/resource'
import { and, eq, inArray, ne } from 'drizzle-orm'
import { getOrgCache } from '../cache'
import { BadRequestError } from '../errors'
import { FieldValueService } from '../field-values/field-value-service'
import { UnifiedCrudHandler } from '../resources/crud'
import { allocateProportionally, resolveFixedInvoiceAmount } from './billing-allocation-math'
import {
  allocateInvoiceLine,
  allocateInvoiceVisit,
  allocateScheduleOccurrence,
  getActiveAllocatedAmounts,
} from './billing-allocations'
import {
  batchReadSystemValues,
  computeWorkOrderBillingProjection,
  syncInvoiceBillingProjection,
  syncWorkOrderBillingProjection,
} from './billing-projection'
import { copyLineOntoInvoice, createInvoiceShell, LINE_COPY_ATTRS } from './gather'
import { applyHeldDepositsToInvoice } from './payments/ledger'
import { recomputeTotals } from './totals-hooks'
import type {
  AddVisitExtrasToContractInput,
  CreateExtraWorkInvoiceInput,
  CreateFixedContractInvoiceInput,
  CreateInvoiceFromWorkOrderResult,
  CreateRecurringChargeInput,
  CreateVisitInvoiceInput,
} from './types'

const logger = createScopedLogger('money:billing-commands')
const MAX_SERIALIZABLE_ATTEMPTS = 3

function databaseErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const direct = 'code' in error ? error.code : undefined
  if (typeof direct === 'string') return direct
  const cause = 'cause' in error ? error.cause : undefined
  return cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string'
    ? cause.code
    : undefined
}

async function withSerializableRetry<T>(operation: (db: Database) => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_SERIALIZABLE_ATTEMPTS; attempt++) {
    try {
      return await database.transaction((tx) => operation(tx as unknown as Database), {
        isolationLevel: 'serializable',
      })
    } catch (error) {
      const code = databaseErrorCode(error)
      if ((code !== '40001' && code !== '40P01') || attempt === MAX_SERIALIZABLE_ATTEMPTS) {
        throw error
      }
      logger.warn('Retrying serializable billing transaction', { attempt, code })
    }
  }
  throw new Error('Serializable billing transaction retry exhausted')
}

async function getSourceLines(input: {
  organizationId: string
  userId: string
  workOrderInstanceId: string
  db?: Database
}) {
  const handler = new UnifiedCrudHandler(input.organizationId, input.userId, input.db)
  const { ids } = await handler.listFiltered({
    entityDefinitionId: 'line_item',
    filters: [
      {
        id: 'billing-command-source-lines',
        logicalOperator: 'AND',
        conditions: [
          {
            id: 'billing-command-source-lines-parent',
            fieldId: 'line_item:workOrder',
            operator: 'is',
            value: toRecordId('work_order', input.workOrderInstanceId),
          },
        ],
      },
    ],
    sorting: [{ id: 'sortOrder', desc: false }],
    limit: 1000,
    mode: 'oneshot',
  })
  const cache = getOrgCache()
  const fields = await cache
    .from(input.organizationId, 'customFields')
    .bySystemAttributes([...LINE_COPY_ATTRS])
  const visitFields = await cache
    .from(input.organizationId, 'customFields')
    .bySystemAttributes(['line_item_visit_id'] as const)
  const fieldIds = [...Object.values(fields), visitFields.line_item_visit_id]
    .filter(Boolean)
    .map((field) => field!.id)
  // One batched read for every source line instead of a `getFieldValues` call per row — this
  // runs on every invoice-creation command.
  const valuesById = await batchReadSystemValues({
    service: new FieldValueService(input.organizationId, input.userId, input.db),
    organizationId: input.organizationId,
    entityType: 'line_item',
    entityInstanceIds: ids,
    attributes: ['line_item_line_total', 'line_item_visit_id'],
  })
  const lines = ids.map((id) => {
    const values = valuesById.get(id) ?? new Map<string, unknown>()
    return {
      id,
      amount: Number(values.get('line_item_line_total') ?? 0),
      visitId: (values.get('line_item_visit_id') as string | undefined) || undefined,
    }
  })
  return { handler, cache, fields, fieldIds, lines }
}

async function finishInvoice(input: {
  organizationId: string
  userId: string
  workOrderInstanceId: string
  invoiceInstanceId: string
  invoiceRecordId: ReturnType<typeof toRecordId>
  db?: Database
}): Promise<CreateInvoiceFromWorkOrderResult> {
  await recomputeTotals({
    organizationId: input.organizationId,
    userId: input.userId,
    documentType: 'invoice',
    documentInstanceId: input.invoiceInstanceId,
    db: input.db,
    publishEvents: !input.db,
  })

  // money 16-deposit-accounting.md §C.2 settle point — every invoice-creation command
  // (createFixedContractInvoice/createVisitInvoice/createRecurringCharge/createExtraWorkInvoice)
  // funnels through this one finish step, right after `recomputeTotals` (above) has written the
  // invoice's real `invoice_total` — the value `applyHeldDepositsToInvoice` needs to cap
  // allocation at (moved here from `createInvoiceShell`, which runs before any line is copied
  // and so never had a real total to cap against). Same `db` (the `withSerializableRetry`
  // transaction every caller wraps this in) and the same `publishEvents: !input.db` threading as
  // `recomputeTotals` just above. `workOrderInstanceId` is a required, non-nullable input on
  // every one of these commands (`WorkOrderBillingCommandInput`) — same guarantee the old
  // shell-embedded call relied on, no extra guard needed.
  const totalsById = await batchReadSystemValues({
    service: new FieldValueService(input.organizationId, input.userId, input.db),
    organizationId: input.organizationId,
    entityType: 'invoice',
    entityInstanceIds: [input.invoiceInstanceId],
    attributes: ['invoice_total'] as const,
  })
  const invoiceTotal = Number(totalsById.get(input.invoiceInstanceId)?.get('invoice_total') ?? 0)
  await applyHeldDepositsToInvoice({
    organizationId: input.organizationId,
    userId: input.userId,
    workOrderInstanceId: input.workOrderInstanceId,
    invoiceInstanceId: input.invoiceInstanceId,
    invoiceTotal,
    db: input.db,
    publishEvents: !input.db,
  })

  return { recordId: input.invoiceRecordId, instanceId: input.invoiceInstanceId }
}

async function sumPriorFixedDiscounts(input: {
  db: Database
  organizationId: string
  workOrderInstanceId: string
  userId: string
}): Promise<number> {
  const rows = await input.db.query.InvoiceLineAllocation.findMany({
    where: and(
      eq(schema.InvoiceLineAllocation.organizationId, input.organizationId),
      eq(schema.InvoiceLineAllocation.workOrderId, input.workOrderInstanceId),
      eq(schema.InvoiceLineAllocation.kind, 'contract'),
      eq(schema.InvoiceLineAllocation.status, 'active')
    ),
    columns: { invoiceId: true },
  })
  const invoiceIds = [...new Set(rows.map((row) => row.invoiceId))]
  if (invoiceIds.length === 0) return 0
  // One batched read over every prior progress invoice instead of one `getFieldValues` per row.
  const valuesById = await batchReadSystemValues({
    service: new FieldValueService(input.organizationId, input.userId, input.db),
    organizationId: input.organizationId,
    entityType: 'invoice',
    entityInstanceIds: invoiceIds,
    attributes: ['invoice_discount_type', 'invoice_discount_value'] as const,
  })
  let total = 0
  for (const invoiceId of invoiceIds) {
    const values = valuesById.get(invoiceId)
    if (values?.get('invoice_discount_type') === 'amount') {
      total += Number(values.get('invoice_discount_value') ?? 0)
    }
  }
  return total
}

async function projectCommittedInvoice(input: {
  organizationId: string
  userId: string
  workOrderInstanceId: string
  result: CreateInvoiceFromWorkOrderResult
}): Promise<CreateInvoiceFromWorkOrderResult> {
  try {
    await syncInvoiceBillingProjection({
      organizationId: input.organizationId,
      userId: input.userId,
      invoiceInstanceId: input.result.instanceId,
    })
    await syncWorkOrderBillingProjection(input)
  } catch (error) {
    logger.error('Committed invoice billing projection failed', {
      organizationId: input.organizationId,
      workOrderId: input.workOrderInstanceId,
      invoiceId: input.result.instanceId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
  return input.result
}

/** Create a full or proportional fixed-contract invoice backed by source allocations. */
export async function createFixedContractInvoice(
  input: CreateFixedContractInvoiceInput
): Promise<CreateInvoiceFromWorkOrderResult> {
  const result = await withSerializableRetry(async (db) => {
    const projection = await computeWorkOrderBillingProjection({ ...input, db })
    if (projection.basis !== 'fixed_contract') {
      throw new BadRequestError('This work order does not use fixed-contract billing')
    }
    let selection: Exclude<typeof input.amount, { type: 'installment' }> =
      input.amount.type === 'installment' ? { type: 'remaining' } : input.amount
    let installmentId: string | undefined
    if (input.amount.type === 'installment') {
      const installment = await db.query.WorkOrderBillingInstallment.findFirst({
        where: and(
          eq(schema.WorkOrderBillingInstallment.organizationId, input.organizationId),
          eq(schema.WorkOrderBillingInstallment.workOrderId, input.workOrderInstanceId),
          eq(schema.WorkOrderBillingInstallment.id, input.amount.installmentId),
          eq(schema.WorkOrderBillingInstallment.status, 'pending')
        ),
      })
      if (!installment) throw new BadRequestError('Billing installment is not available')
      installmentId = installment.id
      selection = { type: 'fixed', amount: installment.amount }
    }
    const source = await getSourceLines({ ...input, db })
    const contractLines = source.lines.filter((line) => !line.visitId && line.amount > 0)
    const allocated = await getActiveAllocatedAmounts({
      db,
      organizationId: input.organizationId,
      sourceLineItemIds: contractLines.map((line) => line.id),
    })
    const remaining = contractLines.map((line) => ({
      sourceLineItemId: line.id,
      amount: Math.max(0, line.amount - (allocated.get(line.id) ?? 0)),
    }))
    const selectedAmount = resolveFixedInvoiceAmount({
      selection,
      contractValue: projection.billingAmount,
      remainingValue: remaining.reduce((sum, line) => sum + line.amount, 0),
    })
    const allocations = allocateProportionally(remaining, selectedAmount)
    const shell = await createInvoiceShell({ ...input, db, publishEvents: false })
    const service = new FieldValueService(input.organizationId, input.userId, db)
    if (shell.discountType === 'amount' && shell.discountValue) {
      const remainingValue = remaining.reduce((sum, line) => sum + line.amount, 0)
      const discountValue =
        selectedAmount === remainingValue
          ? Math.max(
              0,
              shell.discountValue -
                (await sumPriorFixedDiscounts({
                  db,
                  organizationId: input.organizationId,
                  workOrderInstanceId: input.workOrderInstanceId,
                  userId: input.userId,
                }))
            )
          : Math.floor((shell.discountValue * selectedAmount) / projection.billingAmount)
      await service.setValuesForEntity({
        recordId: shell.recordId,
        values: [{ fieldId: 'invoice_discount_value', value: discountValue }],
        publishEvents: false,
      })
    }
    for (const allocation of allocations) {
      const copied = await copyLineOntoInvoice({
        handler: shell.handler,
        fieldValueService: service,
        lineCf: source.fields,
        lineFieldIds: source.fieldIds,
        lineInstanceId: allocation.sourceLineItemId,
        invoiceRecordId: shell.recordId,
        publishEvents: false,
        extraValues: {
          line_item_qty: 1,
          line_item_unit_price: allocation.amount,
          line_item_line_total: allocation.amount,
        },
      })
      await allocateInvoiceLine({
        db,
        organizationId: input.organizationId,
        workOrderId: input.workOrderInstanceId,
        invoiceId: shell.instanceId,
        invoiceLineItemId: copied.instanceId,
        sourceLineItemId: allocation.sourceLineItemId,
        kind: 'contract',
        amount: allocation.amount,
      })
    }
    if (installmentId) {
      await db
        .update(schema.WorkOrderBillingInstallment)
        .set({ status: 'drafted', invoiceId: shell.instanceId })
        .where(eq(schema.WorkOrderBillingInstallment.id, installmentId))
    }
    return finishInvoice({
      ...input,
      db,
      invoiceInstanceId: shell.instanceId,
      invoiceRecordId: shell.recordId,
    })
  })
  return projectCommittedInvoice({ ...input, result })
}

/** Create one allocation-backed invoice for selected visits — `'done'` only by default, or (with
 * `input.advance`) any non-canceled visit, for batch/advance invoicing before the work happens. */
export async function createVisitInvoice(
  input: CreateVisitInvoiceInput
): Promise<CreateInvoiceFromWorkOrderResult> {
  if (input.visitIds.length === 0) throw new BadRequestError('Select at least one visit')
  const result = await withSerializableRetry(async (db) => {
    const projection = await computeWorkOrderBillingProjection({ ...input, db })
    if (projection.basis !== 'per_visit') {
      throw new BadRequestError('This work order does not use per-visit billing')
    }
    const visits = await db.query.WorkOrderVisit.findMany({
      where: and(
        eq(schema.WorkOrderVisit.organizationId, input.organizationId),
        eq(schema.WorkOrderVisit.workOrderId, input.workOrderInstanceId),
        input.advance
          ? ne(schema.WorkOrderVisit.status, 'canceled')
          : eq(schema.WorkOrderVisit.status, 'done'),
        inArray(schema.WorkOrderVisit.id, [...new Set(input.visitIds)])
      ),
    })
    if (visits.length !== new Set(input.visitIds).size) {
      throw new BadRequestError(
        input.advance
          ? 'Every selected visit must belong to this work order and not be canceled'
          : 'Every selected visit must be completed and belong to this work order'
      )
    }
    const source = await getSourceLines({ ...input, db })
    const templates = source.lines.filter((line) => !line.visitId && line.amount > 0)
    const additions = source.lines.filter((line) => line.visitId && line.amount > 0)
    const shell = await createInvoiceShell({ ...input, db, publishEvents: false })
    const service = new FieldValueService(input.organizationId, input.userId, db)
    for (const visit of visits) {
      await allocateInvoiceVisit({
        db,
        organizationId: input.organizationId,
        workOrderId: input.workOrderInstanceId,
        invoiceId: shell.instanceId,
        visitId: visit.id,
        kind: 'base',
      })
      for (const line of [...templates, ...additions.filter((row) => row.visitId === visit.id)]) {
        const copied = await copyLineOntoInvoice({
          handler: shell.handler,
          fieldValueService: service,
          lineCf: source.fields,
          lineFieldIds: source.fieldIds,
          lineInstanceId: line.id,
          invoiceRecordId: shell.recordId,
          publishEvents: false,
          extraValues: { line_item_visit_id: visit.id },
        })
        await allocateInvoiceLine({
          db,
          organizationId: input.organizationId,
          workOrderId: input.workOrderInstanceId,
          invoiceId: shell.instanceId,
          invoiceLineItemId: copied.instanceId,
          sourceLineItemId: line.id,
          visitId: visit.id,
          kind: line.visitId ? 'visit_addition' : 'visit_template',
          amount: line.amount,
        })
      }
    }
    return finishInvoice({
      ...input,
      db,
      invoiceInstanceId: shell.instanceId,
      invoiceRecordId: shell.recordId,
    })
  })
  return projectCommittedInvoice({ ...input, result })
}

/** Create a recurring flat-rate invoice for one occurrence identity. */
export async function createRecurringCharge(
  input: CreateRecurringChargeInput
): Promise<CreateInvoiceFromWorkOrderResult> {
  const result = await withSerializableRetry(async (db) => {
    const projection = await computeWorkOrderBillingProjection({ ...input, db })
    if (projection.basis !== 'recurring_flat') {
      throw new BadRequestError('This work order does not use recurring flat-rate billing')
    }
    const rule = await db.query.RecurrenceRule.findFirst({
      where: and(
        eq(schema.RecurrenceRule.organizationId, input.organizationId),
        eq(schema.RecurrenceRule.subjectId, input.workOrderInstanceId),
        eq(schema.RecurrenceRule.subjectType, 'invoice_drafts')
      ),
    })
    if (!rule) throw new BadRequestError('Configure an invoice schedule before generating a charge')
    const occurrenceDate = input.occurrenceDate ?? new Date().toISOString().split('T')[0]!
    const source = await getSourceLines({ ...input, db })
    const templates = source.lines.filter((line) => !line.visitId && line.amount > 0)
    if (templates.length === 0)
      throw new BadRequestError('Add a billing-period line before invoicing')
    const shell = await createInvoiceShell({
      ...input,
      issuedAt: occurrenceDate,
      db,
      publishEvents: false,
    })
    await allocateScheduleOccurrence({
      db,
      organizationId: input.organizationId,
      workOrderId: input.workOrderInstanceId,
      invoiceId: shell.instanceId,
      recurrenceRuleId: rule.id,
      occurrenceDate,
    })
    const service = new FieldValueService(input.organizationId, input.userId, db)
    for (const line of templates) {
      const copied = await copyLineOntoInvoice({
        handler: shell.handler,
        fieldValueService: service,
        lineCf: source.fields,
        lineFieldIds: source.fieldIds,
        lineInstanceId: line.id,
        invoiceRecordId: shell.recordId,
        publishEvents: false,
      })
      await allocateInvoiceLine({
        db,
        organizationId: input.organizationId,
        workOrderId: input.workOrderInstanceId,
        invoiceId: shell.instanceId,
        invoiceLineItemId: copied.instanceId,
        sourceLineItemId: line.id,
        kind: 'recurring_charge',
        amount: line.amount,
      })
    }
    return finishInvoice({
      ...input,
      db,
      invoiceInstanceId: shell.instanceId,
      invoiceRecordId: shell.recordId,
    })
  })
  return projectCommittedInvoice({ ...input, result })
}

/** Create a separate invoice for additive visit work without consuming base visit pricing. */
export async function createExtraWorkInvoice(
  input: CreateExtraWorkInvoiceInput
): Promise<CreateInvoiceFromWorkOrderResult> {
  const result = await withSerializableRetry(async (db) => {
    const source = await getSourceLines({ ...input, db })
    const selected = source.lines.filter(
      (line) =>
        line.visitId &&
        input.visitIds.includes(line.visitId) &&
        (!input.sourceLineIds || input.sourceLineIds.includes(line.id))
    )
    // Plan money/19 §C: extras on canceled visits are not billable (restore the visit or
    // re-pin the line first); dangling visit ids drop out via the fetched-visit check.
    // Future/scheduled visits stay deliberately accepted — pre-billing staged material is
    // a supported flow. Unpriced lines follow the other builders' `amount > 0` convention.
    const selectedVisitIds = [...new Set(selected.map((line) => line.visitId!))]
    const visitRows = selectedVisitIds.length
      ? await db.query.WorkOrderVisit.findMany({
          where: and(
            eq(schema.WorkOrderVisit.organizationId, input.organizationId),
            eq(schema.WorkOrderVisit.workOrderId, input.workOrderInstanceId),
            inArray(schema.WorkOrderVisit.id, selectedVisitIds)
          ),
          columns: { id: true, status: true },
        })
      : []
    const visitStatusById = new Map(visitRows.map((row) => [row.id, row.status]))
    if (selected.some((line) => visitStatusById.get(line.visitId!) === 'canceled')) {
      throw new BadRequestError('Extra work on a canceled visit cannot be invoiced')
    }
    const allocated = await getActiveAllocatedAmounts({
      db,
      organizationId: input.organizationId,
      sourceLineItemIds: selected.map((line) => line.id),
    })
    const eligible = selected.filter(
      (line) => !allocated.has(line.id) && line.amount > 0 && visitStatusById.has(line.visitId!)
    )
    if (eligible.length === 0)
      throw new BadRequestError('No selected extra work is ready to invoice')
    const shell = await createInvoiceShell({ ...input, db, publishEvents: false })
    const service = new FieldValueService(input.organizationId, input.userId, db)
    for (const visitId of new Set(eligible.map((line) => line.visitId!))) {
      await allocateInvoiceVisit({
        db,
        organizationId: input.organizationId,
        workOrderId: input.workOrderInstanceId,
        invoiceId: shell.instanceId,
        visitId,
        kind: 'additional',
      })
    }
    for (const line of eligible) {
      const copied = await copyLineOntoInvoice({
        handler: shell.handler,
        fieldValueService: service,
        lineCf: source.fields,
        lineFieldIds: source.fieldIds,
        lineInstanceId: line.id,
        invoiceRecordId: shell.recordId,
        publishEvents: false,
        extraValues: { line_item_visit_id: line.visitId },
      })
      await allocateInvoiceLine({
        db,
        organizationId: input.organizationId,
        workOrderId: input.workOrderInstanceId,
        invoiceId: shell.instanceId,
        invoiceLineItemId: copied.instanceId,
        sourceLineItemId: line.id,
        visitId: line.visitId,
        kind: 'visit_addition',
        amount: line.amount,
      })
    }
    return finishInvoice({
      ...input,
      db,
      invoiceInstanceId: shell.instanceId,
      invoiceRecordId: shell.recordId,
    })
  })
  return projectCommittedInvoice({ ...input, result })
}

/** Move unallocated visit additions into the fixed contract so future progress claims include them. */
export async function addVisitExtrasToContract(
  input: AddVisitExtrasToContractInput
): Promise<void> {
  await withSerializableRetry(async (db) => {
    const projection = await computeWorkOrderBillingProjection({ ...input, db })
    if (projection.basis !== 'fixed_contract') {
      throw new BadRequestError('Only fixed-contract extras can be added to the contract')
    }
    const source = await getSourceLines({ ...input, db })
    const additions = source.lines.filter((line) => line.visitId === input.visitId)
    if (additions.length === 0) throw new BadRequestError('This visit has no extra work')
    const allocated = await getActiveAllocatedAmounts({
      db,
      organizationId: input.organizationId,
      sourceLineItemIds: additions.map((line) => line.id),
    })
    if (allocated.size > 0) {
      throw new BadRequestError('Remove these extras from their draft invoice first')
    }
    const service = new FieldValueService(input.organizationId, input.userId, db)
    for (const line of additions) {
      await service.setValuesForEntity({
        recordId: toRecordId('line_item', line.id),
        values: [{ fieldId: 'line_item_visit_id', value: null }],
        publishEvents: false,
      })
    }
  })
  await syncWorkOrderBillingProjection(input)
}
