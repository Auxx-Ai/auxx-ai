// packages/database/src/db/schema/work-order-billing.ts
// Durable work-order billing allocations and fixed-contract installment schedules.

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  check,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  sql,
  text,
  timestamp,
  uniqueIndex,
} from './_shared'
import { EntityInstance } from './entity-instance'
import { Organization } from './organization'
import { RecurrenceRule } from './recurrence-rule'
import { WorkOrderVisit } from './work-order-visit'

export const invoiceVisitAllocationKind = pgEnum('InvoiceVisitAllocationKind', [
  'base',
  'additional',
])
export const invoiceAllocationStatus = pgEnum('InvoiceAllocationStatus', ['active', 'released'])
export const invoiceLineAllocationKind = pgEnum('InvoiceLineAllocationKind', [
  'contract',
  'visit_template',
  'visit_addition',
  'recurring_charge',
])
export const workOrderBillingInstallmentCalculation = pgEnum(
  'WorkOrderBillingInstallmentCalculation',
  ['percentage', 'fixed']
)
export const workOrderBillingInstallmentTrigger = pgEnum('WorkOrderBillingInstallmentTrigger', [
  'manual',
  'date',
  'work_order_completion',
])
export const workOrderBillingInstallmentStatus = pgEnum('WorkOrderBillingInstallmentStatus', [
  'pending',
  'drafted',
  'invoiced',
  'canceled',
])

/** Connects an invoice snapshot to each visit whose price it claims. */
export const InvoiceVisitAllocation = pgTable(
  'InvoiceVisitAllocation',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    workOrderId: text()
      .notNull()
      .references((): AnyPgColumn => EntityInstance.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    invoiceId: text()
      .notNull()
      .references((): AnyPgColumn => EntityInstance.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    visitId: text()
      .notNull()
      .references((): AnyPgColumn => WorkOrderVisit.id, {
        onUpdate: 'cascade',
        onDelete: 'restrict',
      }),
    kind: invoiceVisitAllocationKind().notNull(),
    status: invoiceAllocationStatus().default('active').notNull(),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    releasedAt: timestamp({ precision: 3 }),
  },
  (table) => [
    uniqueIndex('InvoiceVisitAllocation_invoiceId_visitId_kind_key').using(
      'btree',
      table.invoiceId.asc().nullsLast(),
      table.visitId.asc().nullsLast(),
      table.kind.asc().nullsLast()
    ),
    uniqueIndex('InvoiceVisitAllocation_visitId_active_base_key')
      .using('btree', table.visitId.asc().nullsLast(), table.kind.asc().nullsLast())
      .where(sql`${table.status} = 'active' AND ${table.kind} = 'base'`),
    index('InvoiceVisitAllocation_organizationId_workOrderId_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.workOrderId.asc().nullsLast()
    ),
    index('InvoiceVisitAllocation_invoiceId_idx').using('btree', table.invoiceId.asc().nullsLast()),
    index('InvoiceVisitAllocation_visitId_idx').using('btree', table.visitId.asc().nullsLast()),
  ]
)

/** Records the source and amount claimed by one generated invoice line snapshot. */
export const InvoiceLineAllocation = pgTable(
  'InvoiceLineAllocation',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    workOrderId: text()
      .notNull()
      .references((): AnyPgColumn => EntityInstance.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    invoiceId: text()
      .notNull()
      .references((): AnyPgColumn => EntityInstance.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    invoiceLineItemId: text()
      .notNull()
      .references((): AnyPgColumn => EntityInstance.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    sourceLineItemId: text()
      .notNull()
      .references((): AnyPgColumn => EntityInstance.id, {
        onUpdate: 'cascade',
        onDelete: 'restrict',
      }),
    visitId: text().references((): AnyPgColumn => WorkOrderVisit.id, {
      onUpdate: 'cascade',
      onDelete: 'restrict',
    }),
    kind: invoiceLineAllocationKind().notNull(),
    /** Explicit minor-unit value; source edits never rewrite historical invoice math. */
    amount: integer().notNull(),
    quantity: numeric(),
    status: invoiceAllocationStatus().default('active').notNull(),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    releasedAt: timestamp({ precision: 3 }),
  },
  (table) => [
    uniqueIndex('InvoiceLineAllocation_invoiceLineItemId_key').using(
      'btree',
      table.invoiceLineItemId.asc().nullsLast()
    ),
    uniqueIndex('InvoiceLineAllocation_sourceLineItemId_active_visitAddition_key')
      .using('btree', table.sourceLineItemId.asc().nullsLast())
      .where(sql`${table.status} = 'active' AND ${table.kind} = 'visit_addition'`),
    uniqueIndex('InvoiceLineAllocation_sourceLineItemId_visitId_active_template_key')
      .using('btree', table.sourceLineItemId.asc().nullsLast(), table.visitId.asc().nullsLast())
      .where(sql`${table.status} = 'active' AND ${table.kind} = 'visit_template'`),
    index('InvoiceLineAllocation_organizationId_workOrderId_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.workOrderId.asc().nullsLast()
    ),
    index('InvoiceLineAllocation_invoiceId_idx').using('btree', table.invoiceId.asc().nullsLast()),
    index('InvoiceLineAllocation_sourceLineItemId_idx').using(
      'btree',
      table.sourceLineItemId.asc().nullsLast()
    ),
    index('InvoiceLineAllocation_visitId_idx').using('btree', table.visitId.asc().nullsLast()),
  ]
)

/** A resolved fixed-contract installment used by progress invoice generation. */
export const WorkOrderBillingInstallment = pgTable(
  'WorkOrderBillingInstallment',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    workOrderId: text()
      .notNull()
      .references((): AnyPgColumn => EntityInstance.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    name: text().notNull(),
    sortOrder: integer().notNull(),
    calculation: workOrderBillingInstallmentCalculation().notNull(),
    percentageBasisPoints: integer(),
    /** Resolved minor-unit amount. */
    amount: integer().notNull(),
    trigger: workOrderBillingInstallmentTrigger().notNull(),
    scheduledDate: date(),
    invoiceId: text().references((): AnyPgColumn => EntityInstance.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    status: workOrderBillingInstallmentStatus().default('pending').notNull(),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check(
      'WorkOrderBillingInstallment_calculation_check',
      sql`(${table.calculation} = 'percentage' AND ${table.percentageBasisPoints} BETWEEN 1 AND 10000) OR (${table.calculation} = 'fixed' AND ${table.percentageBasisPoints} IS NULL)`
    ),
    check(
      'WorkOrderBillingInstallment_scheduledDate_check',
      sql`${table.trigger} <> 'date' OR ${table.scheduledDate} IS NOT NULL`
    ),
    index('WorkOrderBillingInstallment_organizationId_workOrderId_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.workOrderId.asc().nullsLast()
    ),
    index('WorkOrderBillingInstallment_invoiceId_idx').using(
      'btree',
      table.invoiceId.asc().nullsLast()
    ),
    index('WorkOrderBillingInstallment_status_scheduledDate_idx').using(
      'btree',
      table.status.asc().nullsLast(),
      table.scheduledDate.asc().nullsLast()
    ),
  ]
)

/** Idempotency and audit record for one recurring flat-rate billing occurrence. */
export const InvoiceScheduleAllocation = pgTable(
  'InvoiceScheduleAllocation',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    workOrderId: text()
      .notNull()
      .references((): AnyPgColumn => EntityInstance.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    invoiceId: text()
      .notNull()
      .references((): AnyPgColumn => EntityInstance.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    recurrenceRuleId: text()
      .notNull()
      .references((): AnyPgColumn => RecurrenceRule.id, {
        onUpdate: 'cascade',
        onDelete: 'restrict',
      }),
    occurrenceDate: date().notNull(),
    status: invoiceAllocationStatus().default('active').notNull(),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    releasedAt: timestamp({ precision: 3 }),
  },
  (table) => [
    uniqueIndex('InvoiceScheduleAllocation_recurrenceRuleId_occurrenceDate_active_key')
      .using(
        'btree',
        table.recurrenceRuleId.asc().nullsLast(),
        table.occurrenceDate.asc().nullsLast()
      )
      .where(sql`${table.status} = 'active'`),
    index('InvoiceScheduleAllocation_organizationId_workOrderId_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.workOrderId.asc().nullsLast()
    ),
    index('InvoiceScheduleAllocation_invoiceId_idx').using(
      'btree',
      table.invoiceId.asc().nullsLast()
    ),
    index('InvoiceScheduleAllocation_recurrenceRuleId_idx').using(
      'btree',
      table.recurrenceRuleId.asc().nullsLast()
    ),
  ]
)

export type InvoiceVisitAllocationEntity = typeof InvoiceVisitAllocation.$inferSelect
export type InvoiceVisitAllocationInsert = typeof InvoiceVisitAllocation.$inferInsert
export type InvoiceLineAllocationEntity = typeof InvoiceLineAllocation.$inferSelect
export type InvoiceLineAllocationInsert = typeof InvoiceLineAllocation.$inferInsert
export type WorkOrderBillingInstallmentEntity = typeof WorkOrderBillingInstallment.$inferSelect
export type WorkOrderBillingInstallmentInsert = typeof WorkOrderBillingInstallment.$inferInsert
export type InvoiceScheduleAllocationEntity = typeof InvoiceScheduleAllocation.$inferSelect
export type InvoiceScheduleAllocationInsert = typeof InvoiceScheduleAllocation.$inferInsert
