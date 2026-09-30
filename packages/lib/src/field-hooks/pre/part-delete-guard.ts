// packages/lib/src/field-hooks/pre/part-delete-guard.ts

import { database, schema } from '@auxx/database'
import { parseRecordId } from '@auxx/types/resource'
import { and, count, eq } from 'drizzle-orm'
import {
  describeSettledPeriods,
  settledPeriodsFor,
} from '../../accounting/ledger/periods/settled-periods'
import { BadRequestError } from '../../errors'
import type { EntityPreDeleteHandler } from '../types'
import { readMovementsByRelation } from './guarded-movements'

/**
 * Refuses a part delete while a build produces it (`Build.partId` has no cascade) or any of its
 * stock movements sits in a settled period; open-period movements are then deleted with the part
 * by `deleteEntityInstances` (plans/mrp/20 S9). Fires for every delete path.
 */
export const guardPartDelete: EntityPreDeleteHandler = async (event) => {
  const { organizationId, recordId } = event
  const { entityInstanceId: partInstanceId } = parseRecordId(recordId)

  const [builds] = await database
    .select({ n: count() })
    .from(schema.Build)
    .where(
      and(eq(schema.Build.organizationId, organizationId), eq(schema.Build.partId, partInstanceId))
    )
  if (builds && builds.n > 0) {
    throw new BadRequestError(
      `This part has ${builds.n} build${builds.n === 1 ? '' : 's'}. Archive the part instead.`,
      { organizationId, partInstanceId }
    )
  }

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
