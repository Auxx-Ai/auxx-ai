// packages/lib/src/inventory/receiving/opening-inventory-adjustment.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { minorToMajorString } from '@auxx/utils/currency'
import type { Result } from 'neverthrow'
import { DOC_NUMBER_PREFIX } from '../../accounting/ledger/builders/doc-number'
import { ACCOUNT_ROLES, buildEntry } from '../../accounting/ledger/builders/entry'
import { hashedPeriodKey } from '../../accounting/ledger/periods/period-key'
import { didLedgerAccept } from '../../accounting/ledger/post/ledger-accepted'
import { postEntry } from '../../accounting/ledger/post/post-entry'
import { OPENING_INVENTORY_ADJUSTMENT_SOURCE } from '../../accounting/ledger/reads/opening-inventory'
import type { GlPostingLineInput, PostResult } from '../../accounting/ledger/types'
import { UnprocessableEntityError } from '../../errors'
import { readOrganizationSettings } from '../../settings/read'
import { guard } from './guard'
import {
  type OpeningInventoryDifference,
  type OpeningInventoryInBooks,
  readOpeningInventoryDifference,
} from './opening-inventory-difference'

const logger = createScopedLogger('inventory:opening-adjustment')

/** The claim's occurrence: one per press, numbered after the entries already posted. */
export function openingAdjustmentOccurrence(cutoverDate: string, entryNumber: number): string {
  return `inventory_adjustment:${cutoverDate}:${entryNumber}`
}

/** Which account takes the other side of the difference (111 Q19). */
export const OPENING_INVENTORY_CREDIT_ROLE: Record<OpeningInventoryInBooks, string> = {
  revaluation: ACCOUNT_ROLES.INVENTORY_REVALUATION,
  opening_equity: ACCOUNT_ROLES.EQUITY_OPENING_BALANCE,
}

export type OpeningInventoryAdjustmentOutcome =
  | { outcome: 'nothing_to_post'; difference: OpeningInventoryDifference }
  | {
      outcome: 'posted'
      difference: OpeningInventoryDifference
      glPostingId: string
      post: PostResult
    }

/**
 * Post the delta since the last difference entry, dated the day after the cutover, against the
 * account `accounting.openingInventoryInBooks` names (111 Q19/Q23). Never automatic: every call
 * is a press. An `inventory_movement`, so it exports like one.
 *
 * @throws {UnprocessableEntityError} until the setting is answered, or when the ledger refuses.
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

      if (difference.needsAnswer || !difference.inBooks) {
        throw new UnprocessableEntityError(
          'Answer whether this inventory was on the old books first: set ' +
            'accounting.openingInventoryInBooks to revaluation (it was, at a different value) or ' +
            'opening_equity (it never was).',
          { organizationId, setting: 'accounting.openingInventoryInBooks' }
        )
      }

      const legs = difference.rows.filter((row) => row.differenceMinor !== 0)
      if (legs.length === 0) return { outcome: 'nothing_to_post', difference }

      const { 'organization.currency': currency } = await readOrganizationSettings(organizationId, [
        'organization.currency',
      ] as const)
      const entryNumber = difference.postedDifferenceCount + 1
      const booksMinor = difference.providerOpeningMinor + difference.postedDifferencesMinor
      const memo =
        `Opening inventory difference #${entryNumber}: parts at cutover ` +
        `${money(difference.partsValueAtCutoverMinor, currency)} vs books ${money(booksMinor, currency)}`

      const lines: GlPostingLineInput[] = legs.map((row, index) => ({
        accountRole: row.roles[0]!,
        direction: row.differenceMinor > 0 ? ('debit' as const) : ('credit' as const),
        amount: Math.abs(row.differenceMinor),
        memo,
        sourceType: OPENING_INVENTORY_ADJUSTMENT_SOURCE,
        sourceId: organizationId,
        sortOrder: index,
      }))
      if (difference.deltaMinor !== 0) {
        lines.push({
          accountRole: OPENING_INVENTORY_CREDIT_ROLE[difference.inBooks],
          direction: difference.deltaMinor > 0 ? 'credit' : 'debit',
          amount: Math.abs(difference.deltaMinor),
          memo,
          sourceType: OPENING_INVENTORY_ADJUSTMENT_SOURCE,
          sourceId: organizationId,
          sortOrder: lines.length,
        })
      }

      const occurrence = openingAdjustmentOccurrence(difference.cutoverDate, entryNumber)
      const entry = buildEntry({
        postingType: 'inventory_movement',
        periodKey: hashedPeriodKey({
          prefix: DOC_NUMBER_PREFIX.inventory_movement,
          sourceId: `${organizationId}:${occurrence}`,
          label: 'opening inventory difference',
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
        sources: [
          {
            sourceKind: 'opening_balance',
            sourceId: organizationId,
            occurrence,
            linkRole: 'subject',
          },
        ],
      })

      logger.info('Posted an opening inventory difference', {
        organizationId,
        cutoverDate: difference.cutoverDate,
        entryNumber,
        deltaMinor: difference.deltaMinor,
        inBooks: difference.inBooks,
        status: post.status,
      })
      if (!didLedgerAccept(post) || !post.glPostingId) {
        throw new UnprocessableEntityError(
          post.error ?? `The opening inventory difference came back ${post.status}.`,
          { organizationId, status: post.status }
        )
      }
      return { outcome: 'posted', difference, glPostingId: post.glPostingId, post }
    },
    'Failed to post the opening inventory difference',
    { organizationId }
  )
}

function money(minor: number, currency: unknown): string {
  const code = typeof currency === 'string' && currency ? currency : 'USD'
  return `${minor < 0 ? '-' : ''}${minorToMajorString(Math.abs(minor), code)} ${code}`
}

/** `YYYY-MM-DD` plus one calendar day. */
function dayAfter(date: string): string {
  const next = new Date(`${date}T00:00:00.000Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  return next.toISOString().slice(0, 10)
}
