// packages/lib/src/accounting/sales/billing/allocations.ts

import { type Database, database, schema } from '@auxx/database'
import { and, asc, eq, inArray, type SQL, sql } from 'drizzle-orm'
import { BadRequestError } from '../../../errors'

export type InvoiceLineAllocationKind =
  | 'contract'
  | 'visit_template'
  | 'visit_addition'
  | 'recurring_charge'

/** Insert the provenance row for one generated invoice snapshot line. */
export async function allocateInvoiceLine(input: {
  db?: Database
  organizationId: string
  workOrderId: string
  invoiceId: string
  invoiceLineItemId: string
  sourceLineItemId: string
  visitId?: string | null
  kind: InvoiceLineAllocationKind
  amount: number
  quantity?: string | null
}): Promise<typeof schema.InvoiceLineAllocation.$inferSelect> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new BadRequestError('Allocated line amount must be positive integer cents')
  }
  const db = input.db ?? database
  const [created] = await db
    .insert(schema.InvoiceLineAllocation)
    .values({
      organizationId: input.organizationId,
      workOrderId: input.workOrderId,
      invoiceId: input.invoiceId,
      invoiceLineItemId: input.invoiceLineItemId,
      sourceLineItemId: input.sourceLineItemId,
      visitId: input.visitId,
      kind: input.kind,
      amount: input.amount,
      quantity: input.quantity,
    })
    .returning()
  if (!created) throw new Error('Failed to create invoice line allocation')
  return created
}

/** Claim a visit for a draft invoice. The partial unique index is the final dedup guard. */
export async function allocateInvoiceVisit(input: {
  db?: Database
  organizationId: string
  workOrderId: string
  invoiceId: string
  visitId: string
  kind: 'base' | 'additional'
}): Promise<typeof schema.InvoiceVisitAllocation.$inferSelect> {
  const db = input.db ?? database
  const [created] = await db
    .insert(schema.InvoiceVisitAllocation)
    .values({
      organizationId: input.organizationId,
      workOrderId: input.workOrderId,
      invoiceId: input.invoiceId,
      visitId: input.visitId,
      kind: input.kind,
    })
    .returning()
  if (!created) throw new Error('Failed to create invoice visit allocation')
  return created
}

/** Claim a recurrence occurrence independently from scheduler cursor movement. */
export async function allocateScheduleOccurrence(input: {
  db?: Database
  organizationId: string
  workOrderId: string
  invoiceId: string
  recurrenceRuleId: string
  occurrenceDate: string
}): Promise<typeof schema.InvoiceScheduleAllocation.$inferSelect> {
  const db = input.db ?? database
  const [created] = await db
    .insert(schema.InvoiceScheduleAllocation)
    .values({
      organizationId: input.organizationId,
      workOrderId: input.workOrderId,
      invoiceId: input.invoiceId,
      recurrenceRuleId: input.recurrenceRuleId,
      occurrenceDate: input.occurrenceDate,
    })
    .returning()
  if (!created) throw new Error('Failed to create invoice schedule allocation')
  return created
}

/** Active amount already claimed from each requested source line. */
export async function getActiveAllocatedAmounts(input: {
  db?: Database
  organizationId: string
  sourceLineItemIds: string[]
}): Promise<Map<string, number>> {
  if (input.sourceLineItemIds.length === 0) return new Map()
  const db = input.db ?? database
  const rows = await db
    .select({
      sourceLineItemId: schema.InvoiceLineAllocation.sourceLineItemId,
      amount: sql<number>`coalesce(sum(${schema.InvoiceLineAllocation.amount}), 0)::int`,
    })
    .from(schema.InvoiceLineAllocation)
    .where(
      and(
        eq(schema.InvoiceLineAllocation.organizationId, input.organizationId),
        eq(schema.InvoiceLineAllocation.status, 'active'),
        inArray(schema.InvoiceLineAllocation.sourceLineItemId, input.sourceLineItemIds)
      )
    )
    .groupBy(schema.InvoiceLineAllocation.sourceLineItemId)
  return new Map(rows.map((row) => [row.sourceLineItemId, Number(row.amount)]))
}

/** List active allocation rows for an invoice. */
export async function listInvoiceAllocations(input: {
  db?: Database
  organizationId: string
  invoiceId: string
}) {
  const db = input.db ?? database
  return Promise.all([
    db.query.InvoiceLineAllocation.findMany({
      where: and(
        eq(schema.InvoiceLineAllocation.organizationId, input.organizationId),
        eq(schema.InvoiceLineAllocation.invoiceId, input.invoiceId),
        eq(schema.InvoiceLineAllocation.status, 'active')
      ),
    }),
    db.query.InvoiceVisitAllocation.findMany({
      where: and(
        eq(schema.InvoiceVisitAllocation.organizationId, input.organizationId),
        eq(schema.InvoiceVisitAllocation.invoiceId, input.invoiceId),
        eq(schema.InvoiceVisitAllocation.status, 'active')
      ),
    }),
    db.query.InvoiceScheduleAllocation.findMany({
      where: and(
        eq(schema.InvoiceScheduleAllocation.organizationId, input.organizationId),
        eq(schema.InvoiceScheduleAllocation.invoiceId, input.invoiceId),
        eq(schema.InvoiceScheduleAllocation.status, 'active')
      ),
    }),
  ]).then(([lineAllocations, visitAllocations, scheduleAllocations]) => ({
    lineAllocations,
    visitAllocations,
    scheduleAllocations,
  }))
}

/** `'base'` is the per-visit claim; `'any'` also counts `'additional'` extra-work claims. */
export type VisitAllocationScope = 'base' | 'any'

export type InstallmentStatus = (typeof schema.WorkOrderBillingInstallment.$inferSelect)['status']

function visitAllocationKind(scope: VisitAllocationScope) {
  return scope === 'base' ? eq(schema.InvoiceVisitAllocation.kind, 'base') : undefined
}

/** Active visit claims on a work order. `visitKind` has no default: the old copies disagreed. */
export async function listWorkOrderVisitAllocations(
  db: Database,
  organizationId: string,
  workOrderId: string,
  options: { visitKind: VisitAllocationScope }
): Promise<(typeof schema.InvoiceVisitAllocation.$inferSelect)[]> {
  return db.query.InvoiceVisitAllocation.findMany({
    where: and(
      eq(schema.InvoiceVisitAllocation.organizationId, organizationId),
      eq(schema.InvoiceVisitAllocation.workOrderId, workOrderId),
      eq(schema.InvoiceVisitAllocation.status, 'active'),
      visitAllocationKind(options.visitKind)
    ),
  })
}

/** Active visit claims for specific visits, across work orders. */
export async function listVisitAllocationsForVisits(
  db: Database,
  organizationId: string,
  visitIds: string[],
  options: { visitKind: VisitAllocationScope }
): Promise<(typeof schema.InvoiceVisitAllocation.$inferSelect)[]> {
  if (visitIds.length === 0) return []
  return db.query.InvoiceVisitAllocation.findMany({
    where: and(
      eq(schema.InvoiceVisitAllocation.organizationId, organizationId),
      inArray(schema.InvoiceVisitAllocation.visitId, visitIds),
      eq(schema.InvoiceVisitAllocation.status, 'active'),
      visitAllocationKind(options.visitKind)
    ),
  })
}

/** The three active allocation tables for a work order. */
export async function listWorkOrderAllocations(
  db: Database,
  organizationId: string,
  workOrderId: string,
  options: { visitKind: VisitAllocationScope }
) {
  const [lineAllocations, visitAllocations, scheduleAllocations] = await Promise.all([
    db.query.InvoiceLineAllocation.findMany({
      where: and(
        eq(schema.InvoiceLineAllocation.organizationId, organizationId),
        eq(schema.InvoiceLineAllocation.workOrderId, workOrderId),
        eq(schema.InvoiceLineAllocation.status, 'active')
      ),
    }),
    listWorkOrderVisitAllocations(db, organizationId, workOrderId, options),
    db.query.InvoiceScheduleAllocation.findMany({
      where: and(
        eq(schema.InvoiceScheduleAllocation.organizationId, organizationId),
        eq(schema.InvoiceScheduleAllocation.workOrderId, workOrderId),
        eq(schema.InvoiceScheduleAllocation.status, 'active')
      ),
    }),
  ])
  return { lineAllocations, visitAllocations, scheduleAllocations }
}

/** Whether any of the three allocation tables still claims this work order. */
export async function hasActiveAllocations(
  db: Database,
  organizationId: string,
  workOrderId: string
): Promise<boolean> {
  const [line, visit, schedule] = await Promise.all([
    db.query.InvoiceLineAllocation.findFirst({
      where: and(
        eq(schema.InvoiceLineAllocation.organizationId, organizationId),
        eq(schema.InvoiceLineAllocation.workOrderId, workOrderId),
        eq(schema.InvoiceLineAllocation.status, 'active')
      ),
      columns: { id: true },
    }),
    db.query.InvoiceVisitAllocation.findFirst({
      where: and(
        eq(schema.InvoiceVisitAllocation.organizationId, organizationId),
        eq(schema.InvoiceVisitAllocation.workOrderId, workOrderId),
        eq(schema.InvoiceVisitAllocation.status, 'active')
      ),
      columns: { id: true },
    }),
    db.query.InvoiceScheduleAllocation.findFirst({
      where: and(
        eq(schema.InvoiceScheduleAllocation.organizationId, organizationId),
        eq(schema.InvoiceScheduleAllocation.workOrderId, workOrderId),
        eq(schema.InvoiceScheduleAllocation.status, 'active')
      ),
      columns: { id: true },
    }),
  ])
  return Boolean(line || visit || schedule)
}

/** Payment-schedule installments for a work order, in schedule order. */
export async function listInstallments(
  db: Database,
  organizationId: string,
  workOrderId: string,
  options: { status?: InstallmentStatus | InstallmentStatus[] } = {}
): Promise<(typeof schema.WorkOrderBillingInstallment.$inferSelect)[]> {
  const status = options.status
  return db.query.WorkOrderBillingInstallment.findMany({
    where: and(
      eq(schema.WorkOrderBillingInstallment.organizationId, organizationId),
      eq(schema.WorkOrderBillingInstallment.workOrderId, workOrderId),
      status === undefined
        ? undefined
        : Array.isArray(status)
          ? inArray(schema.WorkOrderBillingInstallment.status, status)
          : eq(schema.WorkOrderBillingInstallment.status, status)
    ),
    orderBy: [asc(schema.WorkOrderBillingInstallment.sortOrder)],
  })
}

/** Installments a given invoice drafted or issued. */
export async function listInvoiceInstallments(
  db: Database,
  organizationId: string,
  invoiceId: string
): Promise<(typeof schema.WorkOrderBillingInstallment.$inferSelect)[]> {
  return db.query.WorkOrderBillingInstallment.findMany({
    where: and(
      eq(schema.WorkOrderBillingInstallment.organizationId, organizationId),
      eq(schema.WorkOrderBillingInstallment.invoiceId, invoiceId)
    ),
    orderBy: [asc(schema.WorkOrderBillingInstallment.sortOrder)],
  })
}

/** Release active line claims, by invoice, by invoice line, or by allocation id. */
export async function releaseLineAllocations(
  db: Database,
  organizationId: string,
  selector: { invoiceId: string } | { invoiceLineItemId: string } | { ids: string[] }
): Promise<void> {
  let match: SQL
  if ('invoiceId' in selector) {
    match = eq(schema.InvoiceLineAllocation.invoiceId, selector.invoiceId)
  } else if ('invoiceLineItemId' in selector) {
    match = eq(schema.InvoiceLineAllocation.invoiceLineItemId, selector.invoiceLineItemId)
  } else {
    if (selector.ids.length === 0) return
    match = inArray(schema.InvoiceLineAllocation.id, selector.ids)
  }
  await db
    .update(schema.InvoiceLineAllocation)
    .set({ status: 'released', releasedAt: new Date() })
    .where(
      and(
        eq(schema.InvoiceLineAllocation.organizationId, organizationId),
        eq(schema.InvoiceLineAllocation.status, 'active'),
        match
      )
    )
}

/** Flip installments by id, optionally repointing them at the invoice that claimed them. */
export async function setInstallmentStatus(
  db: Database,
  organizationId: string,
  ids: string[],
  status: InstallmentStatus,
  options: { invoiceId?: string | null } = {}
): Promise<void> {
  if (ids.length === 0) return
  await db
    .update(schema.WorkOrderBillingInstallment)
    .set('invoiceId' in options ? { status, invoiceId: options.invoiceId } : { status })
    .where(
      and(
        eq(schema.WorkOrderBillingInstallment.organizationId, organizationId),
        inArray(schema.WorkOrderBillingInstallment.id, ids)
      )
    )
}

/** Promote an invoice's drafted installments once the invoice is issued. */
export async function markInstallmentsInvoiced(
  db: Database,
  organizationId: string,
  invoiceId: string
): Promise<void> {
  await db
    .update(schema.WorkOrderBillingInstallment)
    .set({ status: 'invoiced' })
    .where(
      and(
        eq(schema.WorkOrderBillingInstallment.organizationId, organizationId),
        eq(schema.WorkOrderBillingInstallment.invoiceId, invoiceId),
        eq(schema.WorkOrderBillingInstallment.status, 'drafted')
      )
    )
}

/** Release every active billing claim made by an invoice while preserving audit rows. */
export async function releaseInvoiceAllocations(input: {
  db?: Database
  organizationId: string
  invoiceId: string
}): Promise<void> {
  const db = input.db ?? database
  const now = new Date()
  await Promise.all([
    releaseLineAllocations(db, input.organizationId, { invoiceId: input.invoiceId }),
    db
      .update(schema.InvoiceVisitAllocation)
      .set({ status: 'released', releasedAt: now })
      .where(
        and(
          eq(schema.InvoiceVisitAllocation.organizationId, input.organizationId),
          eq(schema.InvoiceVisitAllocation.invoiceId, input.invoiceId),
          eq(schema.InvoiceVisitAllocation.status, 'active')
        )
      ),
    db
      .update(schema.InvoiceScheduleAllocation)
      .set({ status: 'released', releasedAt: now })
      .where(
        and(
          eq(schema.InvoiceScheduleAllocation.organizationId, input.organizationId),
          eq(schema.InvoiceScheduleAllocation.invoiceId, input.invoiceId),
          eq(schema.InvoiceScheduleAllocation.status, 'active')
        )
      ),
    db
      .update(schema.WorkOrderBillingInstallment)
      .set({ status: 'pending', invoiceId: null })
      .where(
        and(
          eq(schema.WorkOrderBillingInstallment.organizationId, input.organizationId),
          eq(schema.WorkOrderBillingInstallment.invoiceId, input.invoiceId)
        )
      ),
  ])
}
