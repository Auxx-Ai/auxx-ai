// packages/lib/src/accounting/purchasing/expense-bill/writes.ts
//
// The Post and Void actions on a vendor bill - the ONE door into the books for
// either kind of bill (73 D3), whether its lines match a purchase order or are
// coded to expense accounts by hand.
//
// Kept out of `purchasing/match.ts` and `match-hook.ts` so the match stays what
// it is - the bill's VERDICT writer, with no ledger effect - and so the read,
// the build and the post do not share a file with it
// (`docs/lib-module-guide.md` §5). The entry itself is `post-vendor-bill.ts`.
//
// ## The trigger
//
// The same shape as the two closest siblings, and deliberately so:
// `markInvoiceSent` posts `invoice_issued` on the draft -> sent transition and
// `issueCreditMemo` posts `credit_memo` on draft -> issued, both from a router
// mutation, both with the ledger going FIRST and a refused post refusing the
// transition. {@link postVendorBill} is the bill's draft -> posted transition
// and does the same. The three-way match keeps running on a posted bill and
// writes its own field (73 D1); it never touches the lifecycle.
//
// ## Why a refused post refuses the ACTION here
//
// `postInvoiceIssuance` never throws, because an invoice must not fail to SEND
// because its bookkeeping did - the customer is waiting on the document. A bill
// has no such counterparty waiting: marking it `posted` is a statement that it
// IS in the books, so a refused post must refuse the status flip, exactly as
// `issueCreditMemo` refuses the issue. Nothing is written at that point.
//
// No permission checks here. The router asserts (§6).
//
// plans/accounting/tasks/73-the-buy-side-against-the-ledger.md §3

import { type Database, database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { toRecordId } from '@auxx/types/resource'
import { calendarDayToInstant } from '@auxx/utils/calendar-day'
import { getEntityDefIdResolver } from '../../../cache'
import { BadRequestError } from '../../../errors'
import { FieldValueService } from '../../../field-values/field-value-service'
import type { BuiltVendorBillEntry } from '../../ledger/builders/entry'
import { VENDOR_BILL_POSTING_TYPE, VENDOR_BILL_SOURCE_TYPE } from '../../ledger/builders/entry'
import { resolvePeriodLock } from '../../ledger/periods/period-lock'
import { isExpectedPostOutcome } from '../../ledger/post/ledger-accepted'
import { previewEntry } from '../../ledger/post/post-entry'
import { reverseEntry } from '../../ledger/post/reverse-entry'
import { listPostingsForSource } from '../../ledger/reads/list-postings'
import { todayInBookTimeZone } from '../../ledger/setup/book-time-zone'
import type { EntryPreview, PostResult } from '../../ledger/types'
import { readBillEditOpen } from '../bill-edit-flag'
import {
  buildEntryForVendorBill,
  postVendorBillEntry,
  readAllocationBasis,
} from '../post-vendor-bill'
import {
  loadVendorBillLines,
  requireVendorBill,
  type VendorBillLineRecord,
  type VendorBillRecord,
} from './reads'

const logger = createScopedLogger('purchasing:expense-bill')

/**
 * The bill lifecycle values a Post action may start from - the complement of
 * `posted` and `void` (73 D1).
 *
 * The match verdict is deliberately NOT consulted: an open `exception` is still
 * a bill somebody may decide to accept and book, and holding the payable off the
 * balance sheet while the dispute runs is the wrong side to be wrong on.
 */
const POSTABLE_BILL_STATUSES: ReadonlySet<string> = new Set(['draft'])

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * A writer for the bill's own fields.
 *
 * No `bypassFieldGuards`: `vendor_bill_status` carries no field pre-hook today
 * (`field-hooks/register-hooks.ts` registers one for `invoice_status`,
 * `quote_status`, `purchase_order_status` and `build_status`, and none for
 * this). 🛑 The day one is added, this is the call site that has to name
 * `vendor_bill_status` in a bypass, or Post stops working - that is the failure
 * `plans/dispatch/money/21-lifecycle-status-guards-are-inert.md` §4 documents.
 */
async function billWriter(
  db: Database,
  organizationId: string,
  userId: string
): Promise<{
  write: (billId: string, values: Array<{ fieldId: string; value: unknown }>) => Promise<void>
}> {
  const resolveDefId = await getEntityDefIdResolver(organizationId)
  const service = new FieldValueService(
    organizationId,
    userId,
    db === database ? undefined : db,
    undefined
  )
  return {
    write: async (billId, values) => {
      await service.setValuesForEntity({
        recordId: toRecordId(resolveDefId('vendor_bill'), billId),
        values,
      })
    },
  }
}

export interface VendorBillPostInput {
  organizationId: string
  /** The `vendor_bill` EntityInstance id. */
  vendorBillInstanceId: string
  userId: string
  /** `YYYY-MM-DD`. Overrides the bill's own `billedAt` for this post. */
  billedAt?: string
}

/** Everything the entry is built from, shared by the post and the preview. */
interface ResolvedVendorBill {
  bill: VendorBillRecord
  lines: VendorBillLineRecord[]
  billedAt: string
  built: BuiltVendorBillEntry
}

/**
 * Refuse a post that cannot be made, resolve its date, and build the entry.
 * Shared by {@link postVendorBill} and {@link previewVendorBill} so the two can
 * never disagree about what is refusable before the ledger is asked.
 */
async function resolveVendorBill(
  db: Database,
  input: VendorBillPostInput
): Promise<ResolvedVendorBill> {
  const { organizationId, vendorBillInstanceId } = input
  const bill = await requireVendorBill(db, organizationId, vendorBillInstanceId)

  if (!POSTABLE_BILL_STATUSES.has(bill.status)) {
    throw new BadRequestError(
      bill.status === 'void'
        ? 'This vendor bill is void and cannot be posted'
        : `This vendor bill is already ${bill.status.replace(/_/g, ' ')}`,
      { vendorBillInstanceId, status: bill.status }
    )
  }
  if (!bill.internalNumber.trim()) {
    throw new BadRequestError(
      'This vendor bill has no internal reference yet, and the entry keys its document number ' +
        'on it. Save the bill again so the numbering hook can issue one.',
      { vendorBillInstanceId }
    )
  }
  if (!bill.vendorCompanyInstanceId) {
    // The ledger would take the entry without one. The EXPORT would not: the
    // QuickBooks provider refuses a line on an `accounts_payable` account that
    // carries no counterparty, so an entry posted now would sit in the books
    // and fail every push until somebody found it. Refused at the door instead.
    throw new BadRequestError(
      'This vendor bill has no vendor, so its payable has nobody to be owed to. Set the vendor ' +
        'before posting it.',
      { vendorBillInstanceId }
    )
  }

  if (input.billedAt !== undefined && !CALENDAR_DAY.test(input.billedAt)) {
    throw new BadRequestError('billedAt must be a calendar day (YYYY-MM-DD)')
  }
  // The bill's own date is the ACCOUNTING date and is routinely a different
  // period from the day the paperwork was keyed - `vendor_bill_billed_at`'s own
  // registry description says so. Today is the fallback, never the default.
  const billedAt = input.billedAt ?? bill.billedAt ?? (await todayInBookTimeZone(organizationId))

  const lines = await loadVendorBillLines(db, organizationId, bill.lineIds)
  if (lines.length === 0) {
    throw new BadRequestError('A vendor bill needs at least one line before it can be posted', {
      vendorBillInstanceId,
    })
  }

  // The order's basis, not the builder's default: a freight-by-weight order
  // spreads its shipping leg by weight, and the bill has no basis of its own.
  const allocationBasis = await readAllocationBasis(db, organizationId, bill.purchaseOrderId)
  const built = buildEntryForVendorBill({ bill, lines, billedAt, allocationBasis })

  return { bill, lines, billedAt, built }
}

/**
 * What posting this bill WOULD write, resolved against the org's own chart.
 * Persists nothing - the drawer's live journal preview, the same shape
 * `previewIssueCreditMemo` returns.
 */
export async function previewVendorBill(
  db: Database,
  input: VendorBillPostInput
): Promise<EntryPreview> {
  const { built } = await resolveVendorBill(db, input)
  const lock = await resolvePeriodLock(input.organizationId)
  return previewEntry(db, { organizationId: input.organizationId, entry: built.entry, lock })
}

export interface PostVendorBillResult {
  post: PostResult
  /** `AUXX-BIL-BILL0007`, once the entry was built. */
  docNumber: string | null
  /** Integer minor units - the payable raised. */
  totalMinor: number
}

/**
 * Post one vendor bill - of EITHER kind - and flip it to `posted` (73 D3).
 *
 * ```
 *   Dr grni / Dr-or-Cr ppv          per line matched to an order line
 *   Dr <each coded line's account>  per unlinked line
 *   Dr freight_accrual / purchase_tax   the header's shipping and tax
 *       Cr accounts_payable           bill total   (counterparty: the vendor)
 * ```
 *
 * It requires a vendor, a date and every line typed. It does NOT require a
 * match verdict (73 D2): a bill posts at `awaiting_receipt`, `matched` or
 * `exception` alike, because a payable held off the balance sheet while a
 * dispute is open is the wrong side to be wrong on.
 *
 * The ledger goes FIRST and a refused post refuses the action, naming the
 * reason: a locked period, an uncoded line, a tie that fails, an unmapped role.
 * Nothing has been written at that point, so the bill stays where it was.
 *
 * 🛑 The status write happens AFTER the post has committed, never inside it.
 */
export async function postVendorBill(
  db: Database,
  input: VendorBillPostInput
): Promise<PostVendorBillResult> {
  const { organizationId, userId, vendorBillInstanceId } = input

  const { bill, billedAt, built } = await resolveVendorBill(db, input)

  // `resolveVendorBill` already refused a bill with no vendor - see there.
  const vendorCompanyInstanceId = bill.vendorCompanyInstanceId
  if (!vendorCompanyInstanceId) {
    throw new BadRequestError(
      'This vendor bill has no vendor, so its payable has nobody to be owed to.',
      { vendorBillInstanceId }
    )
  }

  // An org that has never turned the accounting module on is a first-class
  // case, not a degraded one (task 17 §3): the bill still posts as a document,
  // and nothing is claimed, written or logged in the ledger.
  const post: PostResult = (await postVendorBillEntry(db, {
    organizationId,
    actorUserId: userId,
    vendorBillInstanceId,
    purchaseOrderId: bill.purchaseOrderId,
    vendorCompanyInstanceId,
    entry: built,
    memo: `Bill ${bill.number || bill.internalNumber} posted`,
  })) ?? { status: 'not_enabled' }

  if (!isExpectedPostOutcome(post)) {
    throw new BadRequestError(
      'This vendor bill could not be posted to the general ledger' +
        `${post.error ? `: ${post.error}` : ` (${post.status})`}`,
      { vendorBillInstanceId, status: post.status }
    )
  }

  const writes: Array<{ fieldId: string; value: unknown }> = [
    { fieldId: 'vendor_bill_status', value: 'posted' },
  ]
  // Stamp the accounting date the entry actually used, so the document and the
  // ledger cannot disagree about which period this bill belongs to.
  if (bill.billedAt !== billedAt) {
    writes.push({ fieldId: 'vendor_bill_billed_at', value: calendarDayToInstant(billedAt) })
  }
  const writer = await billWriter(db, organizationId, userId)
  await writer.write(vendorBillInstanceId, writes)

  logger.info('Posted a vendor bill to the general ledger', {
    organizationId,
    vendorBillInstanceId,
    internalNumber: bill.internalNumber,
    status: post.status,
    docNumber: post.docNumber,
  })

  return { post, docNumber: post.docNumber ?? null, totalMinor: built.totalMinor }
}

/**
 * Every general-ledger entry sourced on one vendor bill, newest first.
 *
 * One source type for both kinds of bill since 73 D3, which is what lets a void
 * and the delete guard reckon with the whole document rather than half of it.
 */
export async function listVendorBillPostings(
  db: Database,
  params: { organizationId: string; vendorBillInstanceId: string }
): Promise<Array<{ glPostingId: string; docNumber: string; status: string; postingType: string }>> {
  const result = await listPostingsForSource(db, {
    organizationId: params.organizationId,
    sourceKind: VENDOR_BILL_SOURCE_TYPE,
    sourceId: params.vendorBillInstanceId,
  })
  if (result.isErr()) return []
  return result.value.map((posting) => ({
    glPostingId: posting.id,
    docNumber: posting.docNumber,
    status: posting.status,
    postingType: posting.postingType,
  }))
}

export interface VoidVendorBillInput {
  organizationId: string
  vendorBillInstanceId: string
  userId: string
  memo?: string
}

/**
 * Void a posted bill: reverse its entry, then set `void`.
 *
 * 🛑 Order is the whole point, and it is `voidInvoice`'s. A voided bill whose
 * expense and payable stayed in the books is the same error the posting exists
 * to close with the sign flipped - and it is undetectable, because both entries
 * balance. So the reversal goes first, and a refused reversal (a locked period,
 * a chart that moved under the entry) refuses the VOID by name. Nothing has
 * been written at that point.
 *
 * The reversal claims revision 1 on the same period key, so its document number
 * is the original's with `-R1` on the end.
 */
export async function voidVendorBill(db: Database, input: VoidVendorBillInput): Promise<void> {
  const { organizationId, userId, vendorBillInstanceId, memo } = input
  const bill = await requireVendorBill(db, organizationId, vendorBillInstanceId)

  if (bill.status === 'void') {
    throw new BadRequestError('This vendor bill is already void', { vendorBillInstanceId })
  }
  // An open edit means the values on screen are not the values the live entry was
  // built from, so "reverse every live posting" would back out the wrong figures.
  // Save or re-post first; then void (73 D4).
  if (await readBillEditOpen(db, organizationId, vendorBillInstanceId)) {
    throw new BadRequestError(
      'This vendor bill is open for editing. Save the edit first, then void it - a void has to ' +
        'reverse the entry the bill actually posted.',
      { vendorBillInstanceId }
    )
  }
  // The money axis, not the lifecycle (73 D1): "in the books" is `status`,
  // "money has moved" is `paymentStatus`.
  if (bill.paymentStatus === 'partially_paid' || bill.paymentStatus === 'paid') {
    throw new BadRequestError(
      'This vendor bill has been paid. Reverse the payment before voiding the bill - the money ' +
        'has already moved.',
      { vendorBillInstanceId, paymentStatus: bill.paymentStatus }
    )
  }

  const postings = await listVendorBillPostings(db, { organizationId, vendorBillInstanceId })
  // `PostingStatus` is `posted | reversed` since the export split; a reversed
  // original has already left the books.
  const live = postings.filter(
    (posting) => posting.postingType === VENDOR_BILL_POSTING_TYPE && posting.status !== 'reversed'
  )
  if (live.length > 0) {
    const lock = await resolvePeriodLock(organizationId)
    for (const posting of live) {
      const result = await reverseEntry(db, {
        organizationId,
        glPostingId: posting.glPostingId,
        actorUserId: userId,
        lock,
        memo:
          memo ??
          `Reversal of ${posting.docNumber} - bill ${bill.number || bill.internalNumber} voided`,
      })
      if (!isExpectedPostOutcome(result)) {
        throw new BadRequestError(
          `This vendor bill has a general ledger entry (${posting.docNumber}) that could not be ` +
            `reversed${result.error ? `: ${result.error}` : ` (${result.status})`}. Voiding it ` +
            'would leave its expense and its payable in the books with no document behind them.',
          { vendorBillInstanceId, docNumber: posting.docNumber, status: result.status }
        )
      }
    }
  }

  const writer = await billWriter(db, organizationId, userId)
  await writer.write(vendorBillInstanceId, [{ fieldId: 'vendor_bill_status', value: 'void' }])
}
