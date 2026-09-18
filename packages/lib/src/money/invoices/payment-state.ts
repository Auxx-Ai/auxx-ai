// packages/lib/src/money/invoices/payment-state.ts

/**
 * Project the money model onto an invoice's mirrored `amountPaid`/`amountCredited`/`balance`/
 * `status` fields — the one function where ledger truth becomes invoice state. The
 * replacement for `payments/ledger.ts`'s `syncInvoicePaymentState` (accounting migration step
 * 0): `amountPaid` sums `listInvoiceMoneyPayments`' already-netted (`apply` minus `unapply`)
 * rows instead of `PaymentAllocation` joined to `PaymentTransaction`. Everything else —
 * the terminal-status guard, the `paid`/`partially_paid`/`sent` flips, the field-pre-hook
 * bypass, writing only what changed — is unchanged.
 *
 * Writes go through `FieldValueService` (the sanctioned-writer path that structurally
 * bypasses the system pre-hook, the convert-quote.ts precedent) plus {@link INVOICE_STATUS_BYPASS}
 * for the field pre-hook, which that path does NOT clear on its own.
 *
 * `balance = total - amountPaid - amountCredited` (plans/accounting/tasks/done/10-credit-memos.md
 * §2.3). Credit applied from a memo settles the invoice the way money does, with the same
 * status flips: `paid` once the balance reaches zero and anything at all was paid or
 * credited, `partially_paid` while something was and the balance is still positive, and
 * back to `sent` when both sums are zero again (a voided payment, an unapplied credit).
 */

import { type Database, database } from '@auxx/database'
import { extractValue } from '@auxx/types'
import { toRecordId } from '@auxx/types/resource'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { getOrgCache } from '../../cache'
import { firstTyped } from '../../field-values/client'
import { FieldValueService } from '../../field-values/field-value-service'
import { UnifiedCrudHandler } from '../../resources/crud'
import { sumInvoiceCreditApplications } from '../credit-memos/reads'
import type { SyncInvoicePaymentStateInput } from '../types'
import { listInvoiceMoneyPayments } from './payment-reads'

/**
 * The bypass this projection carries. It names `invoice_status` and nothing else — this
 * function is the ONLY writer of `paid`/`partially_paid` and the payment-reversal `-> sent`.
 */
const INVOICE_STATUS_BYPASS = new Set<SystemAttribute>(['invoice_status'])

/**
 * The invoice statuses this projection must leave exactly as it found them. `void` owes
 * nothing and a recomputed balance would resurrect it; `written_off` has already moved its
 * whole balance out of A/R through a posted entry, and this function knows nothing about
 * that entry.
 */
const TERMINAL_INVOICE_STATUSES = new Set(['void', 'written_off'])

/** Integer minor units: every money-model receipt applied to this invoice, summed. */
async function computeAmountPaid(
  db: Database,
  organizationId: string,
  invoiceInstanceId: string
): Promise<number> {
  const rows = await listInvoiceMoneyPayments(db, { organizationId, invoiceInstanceId })
  return rows.reduce((sum, row) => sum + row.allocatedAmount, 0)
}

export async function syncInvoicePaymentState(
  input: SyncInvoicePaymentStateInput & { db?: Database }
): Promise<void> {
  const { organizationId, userId, invoiceInstanceId } = input
  const db = input.db ?? database
  const invoiceRecordId = toRecordId('invoice', invoiceInstanceId)
  const handler = new UnifiedCrudHandler(organizationId, userId, db)
  const cache = getOrgCache()

  const cf = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes([
      'invoice_status',
      'invoice_total',
      'invoice_amount_paid',
      'invoice_amount_credited',
      'invoice_balance',
    ] as const)

  const fieldIds = [
    cf.invoice_status,
    cf.invoice_total,
    cf.invoice_amount_paid,
    cf.invoice_amount_credited,
    cf.invoice_balance,
  ]
    .filter(Boolean)
    .map((f) => f!.id)
  const values = await handler.getFieldValues(invoiceRecordId, fieldIds)

  const statusTyped = cf.invoice_status ? firstTyped(values.get(cf.invoice_status.id)) : undefined
  const status = statusTyped ? (extractValue(statusTyped) as string) : undefined
  if (TERMINAL_INVOICE_STATUSES.has(status ?? '')) return

  const totalTyped = cf.invoice_total ? firstTyped(values.get(cf.invoice_total.id)) : undefined
  const total = totalTyped ? (extractValue(totalTyped) as number) : 0
  const currentAmountPaidTyped = cf.invoice_amount_paid
    ? firstTyped(values.get(cf.invoice_amount_paid.id))
    : undefined
  const currentAmountPaid = currentAmountPaidTyped
    ? (extractValue(currentAmountPaidTyped) as number)
    : 0
  const currentAmountCreditedTyped = cf.invoice_amount_credited
    ? firstTyped(values.get(cf.invoice_amount_credited.id))
    : undefined
  const currentAmountCredited = currentAmountCreditedTyped
    ? (extractValue(currentAmountCreditedTyped) as number)
    : 0
  const currentBalanceTyped = cf.invoice_balance
    ? firstTyped(values.get(cf.invoice_balance.id))
    : undefined
  const currentBalance = currentBalanceTyped ? (extractValue(currentBalanceTyped) as number) : null

  const [amountPaid, amountCredited] = await Promise.all([
    computeAmountPaid(db, organizationId, invoiceInstanceId),
    sumInvoiceCreditApplications(db, organizationId, invoiceInstanceId),
  ])
  const settled = amountPaid + amountCredited
  const balance = total - settled

  let nextStatus = status
  if (settled > 0 && balance <= 0) {
    nextStatus = 'paid'
  } else if (settled > 0) {
    nextStatus = 'partially_paid'
  } else if (status === 'partially_paid' || status === 'paid') {
    nextStatus = 'sent'
  }

  const writes: Array<{ fieldId: string; value: unknown }> = []
  if (amountPaid !== currentAmountPaid)
    writes.push({ fieldId: 'invoice_amount_paid', value: amountPaid })
  if (cf.invoice_amount_credited && amountCredited !== currentAmountCredited)
    writes.push({ fieldId: 'invoice_amount_credited', value: amountCredited })
  if (balance !== currentBalance) writes.push({ fieldId: 'invoice_balance', value: balance })
  if (nextStatus !== status) writes.push({ fieldId: 'invoice_status', value: nextStatus })
  if (writes.length === 0) return

  const fieldValueService = new FieldValueService(organizationId, userId, db, undefined, {
    bypassFieldGuards: INVOICE_STATUS_BYPASS,
  })
  await fieldValueService.setValuesForEntity({ recordId: invoiceRecordId, values: writes })
}
