// packages/lib/src/accounting/opening/client.ts
//
// Client-safe shapes and pure helpers for the opening trial balance. Types and
// total functions only; nothing here touches a database, a logger or a provider.
//
// NOTE: no 'use client' directive - server code imports this file too, and the
// directive would turn every export into a client-reference proxy there. See
// docs/lib-module-guide.md section 7.

import type { JournalEntryLine, JournalEntryRecord } from '../journals/entries/client'
import { compareAccountsByCodeThenName } from '../ledger/chart/account-label'
import { GL_ACCOUNT_TYPES, type GlAccountTypeValue } from '../ledger/chart/default-chart'
import type { ChartAccountRow, PostingStatus } from '../ledger/types'

/**
 * The setting key the opening trial balance's FREEZE is asserted against.
 *
 * 🛑 There is no such setting. It is a key SHAPE, handed to
 * `assertAccountingSetupUnfrozen`, whose `isFrozenSetupSettingKey` matches on
 * the `accounting.opening` prefix. The trial balance lives on a `journal_entry`
 * record rather than in the catalog, and freezes with the rest of the setup once
 * the ledger holds an entry.
 */
export const OPENING_TRIAL_BALANCE_FREEZE_KEY = 'accounting.openingTrialBalance'

/** The kind of `journal_entry` record the trial balance is held on. */
export const OPENING_TRIAL_BALANCE_KIND = 'opening_balance' as const

/** One chart account, paired with what the draft says it opened at. */
export interface OpeningTrialBalanceRow {
  accountId: string
  /** A label only (task 15 §5). The row's identity is `accountId`. */
  accountCode: string | null
  accountName: string
  accountType: GlAccountTypeValue
  isActive: boolean
  /** Integer minor units, or null for a row with no opening balance. */
  debitMinor: number | null
  creditMinor: number | null
}

/** The posting the opening entry became, once it has one. */
export interface OpeningTrialBalancePosting {
  id: string
  docNumber: string
  txnDate: string
  status: PostingStatus
  totalMinor: number
}

/** Everything the wizard page and the settings twin render from one read. */
export interface OpeningTrialBalanceView {
  /** `accounting.cutoffPeriod`, `'2026-12'`. Null while setup has not reached it. */
  cutoffPeriod: string | null
  /** `accounting.bookTimeZone`. Null while unset - there is no UTC fallback. */
  bookTimeZone: string | null
  /** The last day of `cutoffPeriod`, which is what the entry is dated. */
  cutoverDate: string | null
  /** `accounting.setupState`. */
  setupState: string
  finalized: boolean
  /**
   * True once the ledger holds a standing entry, which is when the whole
   * opening baseline stops being editable. The browser half of the same fact is
   * `useAccountingSettingsFreeze`; this is the server's answer, and
   * `assertAccountingSetupUnfrozen` is what actually enforces it on a write.
   */
  frozen: boolean
  currency: string
  /** The draft, the posted entry, or null when nobody has started one. */
  entry: JournalEntryRecord | null
  /** Every account in the chart, in statement order, with its draft amounts. */
  rows: OpeningTrialBalanceRow[]
  /** Σ debits, Σ credits, the difference, and how many rows carry an amount. */
  summary: { debitMinor: number; creditMinor: number; rows: number; differenceMinor: number }
  posting: OpeningTrialBalancePosting | null
}

/** Statement order: assets, liabilities, equity, revenue, expense, then by code. */
const TYPE_ORDER = new Map<string, number>(GL_ACCOUNT_TYPES.map((type, index) => [type, index]))

/**
 * Sort a chart into the order a statement reads in.
 *
 * `GL_ACCOUNT_TYPES` is the authority on the sequence, not a second list here:
 * it is the same tuple the balance sheet and the trial balance group by, and a
 * private copy would put equity above liabilities on exactly one screen.
 *
 * Within a type: by code when both rows have one, a coded row before an
 * uncoded one, then by name (task 15 §5.2's default, so a partly-numbered
 * chart still reads as a statement). {@link compareAccountsByCodeThenName} is
 * the one place that tiebreak is written.
 */
export function sortChartAccountsForStatement(accounts: readonly ChartAccountRow[]) {
  return [...accounts].sort((a, b) => {
    const typeDelta = (TYPE_ORDER.get(a.accountType) ?? 99) - (TYPE_ORDER.get(b.accountType) ?? 99)
    return typeDelta !== 0 ? typeDelta : compareAccountsByCodeThenName(a, b)
  })
}

/**
 * Turn the grid's rows back into the draft's line shape.
 *
 * PURE, and shared by the wizard page and the settings twin so the two cannot
 * write different JSON for the same grid. A row with neither amount, or with a
 * zero in both columns, contributes nothing: an opening trial balance over the
 * whole chart is mostly zeroes, and persisting 30 zero rows would make the
 * stored draft a picture of the chart rather than a list of balances.
 *
 * 🛑 A row carrying BOTH a debit and a credit emits both lines rather than
 * netting them. Netting would be this function deciding an accounting question
 * on a bookkeeper's behalf; two lines let `buildManualEntry` surface it as the
 * same-account-both-sides warning, which is the answer the person can act on.
 */
export function rowsToJournalEntryLines(
  rows: readonly OpeningTrialBalanceRow[]
): JournalEntryLine[] {
  const lines: JournalEntryLine[] = []
  for (const row of rows) {
    if (row.debitMinor) {
      lines.push({ glAccountId: row.accountId, direction: 'debit', amountMinor: row.debitMinor })
    }
    if (row.creditMinor) {
      lines.push({
        glAccountId: row.accountId,
        direction: 'credit',
        amountMinor: row.creditMinor,
      })
    }
  }
  return lines
}

// ── plans/accounting/tasks/19: opening balances from the provider, pure half ──
// PURE. No database, no io - see opening-fill-plan.ts's own header.
export {
  type ProviderOpeningFillInput,
  type ProviderOpeningFillPlan,
  planProviderOpeningFill,
} from './opening-fill-plan'
