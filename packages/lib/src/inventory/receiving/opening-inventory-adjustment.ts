// packages/lib/src/inventory/receiving/opening-inventory-adjustment.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Result } from 'neverthrow'
import { DOC_NUMBER_PREFIX } from '../../accounting/ledger/builders/doc-number'
import { ACCOUNT_ROLES, buildEntry } from '../../accounting/ledger/builders/entry'
import { hashedPeriodKey } from '../../accounting/ledger/periods/period-key'
import { resolvePeriodLock } from '../../accounting/ledger/periods/period-lock'
import { postEntry } from '../../accounting/ledger/post/post-entry'
import { OPENING_INVENTORY_ADJUSTMENT_SOURCE } from '../../accounting/ledger/reads/opening-inventory'
import type { GlPostingLineInput, PostResult } from '../../accounting/ledger/types'
import { guard } from './guard'
import {
  type OpeningInventoryDifference,
  readOpeningInventoryDifference,
} from './opening-inventory-difference'

const logger = createScopedLogger('inventory:opening-adjustment')

/** The claim's occurrence: one opening adjustment per org and cutover. */
export function openingAdjustmentOccurrence(cutoverDate: string): string {
  return `inventory_adjustment:${cutoverDate}`
}

export interface OpeningInventoryAdjustmentOutcome {
  /** The difference as read before posting. */
  difference: OpeningInventoryDifference
  /** Null when there was nothing to post (the ledger already agrees with the parts). */
  post: PostResult | null
}

/**
 * Post the one entry that brings the ledger's opening inventory to the parts' value,
 * dated the day after the cutover, against `inventory_revaluation`
 * (plans/accounting/tasks/103 §5a). An `inventory_movement`, so it exports like one.
 *
 * Idempotent: the difference it reads already counts an adjustment posted before, so a
 * re-run finds zero and posts nothing; the claim on (org, cutover) settles a race.
 * No permission checks: the router asserts.
 */
export async function postOpeningInventoryAdjustment(
  db: Database,
  input: { organizationId: string; actorUserId: string }
): Promise<Result<OpeningInventoryAdjustmentOutcome, Error>> {
  const { organizationId, actorUserId } = input
  return guard(
    async () => {
      const read = await readOpeningInventoryDifference(db, { organizationId })
      if (read.isErr()) throw read.error
      const difference = read.value

      const legs = difference.rows.filter((row) => row.differenceMinor !== 0)
      if (legs.length === 0) return { difference, post: null }

      const memo = 'Opening inventory brought to the parts on hand at cutover'
      const lines: GlPostingLineInput[] = legs.map((row, index) => ({
        accountRole: row.roles[0]!,
        direction: row.differenceMinor > 0 ? ('debit' as const) : ('credit' as const),
        amount: Math.abs(row.differenceMinor),
        memo,
        sourceType: OPENING_INVENTORY_ADJUSTMENT_SOURCE,
        sourceId: organizationId,
        sortOrder: index,
      }))
      if (difference.differenceMinor !== 0) {
        lines.push({
          accountRole: ACCOUNT_ROLES.INVENTORY_REVALUATION,
          direction: difference.differenceMinor > 0 ? 'credit' : 'debit',
          amount: Math.abs(difference.differenceMinor),
          memo,
          sourceType: OPENING_INVENTORY_ADJUSTMENT_SOURCE,
          sourceId: organizationId,
          sortOrder: lines.length,
        })
      }

      const occurrence = openingAdjustmentOccurrence(difference.cutoverDate)
      const entry = buildEntry({
        postingType: 'inventory_movement',
        periodKey: hashedPeriodKey({
          prefix: DOC_NUMBER_PREFIX.inventory_movement,
          sourceId: `${organizationId}:${occurrence}`,
          label: 'opening inventory adjustment',
          idLabel: 'organization id',
        }),
        txnDate: dayAfter(difference.cutoverDate),
        lines,
      })

      const post = await postEntry(db, {
        organizationId,
        entry,
        actorUserId,
        memo,
        lock: await resolvePeriodLock(organizationId),
        sources: [
          {
            sourceKind: 'opening_balance',
            sourceId: organizationId,
            occurrence,
            linkRole: 'subject',
          },
        ],
      })

      logger.info('Posted the opening inventory adjustment', {
        organizationId,
        cutoverDate: difference.cutoverDate,
        differenceMinor: difference.differenceMinor,
        status: post.status,
      })
      return { difference, post }
    },
    'Failed to post the opening inventory adjustment',
    { organizationId }
  )
}

/** `YYYY-MM-DD` plus one calendar day. */
function dayAfter(date: string): string {
  const next = new Date(`${date}T00:00:00.000Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  return next.toISOString().slice(0, 10)
}
