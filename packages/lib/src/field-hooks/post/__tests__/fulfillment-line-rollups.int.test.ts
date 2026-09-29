// packages/lib/src/field-hooks/post/__tests__/fulfillment-line-rollups.int.test.ts
// The relieved SUM over real `StockMovement` rows: `sale` only, so a `return_in` reversal never
// reads as un-relief (plans/money/tasks/50-batch-inventory-relief.md §1).
// Run: npx vitest run --config vitest.integration.config.ts src/field-hooks/post/__tests__/fulfillment-line-rollups.int.test.ts

import type { Database } from '@auxx/database'
import { getTestDb } from '@auxx/test-utils'
import { describe, expect, it } from 'vitest'
import {
  insertMovements,
  seedMovementOrg,
} from '../../../inventory/movements/__tests__/support/movement-table'
import { readRelievedQuantities } from '../fulfillment-line-rollups'

const db = () => getTestDb() as unknown as Database

describe('readRelievedQuantities', () => {
  it('sums sale rows per line, negated, and ignores a return_in reversal and other types', async () => {
    const { organizationId, ids } = await seedMovementOrg(3)
    const [part, lineA, lineB] = ids as [string, string, string]
    const [sale] = await insertMovements(organizationId, [
      { partId: part, type: 'sale', quantity: -5, fulfillmentLineId: lineA, costBasis: 'pending' },
      { partId: part, type: 'sale', quantity: 2, fulfillmentLineId: lineA, costBasis: 'pending' },
      { partId: part, type: 'adjust', quantity: -9, fulfillmentLineId: lineB },
    ])
    await insertMovements(organizationId, [
      {
        partId: part,
        type: 'return_in',
        quantity: 5,
        fulfillmentLineId: lineA,
        reversesMovementId: sale,
      },
    ])

    const relieved = await readRelievedQuantities(db(), organizationId, [lineA, lineB])
    expect(relieved.get(lineA)).toBe(3)
    expect(relieved.has(lineB)).toBe(false)
  })
})
