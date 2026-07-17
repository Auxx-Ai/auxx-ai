// apps/web/src/components/money/billing/types.ts

import type { RecordId } from '@auxx/types/resource'
import type { RouterOutputs } from '~/trpc/react'

export type BillingBasis = 'fixed_contract' | 'per_visit' | 'recurring_flat'
export type BillingTiming =
  | 'per_visit_completed'
  | 'on_completion'
  | 'as_needed'
  | 'custom_schedule'

type WorkOrderBillingStateData = RouterOutputs['money']['getWorkOrderBillingState']
type ContactBillingOverviewData = RouterOutputs['money']['getContactBillingOverview']
type WorkOrderBillingVisitData = WorkOrderBillingStateData['eligibleVisits'][number]
type WorkOrderBillingInstallmentData = WorkOrderBillingStateData['installments'][number]
type WorkOrderBillingInvoiceData = WorkOrderBillingStateData['invoices'][number]

export interface BillingInvoiceRow {
  recordId: RecordId
  displayName: string
  status: string
  total: number
  balance: number
  servicePeriodStart?: string | null
  servicePeriodEnd?: string | null
  visitCount?: number
}

export interface BillingVisitRow {
  id: string
  label: string
  serviceDate?: string | null
  amount: number
  invoiceState?: 'uninvoiced' | 'drafted' | 'invoiced'
  invoiceId?: string
}

/** One billable visit-pinned extra line (plan money/19 §B) — the server already filtered out
 * unpriced lines and canceled/dangling visits. */
export interface BillingExtraWorkRow {
  id: string
  visitId: string
  visitStatus: string
  serviceDate?: string | null
  name: string
  amount: number
}

export interface BillingInstallmentRow {
  id: string
  name: string
  amount: number
  status: string
  scheduledDate?: string | null
  calculation: 'percentage' | 'fixed'
  percentageBasisPoints?: number | null
  trigger: 'manual' | 'date' | 'work_order_completion'
}

export interface WorkOrderBillingView {
  basis: BillingBasis
  timing: BillingTiming
  state: string
  currencyCode: string
  billingAmount: number
  drafted: number
  invoiced: number
  remaining: number
  balanceDue: number
  depositHeld: number
  depositApplied: number
  nextInvoiceDate?: string | null
  eligibleVisits: BillingVisitRow[]
  extraWork: BillingExtraWorkRow[]
  extraWorkVisitIds: string[]
  installments: BillingInstallmentRow[]
  invoices: BillingInvoiceRow[]
}

export interface ContactBillingView {
  currencyCode: string
  balanceDue: number
  overdueAmount: number
  overdueCount: number
  draftAmount: number
  draftCount: number
  uninvoicedAmount: number
  readyWorkOrderCount: number
  readyWorkOrderRecordId?: RecordId
  recentInvoices: BillingInvoiceRow[]
}

const EMPTY_WORK_ORDER_BILLING: WorkOrderBillingView = {
  basis: 'per_visit',
  timing: 'as_needed',
  state: 'not_ready',
  currencyCode: 'USD',
  billingAmount: 0,
  drafted: 0,
  invoiced: 0,
  remaining: 0,
  balanceDue: 0,
  depositHeld: 0,
  depositApplied: 0,
  nextInvoiceDate: null,
  eligibleVisits: [],
  extraWork: [],
  extraWorkVisitIds: [],
  installments: [],
  invoices: [],
}

const EMPTY_CONTACT_BILLING: ContactBillingView = {
  currencyCode: 'USD',
  balanceDue: 0,
  overdueAmount: 0,
  overdueCount: 0,
  draftAmount: 0,
  draftCount: 0,
  uninvoicedAmount: 0,
  readyWorkOrderCount: 0,
  readyWorkOrderRecordId: undefined,
  recentInvoices: [],
}

/** Normalize the server-composed work-order billing response for all billing surfaces. */
export function normalizeWorkOrderBilling(
  data: WorkOrderBillingStateData | undefined
): WorkOrderBillingView {
  if (!data) return EMPTY_WORK_ORDER_BILLING

  return {
    basis: data.basis,
    timing: data.timing,
    state: data.state,
    currencyCode: data.currencyCode,
    billingAmount: data.summary.billingAmount,
    drafted: data.summary.drafted,
    invoiced: data.summary.invoiced,
    remaining: data.summary.remaining,
    balanceDue: data.summary.balanceDue,
    depositHeld: data.summary.depositHeld,
    depositApplied: data.summary.depositApplied,
    nextInvoiceDate: data.nextInvoiceDate,
    eligibleVisits: data.eligibleVisits.map(normalizeVisit),
    extraWork: data.extraWork.map(normalizeExtraWork),
    extraWorkVisitIds: [...new Set(data.extraWork.map((item) => item.visitId).filter(Boolean))],
    installments: data.installments.map(normalizeInstallment),
    invoices: data.invoices.map(normalizeInvoice),
  }
}

/** Normalize the server-composed contact billing response for drawer and detail parity. */
export function normalizeContactBilling(
  data: ContactBillingOverviewData | undefined
): ContactBillingView {
  if (!data) return EMPTY_CONTACT_BILLING

  return {
    currencyCode: data.currencyCode,
    balanceDue: data.balanceDue,
    overdueAmount: data.overdueAmount,
    overdueCount: data.overdueCount,
    draftAmount: data.draftAmount,
    draftCount: data.draftCount,
    uninvoicedAmount: data.uninvoicedAmount,
    readyWorkOrderCount: data.readyWorkOrderCount,
    readyWorkOrderRecordId: data.readyWorkOrders[0]?.recordId,
    recentInvoices: data.recentInvoices.map(normalizeInvoice),
  }
}

function normalizeVisit(visit: WorkOrderBillingVisitData): BillingVisitRow {
  return {
    id: visit.id,
    label: visit.label,
    serviceDate: visit.serviceDate,
    amount: visit.amount,
    invoiceState: visit.invoiceState,
  }
}

function normalizeExtraWork(
  item: WorkOrderBillingStateData['extraWork'][number]
): BillingExtraWorkRow {
  return {
    id: item.id,
    visitId: item.visitId,
    visitStatus: item.visitStatus,
    serviceDate: item.serviceDate,
    name: item.name,
    amount: item.amount,
  }
}

function normalizeInstallment(item: WorkOrderBillingInstallmentData): BillingInstallmentRow {
  return {
    id: item.id,
    name: item.name,
    amount: item.amount,
    status: item.status,
    scheduledDate: item.scheduledDate,
    calculation: item.calculation,
    percentageBasisPoints: item.percentageBasisPoints,
    trigger: item.trigger,
  }
}

function normalizeInvoice(invoice: WorkOrderBillingInvoiceData): BillingInvoiceRow {
  return {
    recordId: invoice.recordId,
    displayName: invoice.displayName,
    status: invoice.status,
    total: invoice.total,
    balance: invoice.balance,
    servicePeriodStart: invoice.servicePeriodStart,
    servicePeriodEnd: invoice.servicePeriodEnd,
    visitCount: invoice.visitCount,
  }
}

// ─── One next-action condition (work-order invoice flow plan §5.3 + money/19 §D) ───────────────
// Every billing surface (full Billing tab, work-order drawer card, header "Create invoice"
// action) must agree on whether an invoice/recurring-charge action is available and what it's
// called. Server-side gating exists now (plan money/19): `ready_to_invoice` means performed
// work, `eligibleVisits` lists done unbilled-base visits, and `extraWork` carries visit status —
// so the router deliberately reads them to pick between the base and extra-work dialogs.

export interface BillingAction {
  kind: 'create' | 'create_extra' | 'review_draft' | 'view_invoices' | 'none'
  label: string
  /** Set for `review_draft` when exactly one draft invoice is linked — surfaces can open it
   * directly instead of re-opening the create dialog. */
  draftInvoiceRecordId?: RecordId
  /** Set for `view_invoices` when a future automatic billing date is known. */
  nextInvoiceDate?: string | null
}

/** Resolve the one next billing action (and its label) for a work order, shared by every
 * surface that can create/review/view invoices for it (plan §5.3, §6.1, §6.2). */
export function resolveBillingAction(billing: WorkOrderBillingView): BillingAction {
  const draftInvoice = billing.invoices.find((invoice) => invoice.status === 'draft')

  if (billing.basis === 'recurring_flat') {
    if (billing.state === 'draft_pending') {
      return {
        kind: 'review_draft',
        label: 'Review draft',
        draftInvoiceRecordId: draftInvoice?.recordId,
      }
    }
    if (billing.timing === 'as_needed' && billing.state === 'ready_to_invoice') {
      return { kind: 'create', label: 'Generate recurring charge' }
    }
    if (billing.timing === 'custom_schedule') {
      return {
        kind: 'view_invoices',
        label: 'View invoices',
        nextInvoiceDate: billing.nextInvoiceDate ?? null,
      }
    }
    return { kind: 'none', label: '' }
  }

  if (billing.state === 'draft_pending') {
    return {
      kind: 'review_draft',
      label: 'Review draft',
      draftInvoiceRecordId: draftInvoice?.recordId,
    }
  }
  if (billing.state === 'ready_to_invoice') {
    const pendingInstallment = billing.installments.some((item) => item.status === 'pending')
    // Per-visit readiness driven only by extras (base fully billed or extras on an
    // already-invoiced visit): the base dialog would dead-end, so the extra-work dialog is
    // the primary action (plan money/19 D1).
    if (
      billing.basis === 'per_visit' &&
      billing.eligibleVisits.length === 0 &&
      billing.extraWork.some((row) => row.visitStatus === 'done')
    ) {
      return { kind: 'create_extra', label: 'Invoice extra work' }
    }
    return { kind: 'create', label: pendingInstallment ? 'Generate installment' : 'Create invoice' }
  }
  if (billing.state === 'scheduled') {
    return {
      kind: 'view_invoices',
      label: 'View invoices',
      nextInvoiceDate: billing.nextInvoiceDate ?? null,
    }
  }
  return { kind: 'none', label: '' }
}
