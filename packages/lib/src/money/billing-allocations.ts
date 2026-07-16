// packages/lib/src/money/billing-allocations.ts

import { type Database, database, schema } from '@auxx/database'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { BadRequestError } from '../errors'

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

/** Release every active billing claim made by an invoice while preserving audit rows. */
export async function releaseInvoiceAllocations(input: {
  db?: Database
  organizationId: string
  invoiceId: string
}): Promise<void> {
  const db = input.db ?? database
  const now = new Date()
  await Promise.all([
    db
      .update(schema.InvoiceLineAllocation)
      .set({ status: 'released', releasedAt: now })
      .where(
        and(
          eq(schema.InvoiceLineAllocation.organizationId, input.organizationId),
          eq(schema.InvoiceLineAllocation.invoiceId, input.invoiceId),
          eq(schema.InvoiceLineAllocation.status, 'active')
        )
      ),
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
