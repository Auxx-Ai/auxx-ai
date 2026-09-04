// packages/lib/src/banking/import/coverage-effect.ts

/**
 * What a statement file would do to an account, computed BEFORE it runs
 * (plans/accounting/ui-plan.md §2.9, plans/bank-connection/05-file-import.md §§6-7).
 *
 * Two questions, and they are the two a person actually has at the confirm step:
 *
 * 1. **Does this close the hole?** A reconciliation must refuse to run across a
 *    gap (05 §7), so "this file covers 1 Jan to 9 Mar and closes the gap on
 *    ···5381" is the sentence that says whether the upload was the right one.
 * 2. **How much of it do I already have?** The overlap band is the NORMAL case:
 *    files cover up to the cutover, the API reaches 180 days back, and 01 §4.1
 *    deliberately overlaps them so there is no hole. Without this number the
 *    honest expectation ("62 rows, 14 of them already here") is unavailable and
 *    a person reads a duplicate count as a mistake.
 *
 * Read-only. Nothing here writes, so it is safe to call on every render of the
 * confirm step.
 */

import type { Database } from '@auxx/database'
import type { Result } from 'neverthrow'
import { NotFoundError } from '../../errors'
import { type CoverageGap, daysBetween } from '../client'
import { guard } from '../guard'
import { getBankAccount, readCoverage } from '../reads'
import {
  type BankTransactionRow,
  readTransactionsByAccount,
  requireBankTransactionImportContext,
} from './fields'
import { assignImportedExternalIds } from './match-key'
import type { BankImportOverlap, BankImportRow, CoverageEffect } from './types'

/**
 * How many days apart two sightings of one transaction may be and still be one
 * transaction.
 *
 * 🛑 The window exists because the two sources date the same event differently:
 * the feed carries `transacted_at` (when the economic event happened) and a
 * statement carries the day the bank posted it, and the two routinely differ by
 * a weekend. Three days is 05 §6's figure.
 *
 * ⚠️ Widening it is not free. The wider the window, the more likely two
 * genuinely different transactions of the same amount to the same payee - a
 * weekly standing order - are read as one.
 */
export const CROSS_SOURCE_MATCH_DAYS = 3

/**
 * What this file would do to this account.
 *
 * Throws `NotFoundError` when the account does not exist, rather than answering
 * an empty effect: "this file changes nothing" and "you picked an account that
 * is gone" must never render the same.
 */
export async function previewCoverageEffect(
  db: Database,
  params: {
    organizationId: string
    bankAccountId: string
    rows: readonly BankImportRow[]
    today?: string
  }
): Promise<Result<CoverageEffect, Error>> {
  const { organizationId, bankAccountId, rows } = params
  return guard(
    async () => {
      const account = await getBankAccount(db, { organizationId, bankAccountId })
      if (account.isErr()) throw account.error
      if (!account.value) {
        throw new NotFoundError(`Bank account ${bankAccountId} was not found`)
      }

      const coverage = await readCoverage(db, {
        organizationId,
        bankAccountId,
        today: params.today,
      })
      if (coverage.isErr()) throw coverage.error

      const dated = rows.filter((row) => !!row.postedAt)
      const dateKeys = dated.map((row) => row.postedAt as string).sort()
      const fileFrom = dateKeys[0] ?? null
      const fileTo = dateKeys[dateKeys.length - 1] ?? null
      const unusableRowCount = rows.length - dated.filter((row) => row.amountMinor != null).length

      const ctx = await requireBankTransactionImportContext(organizationId)
      const existing = await readTransactionsByAccount(db, organizationId, ctx, bankAccountId)

      return {
        bankAccountId,
        fileFrom,
        fileTo,
        rowCount: rows.length,
        unusableRowCount,
        coverage: coverage.value,
        gapsTouched: coverage.value.gaps.filter((gap) => overlaps(gap, fileFrom, fileTo)),
        gapsClosed: coverage.value.gaps.filter((gap) => covers(gap, fileFrom, fileTo)),
        newCoverageFrom: earliest(coverage.value.coverageFrom, fileFrom),
        overlap: computeOverlap(bankAccountId, rows, existing),
      } satisfies CoverageEffect
    },
    'Failed to preview the coverage effect of a bank import',
    { organizationId, bankAccountId }
  )
}

/**
 * Which of this file's rows we already hold, by which door.
 *
 * Pure, and exported so the two-door rule can be tested without a database.
 *
 * 🛑 **Only a CROSS-source `matchKey` collision is a duplicate** (05 §6). Two
 * rows on the same account, from the same source, with the same date, amount and
 * normalised payee are two real transactions that happen to look alike - two $50
 * fuel purchases - and linking them loses money. So the `matchKey` door
 * deliberately ignores every existing row whose `source` is the one we are
 * importing as.
 *
 * ⚠️ The `externalId` door is the opposite: it matches regardless of source,
 * because an id collision on one account IS the same transaction by definition,
 * and the importer's identity key will update rather than duplicate it.
 */
export function computeOverlap(
  bankAccountId: string,
  rows: readonly BankImportRow[],
  existing: readonly BankTransactionRow[],
  incomingSource = 'import'
): BankImportOverlap {
  const withIds = assignImportedExternalIds(bankAccountId, rows)

  const byExternalIdIndex = new Map(
    existing.filter((row) => !!row.externalId).map((row) => [row.externalId as string, row.id])
  )
  const crossSource = existing.filter((row) => row.source !== incomingSource)

  let byExternalId = 0
  let byMatchKey = 0
  // An existing row may only be claimed once, whichever door claims it. Without
  // this a standing order matches every sighting of itself, and a row already
  // claimed by its id would be counted a second time on its match key - which is
  // how the overlap count comes to exceed the row count.
  const claimed = new Set<string>()

  for (const row of withIds) {
    const knownId = row.externalId ? byExternalIdIndex.get(row.externalId) : undefined
    if (knownId) {
      claimed.add(knownId)
      byExternalId += 1
      continue
    }
    const candidate = crossSource.find(
      (other) =>
        !claimed.has(other.id) &&
        other.amountMinor === row.amountMinor &&
        !!row.matchKey &&
        other.matchKey === row.matchKey &&
        withinWindow(other.postedAt, row.postedAt)
    )
    if (candidate) {
      claimed.add(candidate.id)
      byMatchKey += 1
    }
  }

  // 🛑 An unusable row (no date, or no amount) is not something this file would
  // ADD - `previewCoverageEffect` reports it separately as `unusableRowCount`,
  // and the confirm step renders both. Counting it here made the two numbers
  // contradict each other on the same screen: "62 rows, 3 unusable, 62 added".
  // Clamped at zero because an unusable row carrying an external id can still be
  // claimed by the id door above.
  const unusable = rows.filter((row) => !row.postedAt || row.amountMinor == null).length
  const added = Math.max(0, rows.length - unusable - byExternalId - byMatchKey)
  return { byExternalId, byMatchKey, added }
}

/** Are two dates close enough to be one transaction seen twice? */
export function withinWindow(
  a: string | null,
  b: string | null,
  days = CROSS_SOURCE_MATCH_DAYS
): boolean {
  if (!a || !b) return false
  return Math.abs(daysBetween(a, b)) <= days
}

/** Does the file's range touch this gap at all? */
function overlaps(gap: CoverageGap, from: string | null, to: string | null): boolean {
  if (!from || !to) return false
  return daysBetween(from, gap.to) >= 0 && daysBetween(gap.from, to) >= 0
}

/** Does the file's range cover this gap end to end? */
function covers(gap: CoverageGap, from: string | null, to: string | null): boolean {
  if (!from || !to) return false
  return daysBetween(from, gap.from) >= 0 && daysBetween(gap.to, to) >= 0
}

/** The earlier of two date keys, ignoring nulls. */
export function earliest(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return daysBetween(a, b) < 0 ? b : a
}
