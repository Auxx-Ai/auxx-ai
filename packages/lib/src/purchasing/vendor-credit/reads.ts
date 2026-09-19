// packages/lib/src/purchasing/vendor-credit/reads.ts
//
// Reading one vendor credit, its lines, its applications and the refunds
// against it. Reads only: the writers are `writes.ts` / `apply.ts` / `settle.ts`
// (`docs/lib-module-guide.md` §5).
//
// No permission checks anywhere in this file. The router asserts.

import { type Database, schema } from '@auxx/database'
import { toCalendarDay } from '@auxx/utils/calendar-day'
import { and, eq } from 'drizzle-orm'
import { NotFoundError } from '../../errors'
import { VENDOR_CREDIT_APPLICATION_FIELDS } from '../../resources/registry/resources/vendor-credit-application-fields'
import { VENDOR_CREDIT_FIELDS } from '../../resources/registry/resources/vendor-credit-fields'
import { VENDOR_CREDIT_LINE_FIELDS } from '../../resources/registry/resources/vendor-credit-line-fields'
import { pickSystemAttributes } from '../../resources/registry/system-attributes'
import { getInstanceId } from '../../resources/resource-id'
import { readSystemRecords, type SystemRecord, systemFields } from '../../resources/system-records'
import type { VendorCreditSettlement } from './client'

const CREDIT_ATTRIBUTES = pickSystemAttributes(VENDOR_CREDIT_FIELDS, [
  'vendor_credit_number',
  'vendor_credit_vendor_reference',
  'vendor_credit_status',
  'vendor_credit_issued_at',
  'vendor_credit_vendor',
  'vendor_credit_bill',
  'vendor_credit_purchase_order',
  'vendor_credit_subtotal',
  'vendor_credit_tax_total',
  'vendor_credit_total',
  'vendor_credit_amount_applied',
  'vendor_credit_amount_refunded',
  'vendor_credit_balance',
  'vendor_credit_lines',
] as const)

const LINE_ATTRIBUTES = pickSystemAttributes(VENDOR_CREDIT_LINE_FIELDS, [
  'vendor_credit_line_description',
  'vendor_credit_line_quantity',
  'vendor_credit_line_unit_price',
  'vendor_credit_line_line_total',
  'vendor_credit_line_gl_account',
  'vendor_credit_line_sort_order',
] as const)

const APPLICATION_ATTRIBUTES = pickSystemAttributes(VENDOR_CREDIT_APPLICATION_FIELDS, [
  'vendor_credit_application_vendor_credit',
  'vendor_credit_application_vendor_bill',
  'vendor_credit_application_amount',
  'vendor_credit_application_applied_at',
  'vendor_credit_application_operation',
] as const)

/** One vendor credit's header. */
export interface VendorCreditRecord {
  id: string
  /** OURS — `VC-0001`. The entry's period key. */
  number: string
  status: string
  /** `YYYY-MM-DD`, or `null` while still a draft. */
  issuedAt: string | null
  /** The `company` instance id — the A/P counterparty. */
  vendorCompanyInstanceId: string | null
  vendorBillInstanceId: string | null
  purchaseOrderInstanceId: string | null
  /** Integer minor units. */
  totalMinor: number
  amountAppliedMinor: number
  amountRefundedMinor: number
  balanceMinor: number
  lineIds: string[]
}

/** One coded line of a credit, as the builder reads it. */
export interface VendorCreditLineRecord {
  id: string
  description: string | null
  quantity: number
  /** Integer minor units per unit. */
  unitPriceMinor: number
  /** Integer minor units. `0` when the line carries no total. */
  lineTotalMinor: number
  /** The `gl_account` instance id, or `null` when the line is uncoded. */
  glAccountId: string | null
  sortOrder: number
}

/** One application row, netted by the settlement writer. */
export interface VendorCreditApplicationRecord {
  id: string
  vendorCreditInstanceId: string | null
  vendorBillInstanceId: string | null
  /** Integer minor units. */
  amountMinor: number
  appliedAt: string | null
  operation: 'apply' | 'unapply'
}

/** Read one credit's header, or `null` when it does not exist or is not provisioned. */
export async function loadVendorCredit(
  db: Database,
  organizationId: string,
  vendorCreditInstanceId: string
): Promise<VendorCreditRecord | null> {
  const ctx = await systemFields(db, organizationId, 'vendor_credit', CREDIT_ATTRIBUTES)
  if (!ctx?.fields.vendor_credit_status || !ctx.fields.vendor_credit_total) return null

  const [credit] = await readSystemRecords(db, organizationId, ctx, {
    ids: [vendorCreditInstanceId],
  })
  if (!credit) return null

  return {
    id: vendorCreditInstanceId,
    number: credit.text('vendor_credit_number') ?? '',
    status: credit.option('vendor_credit_status') ?? 'draft',
    issuedAt: toCalendarDay(credit.date('vendor_credit_issued_at')),
    vendorCompanyInstanceId: credit.related('vendor_credit_vendor'),
    vendorBillInstanceId: credit.related('vendor_credit_bill'),
    purchaseOrderInstanceId: credit.related('vendor_credit_purchase_order'),
    totalMinor: credit.number('vendor_credit_total') ?? 0,
    amountAppliedMinor: credit.number('vendor_credit_amount_applied') ?? 0,
    amountRefundedMinor: credit.number('vendor_credit_amount_refunded') ?? 0,
    balanceMinor: credit.number('vendor_credit_balance') ?? 0,
    lineIds: credit
      .cells('vendor_credit_lines')
      .map((value) =>
        value.type === 'relationship' && value.recordId ? getInstanceId(value.recordId) : null
      )
      .filter((id): id is string => !!id),
  }
}

/** {@link loadVendorCredit}, as the refusal a writer needs. */
export async function requireVendorCredit(
  db: Database,
  organizationId: string,
  vendorCreditInstanceId: string
): Promise<VendorCreditRecord> {
  const credit = await loadVendorCredit(db, organizationId, vendorCreditInstanceId)
  if (!credit) throw new NotFoundError('Vendor credit not found', { vendorCreditInstanceId })
  return credit
}

/** The credit's lines, in display order. */
export async function loadVendorCreditLines(
  db: Database,
  organizationId: string,
  lineIds: readonly string[]
): Promise<VendorCreditLineRecord[]> {
  if (lineIds.length === 0) return []
  const ctx = await systemFields(db, organizationId, 'vendor_credit_line', LINE_ATTRIBUTES)
  if (!ctx) return []

  const rows = await readSystemRecords(db, organizationId, ctx, { ids: [...lineIds] })
  return rows
    .map((line) => ({
      id: line.id,
      description: line.text('vendor_credit_line_description'),
      quantity: line.number('vendor_credit_line_quantity') ?? 0,
      unitPriceMinor: line.number('vendor_credit_line_unit_price') ?? 0,
      lineTotalMinor: line.number('vendor_credit_line_line_total') ?? 0,
      glAccountId: line.text('vendor_credit_line_gl_account'),
      sortOrder: line.number('vendor_credit_line_sort_order') ?? 0,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

/** Every application row against one credit, oldest first. */
export async function listVendorCreditApplications(
  db: Database,
  organizationId: string,
  vendorCreditInstanceId: string
): Promise<VendorCreditApplicationRecord[]> {
  return listApplications(db, organizationId, {
    attribute: 'vendor_credit_application_vendor_credit',
    instanceId: vendorCreditInstanceId,
  })
}

/** Every application row against one bill, oldest first. */
export async function listVendorBillCreditApplications(
  db: Database,
  organizationId: string,
  vendorBillInstanceId: string
): Promise<VendorCreditApplicationRecord[]> {
  return listApplications(db, organizationId, {
    attribute: 'vendor_credit_application_vendor_bill',
    instanceId: vendorBillInstanceId,
  })
}

/** Load one application row, or `null`. */
export async function loadVendorCreditApplication(
  db: Database,
  organizationId: string,
  applicationInstanceId: string
): Promise<VendorCreditApplicationRecord | null> {
  const ctx = await systemFields(
    db,
    organizationId,
    'vendor_credit_application',
    APPLICATION_ATTRIBUTES
  )
  if (!ctx) return null
  const [row] = await readSystemRecords(db, organizationId, ctx, { ids: [applicationInstanceId] })
  return row ? toApplication(row) : null
}

/** Net applied credit on one credit, integer minor units. */
export async function sumVendorCreditApplications(
  db: Database,
  organizationId: string,
  vendorCreditInstanceId: string
): Promise<number> {
  const rows = await listVendorCreditApplications(db, organizationId, vendorCreditInstanceId)
  return netApplications(rows)
}

/** Net credit applied to one bill, integer minor units. */
export async function sumVendorBillCreditApplications(
  db: Database,
  organizationId: string,
  vendorBillInstanceId: string
): Promise<number> {
  const rows = await listVendorBillCreditApplications(db, organizationId, vendorBillInstanceId)
  return netApplications(rows)
}

/**
 * Every `vendor_refund` movement settling one credit, and their sum.
 *
 * Read through `MoneyRefundSettlement.vendorCreditInstanceId`, which is the
 * schema's own edge for this disposition.
 */
export async function listVendorCreditRefunds(
  db: Database,
  organizationId: string,
  vendorCreditInstanceId: string
): Promise<
  Array<{
    moneyTransactionId: string
    amountMinor: number
    method: string | null
    reference: string | null
    effectiveDate: string
  }>
> {
  const settlements = await db
    .select({
      refundTransactionId: schema.MoneyRefundSettlement.refundTransactionId,
      amountMinor: schema.MoneyTransaction.amountMinor,
      method: schema.MoneyTransaction.method,
      reference: schema.MoneyTransaction.reference,
      occurredOn: schema.MoneyTransaction.occurredOn,
      occurredAt: schema.MoneyTransaction.occurredAt,
    })
    .from(schema.MoneyRefundSettlement)
    .innerJoin(
      schema.MoneyTransaction,
      eq(schema.MoneyTransaction.id, schema.MoneyRefundSettlement.refundTransactionId)
    )
    .where(
      and(
        eq(schema.MoneyRefundSettlement.organizationId, organizationId),
        eq(schema.MoneyRefundSettlement.disposition, 'vendor_credit'),
        eq(schema.MoneyRefundSettlement.vendorCreditInstanceId, vendorCreditInstanceId)
      )
    )

  return settlements.map((row) => ({
    moneyTransactionId: row.refundTransactionId,
    amountMinor: Number(row.amountMinor),
    method: row.method,
    reference: row.reference,
    effectiveDate: row.occurredOn ?? row.occurredAt?.toISOString().slice(0, 10) ?? '',
  }))
}

/** Integer minor units: everything the supplier has actually paid back on this credit. */
export async function sumVendorCreditRefunds(
  db: Database,
  organizationId: string,
  vendorCreditInstanceId: string
): Promise<number> {
  const refunds = await listVendorCreditRefunds(db, organizationId, vendorCreditInstanceId)
  return refunds.reduce((sum, refund) => sum + refund.amountMinor, 0)
}

/** One bill a credit may be applied to, as the apply picker lists them. */
export interface OpenVendorBillRow {
  vendorBillInstanceId: string
  number: string
  status: string
  /** Integer minor units. */
  totalMinor: number
  balanceMinor: number
}

/**
 * One vendor's bills with something still owed, oldest first — the apply
 * picker's list.
 *
 * ⚠️ A `draft` bill is dropped here because it has no payable yet, but the
 * authoritative gate is still `applyVendorCredit`'s: a bill with no live A/P
 * posting is refused whatever this list says.
 */
export async function listOpenBillsForVendor(
  db: Database,
  organizationId: string,
  vendorCompanyInstanceId: string
): Promise<OpenVendorBillRow[]> {
  const ctx = await systemFields(db, organizationId, 'vendor_bill', [
    'vendor_bill_internal_number',
    'vendor_bill_status',
    'vendor_bill_total',
    'vendor_bill_balance',
    'vendor_bill_vendor',
  ] as const)
  if (!ctx) return []
  const vendorField = ctx.fields.vendor_bill_vendor
  if (!vendorField) return []

  const ids = await db
    .selectDistinct({ entityId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, vendorField.id),
        eq(schema.FieldValue.relatedEntityId, vendorCompanyInstanceId)
      )
    )
  if (ids.length === 0) return []

  const rows = await readSystemRecords(db, organizationId, ctx, {
    ids: ids.map((row) => row.entityId),
  })
  return rows
    .map((bill) => ({
      vendorBillInstanceId: bill.id,
      number: bill.text('vendor_bill_internal_number') ?? '',
      status: bill.option('vendor_bill_status') ?? 'draft',
      totalMinor: bill.number('vendor_bill_total') ?? 0,
      balanceMinor: bill.number('vendor_bill_balance') ?? bill.number('vendor_bill_total') ?? 0,
    }))
    .filter((bill) => bill.status !== 'draft' && bill.status !== 'void' && bill.balanceMinor > 0)
    .sort((a, b) => a.number.localeCompare(b.number))
}

/**
 * Total, applied, refunded, balance, and the rows behind two of them — what the
 * settlement card renders. The mirror of `readCreditMemoSettlement`.
 */
export async function readVendorCreditSettlement(
  db: Database,
  organizationId: string,
  vendorCreditInstanceId: string
): Promise<VendorCreditSettlement> {
  const credit = await requireVendorCredit(db, organizationId, vendorCreditInstanceId)
  const [applications, refunds] = await Promise.all([
    listVendorCreditApplications(db, organizationId, vendorCreditInstanceId),
    listVendorCreditRefunds(db, organizationId, vendorCreditInstanceId),
  ])

  // The bill numbers, one read across whatever rows the applications name.
  const billIds = [
    ...new Set(
      applications.map((row) => row.vendorBillInstanceId).filter((id): id is string => !!id)
    ),
  ]
  const billNumbers = new Map<string, string>()
  if (billIds.length > 0) {
    const ctx = await systemFields(db, organizationId, 'vendor_bill', [
      'vendor_bill_internal_number',
    ] as const)
    if (ctx) {
      for (const row of await readSystemRecords(db, organizationId, ctx, { ids: billIds }))
        billNumbers.set(row.id, row.text('vendor_bill_internal_number') ?? '')
    }
  }

  return {
    vendorCreditInstanceId,
    number: credit.number,
    status: credit.status,
    vendorInstanceId: credit.vendorCompanyInstanceId,
    vendorBillInstanceId: credit.vendorBillInstanceId,
    totalMinor: credit.totalMinor,
    amountAppliedMinor: credit.amountAppliedMinor,
    amountRefundedMinor: credit.amountRefundedMinor,
    balanceMinor: credit.balanceMinor,
    applications: applications.map((row) => ({
      applicationInstanceId: row.id,
      vendorBillInstanceId: row.vendorBillInstanceId ?? '',
      vendorBillNumber: row.vendorBillInstanceId
        ? (billNumbers.get(row.vendorBillInstanceId) ?? '')
        : '',
      operation: row.operation,
      amountMinor: row.amountMinor,
      appliedAt: row.appliedAt,
    })),
    refunds: refunds.map((row) => ({
      moneyTransactionId: row.moneyTransactionId,
      amountMinor: row.amountMinor,
      method: row.method,
      reference: row.reference,
      effectiveDate: row.effectiveDate,
    })),
  }
}

async function listApplications(
  db: Database,
  organizationId: string,
  scope: {
    attribute: 'vendor_credit_application_vendor_credit' | 'vendor_credit_application_vendor_bill'
    instanceId: string
  }
): Promise<VendorCreditApplicationRecord[]> {
  const ctx = await systemFields(
    db,
    organizationId,
    'vendor_credit_application',
    APPLICATION_ATTRIBUTES
  )
  if (!ctx) return []
  const field = ctx.fields[scope.attribute]
  if (!field) return []

  const ids = await db
    .selectDistinct({ entityId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, field.id),
        eq(schema.FieldValue.relatedEntityId, scope.instanceId)
      )
    )
  if (ids.length === 0) return []

  const rows = await readSystemRecords(db, organizationId, ctx, {
    ids: ids.map((row) => row.entityId),
  })
  return rows
    .map(toApplication)
    .sort((a, b) => (a.appliedAt ?? '').localeCompare(b.appliedAt ?? ''))
}

type ApplicationAttribute = (typeof APPLICATION_ATTRIBUTES)[number]

function toApplication(row: SystemRecord<ApplicationAttribute>): VendorCreditApplicationRecord {
  const operation = row.text('vendor_credit_application_operation')
  return {
    id: row.id,
    vendorCreditInstanceId: row.related('vendor_credit_application_vendor_credit'),
    vendorBillInstanceId: row.related('vendor_credit_application_vendor_bill'),
    amountMinor: row.number('vendor_credit_application_amount') ?? 0,
    appliedAt: row.date('vendor_credit_application_applied_at'),
    operation: operation === 'unapply' ? 'unapply' : 'apply',
  }
}

function netApplications(rows: readonly VendorCreditApplicationRecord[]): number {
  return rows.reduce(
    (sum, row) => sum + (row.operation === 'unapply' ? -row.amountMinor : row.amountMinor),
    0
  )
}
