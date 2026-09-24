// packages/lib/src/accounting/opening/reads.ts

/**
 * Every READ behind the opening trial balance: the draft record, the whole
 * chart in statement order, and the two settings that decide what date the
 * entry carries. One assembled view, so the grid and its verdict never flicker.
 *
 * Reads only; no permission checks - the router asserts `ledgerView`.
 */

import type { Database } from '@auxx/database'
import type { Result } from 'neverthrow'
import { readOrganizationSettings } from '../../settings/read'
import type { JournalEntryLine, JournalEntryRecord } from '../journals/entries/client'
import { listJournalEntries } from '../journals/entries/reads'
import { cutoverDateFor } from '../ledger/builders/opening-balance'
import { hasStandingEntry } from '../ledger/periods/settled-periods'
import { getPosting } from '../ledger/reads/read-posting'
import { listChartAccounts } from '../ledger/roles/role-map'
import {
  OPENING_BASELINE_SETTING_KEYS,
  type OpeningPresence,
  summariseOpeningTrialBalance,
} from '../ledger/setup/setup-readiness'
import {
  OPENING_TRIAL_BALANCE_KIND,
  type OpeningTrialBalancePosting,
  type OpeningTrialBalanceRow,
  type OpeningTrialBalanceView,
  sortChartAccountsForStatement,
} from './client'
import { guard } from './guard'

/**
 * The one opening entry, whatever state it is in.
 *
 * The unposted record wins - after a reversal the repair is a new entry beside
 * the reversed one, and the screen opens what is still being edited. Unposted
 * means no stamped posting, read off the record's own pointer; the ledger holds
 * no drafts (91 D5). Otherwise the newest. `null` on an unprovisioned org.
 */
export async function findOpeningTrialBalanceEntry(
  db: Database,
  organizationId: string
): Promise<JournalEntryRecord | null> {
  const result = await listJournalEntries(db, organizationId, {
    kinds: [OPENING_TRIAL_BALANCE_KIND],
    limit: 50,
  })
  if (result.isErr()) throw result.error
  const entries = result.value
  return entries.find((entry) => entry.status === 'draft') ?? entries[0] ?? null
}

/** Whether the opening entry is posted, or else its draft's totals - what readiness asks. */
export async function readOpeningPresence(
  db: Database,
  organizationId: string
): Promise<OpeningPresence> {
  const entry = await findOpeningTrialBalanceEntry(db, organizationId)
  return {
    posted: entry?.status === 'posted',
    summary: summariseOpeningTrialBalance(entry?.lines ?? []),
  }
}

/**
 * Everything the opening trial balance screens render, in one read.
 *
 * Never refuses on a half-configured org: an unset cutoff, an unprovisioned
 * `journal_entry` def and an empty chart come back as nulls and empty arrays,
 * because the setup screens read this to finish the setup being complained about.
 */
export async function readOpeningTrialBalance(
  db: Database,
  organizationId: string
): Promise<Result<OpeningTrialBalanceView, Error>> {
  return guard(
    async () => {
      const K = OPENING_BASELINE_SETTING_KEYS

      const settings = await readOrganizationSettings(organizationId, [
        K.cutoffPeriod,
        K.bookTimeZone,
        K.setupState,
        'organization.currency',
      ] as const)

      const [entry, chart, frozen] = await Promise.all([
        findOpeningTrialBalanceEntry(db, organizationId),
        listChartAccounts(db, organizationId).then((result) =>
          result.isErr() ? [] : result.value
        ),
        hasStandingEntry(db, organizationId),
      ])

      // A settings form that clears a text input writes '' rather than
      // deleting the row, so both spellings of "nothing is set" collapse to null.
      const cutoffPeriod = settings[K.cutoffPeriod]?.trim() || null
      const bookTimeZone = settings[K.bookTimeZone]?.trim() || null
      const setupState = settings[K.setupState].trim() || 'draft'

      // A malformed cutoff is what the person is on this page to fix, so it must not throw.
      let cutoverDate: string | null = null
      if (cutoffPeriod) {
        try {
          cutoverDate = cutoverDateFor(cutoffPeriod)
        } catch {
          cutoverDate = null
        }
      }

      const byId = collectLinesById(entry?.lines ?? [])

      const rows: OpeningTrialBalanceRow[] = sortChartAccountsForStatement(chart).map((account) => {
        const stored = byId.get(account.id)
        return {
          accountId: account.id,
          accountCode: account.code,
          accountName: account.name,
          accountType: account.accountType,
          isActive: account.isActive,
          // A side with nothing on it is null, not 0 - the grid renders a blank cell.
          debitMinor: stored?.debitMinor || null,
          creditMinor: stored?.creditMinor || null,
        }
      })

      const summary = summariseOpeningTrialBalance(
        rows.flatMap((row) => [
          ...(row.debitMinor ? [{ direction: 'debit' as const, amountMinor: row.debitMinor }] : []),
          ...(row.creditMinor
            ? [{ direction: 'credit' as const, amountMinor: row.creditMinor }]
            : []),
        ])
      )

      return {
        cutoffPeriod,
        bookTimeZone,
        cutoverDate,
        setupState,
        finalized: setupState === 'finalized',
        frozen,
        currency: settings['organization.currency'].trim() || 'USD',
        entry,
        rows,
        summary,
        posting: await readPosting(db, organizationId, entry),
      }
    },
    'Failed to read the opening trial balance',
    { organizationId }
  )
}

/** Both sides of every stored line, summed per `gl_account` id. */
function collectLinesById(lines: readonly JournalEntryLine[]) {
  const byId = new Map<string, { debitMinor: number; creditMinor: number }>()
  for (const line of lines) {
    const row = byId.get(line.glAccountId) ?? { debitMinor: 0, creditMinor: 0 }
    if (line.direction === 'debit') row.debitMinor += line.amountMinor
    else row.creditMinor += line.amountMinor
    byId.set(line.glAccountId, row)
  }
  return byId
}

/** The posting the opening entry became; null when there is none or it has vanished. */
async function readPosting(
  db: Database,
  organizationId: string,
  entry: JournalEntryRecord | null
): Promise<OpeningTrialBalancePosting | null> {
  if (!entry?.glPostingId) return null
  const result = await getPosting(db, organizationId, entry.glPostingId)
  if (result.isErr()) return null
  const posting = result.value
  return {
    id: posting.id,
    // Non-null: the opening entry always posts, never drafts.
    docNumber: posting.docNumber ?? '',
    txnDate: posting.txnDate,
    status: posting.status,
    totalMinor: posting.totalMinor,
  }
}
