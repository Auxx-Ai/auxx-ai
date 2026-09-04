// packages/lib/src/banking/rules/suggest.ts

/**
 * Suggest-from-history: the PRIMARY categorisation mechanism (bank plan 03
 * §4, HANDOFF slot 3C). Stripe FC has no merchant enrichment and no
 * categories, so "the last N lines matching this key were coded to X" is the
 * strongest signal available before a single `bank_rule` is ever written.
 *
 * Two producers, tried in this order:
 *
 * 1. **Transfer.** An opposite-sign, same-amount line on another account
 *    within {@link TRANSFER_MATCH_WINDOW_DAYS} is a structural signal a text
 *    match cannot fake, so it is checked first - miscoding a real transfer as
 *    an expense is worse than missing a category suggestion.
 * 2. **History.** The majority GL code among the last
 *    {@link HISTORY_SAMPLE_SIZE} `coded` or `matched` lines sharing this
 *    line's `matchKey` and account.
 */

import type { Database } from '@auxx/database'
import { err, ok, type Result } from 'neverthrow'
import { NotFoundError } from '../../errors'
import { HISTORY_SAMPLE_SIZE, MIN_HISTORY_MATCHES, type SuggestionResult } from './client'
import { findTransferCandidate, getTransactionMatchRow, listHistoryMatches } from './reads'

/**
 * A suggestion for one `bank_transaction`, or `null` when neither producer
 * has anything to say - most lines, most of the time, until a pattern
 * repeats.
 */
export async function suggestFromHistory(
  db: Database,
  params: { organizationId: string; transactionId: string }
): Promise<Result<SuggestionResult | null, Error>> {
  const { organizationId, transactionId } = params

  const rowResult = await getTransactionMatchRow(db, { organizationId, transactionId })
  if (rowResult.isErr()) return err(rowResult.error)
  const row = rowResult.value
  if (!row) return err(new NotFoundError('Bank transaction not found', { transactionId }))

  const transfer = await findTransferCandidate(db, {
    organizationId,
    excludeTransactionId: transactionId,
    excludeBankAccountId: row.bankAccountId,
    amountMinor: row.amountMinor,
    postedAt: row.postedAt,
  })
  if (transfer.isErr()) return err(transfer.error)
  if (transfer.value) {
    return ok({
      source: 'transfer',
      glAccountCode: null,
      recordId: transfer.value.bankAccountId,
      recordType: 'bank_account',
      reason: 'A matching opposite-sign line was found on another connected account within 3 days.',
      ruleId: null,
    })
  }

  if (!row.matchKey || !row.bankAccountId) return ok(null)

  const historyResult = await listHistoryMatches(db, {
    organizationId,
    bankAccountId: row.bankAccountId,
    matchKey: row.matchKey,
    excludeTransactionId: transactionId,
  })
  if (historyResult.isErr()) return err(historyResult.error)

  const majority = pickMajorityCode(historyResult.value.map((line) => line.glAccountCode))
  if (!majority || majority.count < MIN_HISTORY_MATCHES) return ok(null)

  return ok({
    source: 'history',
    glAccountCode: majority.code,
    recordId: null,
    recordType: null,
    reason: `The last ${majority.count} lines matching this key were coded to ${majority.code}.`,
    ruleId: null,
  })
}

/**
 * The most frequent non-null code, ties broken by whichever appears first
 * (the sample already arrives newest-first, so a tie favours the more recent
 * occurrence). `null` when nothing in the sample carries a code.
 */
function pickMajorityCode(codes: (string | null)[]): { code: string; count: number } | null {
  const counts = new Map<string, number>()
  for (const code of codes) {
    if (!code) continue
    counts.set(code, (counts.get(code) ?? 0) + 1)
  }
  let best: { code: string; count: number } | null = null
  for (const code of codes) {
    if (!code) continue
    const count = counts.get(code)!
    if (!best || count > best.count) best = { code, count }
  }
  return best
}

/** Exported for tests: the sample width `listHistoryMatches` is bounded to. */
export const HISTORY_WINDOW = HISTORY_SAMPLE_SIZE
