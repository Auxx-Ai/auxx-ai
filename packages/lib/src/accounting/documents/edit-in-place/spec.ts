// packages/lib/src/accounting/documents/edit-in-place/spec.ts
//
// One row per document family (74 §1.3). Everything family-specific about the
// lane lives here; nothing outside this file switches on a family name.

import type { Database } from '@auxx/database'
import { UnprocessableEntityError } from '../../../errors'
import { CREDIT_MEMO_POSTING_TYPE } from '../../ledger/builders/credit-memo'
import { VENDOR_BILL_POSTING_TYPE } from '../../ledger/builders/entry'
import { INVOICE_ISSUED_POSTING_TYPE } from '../../ledger/builders/invoice'
import { todayInBookTimeZone } from '../../ledger/setup/book-time-zone'
import type { BuiltEntry, PostResult } from '../../ledger/types'
import { syncInvoicePaymentState } from '../../money/invoice-payments/payment-state'
import { syncVendorBillPaymentState } from '../../money/vendor-payments/payment-state'
import { loadVendorBillLines, requireVendorBill } from '../../purchasing/expense-bill/reads'
import { listVendorBillPostings } from '../../purchasing/expense-bill/writes'
import { readLandedAccrualRemaining } from '../../purchasing/landed-cost/reads'
import {
  buildEntryForVendorBill,
  postVendorBillEntry,
  readAllocationBasis,
} from '../../purchasing/post-vendor-bill'
import {
  buildEntryForCreditMemo,
  listCreditMemoPostings,
  organizationCurrency,
  postCreditMemoEntry,
} from '../../sales/credit-memos/accounting'
import {
  loadCreditMemoLines,
  orderHadFulfillmentBefore,
  requireCreditMemo,
  sumCreditMemoApplications,
  sumReservedCreditMemoRefunds,
} from '../../sales/credit-memos/reads'
import { settleCreditMemo } from '../../sales/credit-memos/settle'
import { loadInvoiceForEdit } from '../../sales/invoices/edit-reads'
import {
  buildEntryForInvoiceIssuance,
  postInvoiceIssuanceBuiltEntry,
} from '../../sales/invoices/issuance-accounting'
import { loadInvoiceForIssuance } from '../../sales/invoices/issuance-reads'
import { listInvoicePostings } from '../../sales/invoices/post-invoice'

/** The registry entity types the lane knows. */
export const DOCUMENT_EDIT_FAMILIES = ['vendor_bill', 'credit_memo', 'invoice'] as const

export type DocumentEditFamily = (typeof DOCUMENT_EDIT_FAMILIES)[number]

/** What every family's loader returns. The lane reads nothing else off a document. */
export interface DocumentEditDoc {
  /** The `EntityInstance` id. */
  id: string
  /** The registry lifecycle value — `draft`, `posted`, `void`. */
  status: string
  /** OURS. What the entry's claim and document number key on. */
  internalNumber: string
  /** What a refusal names the document by. */
  label: string
  /** Integer minor units, the document's current total. */
  totalMinor: number
  /** Integer minor units already settled against it. Save is refused below this. */
  settledMinor: number
  /**
   * Everything a build needs beyond the header, read on demand: Edit and the
   * read never pay for it, and Save reads it once, before any lock.
   */
  plan(db: Database): Promise<DocumentEditPlan>
}

/** One general-ledger entry sourced on the document. `status` is `draft | posted | reversed`. */
export interface DocumentEditPosting {
  glPostingId: string
  docNumber: string
  status: string
  postingType: string
}

export interface BuiltDocumentEntry {
  /** The built lines, for the compare against what the live posting froze. */
  entry: BuiltEntry
  /** Put exactly this entry in the books. `null` when accounting is off. */
  post(db: Database, input: { actorUserId: string; memo: string }): Promise<PostResult | null>
}

export interface DocumentEditPlan {
  /** The entry the document's CURRENT values produce at `generation`. Pure. */
  build(generation: number): BuiltDocumentEntry
}

/** What a family's post-Save re-projection is handed. */
export interface DocumentEditAfterSaveInput {
  organizationId: string
  userId: string
  entityInstanceId: string
}

export interface DocumentEditRow {
  readonly family: DocumentEditFamily
  /** The document in the words on the screen — `'bill'`. */
  readonly noun: string
  /** The header definition's content relationship keys (66 D6). */
  readonly children: readonly string[]
  /**
   * The header's content-derived `updatable: false` attributes, restored from
   * the snapshot on Cancel (75-D4). A transcribed, `updatable` total is not one
   * of these — it comes back through the ordinary write path.
   */
  readonly derivedTotalAttrs: readonly string[]
  /**
   * The family's payment-state projection, re-run after Save reposts (75-D5): an
   * edit that moves the total moves what is still owed, and the projection is
   * the only writer of the status that gates Record payment.
   */
  afterSave?(db: Database, input: DocumentEditAfterSaveInput): Promise<void>
  /** The posting type this document claims on its own key. */
  readonly postingType: string
  /** Lifecycle values Edit refuses outright (74 §1.3). */
  readonly editRefusedIn: readonly string[]
  load(db: Database, organizationId: string, entityInstanceId: string): Promise<DocumentEditDoc>
  /** Why Edit will not open this document. Called only for a status it refuses. */
  refuseEdit(doc: DocumentEditDoc): string
  /** Why Save will not take the document below what has been settled against it. */
  refuseBelowFloor(doc: DocumentEditDoc): string
  listPostings(
    db: Database,
    params: { organizationId: string; entityInstanceId: string }
  ): Promise<DocumentEditPosting[]>
  /** The memo the reversal of `docNumber` carries into the books. */
  reversalMemo(doc: DocumentEditDoc, docNumber: string): string
  /** The memo the repost carries. */
  repostMemo(doc: DocumentEditDoc): string
  /** The memo a post that follows a discarded draft carries. */
  restoredMemo(doc: DocumentEditDoc): string
}

const vendorBillRow: DocumentEditRow = {
  family: 'vendor_bill',
  noun: 'bill',
  children: ['lines'],
  // `vendor_bill_total`, `_subtotal` and `_tax_total` are transcribed from the
  // vendor's document and `updatable`, so they restore through the ordinary path.
  derivedTotalAttrs: ['vendor_bill_balance'],
  postingType: VENDOR_BILL_POSTING_TYPE,
  editRefusedIn: ['draft', 'void'],

  afterSave: (db, { organizationId, userId, entityInstanceId }) =>
    syncVendorBillPaymentState(db, {
      organizationId,
      userId,
      vendorBillInstanceId: entityInstanceId,
    }),

  async load(db, organizationId, entityInstanceId) {
    const bill = await requireVendorBill(db, organizationId, entityInstanceId)
    return {
      id: bill.id,
      status: bill.status,
      internalNumber: bill.internalNumber,
      label: bill.number || bill.internalNumber,
      totalMinor: bill.totalMinor,
      // An early-payment discount settles a bill as a credit does (74 D3), so
      // it floors Save with the other two.
      settledMinor: Math.round(
        bill.amountPaidMinor + bill.amountCreditedMinor + bill.amountDiscountedMinor
      ),
      plan: async (planDb) => {
        const lines = await loadVendorBillLines(planDb, organizationId, bill.lineIds)
        const billedAt = bill.billedAt ?? (await todayInBookTimeZone(organizationId))
        // Throws an `UnprocessableEntityError` naming the line or the tie. Read
        // before the commit lock deliberately: nothing is written either way, and
        // the refusal must not hold the org's accounting lock while it is composed.
        const allocationBasis = await readAllocationBasis(
          planDb,
          organizationId,
          bill.purchaseOrderId
        )
        // 74 D4, read here for the same reason the basis is: `build` is pure.
        const landedRemaining = await readLandedAccrualRemaining(
          planDb,
          organizationId,
          bill.id,
          lines.map((line) => line.id)
        )
        return {
          build(generation) {
            const built = buildEntryForVendorBill({
              bill,
              lines,
              billedAt,
              allocationBasis,
              generation,
              landedRemaining,
            })
            return {
              entry: built.entry,
              post: (txDb, postInput) =>
                postVendorBillEntry(txDb, {
                  organizationId,
                  actorUserId: postInput.actorUserId,
                  vendorBillInstanceId: bill.id,
                  purchaseOrderId: bill.purchaseOrderId,
                  vendorCompanyInstanceId: bill.vendorCompanyInstanceId,
                  entry: built,
                  memo: postInput.memo,
                }),
            }
          },
        }
      },
    }
  },

  refuseEdit(doc) {
    return doc.status === 'void'
      ? 'This vendor bill is void. A void bill is corrected by raising a new one, never by ' +
          'editing it.'
      : `This vendor bill is ${doc.status.replace(/_/g, ' ')} and is already editable.`
  },

  refuseBelowFloor(doc) {
    return (
      `Bill ${doc.label} now totals ${doc.totalMinor} but ${doc.settledMinor} has already been ` +
      'paid, credited or discounted against it. Reverse the payment or the credit first — an ' +
      'edit cannot take a payable below what has been settled.'
    )
  },

  listPostings(db, params) {
    return listVendorBillPostings(db, {
      organizationId: params.organizationId,
      vendorBillInstanceId: params.entityInstanceId,
    })
  },

  reversalMemo: (doc, docNumber) => `Reversal of ${docNumber} - bill ${doc.label} edited`,
  repostMemo: (doc) => `Bill ${doc.label} re-posted after an edit`,
  restoredMemo: (doc) => `Bill ${doc.label} posted again after its entry was discarded`,
}

const creditMemoRow: DocumentEditRow = {
  family: 'credit_memo',
  noun: 'credit memo',
  children: ['lines'],
  derivedTotalAttrs: [
    'credit_memo_subtotal',
    'credit_memo_tax_total',
    'credit_memo_total',
    'credit_memo_balance',
  ],
  postingType: CREDIT_MEMO_POSTING_TYPE,
  editRefusedIn: ['draft', 'void'],

  afterSave: async (db, { organizationId, userId, entityInstanceId }) => {
    await settleCreditMemo(db, { organizationId, userId, creditMemoInstanceId: entityInstanceId })
  },

  async load(db, organizationId, entityInstanceId) {
    const memo = await requireCreditMemo(db, organizationId, entityInstanceId)
    // Exactly what `voidCreditMemo` reads before it reverses (`writes.ts`): a
    // pending refund has already reserved the credit, so it counts.
    const [applied, refunded] = await Promise.all([
      sumCreditMemoApplications(db, organizationId, entityInstanceId),
      sumReservedCreditMemoRefunds(db, organizationId, memo),
    ])
    return {
      id: memo.id,
      // OURS, and unique in the org: the memo number is what the entry's claim
      // and document number key on. There is no second internal number.
      internalNumber: memo.number,
      status: memo.status,
      label: memo.number,
      totalMinor: memo.totalMinor,
      settledMinor: Math.round(applied + refunded),
      plan: async (planDb) => {
        const lines = await loadCreditMemoLines(planDb, organizationId, memo.lineIds)
        const issuedAt = memo.issuedAt ?? (await todayInBookTimeZone(organizationId))
        const currency = await organizationCurrency(organizationId)
        // Read before the commit lock for the same reason the bill's basis is:
        // `build` is pure, and a refusal must not hold the accounting lock.
        const reverseRevenue =
          memo.source === 'channel'
            ? memo.orderInstanceId
              ? await orderHadFulfillmentBefore(
                  planDb,
                  organizationId,
                  memo.orderInstanceId,
                  issuedAt
                )
              : false
            : true
        return {
          build(generation) {
            const built = buildEntryForCreditMemo({
              memo,
              lines,
              issuedAt,
              currency,
              reverseRevenue,
              generation,
            })
            return {
              entry: built.entry,
              post: (txDb, postInput) =>
                postCreditMemoEntry(txDb, {
                  organizationId,
                  creditMemoInstanceId: memo.id,
                  contactInstanceId: memo.contactInstanceId,
                  orderInstanceId: memo.orderInstanceId,
                  entry: built.entry,
                  actorUserId: postInput.actorUserId,
                  memo: postInput.memo,
                }),
            }
          },
        }
      },
    }
  },

  refuseEdit(doc) {
    return doc.status === 'void'
      ? 'This credit memo is void. A void memo is corrected by raising a new one, never by ' +
          'editing it.'
      : `This credit memo is ${doc.status.replace(/_/g, ' ')} and is already editable.`
  },

  refuseBelowFloor(doc) {
    return (
      `Credit memo ${doc.label} now totals ${doc.totalMinor} but ${doc.settledMinor} has already ` +
      'been applied or refunded against it. Unapply or cancel the refund first — an edit cannot ' +
      'take a credit below what has been drawn on it.'
    )
  },

  listPostings(db, params) {
    return listCreditMemoPostings(db, {
      organizationId: params.organizationId,
      creditMemoInstanceId: params.entityInstanceId,
    })
  },

  reversalMemo: (doc, docNumber) => `Reversal of ${docNumber} - credit memo ${doc.label} edited`,
  repostMemo: (doc) => `Credit memo ${doc.label} re-posted after an edit`,
  restoredMemo: (doc) => `Credit memo ${doc.label} posted again after its entry was discarded`,
}

const invoiceRow: DocumentEditRow = {
  family: 'invoice',
  noun: 'invoice',
  children: ['lineItems'],
  derivedTotalAttrs: ['invoice_subtotal', 'invoice_tax_total', 'invoice_total', 'invoice_balance'],
  postingType: INVOICE_ISSUED_POSTING_TYPE,
  // A draft is already editable; a void or written-off invoice has had its
  // receivable taken back out of the books and is corrected by raising a new one.
  editRefusedIn: ['draft', 'void', 'written_off'],

  afterSave: (db, { organizationId, userId, entityInstanceId }) =>
    syncInvoicePaymentState({ db, organizationId, userId, invoiceInstanceId: entityInstanceId }),

  async load(db, organizationId, entityInstanceId) {
    const invoice = await loadInvoiceForEdit(db, organizationId, entityInstanceId)
    return {
      id: invoice.id,
      status: invoice.status,
      internalNumber: invoice.number,
      label: invoice.number || invoice.id,
      totalMinor: invoice.totalMinor,
      // The two sums `syncInvoicePaymentState` projects `amount_paid` and
      // `amount_credited` from, read from the money model rather than the mirror.
      settledMinor: Math.round(invoice.amountPaidMinor + invoice.amountCreditedMinor),
      plan: async (planDb) => {
        const issuance = await loadInvoiceForIssuance(planDb, organizationId, invoice.id)
        if (!issuance) {
          throw new UnprocessableEntityError(
            `Invoice ${invoice.number || invoice.id} has no readable totals, so its entry cannot ` +
              'be rebuilt.',
            { invoiceId: invoice.id }
          )
        }
        const issuedAt = issuance.issuedAt ?? (await todayInBookTimeZone(organizationId))
        return {
          build(generation) {
            const built = buildEntryForInvoiceIssuance({
              invoiceId: invoice.id,
              invoice: issuance,
              issuedAt,
              generation,
            })
            return {
              entry: built.entry,
              post: (txDb, postInput) =>
                postInvoiceIssuanceBuiltEntry(txDb, {
                  organizationId,
                  invoiceId: invoice.id,
                  contactInstanceId: issuance.contactInstanceId,
                  entry: built,
                  actorUserId: postInput.actorUserId,
                  memo: postInput.memo,
                }),
            }
          },
        }
      },
    }
  },

  refuseEdit(doc) {
    if (doc.status === 'void' || doc.status === 'written_off') {
      return (
        `This invoice is ${doc.status.replace(/_/g, ' ')}. Its receivable is already out of the ` +
        'books, so it is corrected by raising a new invoice or a credit memo, never by editing it.'
      )
    }
    return `This invoice is ${doc.status.replace(/_/g, ' ')} and is already editable.`
  },

  refuseBelowFloor(doc) {
    return (
      `Invoice ${doc.label} now totals ${doc.totalMinor} but ${doc.settledMinor} has already been ` +
      'paid or credited against it. Unapply the payment or the credit first — an edit cannot ' +
      'take a receivable below what has been settled.'
    )
  },

  listPostings(db, params) {
    return listInvoicePostings(db, {
      organizationId: params.organizationId,
      invoiceId: params.entityInstanceId,
    })
  },

  reversalMemo: (doc, docNumber) => `Reversal of ${docNumber} - invoice ${doc.label} edited`,
  repostMemo: (doc) => `Invoice ${doc.label} re-posted after an edit`,
  restoredMemo: (doc) => `Invoice ${doc.label} posted again after its entry was discarded`,
}

const DOCUMENT_EDIT_SPEC: Readonly<Record<DocumentEditFamily, DocumentEditRow>> = {
  vendor_bill: vendorBillRow,
  credit_memo: creditMemoRow,
  invoice: invoiceRow,
}

/** The row for one family. The only way into the spec. */
export function documentEditRow(family: DocumentEditFamily): DocumentEditRow {
  return DOCUMENT_EDIT_SPEC[family]
}
