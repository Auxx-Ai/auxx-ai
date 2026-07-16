// packages/lib/src/money/billing-state.ts

import { database, schema } from '@auxx/database'
import { toRecordId } from '@auxx/types/resource'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { FieldValueService } from '../field-values/field-value-service'
import { UnifiedCrudHandler } from '../resources/crud'
import { batchReadSystemValues, computeWorkOrderBillingProjection } from './billing-projection'
import { listUninvoicedLines } from './gather'
import {
  computeDepositFigures,
  getAllocationTotalsByTransaction,
  getContactCreditOnAccount,
} from './payments/allocation-reads'
import { listWorkOrderPayments } from './payments/ledger'

const INVOICE_ROW_ATTRS = [
  'invoice_status',
  'invoice_total',
  'invoice_balance',
  'invoice_service_period_start',
  'invoice_service_period_end',
  'invoice_visit_count',
  'invoice_due_date',
  'invoice_issued_at',
] as const

async function invoiceRows(input: {
  organizationId: string
  userId: string
  invoiceIds: string[]
}) {
  const [instances, valuesById] = await Promise.all([
    input.invoiceIds.length
      ? database.query.EntityInstance.findMany({
          where: inArray(schema.EntityInstance.id, input.invoiceIds),
          columns: { id: true, displayName: true },
        })
      : Promise.resolve([]),
    batchReadSystemValues({
      service: new FieldValueService(input.organizationId, input.userId),
      organizationId: input.organizationId,
      entityType: 'invoice',
      entityInstanceIds: input.invoiceIds,
      attributes: INVOICE_ROW_ATTRS,
    }),
  ])
  const names = new Map(instances.map((row) => [row.id, row.displayName]))
  const rows = input.invoiceIds.map((id) => {
    const values = valuesById.get(id) ?? new Map<string, unknown>()
    return {
      recordId: toRecordId('invoice', id),
      displayName: names.get(id) ?? 'Invoice',
      status: String(values.get('invoice_status') ?? 'draft'),
      total: Number(values.get('invoice_total') ?? 0),
      balance: Number(values.get('invoice_balance') ?? 0),
      servicePeriodStart: values.get('invoice_service_period_start') as string | undefined,
      servicePeriodEnd: values.get('invoice_service_period_end') as string | undefined,
      visitCount: Number(values.get('invoice_visit_count') ?? 0),
      dueDate: values.get('invoice_due_date') as string | undefined,
      issuedAt: values.get('invoice_issued_at') as string | undefined,
    }
  })
  return rows.sort(
    (a, b) =>
      (b.issuedAt ?? '').localeCompare(a.issuedAt ?? '') || b.recordId.localeCompare(a.recordId)
  )
}

/** One server-shaped authoritative read shared by every work-order billing surface. */
export async function getWorkOrderBillingState(input: {
  organizationId: string
  userId: string
  workOrderInstanceId: string
}) {
  const projection = await computeWorkOrderBillingProjection(input)
  const handler = new UnifiedCrudHandler(input.organizationId, input.userId)
  const [visits, activeVisits, installments, linkedInvoices, payments, uninvoicedLines] =
    await Promise.all([
      database.query.WorkOrderVisit.findMany({
        where: and(
          eq(schema.WorkOrderVisit.organizationId, input.organizationId),
          eq(schema.WorkOrderVisit.workOrderId, input.workOrderInstanceId),
          eq(schema.WorkOrderVisit.status, 'done')
        ),
        orderBy: [asc(schema.WorkOrderVisit.startTime)],
      }),
      database.query.InvoiceVisitAllocation.findMany({
        where: and(
          eq(schema.InvoiceVisitAllocation.organizationId, input.organizationId),
          eq(schema.InvoiceVisitAllocation.workOrderId, input.workOrderInstanceId),
          eq(schema.InvoiceVisitAllocation.status, 'active')
        ),
      }),
      database.query.WorkOrderBillingInstallment.findMany({
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
            id: 'billing-state-invoices',
            logicalOperator: 'AND',
            conditions: [
              {
                id: 'billing-state-invoices-parent',
                fieldId: 'invoice:workOrder',
                operator: 'is',
                value: toRecordId('work_order', input.workOrderInstanceId),
              },
            ],
          },
        ],
        limit: 1000,
        mode: 'oneshot',
      }),
      listWorkOrderPayments(input),
      listUninvoicedLines(input),
    ])
  // Deposit-accounting plan 16 §D.1 — held vs applied over the WO's own succeeded deposit
  // charges (quote provenance). `payments` is already fetched above (`listWorkOrderPayments`);
  // batch the allocation totals for just those rows' ids, never N+1.
  const depositChargeRows = payments.filter(
    (row) => row.kind === 'charge' && row.status === 'succeeded' && row.quoteInstanceId != null
  )
  const depositAllocationTotals = await getAllocationTotalsByTransaction(
    input.organizationId,
    depositChargeRows.map((row) => row.id)
  )
  const { depositHeld, depositApplied } = computeDepositFigures(
    depositChargeRows,
    depositAllocationTotals
  )

  const allocationsByVisit = new Map<string, typeof activeVisits>()
  for (const allocation of activeVisits) {
    const rows = allocationsByVisit.get(allocation.visitId) ?? []
    rows.push(allocation)
    allocationsByVisit.set(allocation.visitId, rows)
  }
  const eligibleVisits = visits
    .filter((visit) => !allocationsByVisit.get(visit.id)?.some((row) => row.kind === 'base'))
    .map((visit, index) => ({
      id: visit.id,
      label: `Visit ${index + 1}`,
      serviceDate: visit.occurrenceDate ?? visit.startTime?.toISOString().split('T')[0] ?? null,
      amount: projection.billingAmount,
      invoiceState: 'uninvoiced' as const,
    }))
  return {
    ...projection,
    currencyCode: 'USD',
    summary: {
      billingAmount: projection.billingAmount,
      drafted: projection.amountDrafted,
      invoiced: projection.amountInvoiced,
      remaining: projection.uninvoicedAmount,
      balanceDue: projection.balanceDue,
      // Deposit-accounting plan 16 §D.1 — held (unallocated) never touches balanceDue above
      // (§Decisions: it renders as its own figure); applied is derived, not stamped.
      depositHeld,
      depositApplied,
    },
    eligibleVisits,
    extraWork: uninvoicedLines
      .filter((line) => line.visitId)
      .map((line) => ({
        id: line.instanceId,
        sourceLineId: line.instanceId,
        visitId: line.visitId!,
        amount: line.lineTotal ?? 0,
      })),
    installments,
    invoices: await invoiceRows({
      organizationId: input.organizationId,
      userId: input.userId,
      invoiceIds: linkedInvoices.ids,
    }),
    payments,
  }
}

/** Composed current customer billing aggregate and five recent invoices. */
export async function getContactBillingOverview(input: {
  organizationId: string
  userId: string
  contactInstanceId: string
}) {
  const handler = new UnifiedCrudHandler(input.organizationId, input.userId)
  const contactRecordId = toRecordId('contact', input.contactInstanceId)
  const [workOrders, invoices] = await Promise.all([
    handler.listFiltered({
      entityDefinitionId: 'work_order',
      filters: [
        {
          id: 'contact-overview-work-orders',
          logicalOperator: 'AND',
          conditions: [
            {
              id: 'contact-overview-work-orders-contact',
              fieldId: 'work_order:contact',
              operator: 'is',
              value: contactRecordId,
            },
          ],
        },
      ],
      limit: 1000,
      mode: 'oneshot',
    }),
    handler.listFiltered({
      entityDefinitionId: 'invoice',
      filters: [
        {
          id: 'contact-overview-invoices',
          logicalOperator: 'AND',
          conditions: [
            {
              id: 'contact-overview-invoices-contact',
              fieldId: 'invoice:contact',
              operator: 'is',
              value: contactRecordId,
            },
          ],
        },
      ],
      limit: 1000,
      mode: 'oneshot',
    }),
  ])
  // Fixed query count regardless of work-order/invoice counts (plan §4.7): read the projected
  // `work_order_uninvoiced_amount`/`work_order_billing_state` fields the projector already keeps
  // fresh instead of recomputing each work order's ~11-query billing projection here.
  const [workOrderValuesById, rows, creditOnAccount] = await Promise.all([
    batchReadSystemValues({
      service: new FieldValueService(input.organizationId, input.userId),
      organizationId: input.organizationId,
      entityType: 'work_order',
      entityInstanceIds: workOrders.ids,
      attributes: ['work_order_uninvoiced_amount', 'work_order_billing_state'] as const,
    }),
    invoiceRows({ ...input, invoiceIds: invoices.ids }),
    // Deposit-accounting plan 16 §D.4 — Σ unallocated remainders of the contact's succeeded
    // deposit charges, via the new `contactInstanceId` column (a plain query, no FieldValue hops).
    getContactCreditOnAccount(input.organizationId, input.contactInstanceId),
  ])
  const activeRows = rows.filter((row) => row.status !== 'void')
  const draftRows = activeRows.filter((row) => row.status === 'draft')
  const now = new Date().toISOString().split('T')[0]!
  const overdueRows = activeRows.filter(
    (row) => row.status !== 'draft' && row.balance > 0 && row.dueDate && row.dueDate < now
  )
  let uninvoicedAmount = 0
  const readyWorkOrderIds: string[] = []
  for (const workOrderInstanceId of workOrders.ids) {
    const values = workOrderValuesById.get(workOrderInstanceId) ?? new Map<string, unknown>()
    uninvoicedAmount += Number(values.get('work_order_uninvoiced_amount') ?? 0)
    if (values.get('work_order_billing_state') === 'ready_to_invoice') {
      readyWorkOrderIds.push(workOrderInstanceId)
    }
  }
  return {
    currencyCode: 'USD',
    balanceDue: activeRows.reduce((sum, row) => sum + row.balance, 0),
    overdueAmount: overdueRows.reduce((sum, row) => sum + row.balance, 0),
    overdueCount: overdueRows.length,
    draftAmount: draftRows.reduce((sum, row) => sum + row.total, 0),
    draftCount: draftRows.length,
    uninvoicedAmount,
    readyWorkOrderCount: readyWorkOrderIds.length,
    readyWorkOrders: readyWorkOrderIds.map((id) => ({ recordId: toRecordId('work_order', id) })),
    recentInvoices: activeRows.slice(0, 5),
    creditOnAccount,
  }
}
