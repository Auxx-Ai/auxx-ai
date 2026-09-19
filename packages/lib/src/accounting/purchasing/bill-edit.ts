// packages/lib/src/accounting/purchasing/bill-edit.ts
//
// Edit and Save on a POSTED vendor bill (73 D4).
//
// ```
// draft --[Post]--> posted --[Edit]--> editing --[Save]--> posted
//  editable          locked            editable           reverse + repost if changed
// ```
//
// Edit writes one flag, `EntityInstance.metadata.editOpen`; the lock in
// `field-hooks/pre/vendor-bill-lock.ts` reads it and lifts. While it is set the
// line builder autosaves as on a draft and the three-way match keeps writing its
// own field - NOTHING touches the ledger. Save is where the ledger catches up.
//
// No snapshot and no Cancel, deliberately: without a snapshot "cancel" is
// "save", because the record is the truth. 66 U1 adds both on top of this flag
// and nothing here moves.
//
// No permission checks here. The router asserts (`docs/lib-module-guide.md` §6).

import { type Database, schema, withAccountingCommitLock } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { BadRequestError, ConflictError } from '../../errors'
import { VENDOR_BILL_POSTING_TYPE } from '../ledger/builders/entry'
import { resolvePeriodLock } from '../ledger/periods/period-lock'
import { isExpectedPostOutcome } from '../ledger/post/ledger-accepted'
import { reverseEntry } from '../ledger/post/reverse-entry'
import { todayInBookTimeZone } from '../ledger/setup/book-time-zone'
import type { BuiltEntry, GlPostingLineInput } from '../ledger/types'
import {
  type BillEditOpen,
  clearBillEditOpen,
  readBillEditOpen,
  writeBillEditOpen,
} from './bill-edit-flag'
import type { VendorBillRecord } from './expense-bill/reads'
import { loadVendorBillLines, requireVendorBill } from './expense-bill/reads'
import { listVendorBillPostings } from './expense-bill/writes'
import {
  buildEntryForVendorBill,
  postVendorBillEntry,
  readAllocationBasis,
} from './post-vendor-bill'

const logger = createScopedLogger('purchasing:bill-edit')

export interface BillEditInput {
  organizationId: string
  /** The `vendor_bill` EntityInstance id. */
  vendorBillInstanceId: string
  userId: string
}

export interface SaveBillEditResult {
  /**
   * `unchanged` — the rebuilt entry equals the live one, so nothing was posted.
   * `reposted` — the live entry was reversed and the bill posted again.
   * `not_posted` — the bill carries no live entry (accounting is off).
   */
  outcome: 'unchanged' | 'reposted' | 'not_posted'
  /** The entry's document number, when there is one. */
  docNumber: string | null
}

/**
 * Unlock a posted bill for editing. Writes the flag and nothing else.
 *
 * Refused on `void` (there is nothing to correct) and on `draft` (there is
 * nothing to unlock — a draft is already editable, and a flag set there would
 * still be standing when the bill is later posted).
 */
export async function openBillEdit(db: Database, input: BillEditInput): Promise<BillEditOpen> {
  const { organizationId, vendorBillInstanceId, userId } = input
  const bill = await requireVendorBill(db, organizationId, vendorBillInstanceId)

  if (bill.status !== 'posted') {
    throw new BadRequestError(
      bill.status === 'void'
        ? 'This vendor bill is void. A void bill is corrected by raising a new one, never by ' +
            'editing it.'
        : `This vendor bill is ${bill.status.replace(/_/g, ' ')} and is already editable.`,
      { vendorBillInstanceId, status: bill.status }
    )
  }

  const existing = await readBillEditOpen(db, organizationId, vendorBillInstanceId)
  if (existing) return existing

  const flag: BillEditOpen = { openedAt: new Date().toISOString(), byUserId: userId }
  await writeBillEditOpen(db, organizationId, vendorBillInstanceId, flag)
  logger.info('Opened a posted vendor bill for editing', {
    organizationId,
    vendorBillInstanceId,
    internalNumber: bill.internalNumber,
  })
  return flag
}

/**
 * Close the edit: bring the ledger up to the bill's current values, then clear
 * the flag.
 *
 * One transaction under `withAccountingCommitLock`, so the reversal, the repost
 * and the flag commit together — a bill whose entry was backed out and never
 * re-posted is unreachable rather than merely detectable.
 *
 * 🛑 Every floor and every build refusal runs BEFORE the ledger is touched, and
 * a refusal of any kind leaves the entry, the values and the flag exactly as
 * they were, naming the reason.
 *
 * When the rebuilt entry's lines equal the live posting's, nothing is posted: a
 * Save that only fixed a description would otherwise leave a reversal and its
 * twin in the books.
 */
export async function saveBillEdit(
  db: Database,
  input: BillEditInput
): Promise<SaveBillEditResult> {
  const { organizationId, vendorBillInstanceId, userId } = input

  const flag = await readBillEditOpen(db, organizationId, vendorBillInstanceId)
  if (!flag) {
    throw new ConflictError(
      'This vendor bill is not open for editing, so there is nothing to save. Press Edit first.',
      { vendorBillInstanceId }
    )
  }

  const bill = await requireVendorBill(db, organizationId, vendorBillInstanceId)
  if (bill.status !== 'posted') {
    throw new BadRequestError(
      `This vendor bill is ${bill.status.replace(/_/g, ' ')}, not posted, so there is no entry ` +
        'to bring up to date.',
      { vendorBillInstanceId, status: bill.status }
    )
  }

  const lines = await loadVendorBillLines(db, organizationId, bill.lineIds)
  assertSaveFloors(bill)

  const billedAt = bill.billedAt ?? (await todayInBookTimeZone(organizationId))
  // Throws an `UnprocessableEntityError` naming the line or the tie. Outside the
  // transaction deliberately: nothing is written either way, and the refusal must
  // not hold the org's accounting lock while it is composed.
  const allocationBasis = await readAllocationBasis(db, organizationId, bill.purchaseOrderId)
  const built = buildEntryForVendorBill({ bill, lines, billedAt, allocationBasis })

  const postings = await listVendorBillPostings(db, { organizationId, vendorBillInstanceId })
  const live = postings.filter(
    (posting) => posting.postingType === VENDOR_BILL_POSTING_TYPE && posting.status !== 'reversed'
  )

  if (live.length === 0) {
    await clearBillEditOpen(db, organizationId, vendorBillInstanceId)
    return { outcome: 'not_posted', docNumber: null }
  }

  if (
    live.length === 1 &&
    entryLinesEqual(built.entry, await readBuiltEntry(db, organizationId, live[0]!.glPostingId))
  ) {
    await clearBillEditOpen(db, organizationId, vendorBillInstanceId)
    logger.info('Saved a vendor bill edit with no ledger consequence', {
      organizationId,
      vendorBillInstanceId,
      internalNumber: bill.internalNumber,
    })
    return { outcome: 'unchanged', docNumber: live[0]!.docNumber }
  }

  const lock = await resolvePeriodLock(organizationId)
  const docNumber = await db.transaction(async (tx) => {
    await withAccountingCommitLock(tx, organizationId)
    // The poster and the reverser each open a transaction of their own. Handed
    // the caller's, those become savepoints on THIS connection, so the advisory
    // lock above is re-entered rather than waited on and the pair is atomic.
    const txDb = tx as unknown as Database

    for (const posting of live) {
      const reversal = await reverseEntry(txDb, {
        organizationId,
        glPostingId: posting.glPostingId,
        actorUserId: userId,
        lock,
        memo: `Reversal of ${posting.docNumber} - bill ${bill.number || bill.internalNumber} edited`,
      })
      if (!isExpectedPostOutcome(reversal)) {
        throw new BadRequestError(
          `This vendor bill's entry (${posting.docNumber}) could not be reversed` +
            `${reversal.error ? `: ${reversal.error}` : ` (${reversal.status})`}, so the edit ` +
            'cannot be saved. Nothing has been changed.',
          { vendorBillInstanceId, docNumber: posting.docNumber, status: reversal.status }
        )
      }
    }

    // Reversing DELETED the subject claim, so this claims the next generation on
    // the bill's own internal number rather than converging to `already_posted`.
    const post = await postVendorBillEntry(txDb, {
      organizationId,
      actorUserId: userId,
      vendorBillInstanceId,
      purchaseOrderId: bill.purchaseOrderId,
      vendorCompanyInstanceId: bill.vendorCompanyInstanceId,
      entry: built,
      memo: `Bill ${bill.number || bill.internalNumber} re-posted after an edit`,
    })
    if (post && !isExpectedPostOutcome(post)) {
      throw new BadRequestError(
        'This vendor bill could not be re-posted to the general ledger' +
          `${post.error ? `: ${post.error}` : ` (${post.status})`}. Nothing has been changed.`,
        { vendorBillInstanceId, status: post.status }
      )
    }

    await clearBillEditOpen(txDb, organizationId, vendorBillInstanceId)
    return post?.docNumber ?? null
  })

  logger.info('Re-posted a vendor bill after an edit', {
    organizationId,
    vendorBillInstanceId,
    internalNumber: bill.internalNumber,
    docNumber,
  })
  return { outcome: 'reposted', docNumber }
}

// ── The floors ───────────────────────────────────────────────────────────────

/**
 * The one refusal that lands before the ledger is touched (73 D4): the new total may not
 * fall below `paid + credited`, or A/P goes negative on a document saying the opposite.
 * Billing below what was received is not floored: that is ordinary GRNI, the match's healthy state.
 */
function assertSaveFloors(bill: VendorBillRecord): void {
  const settledMinor = Math.round(bill.amountPaidMinor + bill.amountCreditedMinor)
  if (settledMinor > 0 && bill.totalMinor < settledMinor) {
    throw new ConflictError(
      `Bill ${bill.number || bill.internalNumber} now totals ${bill.totalMinor} but ` +
        `${settledMinor} has already been paid or credited against it. Reverse the payment or ` +
        'the credit first — an edit cannot take a payable below what has been settled.',
      {
        vendorBillInstanceId: bill.id,
        totalMinor: String(bill.totalMinor),
        settledMinor: String(settledMinor),
      }
    )
  }
}

// ── The comparison ───────────────────────────────────────────────────────────

/** The stored `BuiltEntry` of one posting, or `null` when it cannot be read. */
async function readBuiltEntry(
  db: Database,
  organizationId: string,
  glPostingId: string
): Promise<BuiltEntry | null> {
  const [row] = await db
    .select({ built: schema.GlPosting.built })
    .from(schema.GlPosting)
    .where(
      and(eq(schema.GlPosting.id, glPostingId), eq(schema.GlPosting.organizationId, organizationId))
    )
    .limit(1)

  const built = row?.built
  if (!built || typeof built !== 'object') return null
  const entry = (built as Record<string, unknown>).entry
  return entry && typeof entry === 'object' ? (entry as BuiltEntry) : null
}

/**
 * Do these two entries say the same thing?
 *
 * The date and the line set, compared on what a ledger line IS — its account,
 * its side, its amount and what it is sourced on. The memo is deliberately not
 * compared: re-posting a whole entry because somebody fixed a typo in a line
 * description would leave a reversal pair in the books for a change with no
 * accounting content. An unreadable stored entry compares as different, so the
 * Save reposts rather than silently doing nothing.
 */
function entryLinesEqual(next: BuiltEntry, live: BuiltEntry | null): boolean {
  if (!live) return false
  if (next.txnDate !== live.txnDate) return false
  const a = next.lines.map(lineKey).sort()
  const b = (live.lines ?? []).map(lineKey).sort()
  return a.length === b.length && a.every((key, index) => key === b[index])
}

/** One line reduced to the facts the ledger keeps. */
function lineKey(line: GlPostingLineInput): string {
  const account = line.glAccountId ?? line.accountCode ?? line.accountRole ?? ''
  return `${account}|${line.direction}|${line.amount}|${line.sourceId ?? ''}`
}
