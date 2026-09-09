// packages/lib/src/money/credit-memos/client.ts
//
// The client-safe half of the credit memo module: the status, source, reason
// and disposition vocabularies, the number prefix, the wire shapes the drawer
// reads, and the one pure function (`planCreditApplication`) the apply dialog
// runs to prefill an amount. Nothing here imports a database.
//
// No 'use client' directive, on purpose: `money/client.ts` documents why a
// directive here turns every server-side import into a client-reference proxy.
//
// plans/accounting/tasks/10-credit-memos.md sections 2, 5 and 10.7.

import {
  CREDIT_MEMO_REASON_OPTIONS,
  CREDIT_MEMO_SOURCE_OPTIONS,
  CREDIT_MEMO_STATUS_OPTIONS,
} from '../../resources/registry/resources/credit-memo-fields'
import { CREDIT_MEMO_LINE_DISPOSITION_OPTIONS } from '../../resources/registry/resources/credit-memo-line-fields'

// The option arrays are declared ONCE, on the registry, and re-exported here so
// the drawer and the writers agree on one list. The registry files reach only
// enums and types past their own imports, so they are client-safe.
export {
  CREDIT_MEMO_LINE_DISPOSITION_OPTIONS,
  CREDIT_MEMO_REASON_OPTIONS,
  CREDIT_MEMO_SOURCE_OPTIONS,
  CREDIT_MEMO_STATUS_OPTIONS,
}

/** `CM-0001`. The `RecordSequence` scope `credit_memo` allocates on this prefix. */
export const CREDIT_MEMO_NUMBER_PREFIX = 'CM'

/** The status machine of section 2.4: `draft -> issued -> settled`, `void` off either. */
export const CREDIT_MEMO_STATUSES = CREDIT_MEMO_STATUS_OPTIONS.map((option) => option.value)
export type CreditMemoStatus = (typeof CREDIT_MEMO_STATUS_OPTIONS)[number]['value']

/** Who started the memo. Set once on create and never editable. */
export const CREDIT_MEMO_SOURCES = CREDIT_MEMO_SOURCE_OPTIONS.map((option) => option.value)
export type CreditMemoSource = (typeof CREDIT_MEMO_SOURCE_OPTIONS)[number]['value']

/** Why the credit was given. Nullable on the record; a reviewer may set it while draft. */
export const CREDIT_MEMO_REASONS = CREDIT_MEMO_REASON_OPTIONS.map((option) => option.value)
export type CreditMemoReason = (typeof CREDIT_MEMO_REASON_OPTIONS)[number]['value']

/** What happened to the goods on a line. Nullable: a concession or remainder line has none. */
export const CREDIT_MEMO_LINE_DISPOSITIONS = CREDIT_MEMO_LINE_DISPOSITION_OPTIONS.map(
  (option) => option.value
)
export type CreditMemoLineDisposition =
  (typeof CREDIT_MEMO_LINE_DISPOSITION_OPTIONS)[number]['value']

export const CREDIT_MEMO_STATUS_LABELS = Object.fromEntries(
  CREDIT_MEMO_STATUS_OPTIONS.map((option) => [option.value, option.label])
) as Record<CreditMemoStatus, string>

export const CREDIT_MEMO_REASON_LABELS = Object.fromEntries(
  CREDIT_MEMO_REASON_OPTIONS.map((option) => [option.value, option.label])
) as Record<CreditMemoReason, string>

/**
 * The statuses a person may still change lines and header fields on. Everything
 * past `draft` is corrected by void and re-issue, never by edit (section 2.4).
 */
export const CREDIT_MEMO_EDITABLE_STATUSES: ReadonlySet<string> = new Set<CreditMemoStatus>([
  'draft',
])

/** The statuses that carry a posted entry. A delete is refused on either; void first. */
export const CREDIT_MEMO_POSTED_STATUSES: ReadonlySet<string> = new Set<CreditMemoStatus>([
  'issued',
  'settled',
])

/** One line as `createCreditMemo` takes it. Money is integer minor units; `qty` may be fractional. */
export interface CreditMemoLineInput {
  description?: string
  qty: number
  /** Integer minor units per unit. */
  unitPrice: number
  /** Integer minor units. Transcribed, never derived from a rate. Omitted means no tax leg. */
  taxTotal?: number
  disposition?: CreditMemoLineDisposition
  /** The `line_item` this line credits, when it credits one. A concession line has none. */
  lineItemInstanceId?: string
}

/** One application row as the settlement card lists it. */
export interface CreditMemoApplicationRow {
  applicationInstanceId: string
  invoiceInstanceId: string
  invoiceNumber: string
  /** Integer minor units. */
  amountMinor: number
  /** ISO instant, or `null` when the row never stamped one. */
  appliedAt: string | null
}

/** One refund `PaymentTransaction` carrying this memo, as the settlement card lists it. */
export interface CreditMemoRefundRow {
  transactionId: string
  provider: string
  status: string
  /** Integer minor units. */
  amountMinor: number
  method: string | null
  reference: string | null
  createdAt: string
}

/** What `readCreditMemoSettlement` returns: the four figures and the rows behind two of them. */
export interface CreditMemoSettlement {
  creditMemoInstanceId: string
  number: string
  status: CreditMemoStatus | string
  source: CreditMemoSource | string
  contactInstanceId: string | null
  invoiceInstanceId: string | null
  /** Integer minor units. */
  totalMinor: number
  amountAppliedMinor: number
  amountRefundedMinor: number
  balanceMinor: number
  applications: CreditMemoApplicationRow[]
  refunds: CreditMemoRefundRow[]
}

/** One issued memo with credit still on it, oldest first, as `readContactCredit` lists them. */
export interface ContactCreditMemo {
  creditMemoInstanceId: string
  number: string
  /** `YYYY-MM-DD`, or `null` when the memo was issued without a date (should not happen). */
  issuedAt: string | null
  /** Integer minor units. */
  totalMinor: number
  balanceMinor: number
}

/** What `readContactCredit` returns: the sum, and the memos it is the sum of. */
export interface ContactCredit {
  contactInstanceId: string
  /** Integer minor units. The sum of every issued memo's balance. */
  creditAvailableMinor: number
  memos: ContactCreditMemo[]
}

/** One open invoice as `listOpenInvoicesForContact` lists them, for the apply picker. */
export interface OpenInvoiceRow {
  invoiceInstanceId: string
  number: string
  status: string
  /** `YYYY-MM-DD` or `null`. */
  issuedAt: string | null
  dueDate: string | null
  /** Integer minor units. */
  totalMinor: number
  balanceMinor: number
}

/** A memo the planner may draw on. The caller passes them oldest issued first. */
export interface CreditMemoForApplication {
  /** The `credit_memo` EntityInstance id. */
  id: string
  /** Integer minor units. What is still unapplied and unrefunded on the memo. */
  balanceMinor: number
}

/** One planned `applyCreditMemo` call. */
export interface PlannedCreditApplication {
  creditMemoInstanceId: string
  /** Integer minor units, always > 0. */
  amountMinor: number
}

/**
 * Plan how much of each memo to apply to an invoice, in integer minor units.
 *
 * The `planDepositApplication` shape (`money/payments/deposit-allocation.ts`):
 * the caller passes `memos` oldest issued first so the oldest credit drains
 * first, each memo is capped at `min(memo balance, invoice remaining)`, and the
 * loop stops when the invoice is covered or the memos run out. A memo with no
 * balance contributes nothing and is skipped rather than refused, so a settled
 * memo in the list is harmless.
 *
 * Pure: it takes the invoice's remaining balance rather than deriving it, so it
 * never has to know how `invoice_balance` is computed.
 */
export function planCreditApplication(
  memos: readonly CreditMemoForApplication[],
  invoiceBalanceMinor: number
): PlannedCreditApplication[] {
  const planned: PlannedCreditApplication[] = []
  let remaining = Math.floor(invoiceBalanceMinor)
  if (!Number.isFinite(remaining) || remaining <= 0) return planned

  for (const memo of memos) {
    if (remaining <= 0) break
    const available = Math.floor(memo.balanceMinor)
    if (!Number.isFinite(available) || available <= 0) continue
    const amountMinor = Math.min(available, remaining)
    planned.push({ creditMemoInstanceId: memo.id, amountMinor })
    remaining -= amountMinor
  }

  return planned
}
