// packages/lib/src/accounting/purchasing/landed-cost/clear.ts

/**
 * Clear a shipment's landed-cost under-run (74 D4).
 *
 * ```
 *   Dr freight_accrual   what the receipts accrued and no carrier billed
 *   Dr duties_accrual    what the receipts accrued and no broker billed
 *       Cr ppv             the under-run, as a variance of the period
 * ```
 *
 * ONE entry for both accruals, subject the goods bill, occurrence
 * `clear:<attempt>` - the write-off's shape, because a clear is repeatable
 * against the same record and `original` is not free. 🛑 No stock revaluation:
 * the gap between an estimate and a bill is a period variance and never a
 * restatement of what is on hand (73 D6).
 *
 * No permission checks. The router asserts (`docs/lib-module-guide.md` §6).
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Result } from 'neverthrow'
import { UnprocessableEntityError } from '../../../errors'
import { createGuard } from '../../../utils/guard'
import { ACCOUNT_ROLES, buildEntry, VENDOR_BILL_SOURCE_TYPE } from '../../ledger/builders/entry'
import { hashedPeriodKey } from '../../ledger/periods/period-key'
import { resolvePeriodLock } from '../../ledger/periods/period-lock'
import { discardDraftsForSource } from '../../ledger/post/draft-lines'
import { postEntry } from '../../ledger/post/post-entry'
import { reverseEntry } from '../../ledger/post/reverse-entry'
import { findLiveSubjectPosting } from '../../ledger/reads/list-postings'
import { isAccountingEnabled } from '../../ledger/setup/accounting-enabled'
import { todayInBookTimeZone } from '../../ledger/setup/book-time-zone'
import type { BuiltEntry, PostResult } from '../../ledger/types'
import { requireVendorBill } from '../expense-bill/reads'
import { countClearPostings, LANDED_COST_CLEAR_POSTING_TYPE } from './cleared'
import { readLandedCostByBill } from './reads'

const guard = createGuard('purchasing:landed-cost-clear')
const logger = createScopedLogger('purchasing:landed-cost-clear')

/** The claim occurrence for one clear attempt against a goods bill. */
export function clearOccurrence(attempt: number): string {
  return `clear:${attempt}`
}

/** The period key one attempt claims. Hashed: a cuid subject is over the cap. */
function clearPeriodKey(goodsBillInstanceId: string, attempt: number): string {
  return hashedPeriodKey({
    prefix: 'LCC',
    sourceId: `${goodsBillInstanceId}:${attempt}`,
    label: 'landed cost clear entry',
    idLabel: 'goods bill id',
  })
}

/** The entry itself. Pure - the amounts are the caller's read of the remaining. */
function buildClearEntry(input: {
  goodsBillInstanceId: string
  attempt: number
  freightMinor: number
  dutiesMinor: number
  txnDate: string
  label: string
}): BuiltEntry {
  const source = { sourceType: VENDOR_BILL_SOURCE_TYPE, sourceId: input.goodsBillInstanceId }
  const memo = `${input.label} - landed cost cleared`
  // A zero leg is dropped rather than posted: `buildEntry` refuses an amount of
  // nothing, and an org with no tariffs must never make the ledger resolve
  // `duties_accrual` to clear a freight under-run.
  const accruals = [
    { role: ACCOUNT_ROLES.FREIGHT_ACCRUAL, amount: input.freightMinor, what: 'freight' },
    { role: ACCOUNT_ROLES.DUTIES_ACCRUAL, amount: input.dutiesMinor, what: 'duty' },
  ].filter((accrual) => accrual.amount > 0)

  return buildEntry({
    postingType: LANDED_COST_CLEAR_POSTING_TYPE,
    periodKey: clearPeriodKey(input.goodsBillInstanceId, input.attempt),
    txnDate: input.txnDate,
    lines: [
      ...accruals.map((accrual, index) => ({
        ...source,
        accountRole: accrual.role,
        direction: 'debit' as const,
        amount: accrual.amount,
        memo: `${memo} - ${accrual.what}`,
        sortOrder: index,
      })),
      {
        ...source,
        accountRole: ACCOUNT_ROLES.PPV,
        direction: 'credit' as const,
        amount: input.freightMinor + input.dutiesMinor,
        memo,
        sortOrder: accruals.length,
      },
    ],
  })
}

export interface ClearLandedCostInput {
  organizationId: string
  /** The GOODS bill - the shipment whose accruals are being cleared. */
  goodsBillInstanceId: string
  actorUserId?: string
}

export interface ClearLandedCostResult {
  post: PostResult
  /** Integer minor units, what came off each accrual. */
  freightMinor: number
  dutiesMinor: number
}

/**
 * Post one clear for what this shipment still has accrued.
 *
 * Refuses when both accruals are already at zero: there is nothing to say, and
 * an entry of zero would still claim an attempt and a document number.
 */
export async function clearLandedCost(
  db: Database,
  input: ClearLandedCostInput
): Promise<Result<ClearLandedCostResult, Error>> {
  const { organizationId, goodsBillInstanceId, actorUserId } = input
  return guard(
    async () => {
      if (!(await isAccountingEnabled(db, organizationId))) {
        throw new UnprocessableEntityError(
          'Accounting is off for this organisation, so there is no accrual to clear.',
          { goodsBillInstanceId }
        )
      }

      const summary = await readLandedCostByBill(db, organizationId, goodsBillInstanceId)
      if (summary.isErr()) throw summary.error
      const freightMinor = summary.value.freight.remainingMinor
      const dutiesMinor = summary.value.duties.remainingMinor
      if (freightMinor === 0 && dutiesMinor === 0) {
        throw new UnprocessableEntityError(
          'This shipment has nothing left accrued for freight or duty, so there is nothing to ' +
            'clear. A carrier or broker bill arriving now posts to purchase price variance.',
          { goodsBillInstanceId }
        )
      }

      const bill = await requireVendorBill(db, organizationId, goodsBillInstanceId)
      const attempt = await countClearPostings(db, organizationId, goodsBillInstanceId)
      const txnDate = await todayInBookTimeZone(organizationId)
      const entry = buildClearEntry({
        goodsBillInstanceId,
        attempt,
        freightMinor,
        dutiesMinor,
        txnDate,
        label: `Bill ${bill.number || bill.internalNumber}`,
      })

      const lock = await resolvePeriodLock(organizationId)
      const post = await postEntry(db, {
        organizationId,
        entry,
        actorUserId,
        lock,
        memo: 'Landed cost cleared',
        // Inventory's lane has no draft step: a clear posts as Clear is pressed.
        mode: 'post',
        sources: [
          {
            sourceKind: VENDOR_BILL_SOURCE_TYPE,
            sourceId: goodsBillInstanceId,
            linkRole: 'subject',
            occurrence: clearOccurrence(attempt),
          },
        ],
      })

      logger.info('Cleared a landed-cost accrual', {
        organizationId,
        goodsBillInstanceId,
        attempt,
        status: post.status,
        freightMinor,
        dutiesMinor,
      })
      return { post, freightMinor, dutiesMinor }
    },
    'Failed to clear the landed cost for a shipment',
    { organizationId, goodsBillInstanceId }
  )
}

/**
 * Reverse one clear attempt's live posting, freeing its claim and putting the
 * accrual back. `null` when that attempt has nothing standing.
 */
export async function reverseLandedCostClear(
  db: Database,
  input: {
    organizationId: string
    goodsBillInstanceId: string
    attempt: number
    actorUserId?: string
  }
): Promise<PostResult | null> {
  const { organizationId, goodsBillInstanceId, attempt, actorUserId } = input
  const discarded = await discardDraftsForSource(db, {
    organizationId,
    sourceKind: VENDOR_BILL_SOURCE_TYPE,
    sourceId: goodsBillInstanceId,
    occurrence: clearOccurrence(attempt),
  })
  if (discarded.isErr()) throw new UnprocessableEntityError(discarded.error.message)
  const live = await findLiveSubjectPosting(db, {
    organizationId,
    sourceKind: VENDOR_BILL_SOURCE_TYPE,
    sourceId: goodsBillInstanceId,
    occurrence: clearOccurrence(attempt),
  })
  if (live.isErr()) throw new UnprocessableEntityError(live.error.message)
  if (!live.value) return null

  const lock = await resolvePeriodLock(organizationId)
  return reverseEntry(db, {
    organizationId,
    glPostingId: live.value.id,
    actorUserId,
    lock,
    memo: `Reversal of ${live.value.docNumber} - landed cost clear backed out`,
  })
}
