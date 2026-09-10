// packages/lib/src/purchasing/expense-bill/writes.ts
//
// Posting a standalone company's A/P bill to the general ledger, and backing it
// out again when the bill is voided.
//
// The write half of `postings/build-expense-bill-entry.ts`, kept out of
// `purchasing/match.ts` and `match-hook.ts` so the match stays what it is - the
// bill's VERDICT writer - and so the read, the build and the post do not share a
// file with it (`docs/lib-module-guide.md` §5).
//
// ## The trigger
//
// The same shape as the two closest siblings, and deliberately so:
// `markInvoiceSent` posts `invoice_issued` on the draft -> sent transition and
// `issueCreditMemo` posts `credit_memo` on draft -> issued, both from a router
// mutation, both with the ledger going FIRST and a refused post refusing the
// transition. {@link postExpenseBill} is the bill's draft -> posted transition
// and does the same. `posted` is not in `MATCHABLE_STATUSES`, so the three-way
// match hook leaves a posted bill alone from then on.
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
// plans/accounting/tasks/21-the-books-stand-alone.md §3.2

import { type Database, database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { toRecordId } from '@auxx/types/resource'
import { getEntityDefIdResolver } from '../../cache'
import { BadRequestError } from '../../errors'
import { FieldValueService } from '../../field-values/field-value-service'
import { isAccountingEnabled } from '../../postings/accounting-enabled'
import {
  type BuiltExpenseBillEntry,
  buildExpenseBillEntry,
  EXPENSE_BILL_POSTING_TYPE,
  EXPENSE_BILL_SOURCE_TYPE,
} from '../../postings/build-expense-bill-entry'
import { listPostingsForSource } from '../../postings/list-postings'
import { resolvePeriodLock } from '../../postings/period-lock'
import { periodKeyForDate } from '../../postings/periods'
import { LEDGER_CURRENCY, postEntry, previewEntry } from '../../postings/post-entry'
import { reverseEntry } from '../../postings/reverse-entry'
import { OPENING_BASELINE_SETTING_KEYS } from '../../postings/setup-readiness'
import type { EntryPreview, PostResult } from '../../postings/types'
import { getOrganizationSetting } from '../../settings/settings-service'
import {
  loadVendorBillLines,
  requireVendorBill,
  type VendorBillLineRecord,
  type VendorBillRecord,
} from './reads'

const logger = createScopedLogger('purchasing:expense-bill')

/**
 * The statuses that mean the LEDGER took the entry. The same set
 * `postInvoiceIssuance` and `issueCreditMemo` accept, for the same reasons: a
 * refused EXPORT still returns `posted` (see
 * `plans/accounting/export-state-split.md`), an org with no accounting system is
 * a first-class case (decision P1), and an org that never enabled the module is
 * another (task 17 §3).
 */
const ACCEPTED_POST_STATUSES = new Set<string>([
  'posted',
  'already_posted',
  'healed',
  'not_connected',
  'disabled',
  'not_enabled',
])

/** The statuses that mean a reversal landed. Same set as `reverseInvoiceIssuance`. */
const ACCEPTED_REVERSAL_STATUSES = ACCEPTED_POST_STATUSES

/**
 * The bill statuses a Post action may start from.
 *
 * The complement of the three the delete guard already calls settled
 * (`posted`, `partially_paid`, `paid`) plus `void`. `exception` is in: a bill
 * the three-way match flagged is still a bill somebody may decide to accept and
 * book, and refusing to post it would leave the payable off the balance sheet
 * for as long as the exception is open - which is the wrong side to be wrong on.
 */
const POSTABLE_BILL_STATUSES: ReadonlySet<string> = new Set([
  'draft',
  'awaiting_receipt',
  'matched',
  'exception',
])

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/

/** Today, in the org's own book time zone - falls back to UTC while setup is incomplete. */
async function todayInBookTimeZone(organizationId: string): Promise<string> {
  const raw = await getOrganizationSetting({
    organizationId,
    key: OPENING_BASELINE_SETTING_KEYS.bookTimeZone,
  })
  const bookTimeZone = typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : 'UTC'
  return periodKeyForDate(new Date(), 'day', bookTimeZone)
}

/**
 * A calendar day written into a DATETIME field.
 *
 * Noon UTC rather than midnight, so the instant renders as the SAME calendar day
 * in every zone from UTC-12 to UTC+11. The ledger reads only the day back
 * (`reads.ts` slices it), so the hour carries no meaning beyond display.
 */
function calendarDayToInstant(day: string): string {
  return `${day}T12:00:00.000Z`
}

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

export interface ExpenseBillPostInput {
  organizationId: string
  /** The `vendor_bill` EntityInstance id. */
  vendorBillInstanceId: string
  userId: string
  /** `YYYY-MM-DD`. Overrides the bill's own `billedAt` for this post. */
  billedAt?: string
}

/** Everything the entry is built from, shared by the post and the preview. */
interface ResolvedExpenseBill {
  bill: VendorBillRecord
  lines: VendorBillLineRecord[]
  billedAt: string
  built: BuiltExpenseBillEntry
}

/**
 * Refuse a post that cannot be made, resolve its date, and build the entry.
 * Shared by {@link postExpenseBill} and {@link previewExpenseBill} so the two
 * can never disagree about what is refusable before the ledger is asked.
 */
async function resolveExpenseBill(
  db: Database,
  input: ExpenseBillPostInput
): Promise<ResolvedExpenseBill> {
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

  const built = buildExpenseBillEntry({
    vendorBillId: vendorBillInstanceId,
    internalNumber: bill.internalNumber,
    billedAt,
    currency: bill.currency,
    ledgerCurrency: LEDGER_CURRENCY,
    total: bill.totalMinor,
    lines: lines.map((line) => ({
      lineId: line.id,
      glAccountId: line.glAccountId,
      amount: line.lineTotalMinor,
      description: line.description,
    })),
    vendorCompanyInstanceId: bill.vendorCompanyInstanceId,
    memo: `Bill ${bill.number || bill.internalNumber}`,
  })

  return { bill, lines, billedAt, built }
}

/**
 * What posting this bill WOULD write, resolved against the org's own chart.
 * Persists nothing - the drawer's live journal preview, the same shape
 * `previewIssueCreditMemo` returns.
 */
export async function previewExpenseBill(
  db: Database,
  input: ExpenseBillPostInput
): Promise<EntryPreview> {
  const { built } = await resolveExpenseBill(db, input)
  const lock = await resolvePeriodLock(input.organizationId)
  return previewEntry(db, { organizationId: input.organizationId, entry: built.entry, lock })
}

export interface PostExpenseBillResult {
  post: PostResult
  /** `AUXX-EXB-BILL0007`, once the entry was built. */
  docNumber: string | null
  /** Integer minor units - the payable raised. */
  totalMinor: number
}

/**
 * Post one expense-coded vendor bill and flip it to `posted`.
 *
 * ```
 *   Dr <each line's coded account>   line total
 *       Cr accounts_payable            bill total   (counterparty: the vendor)
 * ```
 *
 * The ledger goes FIRST and a refused post refuses the action, naming the
 * reason: a locked period, an uncoded line, an unmapped `accounts_payable`
 * role. Nothing has been written at that point, so the bill stays where it was.
 *
 * Idempotent by the claim's unique index: the period key is the bill's own
 * INTERNAL number, which is `RecordSequence`-issued and unique in the org, so a
 * second call claims the same `(org, expense_bill, periodKey, revision=0)`
 * tuple and converges to `already_posted` - and unlike a minted hash key it
 * cannot fold two different bills together.
 *
 * 🛑 The status write happens AFTER the post has committed, never inside it.
 */
export async function postExpenseBill(
  db: Database,
  input: ExpenseBillPostInput
): Promise<PostExpenseBillResult> {
  const { organizationId, userId, vendorBillInstanceId } = input

  const { bill, billedAt, built } = await resolveExpenseBill(db, input)

  // An org that has never turned the accounting module on is a first-class
  // case, not a degraded one (task 17 §3): the bill still posts as a document,
  // and nothing is claimed, written or logged in the ledger.
  let post: PostResult
  if (await isAccountingEnabled(db, organizationId)) {
    const lock = await resolvePeriodLock(organizationId)
    post = await postEntry(db, {
      organizationId,
      entry: built.entry,
      actorUserId: userId,
      lock,
      memo: `Bill ${bill.number || bill.internalNumber} posted`,
    })
  } else {
    post = { status: 'not_enabled' }
  }

  if (!ACCEPTED_POST_STATUSES.has(post.status)) {
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

  logger.info('Posted an expense bill to the general ledger', {
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
 * `sourceType: 'vendor_bill'` covers the expense-bill entry AND, when the L3
 * regime is switched on, the purchasing bill entry - which is exactly what a
 * void and the delete guard have to reckon with.
 */
export async function listVendorBillPostings(
  db: Database,
  params: { organizationId: string; vendorBillInstanceId: string }
): Promise<Array<{ glPostingId: string; docNumber: string; status: string; postingType: string }>> {
  const result = await listPostingsForSource(db, {
    organizationId: params.organizationId,
    sourceType: EXPENSE_BILL_SOURCE_TYPE,
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

export interface VoidExpenseBillInput {
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
export async function voidExpenseBill(db: Database, input: VoidExpenseBillInput): Promise<void> {
  const { organizationId, userId, vendorBillInstanceId, memo } = input
  const bill = await requireVendorBill(db, organizationId, vendorBillInstanceId)

  if (bill.status === 'void') {
    throw new BadRequestError('This vendor bill is already void', { vendorBillInstanceId })
  }
  if (bill.status === 'partially_paid' || bill.status === 'paid') {
    throw new BadRequestError(
      'This vendor bill has been paid. Reverse the payment before voiding the bill - the money ' +
        'has already moved.',
      { vendorBillInstanceId, status: bill.status }
    )
  }

  const postings = await listVendorBillPostings(db, { organizationId, vendorBillInstanceId })
  // `PostingStatus` is `posted | reversed` since the export split; a reversed
  // original has already left the books.
  const live = postings.filter(
    (posting) => posting.postingType === EXPENSE_BILL_POSTING_TYPE && posting.status !== 'reversed'
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
      if (!ACCEPTED_REVERSAL_STATUSES.has(result.status)) {
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
