// packages/lib/src/postings/opening-trial-balance/client.ts
//
// Client-safe shapes and pure helpers for the opening trial balance. Types and
// total functions only; nothing here touches a database, a logger or a provider.
//
// NOTE: no 'use client' directive - server code imports this file too, and the
// directive would turn every export into a client-reference proxy there. See
// docs/lib-module-guide.md section 7.

import { compareAccountsByCodeThenName } from '../account-label'
import { GL_ACCOUNT_TYPES, type GlAccountTypeValue } from '../default-chart'
import type { JournalEntryLine, JournalEntryRecord } from '../journal-entries/client'
import type { ChartAccountRow, PostingStatus } from '../types'

/**
 * The setting key the opening trial balance's FREEZE is asserted against.
 *
 * 🛑 There is no such setting. It is a key SHAPE, handed to
 * `assertAccountingSetupUnfrozen`, whose `isFrozenSetupSettingKey` matches on
 * the `accounting.opening` prefix. The trial balance lives on a `journal_entry`
 * record rather than in the catalog (HANDOFF decision 6.7), but it is exactly
 * as frozen as the three `accounting.opening*` scalars it sits beside: both are
 * the baseline every posted entry was computed from, and the server guard that
 * protects one has to protect the other or the freeze has a door in it.
 *
 * Naming it here rather than inlining the string keeps the two facts - that it
 * is not a real key, and that the prefix is load-bearing - in one place.
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
  /**
   * Set when this account carries one of the three inventory roles, naming the
   * role.
   *
   * ⚠️ A locked row is NOT read-only because it is unimportant - it is
   * read-only because its value already has an authority: the
   * `accounting.opening*` settings, which the previous wizard page writes and
   * which `readOpeningBaseline` reads as the first close's baseline. Two doors
   * onto one number is how the ledger and the subledger start disagreeing.
   */
  lockedByRole?: string
  /**
   * EVERY inventory role that lands on this account, in `INVENTORY_ROLES`
   * order. Present whenever {@link lockedByRole} is.
   *
   * 🛑 More than one role on one account is the COMMON case, not the exotic
   * one: QuickBooks ships a single `Inventory Asset`, so every chart imported
   * from it has all three roles pointing at the same account. The row's amount
   * is then the SUM of the three settings, and a reader that took one role's
   * figure would leave the trial balance short by the other two - which it did,
   * found by driving on 2026-09-10 (brief 19's DRIVEN block). `lockedByRole`
   * survives as the representative role for the lock badge and the divergence
   * label; anything computing an AMOUNT must read this instead.
   */
  lockedRoles?: readonly string[]
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

/** One locked row whose stored draft amount disagrees with its setting. */
export interface LockedRowDivergence {
  accountId: string
  /** A label only (task 15 §5) - may be null. `accountId` is what is keyed on. */
  accountCode: string | null
  accountName: string
  role: string
  /** What the `accounting.opening*` setting says, in integer minor units. */
  settingMinor: number
  /** What the stored draft's lines net to for this account, debit-positive. */
  storedMinor: number
}

/**
 * Every locked inventory row whose STORED draft amount disagrees with the
 * setting that owns it.
 *
 * PURE. `rows` come from `readOpeningTrialBalance`, which deliberately OVERRIDES
 * a locked row's amount from the `accounting.opening*` settings rather than
 * reading it out of the draft. `lines` are the draft as stored, which is what
 * the builder actually posts. So the screen can show one number while the post
 * writes another, and the two only ever diverge if something wrote around the
 * grid's lock.
 *
 * 🛑 **Divergence is a REFUSAL rather than a silent correction**, and the choice
 * matters. Building from the read's rows instead would post whatever the
 * settings say and quietly discard the number a person had stored - a general
 * ledger amount changed without anybody being told. Refusing costs one manual
 * fix in a case the UI already makes unreachable, and it names the account. The
 * settings are also what `readOpeningBaseline` hands the first close, so a
 * divergence means the ledger and the subledger are about to disagree; that is
 * exactly the thing to stop rather than to paper over.
 *
 * Debits are positive and credits negative, so an inventory row stored as a
 * credit reads as a disagreement rather than as a match on magnitude. A missing
 * setting and a missing line are both `0`, so the ordinary "this org holds no
 * WIP" case is silent.
 */
export function findLockedRowDivergences(
  rows: readonly OpeningTrialBalanceRow[],
  lines: readonly JournalEntryLine[]
): LockedRowDivergence[] {
  const storedById = new Map<string, number>()
  for (const line of lines) {
    const signed = line.direction === 'debit' ? line.amountMinor : -line.amountMinor
    storedById.set(line.glAccountId, (storedById.get(line.glAccountId) ?? 0) + signed)
  }

  const divergences: LockedRowDivergence[] = []
  for (const row of rows) {
    if (!row.lockedByRole) continue
    const settingMinor = (row.debitMinor ?? 0) - (row.creditMinor ?? 0)
    const storedMinor = storedById.get(row.accountId) ?? 0
    if (settingMinor === storedMinor) continue
    divergences.push({
      accountId: row.accountId,
      accountCode: row.accountCode,
      accountName: row.accountName,
      role: row.lockedByRole,
      settingMinor,
      storedMinor,
    })
  }
  return divergences
}
