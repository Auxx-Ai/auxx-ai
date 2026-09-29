// packages/lib/src/field-hooks/pre/build-delete-guard.ts

import { parseRecordId } from '@auxx/types/resource'
import {
  describeSettledPeriods,
  settledPeriodsFor,
} from '../../accounting/ledger/periods/settled-periods'
import { BadRequestError } from '../../errors'
import { unwrapRelationId } from '../../resources/events/captured-values'
import type { EntityPreDeleteEvent, EntityPreDeleteHandler } from '../types'
import { readMovementsByRelation } from './guarded-movements'

/**
 * Refuses a build delete when the build is itself a reversal or any of its movements sits in a
 * settled period; open-period movements are then deleted with the build by
 * `deleteEntityInstances`, which re-derives QoH on the component parts (plans/mrp/20 S9).
 * "Has been reversed" is `onDelete: 'restrict'` on `build_reversed_by`, refused by the engine.
 */
export const guardBuildDelete: EntityPreDeleteHandler = async (event) => {
  const { organizationId, recordId } = event
  const { entityInstanceId: buildInstanceId } = parseRecordId(recordId)

  // The cheap check first: it reads nothing.
  refuseIfReversal(event)

  const movements = await readMovementsByRelation(organizationId, 'buildId', [buildInstanceId])
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
