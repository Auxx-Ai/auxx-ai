// packages/lib/src/field-hooks/pre/build-delete-guard.ts

import { parseRecordId } from '@auxx/types/resource'
import { BadRequestError } from '../../errors'
import { describeSettledPeriods, settledPeriodsFor } from '../../postings/settled-periods'
import { unwrapRelationId } from '../../resources/events/captured-values'
import type { EntityPreDeleteEvent, EntityPreDeleteHandler } from '../types'
import { readMovementsByRelation } from './guarded-movements'

/**
 * Pre-delete guard for `builds` (plans/money/tasks/21-money-parent-delete-safety.md §3).
 * Fires inside `deleteEntity` for EVERY delete path, generic `record.delete`,
 * bulk delete, drawers, Kopilot and the API, because `builds` is
 * `isVisible: true` and therefore carries an ordinary records table with an
 * ordinary delete button that no money code has ever seen.
 *
 * Two refusals, both conditional on state the registry cannot see:
 *
 *   1. **REFUSE when this build IS a reversal.** `build_reversal_of` is a value
 *      on the dying row. Deleting the reversal leaves the original's negation
 *      explaining nothing. The registry's `restrict` covers only the other
 *      direction (below), because `onDelete` is declared on the has_many side.
 *   2. **REFUSE when any movement sits in a settled period.** `settledPeriodsFor`
 *      owns the three predicates.
 *
 * **What is NOT here, and why.**
 *
 *   - "This build HAS BEEN reversed" is `onDelete: 'restrict'` on
 *     `build_reversed_by`. The delete engine refuses it from the declaration,
 *     archived reversals included.
 *   - The `build_consume` / `build_produce` movements are `onDelete: 'cascade'`
 *     on `build_movements`. The engine collects them into the closure, runs this
 *     guard before writing anything, and publishes a lifecycle event per row, so
 *     `mfg-stock-movements-deleted` still recomputes `recalculatePartQoH` on
 *     every SURVIVING part the build touched.
 *
 * **The refusal points at `reverseBuild`, not at archive.** Unlike a part, a
 * build has a sanctioned correction path (`builds/reverse-build.ts`) that
 * already writes the negation with the type carried verbatim, so the message
 * names it.
 */
export const guardBuildDelete: EntityPreDeleteHandler = async (event) => {
  const { organizationId, recordId } = event
  const { entityInstanceId: buildInstanceId } = parseRecordId(recordId)

  // The cheap check first: it reads nothing.
  refuseIfReversal(event)

  const movements = await readMovementsByRelation(organizationId, 'stock_movement_build', [
    buildInstanceId,
  ])
  if (movements.length === 0) return

  const settled = await settledPeriodsFor(
    organizationId,
    movements.map((movement) => movement.accountingDate)
  )
  if (settled.size > 0) {
    throw new BadRequestError(
      `This build has ${describeSettledPeriods(settled, 'stock movement')}. ` +
        'A posted period is corrected by reversing an entry, never by deleting its history. ' +
        'Reverse the build instead.',
      { organizationId, buildInstanceId, periods: [...settled.keys()] }
    )
  }
}

/**
 * Refuse when this build reverses another.
 *
 * Read off the values `deleteEntity` has already captured; its own comment says
 * the capture exists so "pre-delete hooks can inspect the record's current
 * state", so re-reading it would be a query for data already in hand.
 *
 * Through `unwrapRelationId`, never `typeof === 'string'`. The capture chain hands a
 * RELATIONSHIP over as `['defId:instId']`, an array of one, so the string test this
 * originally used was always false and the refusal never fired in production, while its
 * unit test passed a bare string and stayed green. See the three-chain table on
 * `resources/events/captured-values.ts`.
 */
function refuseIfReversal(event: EntityPreDeleteEvent): void {
  const { organizationId, recordId } = event

  const reversalOf = unwrapRelationId(event.values.build_reversal_of)
  if (reversalOf) {
    throw new BadRequestError(
      'This build reverses another build. Deleting it would leave the original ' +
        'reversed by nothing. Archive it instead.',
      { organizationId, recordId }
    )
  }
}
