// packages/lib/src/postings/opening-trial-balance/reads.ts

/**
 * Every READ behind the opening trial balance: the draft record, the whole
 * chart in statement order, and the two settings that decide what date the
 * entry carries.
 *
 * Reads only. The writes live in `writes.ts`, because a file that both queries
 * and mutates is the first step back toward a service class
 * (`docs/lib-module-guide.md` §5).
 *
 * No permission checks anywhere in this file. The router asserts `ledgerView`
 * (`docs/lib-module-guide.md` §6).
 *
 * ## One read, not five
 *
 * The wizard page and the settings twin both render a grid over the WHOLE
 * chart, prefilled from a draft, with three rows locked to the inventory
 * settings and a verdict under it. Every one of those needs a different table,
 * and a screen that fetched them separately would render a chart with no
 * amounts, then a verdict that flickers. So this returns the assembled view.
 */

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { getOrganizationSetting } from '../../settings/settings-service'
import { ACCOUNT_ROLES } from '../build-entry'
import { cutoverDateFor } from '../build-opening-balance-entry'
import type { JournalEntryLine, JournalEntryRecord } from '../journal-entries/client'
import { listJournalEntries } from '../journal-entries/reads'
import { getPosting } from '../read-posting'
import { INVENTORY_ROLES } from '../regime'
import { loadRoleAccountCodes } from '../resolve-roles'
import { listChartAccounts } from '../role-map'
import { OPENING_BASELINE_SETTING_KEYS, summariseOpeningTrialBalance } from '../setup-readiness'
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
 * A draft wins over a posted one, and that is the only ordering rule worth
 * having: after a reversal the ordinary repair is to raise a new draft beside
 * the reversed record, and the screen has to open the thing that is still being
 * edited. `listJournalEntries` orders newest first, so the fallback is the most
 * recent posted or reversed entry.
 *
 * Returns `null` on an org that has not run entity migration 125, rather than
 * throwing - the wizard renders an empty grid there instead of a 500, and the
 * WRITE path is where the refusal belongs.
 */
export async function findOpeningTrialBalanceEntry(
  db: Database,
  organizationId: string
): Promise<JournalEntryRecord | null> {
  const result = await listJournalEntries(db, organizationId, {
    kind: OPENING_TRIAL_BALANCE_KIND,
    limit: 50,
  })
  if (result.isErr()) throw result.error
  const entries = result.value
  return entries.find((entry) => entry.status === 'draft') ?? entries[0] ?? null
}

/**
 * Everything the opening trial balance screens render, in one read.
 *
 * @returns the assembled {@link OpeningTrialBalanceView}. Never refuses on a
 *   half-configured org: an unset cutoff, an unprovisioned `journal_entry` def
 *   and an empty chart all come back as nulls and empty arrays, because this is
 *   the read the SETUP screens use and refusing would leave somebody with no
 *   way to finish the setup being complained about.
 */
export async function readOpeningTrialBalance(
  db: Database,
  organizationId: string
): Promise<Result<OpeningTrialBalanceView, Error>> {
  return guard(
    async () => {
      const K = OPENING_BASELINE_SETTING_KEYS

      const [cutoffRaw, zoneRaw, stateRaw, currencyRaw, rawMaterials, wip, finishedGoods] =
        await Promise.all([
          getOrganizationSetting({ organizationId, key: K.cutoffPeriod }),
          getOrganizationSetting({ organizationId, key: K.bookTimeZone }),
          getOrganizationSetting({ organizationId, key: K.setupState }),
          getOrganizationSetting({ organizationId, key: 'organization.currency' }),
          getOrganizationSetting({ organizationId, key: K.inventory_raw_materials }),
          getOrganizationSetting({ organizationId, key: K.inventory_wip }),
          getOrganizationSetting({ organizationId, key: K.inventory_finished_goods }),
        ])

      const [entry, chart, inventoryAccounts, frozen] = await Promise.all([
        findOpeningTrialBalanceEntry(db, organizationId),
        listChartAccounts(db, organizationId).then((result) =>
          result.isErr() ? [] : result.value
        ),
        loadRoleAccountCodes(db, organizationId, [...INVENTORY_ROLES]),
        hasStandingPosting(db, organizationId),
      ])

      const cutoffPeriod = text(cutoffRaw)
      const bookTimeZone = text(zoneRaw)
      const setupState = text(stateRaw) ?? 'draft'

      // A malformed cutoff must not take the screen down: it is exactly what
      // the person is on this page to fix, and `cutoverDateFor` throwing here
      // would replace the form with an error.
      let cutoverDate: string | null = null
      if (cutoffPeriod) {
        try {
          cutoverDate = cutoverDateFor(cutoffPeriod)
        } catch {
          cutoverDate = null
        }
      }

      // role -> the code THIS org gave the account, and the settings value that
      // owns that row. `G8` read backwards: the number differs per org, so the
      // lock has to be resolved rather than hardcoded to 1310/1320/1330.
      const inventoryByCode = new Map<string, { role: string; minor: number | null }>()
      // Keyed off `ACCOUNT_ROLES`, never off `INVENTORY_ROLES`'s ordering: the
      // three settings and the three roles are paired by NAME in
      // `OPENING_BASELINE_SETTING_KEYS`, and pairing them by array index would
      // silently swap WIP and finished goods the day that list is reordered.
      const settingsByRole: Record<string, number | null> = {
        [ACCOUNT_ROLES.INVENTORY_RAW_MATERIALS]: minor(rawMaterials),
        [ACCOUNT_ROLES.INVENTORY_WIP]: minor(wip),
        [ACCOUNT_ROLES.INVENTORY_FINISHED_GOODS]: minor(finishedGoods),
      }
      for (const [role, account] of inventoryAccounts) {
        inventoryByCode.set(account.code, { role, minor: settingsByRole[role] ?? null })
      }

      const byCode = collectLinesByCode(entry?.lines ?? [])

      const rows: OpeningTrialBalanceRow[] = sortChartAccountsForStatement(chart).map((account) => {
        const locked = inventoryByCode.get(account.code)
        const stored = byCode.get(account.code)
        // 🛑 A locked row reads its amount from the SETTINGS, never from the
        // stored draft, even when the draft holds a different number. The
        // settings are what `readOpeningBaseline` hands the first close, so a
        // draft that disagreed would post a ledger the close then contradicts.
        // The lock in the UI is what stops them ever diverging; this is what
        // happens if one already has.
        const debitMinor = locked ? (locked.minor ?? null) : (stored?.debitMinor ?? null)
        const creditMinor = locked ? null : (stored?.creditMinor ?? null)
        return {
          accountId: account.id,
          accountCode: account.code,
          accountName: account.name,
          accountType: account.accountType,
          isActive: account.isActive,
          ...(locked ? { lockedByRole: locked.role } : {}),
          debitMinor,
          creditMinor,
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
        currency: text(currencyRaw) ?? 'USD',
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

/** Both sides of every stored line, summed per account code. */
function collectLinesByCode(lines: readonly JournalEntryLine[]) {
  const byCode = new Map<string, { debitMinor: number; creditMinor: number }>()
  for (const line of lines) {
    const row = byCode.get(line.accountCode) ?? { debitMinor: 0, creditMinor: 0 }
    if (line.direction === 'debit') row.debitMinor += line.amountMinor
    else row.creditMinor += line.amountMinor
    byCode.set(line.accountCode, row)
  }
  return byCode
}

/**
 * The posting the opening entry became, for the "reverse it from the ledger"
 * link on the settings twin.
 *
 * Null when there is no entry, no posting id, or the posting has vanished. A
 * missing posting is not an error here: the screen simply loses a link.
 */
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
    docNumber: posting.docNumber,
    txnDate: posting.txnDate,
    status: posting.status,
    totalMinor: posting.totalMinor,
  }
}

/**
 * Whether the ledger holds an entry that is standing in the books.
 *
 * The same predicate `assertAccountingSetupUnfrozen` enforces on a write -
 * `posted` or `pending` - so the screen's lock and the server's refusal can
 * never disagree. Read here rather than through `verifyBooksBalance` (which the
 * browser hook uses) because this read wants one boolean, not a sweep of every
 * line in the ledger.
 */
async function hasStandingPosting(db: Database, organizationId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.GlPosting.id })
    .from(schema.GlPosting)
    .where(
      and(
        eq(schema.GlPosting.organizationId, organizationId),
        inArray(schema.GlPosting.status, ['posted', 'pending'])
      )
    )
    .limit(1)
  return !!row
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * A `CURRENCY` setting as minor units.
 *
 * ⚠️ `null` and `0` are not interchangeable: an org with no work in process at
 * cutover has exactly zero, and one that never entered the figure has nothing.
 * A fractional value is read as null rather than rounded - `readOpeningBaseline`
 * refuses it on the same read, and quietly rounding here would post a ledger
 * that the first close then refuses to build against.
 */
function minor(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) return null
  return value
}
