// packages/lib/src/postings/build-entry.ts
//
// PURE. Turns source rows into balanced posting lines. No database, no provider,
// no clock, no io. Everything here is a total function of its arguments, which
// is what lets the balance rule below be tested exhaustively instead of hoped
// for.
//
// Failures here are programmer error - an unbalanced entry means the caller
// computed the wrong numbers - so this file THROWS `AuxxError` subclasses rather
// than returning a `Result`. Per docs/lib-module-guide.md, `Result` is for
// runtime failure; a builder that cannot balance its own arithmetic is a bug.

import { UnprocessableEntityError } from '../errors'
import type { BuiltEntry, GlPostingLineInput, PostingType } from './types'

/**
 * The chart of accounts this module posts to, in one place.
 *
 * These are CODES, not provider account ids (decision P2). A code is ours and
 * means the same thing whether QuickBooks is connected, replaced, or absent. The
 * mapping from a code to a provider's own id lives in exactly one place -
 * `AccountingProvider.resolveAccount` - and nowhere else.
 *
 * Named constants rather than string literals at the call sites because `'2160'`
 * appearing in four builders is four places to get a digit wrong, and a posting
 * to the wrong account balances perfectly and is invisible until a close.
 */
export const ACCOUNT_CODES = {
  /** 1000 Cash. Credited when a bill is paid in ledger mode (decision P12). */
  CASH: '1000',
  /**
   * 1310 Raw Materials. Debited at LANDED cost when a component or a
   * subassembly is received - `partKind` maps BOTH to this account
   * (plans/products/01-product-family.md §4).
   */
  RAW_MATERIALS: '1310',
  /**
   * 1330 Finished Goods. The other inventory account a receipt can debit, when
   * the part received is a finished good.
   *
   * ⚠️ Which of the two applies is NOT decided here. It is the movement's own
   * frozen `stock_movement_gl_account`, resolved from `partKind` by
   * `receiveStock` at write time and passed in as
   * `ReceiptEntryInput.inventoryAccountCode`. One receipt must not carry two
   * account codes.
   *
   * Note 1320 WIP is deliberately absent: nothing in the `partKind` table maps
   * to it, and receiving never produces work in progress.
   */
  FINISHED_GOODS: '1330',
  /** 2000 Accounts Payable. Credited for the vendor bill total. */
  ACCOUNTS_PAYABLE: '2000',
  /** 2150 Freight Accrual. Holds the carrier's share until the carrier bills. */
  FREIGHT_ACCRUAL: '2150',
  /**
   * 2160 Goods Received Not Invoiced. Credited on receipt at the VENDOR unit
   * price, debited again when the vendor's bill arrives. See
   * `buildReceiptEntry` for why the "vendor unit price" half is load-bearing.
   */
  GRNI: '2160',
  /**
   * 2170 Duties Accrual. Holds the customs broker's share.
   *
   * Only ever appears when there is a non-zero tariff portion. Build plan phase
   * 0.1 asks whether `tariffRate` is ever non-zero at all; if the answer is no,
   * this account should not be created in the chart and no line will ever
   * reference it - which is exactly what `buildReceiptEntry` produces when the
   * duty portion is zero.
   */
  DUTIES_ACCRUAL: '2170',
  /**
   * 5090 Purchase Price Variance. Absorbs the difference between what we
   * accrued on receipt and what the vendor actually billed. Debit when billed
   * high, credit when billed low.
   */
  PPV: '5090',
} as const

export type AccountCode = (typeof ACCOUNT_CODES)[keyof typeof ACCOUNT_CODES]

export interface BuildEntryInput {
  postingType: PostingType
  periodKey: string
  /** `YYYY-MM-DD`. */
  txnDate: string
  lines: GlPostingLineInput[]
}

/** A line as the builders express it, before zero legs are dropped and ordered. */
interface DraftLine {
  accountCode: string
  direction: 'debit' | 'credit'
  amount: number
  memo?: string
}

function assertMinorUnits(amount: number, label: string): void {
  if (!Number.isFinite(amount) || !Number.isInteger(amount)) {
    throw new UnprocessableEntityError(
      `${label} must be an integer number of minor units, got ${String(amount)}`,
      { amount: String(amount) }
    )
  }
}

/**
 * Build a balanced entry from explicit lines.
 *
 * **This is the balance gate, and it is the reason the file exists.** The sum of
 * debits must equal the sum of credits, in integer minor units, before anything
 * is persisted or pushed. QuickBooks enforces the same rule server-side with a
 * specific fault code (2300), but a provider-agnostic ledger cannot use its
 * provider as its validator: by the time the provider rejects, we have written a
 * `pending` `gl_posting` row and there is no entry anywhere to match it, and for
 * an org with NO provider connected nothing ever checks at all.
 *
 * Also rejected here, for the same reason - each of these produces an entry that
 * is wrong in a way no downstream reader can detect:
 *
 * - a non-integer or non-finite amount (minor units are integers; a float cent
 *   is a rounding bug that has already happened)
 * - a negative amount (sign lives in `direction`, only - see `GlPostingLineInput`)
 * - a zero amount (an entry leg that moves nothing; drop it upstream)
 * - a blank account code
 * - an entry with no lines, or with lines on only one side
 *
 * @throws {UnprocessableEntityError} on any of the above.
 */
export function buildEntry(input: BuildEntryInput): BuiltEntry {
  const { postingType, periodKey, txnDate, lines } = input

  if (lines.length === 0) {
    throw new UnprocessableEntityError('A posting must have at least one line', {
      postingType,
      periodKey,
    })
  }

  let totalDebit = 0
  let totalCredit = 0

  for (const line of lines) {
    if (!line.accountCode || line.accountCode.trim().length === 0) {
      throw new UnprocessableEntityError('A posting line must carry an account code', {
        postingType,
        periodKey,
      })
    }
    assertMinorUnits(line.amount, `Posting line amount for account ${line.accountCode}`)
    if (line.amount < 0) {
      throw new UnprocessableEntityError(
        `Posting line amount must be positive - direction carries the sign (account ${line.accountCode}, amount ${line.amount})`,
        { accountCode: line.accountCode, amount: String(line.amount) }
      )
    }
    if (line.amount === 0) {
      throw new UnprocessableEntityError(
        `Posting line amount must be non-zero (account ${line.accountCode})`,
        { accountCode: line.accountCode }
      )
    }

    if (line.direction === 'debit') totalDebit += line.amount
    else totalCredit += line.amount
  }

  if (totalDebit !== totalCredit) {
    throw new UnprocessableEntityError(
      `Posting does not balance: debits ${totalDebit} != credits ${totalCredit}`,
      {
        postingType,
        periodKey,
        totalDebit: String(totalDebit),
        totalCredit: String(totalCredit),
      }
    )
  }

  // Both sides zero passes the equality above, which is exactly the entry that
  // is meaningless. Unreachable through the zero-amount check while there is at
  // least one line, but asserted so a future relaxation of that check cannot
  // quietly reintroduce it.
  if (totalDebit === 0) {
    throw new UnprocessableEntityError('Posting has no value on either side', {
      postingType,
      periodKey,
    })
  }

  return { postingType, periodKey, txnDate, lines, totalDebit, totalCredit }
}

/**
 * Drop zero legs, stamp the audit trail and the presentation order.
 *
 * Dropping zeros is deliberate and is not merely tidiness: a zero-amount leg
 * against an account that should not exist - `2170 Duties Accrual` on an org
 * that has never paid a tariff - would force that account into the chart and
 * into every provider's chart, for no information at all.
 */
function materialize(
  drafts: DraftLine[],
  source: { sourceType: string; sourceId: string }
): GlPostingLineInput[] {
  return drafts
    .filter((draft) => draft.amount !== 0)
    .map((draft, index) => ({
      accountCode: draft.accountCode,
      direction: draft.direction,
      amount: draft.amount,
      memo: draft.memo,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      sortOrder: index,
    }))
}

export interface ReceiptEntryInput {
  /** The `stock_movement` (type `receive`) row this entry accounts for. */
  stockMovementId: string
  periodKey: string
  /** `YYYY-MM-DD`. */
  txnDate: string
  /**
   * The VENDOR's unit price in minor units - what the vendor will invoice, and
   * nothing else. Not the landed cost.
   */
  vendorUnitPriceMinor: number
  /** Units received. Integer - partial units are not a thing we receive. */
  quantity: number
  /** This receipt's allocated share of freight, in minor units. */
  freightMinor: number
  /** This receipt's allocated share of duty/tariff, in minor units. */
  dutyMinor: number
  /**
   * The inventory account this receipt debits, as a CODE.
   *
   * Required, with no default, and deliberately so. It must be the movement's
   * OWN frozen `stock_movement_gl_account`, which `receiveStock` resolved from
   * the part's `partKind` at write time - `1310` for a component or a
   * subassembly, `1330` for a finished good. Re-deriving it here, or defaulting
   * it to Raw Materials, gives the same receipt two account codes that can
   * disagree: the ledger row would relieve 1330 and the posting would debit
   * 1310, and nothing would ever reconcile them. The movement is the source of
   * truth; this parameter exists to carry it, not to decide it.
   */
  inventoryAccountCode: string
  memo?: string
}

/**
 * The receipt entry (decision P7, build plan 7.5):
 *
 * ```
 * Dr <inventory account>    quantity x LANDED cost   (1310 or 1330 - see input)
 *   Cr 2160 GRNI             quantity x VENDOR unit price
 *   Cr 2150 Freight Accrual  the freight portion      (omitted when zero)
 *   Cr 2170 Duties Accrual   the tariff portion       (omitted when zero)
 * ```
 *
 * **GRNI is credited at `vendorUnitPrice`, never at landed cost. This is the
 * single most important rule in this module.** The reason is not accounting
 * theory, it is the shape of the paperwork: the vendor's invoice contains only
 * the unit price. Freight is invoiced separately, weekly, by the carrier; duty
 * comes from the customs broker on its own schedule. So the only number the
 * vendor's bill can ever relieve from GRNI is `vendorUnitPrice x quantity`.
 *
 * Credit GRNI at landed cost and debit it at vendor-only when the bill arrives,
 * and the account is short by the freight and duty on every single receipt,
 * forever. That residue never clears and it is not a small explainable balance
 * by month three - it is the sum of all freight and duty ever received, sitting
 * in a liability account that is supposed to be a transient accrual, and there
 * is no query that can decompose it back out. Freight and duty clear against
 * their OWN accruals (2150, 2170) when their own bills arrive, which is the
 * whole point of giving them separate accounts.
 *
 * The entry balances by construction - landed cost is defined as the sum of the
 * three credits - but `buildEntry` still asserts it, because "by construction"
 * is a property of today's arithmetic and not of tomorrow's edit.
 *
 * @throws {UnprocessableEntityError} on non-integer minor units, a negative
 * quantity or portion, or (via `buildEntry`) an entry that does not balance.
 */
export function buildReceiptEntry(input: ReceiptEntryInput): BuiltEntry {
  const { vendorUnitPriceMinor, quantity, freightMinor, dutyMinor } = input

  assertMinorUnits(vendorUnitPriceMinor, 'Vendor unit price')
  assertMinorUnits(freightMinor, 'Freight portion')
  assertMinorUnits(dutyMinor, 'Duty portion')
  if (!Number.isInteger(quantity)) {
    throw new UnprocessableEntityError(`Received quantity must be an integer, got ${quantity}`, {
      quantity: String(quantity),
    })
  }
  if (quantity <= 0) {
    throw new UnprocessableEntityError(`Received quantity must be positive, got ${quantity}`, {
      quantity: String(quantity),
    })
  }
  if (vendorUnitPriceMinor < 0 || freightMinor < 0 || dutyMinor < 0) {
    throw new UnprocessableEntityError(
      'Receipt amounts must be non-negative - a credit memo is a separate posting, not a negative receipt'
    )
  }

  const goodsMinor = vendorUnitPriceMinor * quantity
  const landedMinor = goodsMinor + freightMinor + dutyMinor

  const drafts: DraftLine[] = [
    {
      // The movement's own frozen code, never re-derived here - see the field doc.
      accountCode: input.inventoryAccountCode,
      direction: 'debit',
      amount: landedMinor,
      memo: input.memo ?? `Received ${quantity} at landed cost`,
    },
    { accountCode: ACCOUNT_CODES.GRNI, direction: 'credit', amount: goodsMinor },
    { accountCode: ACCOUNT_CODES.FREIGHT_ACCRUAL, direction: 'credit', amount: freightMinor },
    { accountCode: ACCOUNT_CODES.DUTIES_ACCRUAL, direction: 'credit', amount: dutyMinor },
  ]

  return buildEntry({
    postingType: 'receipt',
    periodKey: input.periodKey,
    txnDate: input.txnDate,
    lines: materialize(drafts, {
      sourceType: 'stock_movement',
      sourceId: input.stockMovementId,
    }),
  })
}

export interface VendorBillEntryInput {
  /** The `vendor_bill` row this entry accounts for. */
  vendorBillId: string
  periodKey: string
  /** `YYYY-MM-DD`. */
  txnDate: string
  /**
   * The portion of the bill that matches an accrued receipt, in minor units:
   * `SUM(qtyBilled x vendorUnitPrice)` over the matched receipt lines. This is
   * what is relieved from GRNI, and it is why GRNI had to be credited at the
   * vendor price in the first place.
   */
  matchedMinor: number
  /** What the vendor is actually charging, in minor units. */
  billTotalMinor: number
  memo?: string
}

/**
 * The matched vendor bill entry (build plan 7.5):
 *
 * ```
 * Dr 2160 GRNI                the matched portion
 * Dr/Cr 5090 PPV              the residual, if any
 *   Cr 2000 Accounts Payable  the bill total
 * ```
 *
 * The residual is `billTotal - matched`. Billed HIGH (positive residual) is a
 * debit to PPV - an unfavourable variance, a cost we did not accrue. Billed LOW
 * is a credit. Exactly zero produces no PPV line at all, which is the ordinary
 * case and should stay visibly ordinary in the register.
 *
 * Note what is NOT here: freight and duty. They were accrued to 2150 and 2170 on
 * receipt and are relieved by the carrier's and the broker's own bills, on their
 * own schedules. A vendor bill that also carried freight would be two postings,
 * not one line - see `buildReceiptEntry` for why the accruals are kept apart.
 *
 * @throws {UnprocessableEntityError} on non-integer minor units, or (via
 * `buildEntry`) an entry that does not balance.
 */
export function buildVendorBillEntry(input: VendorBillEntryInput): BuiltEntry {
  const { matchedMinor, billTotalMinor } = input

  assertMinorUnits(matchedMinor, 'Matched portion')
  assertMinorUnits(billTotalMinor, 'Bill total')
  if (matchedMinor < 0) {
    throw new UnprocessableEntityError(
      `Matched portion must be non-negative, got ${matchedMinor}`,
      { matchedMinor: String(matchedMinor) }
    )
  }
  if (billTotalMinor <= 0) {
    throw new UnprocessableEntityError(
      `Bill total must be positive, got ${billTotalMinor} - a vendor credit is a separate posting`,
      { billTotalMinor: String(billTotalMinor) }
    )
  }

  const residualMinor = billTotalMinor - matchedMinor

  const drafts: DraftLine[] = [
    {
      accountCode: ACCOUNT_CODES.GRNI,
      direction: 'debit',
      amount: matchedMinor,
      memo: input.memo ?? 'Relieve goods received not invoiced',
    },
    {
      accountCode: ACCOUNT_CODES.PPV,
      direction: residualMinor >= 0 ? 'debit' : 'credit',
      amount: Math.abs(residualMinor),
      memo: 'Purchase price variance',
    },
    {
      accountCode: ACCOUNT_CODES.ACCOUNTS_PAYABLE,
      direction: 'credit',
      amount: billTotalMinor,
    },
  ]

  return buildEntry({
    postingType: 'vendor_bill',
    periodKey: input.periodKey,
    txnDate: input.txnDate,
    lines: materialize(drafts, { sourceType: 'vendor_bill', sourceId: input.vendorBillId }),
  })
}
