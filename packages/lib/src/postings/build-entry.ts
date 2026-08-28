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
 * The posting ROLES this module emits, in one place.
 *
 * ## Why this is not a list of account numbers
 *
 * It used to be. `GRNI: '2160'` was a code, and a code is what a posting line
 * carries all the way to the provider (decision `P2`): a code is ours, it means
 * the same thing whether QuickBooks is connected, replaced or absent, and it is
 * what makes an entry auditable three years later with no API call.
 *
 * `P2` is unchanged. What changed is one layer above it. Decision `G7` makes
 * the chart of accounts a seeded **default the org edits**, not a fixed list -
 * charts are not standardised, US GAAP mandates no numbering, QuickBooks'
 * default varies by country and industry and is routinely edited, and France's
 * PCG and Germany's SKR03/04 mandate different ones outright. The moment the
 * chart is editable, the NUMBER can no longer carry the meaning: a customer who
 * renumbers goods-received-not-invoiced from `2160` to `2155` would silently
 * break every posting that hardcoded `'2160'`. The entry would still balance,
 * so nothing downstream could detect it. It would surface at a close, as a
 * number that is wrong for reasons nobody can reconstruct.
 *
 * So decision `G8`: **a builder posts to a role, and the org maps one of its own
 * accounts to that role.** The chain is
 *
 * ```
 *   role  ->  the org's gl_account  ->  its code  ->  the provider's own id
 *          ^                         ^                ^
 *          |                         |                `AccountingProvider.resolveAccount`
 *          |                         the ledger line stores this (P2)
 *          the resolver, ahead of the claim - fails CLOSED on 0 or >1 match
 * ```
 *
 * Only the last hop belongs to a provider adapter, exactly as before. `G8` adds
 * the FIRST hop, and it is what keeps `G7` and correctness both true. It is
 * `P2`'s own argument one level up: `P2` refuses to tie the ledger to one
 * provider's account ids, `G8` refuses to tie it to one company's numbering.
 *
 * ## Why named constants rather than string literals
 *
 * Unchanged from when these were codes: `'grni'` appearing in four builders is
 * four places to get it wrong, and a posting to the wrong account balances
 * perfectly and is invisible until a close.
 *
 * ## This vocabulary is auxx's, and it is CLOSED
 *
 * An org may renumber, rename or replace the account behind a role. It may not
 * invent a role, because a role only means something if a builder emits it.
 *
 * ⚠️ This is the module's own copy of the vocabulary, for the same reason
 * `POSTING_TYPES` in `types.ts` is: it is client-safe and keeps this file pure.
 * The storage contract is `GlAccountRole` in
 * `resources/registry/enum-values.ts` and the two are pinned to each other by
 * an exact-set-equality test in `__tests__/build-entry.test.ts`. Adding a role
 * is one atomic change to both, plus an options migration - `ensureCustomFields`
 * never rewrites an existing field's `options`, so a new value otherwise reaches
 * new orgs only.
 *
 * ## Scope
 *
 * These twelve cover what the code posts to today - the receipt and vendor bill
 * builders below - plus the L1 month-end inventory entry that is the January 1
 * deliverable (`plans/money/04-books.md` §2.1). The designed-but-unbuilt
 * builders (fulfillment, payout, build, month-end deferral) will need roles for
 * revenue, the clearing accounts, sales tax, deferred revenue, merchant fees,
 * freight-out and receivables. Those are deliberately absent: their entries are
 * design only, which account each leg lands on is still open, and a role nothing
 * emits is a select value a bookkeeper can map wrongly with no way to find out.
 */
export const ACCOUNT_ROLES = {
  /** Cash (default `1000`). Credited when a bill is paid in ledger mode (decision P12). */
  CASH: 'cash',
  /**
   * Raw materials inventory (default `1310`). Debited at LANDED cost when a
   * component or a subassembly is received - `partKind` maps BOTH to this role
   * (plans/products/01-product-family.md §4).
   */
  INVENTORY_RAW_MATERIALS: 'inventory_raw_materials',
  /**
   * Work in process inventory (default `1320`).
   *
   * ⚠️ **Never emitted by a receipt.** Nothing in the `partKind` table maps to
   * it and receiving does not produce work in progress - `buildReceiptEntry`
   * can only ever debit raw materials or finished goods. The role exists
   * because the L1 month-end inventory entry moves all three inventory
   * accounts to the balance the subledger computes (04-books §2.1), and that
   * entry is the January 1 deliverable.
   */
  INVENTORY_WIP: 'inventory_wip',
  /**
   * Finished goods inventory (default `1330`). The other inventory account a
   * receipt can debit, when the part received is a finished good.
   *
   * ⚠️ Which of the two applies is NOT decided here. It is the movement's own
   * frozen `stock_movement_gl_account`, resolved from `partKind` by
   * `receiveStock` at write time and passed in as
   * `ReceiptEntryInput.inventoryAccountRole`. One receipt must not carry two
   * accounts.
   */
  INVENTORY_FINISHED_GOODS: 'inventory_finished_goods',
  /** Accounts payable (default `2000`). Credited for the vendor bill total. */
  ACCOUNTS_PAYABLE: 'accounts_payable',
  /**
   * Payroll clearing (default `2110`). Standard assembly labour absorbed into
   * inventory comes OUT of this pool in the L1 month-end entry - that handshake
   * is the reason the account exists (04-books §2.1).
   */
  PAYROLL_CLEARING: 'payroll_clearing',
  /**
   * Freight accrual (default `2150`). Holds the carrier's share until the
   * carrier bills.
   */
  FREIGHT_ACCRUAL: 'freight_accrual',
  /**
   * Goods received not invoiced (default `2160`). Credited on receipt at the
   * VENDOR unit price, debited again when the vendor's bill arrives. See
   * `buildReceiptEntry` for why the "vendor unit price" half is load-bearing.
   */
  GRNI: 'grni',
  /**
   * Duties accrual (default `2170`). Holds the customs broker's share.
   *
   * Only ever appears when there is a non-zero tariff portion. Build plan phase
   * 0.1 asks whether `tariffRate` is ever non-zero at all; if the answer is no,
   * the org simply leaves this role unmapped and no line will ever reference it
   * - which is exactly what `buildReceiptEntry` produces when the duty portion
   * is zero.
   */
  DUTIES_ACCRUAL: 'duties_accrual',
  /**
   * COGS - materials (default `5000`). The balancing figure of the L1 month-end
   * entry, and the account parts purchases must be coded to off the bank feed
   * for that entry to have anything to reclassify (04-books §2.1).
   */
  COGS_MATERIALS: 'cogs_materials',
  /**
   * COGS - applied overhead (default `5020`). Overhead absorbed into inventory
   * this period, credited by the L1 month-end entry.
   */
  APPLIED_OVERHEAD: 'applied_overhead',
  /**
   * Purchase price variance (default `5090`). Absorbs the difference between
   * what we accrued on receipt and what the vendor actually billed. Debit when
   * billed high, credit when billed low.
   */
  PPV: 'ppv',
} as const

export type AccountRole = (typeof ACCOUNT_ROLES)[keyof typeof ACCOUNT_ROLES]

export interface BuildEntryInput {
  postingType: PostingType
  periodKey: string
  /** `YYYY-MM-DD`. */
  txnDate: string
  lines: GlPostingLineInput[]
}

/** A line as the builders express it, before zero legs are dropped and ordered. */
interface DraftLine {
  accountRole: string
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
 * - a blank account role
 * - an entry with no lines, or with lines on only one side
 *
 * ⚠️ What this gate does NOT do is check that a role RESOLVES. That is a
 * database read against the org's own chart and it belongs to the resolver that
 * runs ahead of the claim, which fails closed on zero matches and - the one that
 * matters - on more than one. Keeping it out of here is what keeps this module
 * pure and exhaustively testable.
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
    if (!line.accountRole || line.accountRole.trim().length === 0) {
      throw new UnprocessableEntityError('A posting line must carry an account role', {
        postingType,
        periodKey,
      })
    }
    assertMinorUnits(line.amount, `Posting line amount for role ${line.accountRole}`)
    if (line.amount < 0) {
      throw new UnprocessableEntityError(
        `Posting line amount must be positive - direction carries the sign (role ${line.accountRole}, amount ${line.amount})`,
        { accountRole: line.accountRole, amount: String(line.amount) }
      )
    }
    if (line.amount === 0) {
      throw new UnprocessableEntityError(
        `Posting line amount must be non-zero (role ${line.accountRole})`,
        { accountRole: line.accountRole }
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
 * against a role the org has not mapped - duties accrual on an org that has
 * never paid a tariff - would fail the resolver, or force an account into the
 * chart and into every provider's chart, for no information at all.
 */
function materialize(
  drafts: DraftLine[],
  source: { sourceType: string; sourceId: string }
): GlPostingLineInput[] {
  return drafts
    .filter((draft) => draft.amount !== 0)
    .map((draft, index) => ({
      accountRole: draft.accountRole,
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
   * The inventory account this receipt debits, as a ROLE.
   *
   * Required, with no default, and deliberately so. It must be the movement's
   * OWN frozen `stock_movement_gl_account`, which `receiveStock` resolved from
   * the part's `partKind` at write time - raw materials for a component or a
   * subassembly, finished goods for a finished good. Re-deriving it here, or
   * defaulting it to raw materials, gives the same receipt two accounts that
   * can disagree: the ledger row would relieve finished goods and the posting
   * would debit raw materials, and nothing would ever reconcile them. The
   * movement is the source of truth; this parameter exists to carry it, not to
   * decide it.
   *
   * `ACCOUNT_ROLES.INVENTORY_WIP` is never a legal value here - see its own
   * doc. Only two of the three inventory roles are reachable from `partKind`.
   */
  inventoryAccountRole: string
  memo?: string
}

/**
 * The receipt entry (decision P7, build plan 7.5):
 *
 * ```
 * Dr <inventory role>       quantity x LANDED cost   (raw materials or finished goods - see input)
 *   Cr grni                  quantity x VENDOR unit price
 *   Cr freight_accrual       the freight portion      (omitted when zero)
 *   Cr duties_accrual        the tariff portion       (omitted when zero)
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
 * their OWN accruals when their own bills arrive, which is the whole point of
 * giving them separate roles.
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
      // The movement's own frozen role, never re-derived here - see the field doc.
      accountRole: input.inventoryAccountRole,
      direction: 'debit',
      amount: landedMinor,
      memo: input.memo ?? `Received ${quantity} at landed cost`,
    },
    { accountRole: ACCOUNT_ROLES.GRNI, direction: 'credit', amount: goodsMinor },
    { accountRole: ACCOUNT_ROLES.FREIGHT_ACCRUAL, direction: 'credit', amount: freightMinor },
    { accountRole: ACCOUNT_ROLES.DUTIES_ACCRUAL, direction: 'credit', amount: dutyMinor },
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
 * Dr grni                    the matched portion
 * Dr/Cr ppv                  the residual, if any
 *   Cr accounts_payable      the bill total
 * ```
 *
 * The residual is `billTotal - matched`. Billed HIGH (positive residual) is a
 * debit to PPV - an unfavourable variance, a cost we did not accrue. Billed LOW
 * is a credit. Exactly zero produces no PPV line at all, which is the ordinary
 * case and should stay visibly ordinary in the register.
 *
 * Note what is NOT here: freight and duty. They were accrued to their own roles
 * on receipt and are relieved by the carrier's and the broker's own bills, on
 * their own schedules. A vendor bill that also carried freight would be two
 * postings, not one line - see `buildReceiptEntry` for why the accruals are
 * kept apart.
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
      accountRole: ACCOUNT_ROLES.GRNI,
      direction: 'debit',
      amount: matchedMinor,
      memo: input.memo ?? 'Relieve goods received not invoiced',
    },
    {
      accountRole: ACCOUNT_ROLES.PPV,
      direction: residualMinor >= 0 ? 'debit' : 'credit',
      amount: Math.abs(residualMinor),
      memo: 'Purchase price variance',
    },
    {
      accountRole: ACCOUNT_ROLES.ACCOUNTS_PAYABLE,
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
