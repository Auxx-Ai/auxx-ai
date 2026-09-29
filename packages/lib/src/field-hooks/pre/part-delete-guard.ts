// packages/lib/src/field-hooks/pre/part-delete-guard.ts

import { parseRecordId } from '@auxx/types/resource'
import {
  describeSettledPeriods,
  settledPeriodsFor,
} from '../../accounting/ledger/periods/settled-periods'
import { BadRequestError } from '../../errors'
import type { EntityPreDeleteHandler } from '../types'
import { readMovementsByRelation } from './guarded-movements'

/**
 * Refuses a part delete while any of its stock movements sits in a settled period; open-period
 * movements are then deleted with the part by `deleteEntityInstances` (plans/mrp/20 S9).
 * Fires for every delete path, generic `record.delete`, bulk delete, Kopilot and the API.
 */
export const guardPartDelete: EntityPreDeleteHandler = async (event) => {
  const { organizationId, recordId } = event
  const { entityInstanceId: partInstanceId } = parseRecordId(recordId)

  const movements = await readMovementsByRelation(organizationId, 'partId', [partInstanceId])
  if (movements.length === 0) return

  const settled = await settledPeriodsFor(
    organizationId,
    movements.map((movement) => movement.accountingDate)
  )
  if (settled.size > 0) {
    throw new BadRequestError(describeRefusal(settled), {
      organizationId,
      partInstanceId,
      periods: [...settled.keys()],
    })
  }
}

/**
 * The refusal a user reads. Names the months and the counts, and points at
 * archive, which is what `deleteEntityInstance`'s own docblock recommends over
 * deletion anyway, and which loses nothing.
 */
function describeRefusal(settled: Map<string, number>): string {
  return (
    `This part has ${describeSettledPeriods(settled, 'stock movement')}. ` +
    'A posted period is corrected by reversing an entry, never by deleting its history. ' +
    'Archive the part instead.'
  )
}
