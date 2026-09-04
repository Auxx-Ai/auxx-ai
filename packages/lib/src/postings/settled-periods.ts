// packages/lib/src/postings/settled-periods.ts

import { database, schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { ConflictError } from '../errors'
import { getOrganizationSetting } from '../settings/settings-service'
import { resolvePeriodLock } from './period-lock'
import { compareMonths, isPeriodLocked, periodKeyForDate } from './periods'
import { OPENING_BASELINE_SETTING_KEYS } from './setup-readiness'

/**
 * Which of these dates fall in a month the books are already closed to.
 *
 * **Extracted from `field-hooks/pre/part-delete-guard.ts`**
 * (plans/money/tasks/21-money-parent-delete-safety.md §2) because four delete
 * guards now need the same answer, and the reason each predicate is written the
 * way it is does not survive being copy-pasted.
 *
 * **Three predicates, and each one catches a case the others miss.** All three
 * are needed; this was established against the dev database, not by reasoning:
 *
 *   1. **The period lock.** `resolvePeriodLock` + `isPeriodLocked`. DemoOrg1 is
 *      locked through `2026-07`, so everything up to there is settled.
 *   2. **A posted entry stands for the month.** Read from `GlPosting` directly,
 *      NOT from `listClosePeriods`.
 *   3. **At or before `accounting.cutoffPeriod`.** Those months never appear in
 *      the close strip at all — `close-periods.ts` states that they "are covered
 *      by the frozen opening baseline and can never be closed here".
 *
 * 🛑 **Why predicate 2 does not use the close strip, which is the obvious move
 * and is wrong.** `listClosePeriods` answers *"can I close this month?"*, and
 * its `resolveState` reports the EFFECTIVE posting — the highest revision that
 * is not itself reversed. DemoOrg1's `2026-08` holds revision 0 `reversed`,
 * revision 1 **`posted`** at $1,320,563.80, and revision 2 `failed` on four
 * unmapped QuickBooks accounts. The effective row is revision 2, so the strip
 * correctly reports `2026-08` as **`open`** — there is an unfinished attempt in
 * it. But revision 1 is still standing in the books, and its
 * `assertions.before.balances` were computed from exactly the rows a guard is
 * deciding about. A guard keyed on the strip's state would have let every part
 * in the dev org delete its ledger out from under a filed entry.
 *
 * `status = 'posted'` is precisely "currently standing in the books": a reversal
 * flips the row it supersedes to `reversed`, so a reversed entry stops matching
 * on its own.
 *
 * An organization that has not finished accounting setup has no cutoff, gets no
 * posted rows and holds no lock, so it settles nothing. That is the correct
 * reading of "we have not started keeping books yet", and it keeps every guard
 * built on this out of the way of the orgs not using the accounting module.
 *
 * @returns the settled months among `dates`, each mapped to how many of the
 *   dates landed in it. Empty when nothing is settled.
 */
export async function settledPeriodsFor(
  organizationId: string,
  dates: readonly Date[]
): Promise<Map<string, number>> {
  const settled = new Map<string, number>()
  if (dates.length === 0) return settled

  const [cutoff, bookTimeZone, lock, postedPeriods] = await Promise.all([
    readSetting(organizationId, OPENING_BASELINE_SETTING_KEYS.cutoffPeriod),
    readSetting(organizationId, OPENING_BASELINE_SETTING_KEYS.bookTimeZone),
    // Fails CLOSED on a malformed lock, which is the behaviour a guard wants:
    // refusing one delete until a settings row is fixed is a five-second repair,
    // and the alternative reading lets history out from under a closed month.
    resolvePeriodLock(organizationId),
    readPostedPeriods(organizationId),
  ])

  for (const date of dates) {
    const periodKey = periodKeyForDate(date, 'month', bookTimeZone ?? 'UTC')
    const isSettled =
      isPeriodLocked(periodKey, lock) ||
      postedPeriods.has(periodKey) ||
      (cutoff !== null && compareMonths(periodKey, cutoff) <= 0)
    if (isSettled) settled.set(periodKey, (settled.get(periodKey) ?? 0) + 1)
  }
  return settled
}

/** Every month this organization has an entry currently standing in the books for. */
async function readPostedPeriods(organizationId: string): Promise<ReadonlySet<string>> {
  const rows = await database
    .selectDistinct({ periodKey: schema.GlPosting.periodKey })
    .from(schema.GlPosting)
    .where(
      and(
        eq(schema.GlPosting.organizationId, organizationId),
        eq(schema.GlPosting.status, 'posted')
      )
    )
  return new Set(rows.map((row) => row.periodKey))
}

/**
 * One organization setting as a trimmed string, or null.
 *
 * The key is typed off `getOrganizationSetting`'s own parameter rather than
 * widened to `string`, so a catalog key that is renamed or retired fails here at
 * compile time instead of silently reading as "unset" — which for the cutoff
 * would mean "this org keeps no books" and would quietly disarm every guard
 * built on this function.
 */
type SettingKey = Parameters<typeof getOrganizationSetting>[0]['key']

async function readSetting(organizationId: string, key: SettingKey): Promise<string | null> {
  const value = await getOrganizationSetting({ organizationId, key })
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/**
 * The shared half of a guard's refusal message: names the months and the counts.
 *
 * @param settled the map {@link settledPeriodsFor} returned
 * @param noun what the counted rows are, singular — pluralised with a bare `s`
 */
export function describeSettledPeriods(settled: Map<string, number>, noun: string): string {
  const total = [...settled.values()].reduce((sum, n) => sum + n, 0)
  const months = [...settled.keys()].sort().join(', ')
  const subject = total === 1 ? noun : `${noun}s`
  const verb = settled.size === 1 ? 'has' : 'have'
  return `${total} ${subject} in ${months}, which ${verb} been closed or posted`
}

/**
 * The setup keys that become read-only once the books hold an entry
 * (plans/accounting/HANDOFF.md slot 0D; plans/money/README.md rank 2b).
 *
 * Every `accounting.opening*` key, plus the two that define the period
 * keyspace. The three inventory openings are what every month-end entry
 * computes its delta FROM, so rewriting one after a close restates the
 * baseline under a filed entry with nothing to flag it. The zone and the
 * cutoff move every period boundary.
 *
 * 🛑 **The three `qboOpening*` keys are here BY NAME because the prefix does not
 * reach them**, and they are the other half of the same fact. `setup-readiness.ts`
 * and the reconciliation panel compare `accounting.opening<X>` against
 * `accounting.qboOpening<X>` PAIRWISE - the auxx subledger's opening figure
 * against what QuickBooks said on the same date - and a readiness check whose
 * two sides are not equally frozen is not a check: freeze one and leave the
 * other editable, and anybody can make a settled cutover reconcile by rewriting
 * the side nobody guards. Both halves freeze together or neither is worth
 * anything.
 */
export const FROZEN_SETUP_SETTING_KEYS = {
  prefix: 'accounting.opening',
  exact: [
    'accounting.bookTimeZone',
    'accounting.cutoffPeriod',
    'accounting.qboOpeningRawMaterials',
    'accounting.qboOpeningWip',
    'accounting.qboOpeningFinishedGoods',
  ],
} as const

/** Whether one setting key is frozen by a standing ledger entry. */
export function isFrozenSetupSettingKey(key: string): boolean {
  return (
    key.startsWith(FROZEN_SETUP_SETTING_KEYS.prefix) ||
    (FROZEN_SETUP_SETTING_KEYS.exact as readonly string[]).includes(key)
  )
}

/**
 * Refuse a write to any frozen setup key once the organization has an entry
 * standing in its books.
 *
 * "Standing" is `status IN ('posted', 'pending')`: a reversed original has
 * left the books, a failed claim never entered them, and a pending one is
 * mid-push and about to. A reversal row is itself `posted`, so a ledger whose
 * every original has been reversed is STILL frozen - deliberately. The pairs
 * net to zero, but each half was computed from the baseline these keys hold,
 * and a bookkeeper who wants the baseline back should see the entries that
 * used it in the register rather than have them silently disagree with a
 * rewritten setting.
 *
 * The server-side half of the freeze `useAccountingSettingsFreeze` shows in
 * the browser. A client-only freeze fails open: any caller of
 * `setting.batchUpdateOrganizationSettings` could rewrite the baseline under a
 * closed month.
 *
 * @throws {ConflictError} naming the offending keys and the reversal path.
 */
export async function assertAccountingSetupUnfrozen(
  organizationId: string,
  keys: readonly string[]
): Promise<void> {
  const frozen = keys.filter(isFrozenSetupSettingKey)
  if (frozen.length === 0) return

  const [standing] = await database
    .select({ id: schema.GlPosting.id })
    .from(schema.GlPosting)
    .where(
      and(
        eq(schema.GlPosting.organizationId, organizationId),
        inArray(schema.GlPosting.status, ['posted', 'pending'])
      )
    )
    .limit(1)
  if (!standing) return

  throw new ConflictError(
    `${frozen.join(', ')} cannot change once the ledger holds an entry. ` +
      'Every posted entry was computed from this baseline. To change it, reverse the standing ' +
      'entries from the ledger page first; the reversal keeps the audit trail and the setting ' +
      'can then be re-entered.',
    { keys: frozen.join(',') }
  )
}
