// packages/lib/src/money/quickbooks/account-types.ts

/**
 * How one of OUR accounts should be described to QuickBooks when auxx asks it
 * to create the counterpart - the OUTBOUND half of the type vocabulary.
 *
 * `suggest-account-identities.ts`'s `SUBTYPE_PROVIDER_ACCOUNT_TYPES` is the
 * inbound half, and the two are not mirror images: inbound asks "may this
 * provider account satisfy that subtype of ours", which is a permissive
 * many-to-one check, while this one has to pick exactly one pair to send. A
 * table that tried to do both would end up either refusing legal imports or
 * inventing a creation it could not justify.
 *
 * ## Why both columns are always sent
 *
 * QuickBooks accepts an `AccountType` on its own - and then invents an
 * `AccountSubType` of its own choosing. Probed against realm 9341453857213446
 * on 2026-09-10: an account created as `Other Current Asset` with no subtype
 * came back filed under **`EmployeeCashAdvances`**. The subtype is what QBO's
 * own reports group by, so a clearing account left to Intuit's default lands in
 * a section nobody chose and reads as an employee advance on their books. Every
 * row below therefore names both, and `quickbooksAccountType` never returns a
 * pair with the subtype missing.
 *
 * ## Where the strings come from
 *
 * Read off a real company's chart rather than transcribed from documentation -
 * the exact spellings Intuit round-trips (`OtherCurrentAssets` with the plural,
 * `SuppliesMaterialsCogs` with the suffix) are what a create must send, and a
 * near-miss is a fault rather than a silent default. Two values below are the
 * exception and are marked: they are standard Intuit members that the sandbox
 * company happens to hold no example of.
 */

import type { GlAccountSubtypeValue } from '../../postings/account-subtype'
import type { GlAccountTypeValue } from '../../postings/default-chart'

/** One QuickBooks type pair, both halves always present. */
export interface QuickbooksAccountType {
  /** `Account.AccountType` - 'Other Current Asset', 'Bank', 'Income'. */
  accountType: string
  /** `Account.AccountSubType` - 'OtherCurrentAssets', 'Checking'. */
  accountSubType: string
}

/**
 * The answer when the account's statement classification is all we know.
 *
 * 🛑 Each of these is the deliberately GENERIC member of its section, never the
 * most common one. `Expense`/`OtherMiscellaneousServiceCost` is Intuit's own
 * "Other Business Expenses"; `Income`/`SalesOfProductIncome` is the plain sales
 * line. The temptation is to pick something more specific because it is what a
 * chart usually holds - but a wrong specific subtype is invisible (the account
 * still posts, it just groups oddly on their reports), while a generic one is
 * merely unremarkable and can be corrected in QuickBooks in one click.
 *
 * ⚠️ `equity` is the one row with no example in the probed company, which held
 * only the two special equity accounts (`OpeningBalanceEquity`,
 * `RetainedEarnings`) - and defaulting to either of THOSE would be actively
 * wrong, because QuickBooks gives both of them meanings of its own. Intuit
 * rejects an unknown subtype with a fault naming the field, so a mistake here
 * surfaces as a refusal a person can read rather than as a misfiled account.
 */
const BY_CLASSIFICATION: Record<GlAccountTypeValue, QuickbooksAccountType> = {
  asset: { accountType: 'Other Current Asset', accountSubType: 'OtherCurrentAssets' },
  liability: { accountType: 'Other Current Liability', accountSubType: 'OtherCurrentLiabilities' },
  equity: { accountType: 'Equity', accountSubType: 'OwnersEquity' },
  revenue: { accountType: 'Income', accountSubType: 'SalesOfProductIncome' },
  expense: { accountType: 'Expense', accountSubType: 'OtherMiscellaneousServiceCost' },
}

/**
 * The answer when the account carries one of our eight subtypes, which is a
 * better one - our subtype is a statement about what the account IS, and it
 * lines up with a QuickBooks detail type almost exactly.
 *
 * `other` is absent deliberately: it means "no second fact", so it must fall
 * through to the classification rather than resolve to some generic pair of its
 * own. A subtype whose classification disagrees with the account's is refused
 * by {@link quickbooksAccountType} rather than silently preferred.
 *
 * ⚠️ `fixed_asset` is the second unobserved row - the probed company held only
 * `Vehicles` and `AccumulatedDepreciation`, both too specific to default to.
 */
const BY_SUBTYPE: Partial<Record<GlAccountSubtypeValue, QuickbooksAccountType>> = {
  bank: { accountType: 'Bank', accountSubType: 'Checking' },
  accounts_receivable: {
    accountType: 'Accounts Receivable',
    accountSubType: 'AccountsReceivable',
  },
  accounts_payable: { accountType: 'Accounts Payable', accountSubType: 'AccountsPayable' },
  credit_card: { accountType: 'Credit Card', accountSubType: 'CreditCard' },
  inventory: { accountType: 'Other Current Asset', accountSubType: 'Inventory' },
  fixed_asset: { accountType: 'Fixed Asset', accountSubType: 'OtherFixedAssets' },
  cost_of_goods_sold: {
    accountType: 'Cost of Goods Sold',
    accountSubType: 'SuppliesMaterialsCogs',
  },
}

/**
 * Which statement section each subtype's pair belongs to, so a subtype can
 * never drag an account into the wrong half of the balance sheet.
 *
 * 🛑 This guard is the reason the subtype is not simply trusted. Our `subtype`
 * and our `accountType` are two independently edited fields on one
 * `gl_account`, and nothing in the chart editor stops somebody saving a
 * `revenue` account carrying `subtype: bank`. Sending `Bank` for it would
 * create a real asset account in somebody's books that our ledger then posts
 * revenue into - an entry that balances and misstates the balance sheet, which
 * is exactly the failure class `suggest-account-identities.ts` refuses to make
 * in the other direction. When the two disagree the CLASSIFICATION wins: it is
 * the field every report already groups by.
 */
const SUBTYPE_CLASSIFICATION: Partial<Record<GlAccountSubtypeValue, GlAccountTypeValue>> = {
  bank: 'asset',
  accounts_receivable: 'asset',
  accounts_payable: 'liability',
  credit_card: 'liability',
  inventory: 'asset',
  fixed_asset: 'asset',
  cost_of_goods_sold: 'expense',
}

/**
 * The QuickBooks type pair to create one of our accounts as.
 *
 * Subtype first when it agrees with the classification, classification
 * otherwise. Never returns a partial pair - see the file header on why sending
 * a type without a subtype is worse than it looks.
 *
 * @param classification - the account's statement section, the field that wins
 * @param subtype - our second fact, or null
 */
export function quickbooksAccountType(
  classification: GlAccountTypeValue,
  subtype: GlAccountSubtypeValue | null
): QuickbooksAccountType {
  if (subtype && SUBTYPE_CLASSIFICATION[subtype] === classification) {
    const bySubtype = BY_SUBTYPE[subtype]
    if (bySubtype) return bySubtype
  }
  return BY_CLASSIFICATION[classification]
}
