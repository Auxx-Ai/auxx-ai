// packages/lib/src/inventory/movements/__tests__/write-movements-batch.test.ts
//
// The inputs `writeStockMovementsBatch` refuses. The hooks a `stock_movement` create runs are
// pinned in `resources/crud/__tests__/batch-create-audit.test.ts`; equivalence is the int suite's.

import { describe, expect, it } from 'vitest'
import { quietSession, seedSession } from '../../../resources/crud/write-origin'
import type { StockMovementInput, StockMovementsCtx } from '../types'
import { writeStockMovementsBatch } from '../write-movements-batch'

describe('writeStockMovementsBatch refuses what it does not replicate', () => {
  const input: StockMovementInput = {
    partInstanceId: 'part_1',
    type: 'build_consume',
    quantity: -2,
    unitCost: 100,
    costBasis: 'standard',
    occurredAt: new Date('2026-03-01T00:00:00.000Z'),
  }
  const ctx = (lane: StockMovementsCtx['lane']): StockMovementsCtx => ({
    db: {} as never,
    organizationId: 'org_1',
    userId: 'user_1',
    movementDefId: 'def_movement',
    partDefId: 'def_part',
    lane,
  })
  const quiet = { kind: 'quiet' as const, session: quietSession('test') }

  it.each([
    ['the plain lane', ctx({ kind: 'plain' }), input],
    ['a seed session', ctx({ kind: 'quiet', session: seedSession('test') }), input],
    ['a reversal', ctx(quiet), { ...input, links: { reversesMovementId: 'mv_1' } }],
    ['an exploded child', ctx(quiet), { ...input, links: { parentMovementId: 'mv_1' } }],
    ['adjustSubparts', ctx(quiet), { ...input, adjustSubparts: true as const }],
  ])('%s', async (_name, context, movement) => {
    const result = await writeStockMovementsBatch(context, [movement])
    expect(result.isErr()).toBe(true)
  })

  it('writes nothing for no inputs', async () => {
    const result = await writeStockMovementsBatch(ctx({ kind: 'plain' }), [])
    expect(result._unsafeUnwrap()).toEqual({ records: [], affectedPartIds: [] })
  })
})
