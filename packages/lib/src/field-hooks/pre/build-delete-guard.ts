// packages/lib/src/field-hooks/pre/build-delete-guard.ts

import { parseRecordId, toRecordId } from '@auxx/types/resource'
import { BadRequestError } from '../../errors'
import { describeSettledPeriods, settledPeriodsFor } from '../../postings/settled-periods'
import { UnifiedCrudHandler } from '../../resources/crud'
import { unwrapRelationId } from '../../resources/events/captured-values'
import type { EntityPreDeleteEvent, EntityPreDeleteHandler } from '../types'
import { type GuardedMovement, readMovementsByRelation } from './guarded-movements'

/**
 * Pre-delete guard for `builds` (plans/money/tasks/21-money-parent-delete-safety.md §3).
 * Fires inside `deleteEntity` for EVERY delete path — generic `record.delete`,
 * bulk delete, drawers, Kopilot and the API — because `builds` is
 * `isVisible: true` and therefore carries an ordinary records table with an
 * ordinary delete button that no money code has ever seen.
 *
 * **What deleting a build costs today.** A completed build writes one
 * `build_consume` per component at the negated quantity and one `build_produce`
 * at `+quantityProduced` (`builds/complete-build.ts`). Deleting the build leaves
 * every one of them alive — `sweepEntityFieldValues` removes the link rather
 * than the row — so the ledger keeps the quantities and loses the only thing
 * that explains them. QoH still nets out, which is exactly why nothing looks
 * wrong.
 *
 * Two refusals and one cascade:
 *
 *   1. **REFUSE when any movement sits in a settled period.** `settledPeriodsFor`
 *      owns the three predicates.
 *   2. **REFUSE when the build is either end of a reversal pair.** Deleting one
 *      end leaves the other end's negation explaining nothing, and cascading
 *      both is a two-document decision a delete button should not be making.
 *   3. **CASCADE the movements** otherwise.
 *
 * ⚠️ **The refusal points at `reverseBuild`, not at archive.** Unlike a part, a
 * build has a sanctioned correction path (`builds/reverse-build.ts`) that
 * already writes the negation with the type carried verbatim, so the message
 * names it.
 *
 * ⚠️ **Nothing is suppressed on the cascade**, matching `guardPartDelete` and
 * differing from the invoice/order/vendor-bill guards. Those suppress because
 * their post-delete hook re-projects the document being deleted; here
 * `mfg-stock-movements-deleted` recomputes `recalculatePartQoH` on a SURVIVING
 * part — and it must fire once per row, because one build touches one component
 * movement per BOM line plus the produced part, all of them survivors.
 */
export const guardBuildDelete: EntityPreDeleteHandler = async (event) => {
  const { organizationId, userId, recordId } = event
  const { entityInstanceId: buildInstanceId } = parseRecordId(recordId)
  const handler = new UnifiedCrudHandler(organizationId, userId)

  // Refuse BEFORE any cascade, so a rejected delete mutates nothing.
  await refuseIfReversalPair(handler, event)

  const movements = await readMovementsByRelation(organizationId, 'stock_movement_build', [
    buildInstanceId,
  ])
  if (movements.length > 0) {
    const settled = await settledPeriodsFor(
      organizationId,
      movements.map((movement) => movement.accountingDate)
    )
    if (settled.size > 0) {
      throw new BadRequestError(
        `This build has ${describeSettledPeriods(settled, 'stock movement')}. ` +
          `A posted period is corrected by reversing an entry, never by deleting its history — ` +
          `reverse the build instead.`,
        { organizationId, buildInstanceId, periods: [...settled.keys()] }
      )
    }
  }

  await cascadeMovements(handler, movements)
}

/**
 * Refuse when this build reverses another, or has itself been reversed.
 *
 * The two directions are read differently on purpose. **"This build IS a
 * reversal"** is a value on the dying row, and `deleteEntity` has already
 * captured it — its own comment says the capture exists so "pre-delete hooks can
 * inspect the record's current state", so re-reading it would be a query for
 * data already in hand. **"This build HAS BEEN reversed"** lives on a different
 * row and has to be looked up.
 */
async function refuseIfReversalPair(
  handler: UnifiedCrudHandler,
  event: EntityPreDeleteEvent
): Promise<void> {
  const { organizationId, recordId } = event

  // 🛑 Through `unwrapRelationId`, never `typeof === 'string'`. The capture chain hands a
  // RELATIONSHIP over as `['defId:instId']` — an array of one — so the string test this
  // originally used was always false and the refusal never fired in production, while its
  // unit test passed a bare string and stayed green. See the three-chain table on
  // `resources/events/captured-values.ts`.
  const reversalOf = unwrapRelationId(event.values.build_reversal_of)
  if (reversalOf) {
    throw new BadRequestError(
      'This build reverses another build. Deleting it would leave the original ' +
        'reversed by nothing — archive it instead.',
      { organizationId, recordId }
    )
  }

  const { ids: reversedBy } = await handler.listFiltered({
    entityDefinitionId: 'build',
    filters: [
      {
        id: 'build-reversed-by',
        logicalOperator: 'AND',
        conditions: [
          {
            id: 'build-reversed-by-original',
            fieldId: 'build:reversalOf',
            operator: 'is',
            value: recordId,
          },
        ],
      },
    ],
    limit: 1000,
  })

  if (reversedBy.length > 0) {
    throw new BadRequestError(
      `This build has already been reversed by ${reversedBy.length} ` +
        `${reversedBy.length === 1 ? 'build' : 'builds'}. Deleting it would leave the ` +
        `reversal explaining nothing — archive it instead.`,
      { organizationId, recordId, reversedBy }
    )
  }
}

/**
 * The `build_consume` / `build_produce` pair, once every one of them is known to
 * sit in an open period.
 *
 * Deleted one at a time through the handler so `mfg-stock-movements-deleted`
 * fires per row and `recalculatePartQoH` runs for every part the build touched.
 *
 * ⚠️ Deliberately O(movements) round trips rather than one bulk statement: each
 * of those handlers re-SUMs whole, and a bulk delete that skipped them would
 * leave every component's on-hand quantity holding stock the ledger no longer
 * accounts for. A build with a long BOM is short in absolute terms.
 */
async function cascadeMovements(
  handler: UnifiedCrudHandler,
  movements: readonly GuardedMovement[]
): Promise<void> {
  for (const movement of movements) {
    await handler.delete(toRecordId('stock_movement', movement.id))
  }
}
