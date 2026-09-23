// packages/lib/src/accounting/provider-matches/assess.ts
// Brief 102 M3: match each provider-authored Payment, Deposit, Bill Payment and Purchase in a
// range to a record of ours. Only an invoice or bill link matches on its own (and adopts); a
// pairing found by amount and date is a suggestion a person accepts.

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError } from '../../errors'
import { BILL_OBJECT_TYPE } from '../export/payloads/bill'
import { INVOICE_OBJECT_TYPE } from '../export/payloads/invoice'
import { VENDOR_BILL_SOURCE_TYPE } from '../ledger/builders/entry'
import { resolveProviderVendors } from '../mirror/provider-vendors'
import { recordInvoicePayment } from '../money/invoice-payments/record-payment'
import type { AccountingProvider, ProviderTransactionLinks } from '../providers/provider'
import {
  BILL_PAYMENT_TXN_TYPES,
  PURCHASE_TXN_TYPES,
} from '../providers/quickbooks/transaction-links'
import { adoptingUser, adoptVendorPayment } from './adopt'
import {
  type EntryToAssess,
  findOurSentDocument,
  isSubjectSent,
  listEntriesToAssess,
  listOpenBillsForAmount,
  listPayoutCandidates,
  listReceiptsOnInvoice,
  listVendorPaymentsOnBill,
  listVendorPaymentsToVendor,
  railOfClearingAccount,
} from './reads'
import { type ProviderMatchWrite, writeProviderMatch } from './writes'

const logger = createScopedLogger('provider-matches')

/** How far either side of their deposit date a payout of ours may fall. */
const PAYOUT_WINDOW_DAYS = 5
/** How far either side of their expense date a vendor payment of ours may fall. */
const PURCHASE_WINDOW_DAYS = 7

export interface AssessProviderMatchesInput {
  bookId: string
  from: string
  to: string
  provider: AccountingProvider
  /** `providerAccountId -> glAccountId`, the map the translation used. */
  glAccountIdByProviderId: ReadonlyMap<string, string>
  actorUserId?: string
}

export interface AssessProviderMatchesOutcome {
  assessed: number
  adopted: number
  suggested: number
  /** One line per entry whose provider object could not be read; it is assessed next run. */
  failures: string[]
}

export async function assessProviderMatches(
  db: Database,
  organizationId: string,
  input: AssessProviderMatchesInput
): Promise<Result<AssessProviderMatchesOutcome, Error>> {
  const outcome: AssessProviderMatchesOutcome = {
    assessed: 0,
    adopted: 0,
    suggested: 0,
    failures: [],
  }
  const readLinks = input.provider.readTransactionLinks?.bind(input.provider)
  if (!readLinks) return ok(outcome)

  try {
    const entries = await listEntriesToAssess(db, organizationId, input)
    for (const entry of entries) {
      const links = await readLinks(organizationId, {
        txnType: entry.providerTxnType,
        txnId: entry.providerTxnId,
      })
      if (links.isErr()) {
        outcome.failures.push(links.error.message)
        continue
      }
      const assess = ASSESSORS[entry.providerTxnType]
      const next: ProviderMatchWrite =
        links.value && assess
          ? await assess(db, organizationId, entry, links.value, input)
          : { state: null, reason: 'not_ours' }
      await writeProviderMatch(db, organizationId, entry.id, next)
      outcome.assessed += 1
      if (next.reason === 'adopted') outcome.adopted += 1
      if (next.state === 'suggested') outcome.suggested += 1
    }
    return ok(outcome)
  } catch (error) {
    logger.error('Provider match assessment failed', { organizationId, error })
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}

function debitTotal(entry: EntryToAssess): number {
  return entry.lines
    .filter((line) => line.direction === 'debit')
    .reduce((total, line) => total + line.amountMinor, 0)
}

type Assessor = (
  db: Database,
  organizationId: string,
  entry: EntryToAssess,
  links: ProviderTransactionLinks,
  input: AssessProviderMatchesInput
) => Promise<ProviderMatchWrite>

async function assessPayment(
  db: Database,
  organizationId: string,
  entry: EntryToAssess,
  links: ProviderTransactionLinks,
  input: AssessProviderMatchesInput
): Promise<ProviderMatchWrite> {
  const invoices = links.linked.filter((linked) => linked.txnType === 'Invoice')
  if (invoices.length === 0) return { state: null, reason: 'not_ours' }
  if (invoices.length > 1) return { state: 'unmatchable', reason: 'ambiguous' }

  const document = await findOurSentDocument(db, organizationId, {
    objectType: INVOICE_OBJECT_TYPE,
    providerObjectId: invoices[0]!.txnId,
  })
  if (!document) return { state: null, reason: 'not_ours' }
  if (document.sourceKind !== 'invoice') return { state: 'unmatchable', reason: 'order_invoice' }

  // Names our invoice even when it cannot settle, so the invoice drawer can find it.
  const onInvoice = { kind: 'invoice', matchedId: document.sourceId } as const
  const amountMinor = debitTotal(entry)
  const receipts = await listReceiptsOnInvoice(db, organizationId, {
    invoiceInstanceId: document.sourceId,
    amountMinor,
  })
  if (receipts.length > 1) return { state: 'unmatchable', reason: 'ambiguous', ...onInvoice }
  if (receipts.length === 1) {
    const sent = await isSubjectSent(db, organizationId, {
      sourceKind: 'money_transaction',
      sourceId: receipts[0]!,
    })
    return {
      state: 'suggested',
      reason: sent ? 'duplicate_sent' : 'ours_unsent',
      kind: 'money_transaction',
      matchedId: receipts[0]!,
    }
  }

  // Only theirs: record it against our invoice so it reads paid; their entry is the posting.
  try {
    const userId = await adoptingUser(organizationId, input.actorUserId)
    const recorded = await recordInvoicePayment(db, {
      organizationId,
      userId,
      invoiceInstanceId: document.sourceId,
      amountMinor,
      date: entry.txnDate,
      method: 'other',
      reference: entry.docNumber ?? undefined,
      note: `Recorded from ${entry.providerTxnType} ${entry.providerTxnId} in the connected books`,
      commandKey: `provider-match:${entry.id}`,
      providerLedgerEntryId: entry.id,
    })
    return {
      state: 'matched',
      reason: 'adopted',
      kind: 'money_transaction',
      matchedId: recorded.moneyTransactionId,
    }
  } catch (error) {
    if (!(error instanceof AuxxError)) throw error
    return { state: 'unmatchable', reason: 'cannot_adopt', ...onInvoice }
  }
}

function shiftDate(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00Z`)
  shifted.setUTCDate(shifted.getUTCDate() + days)
  return shifted.toISOString().slice(0, 10)
}

async function assessDeposit(
  db: Database,
  organizationId: string,
  entry: EntryToAssess,
  links: ProviderTransactionLinks,
  input: AssessProviderMatchesInput
): Promise<ProviderMatchWrite> {
  const onRails: Array<{ railId: string; amountMinor: number }> = []
  for (const line of links.codedLines) {
    const glAccountId = input.glAccountIdByProviderId.get(line.providerAccountId)
    const railId = glAccountId ? await railOfClearingAccount(db, organizationId, glAccountId) : null
    if (railId) onRails.push({ railId, amountMinor: line.amountMinor })
  }
  if (onRails.length === 0) return { state: null, reason: 'not_ours' }
  if (onRails.length > 1) return { state: 'unmatchable', reason: 'ambiguous' }

  const payouts = await listPayoutCandidates(db, organizationId, {
    railId: onRails[0]!.railId,
    amountMinor: onRails[0]!.amountMinor,
    from: shiftDate(entry.txnDate, -PAYOUT_WINDOW_DAYS),
    to: shiftDate(entry.txnDate, PAYOUT_WINDOW_DAYS),
  })
  if (payouts.length === 0) return { state: 'pending', reason: 'no_payout' }
  if (payouts.length > 1) return { state: 'unmatchable', reason: 'ambiguous' }
  const sent = await isSubjectSent(db, organizationId, {
    sourceKind: 'payout',
    sourceId: payouts[0]!,
  })
  return {
    state: 'suggested',
    reason: sent ? 'duplicate_sent' : 'ours_unsent',
    kind: 'payout',
    matchedId: payouts[0]!,
  }
}

/** Their payment of a bill: the vendor twin of {@link assessPayment}. */
async function assessBillPayment(
  db: Database,
  organizationId: string,
  entry: EntryToAssess,
  links: ProviderTransactionLinks,
  input: AssessProviderMatchesInput
): Promise<ProviderMatchWrite> {
  const bills = links.linked.filter((linked) => linked.txnType === 'Bill')
  if (bills.length === 0) return { state: null, reason: 'not_ours' }

  const ours: Array<{ billId: string; amountMinor: number | undefined }> = []
  for (const bill of bills) {
    const document = await findOurSentDocument(db, organizationId, {
      objectType: BILL_OBJECT_TYPE,
      providerObjectId: bill.txnId,
    })
    if (document?.sourceKind === VENDOR_BILL_SOURCE_TYPE)
      ours.push({ billId: document.sourceId, amountMinor: bill.amountMinor })
  }
  if (ours.length === 0) return { state: null, reason: 'not_ours' }
  const onBill =
    ours.length === 1 ? ({ kind: 'vendor_bill', matchedId: ours[0]!.billId } as const) : {}
  // Several bills or a vendor credit in one payment: one movement per bill is not built yet.
  if (bills.length !== links.linked.length || bills.length > 1)
    return { state: 'unmatchable', reason: 'ambiguous', ...onBill }

  const billId = ours[0]!.billId
  const amountMinor = ours[0]!.amountMinor ?? debitTotal(entry)
  const payments = await listVendorPaymentsOnBill(db, organizationId, {
    vendorBillInstanceId: billId,
    amountMinor,
  })
  if (payments.length > 1) return { state: 'unmatchable', reason: 'ambiguous', ...onBill }
  if (payments.length === 1) return suggestOurMovement(db, organizationId, payments[0]!)

  const adopted = await adoptVendorPayment(db, organizationId, entry, {
    vendorBillInstanceId: billId,
    amountMinor,
    actorUserId: input.actorUserId,
  })
  return adopted.isOk()
    ? { state: 'matched', reason: 'adopted', kind: 'money_transaction', matchedId: adopted.value }
    : { state: 'unmatchable', reason: 'cannot_adopt', ...onBill }
}

/**
 * Their expense, cheque or card charge to a vendor of ours: never automatic, since nothing links
 * it. A vendor payment of ours for the amount, else an open bill of ours for exactly that balance.
 */
async function assessPurchase(
  db: Database,
  organizationId: string,
  entry: EntryToAssess,
  links: ProviderTransactionLinks,
  input: AssessProviderMatchesInput
): Promise<ProviderMatchWrite> {
  if (!links.vendorId) return { state: null, reason: 'not_ours' }
  const vendors = await resolveProviderVendors(db, organizationId, input.provider.id, [
    links.vendorId,
  ])
  const vendorInstanceId = vendors.get(links.vendorId)
  if (!vendorInstanceId) return { state: null, reason: 'not_ours' }

  const amountMinor = debitTotal(entry)
  const payments = await listVendorPaymentsToVendor(db, organizationId, {
    vendorInstanceId,
    amountMinor,
    from: shiftDate(entry.txnDate, -PURCHASE_WINDOW_DAYS),
    to: shiftDate(entry.txnDate, PURCHASE_WINDOW_DAYS),
  })
  if (payments.length > 1) return { state: 'unmatchable', reason: 'ambiguous' }
  if (payments.length === 1) return suggestOurMovement(db, organizationId, payments[0]!)

  const bills = await listOpenBillsForAmount(db, organizationId, { vendorInstanceId, amountMinor })
  if (bills.length > 1) return { state: 'unmatchable', reason: 'ambiguous' }
  if (bills.length === 1)
    return { state: 'suggested', reason: 'pays_bill', kind: 'vendor_bill', matchedId: bills[0]! }
  return { state: 'pending', reason: 'no_candidate' }
}

async function suggestOurMovement(
  db: Database,
  organizationId: string,
  moneyTransactionId: string
): Promise<ProviderMatchWrite> {
  const sent = await isSubjectSent(db, organizationId, {
    sourceKind: 'money_transaction',
    sourceId: moneyTransactionId,
  })
  return {
    state: 'suggested',
    reason: sent ? 'duplicate_sent' : 'ours_unsent',
    kind: 'money_transaction',
    matchedId: moneyTransactionId,
  }
}

/** Keyed by the report label; a label with no assessor is not ours. */
const ASSESSORS: Record<string, Assessor> = {
  Payment: assessPayment,
  Deposit: assessDeposit,
  ...Object.fromEntries(BILL_PAYMENT_TXN_TYPES.map((label) => [label, assessBillPayment])),
  ...Object.fromEntries(PURCHASE_TXN_TYPES.map((label) => [label, assessPurchase])),
}
