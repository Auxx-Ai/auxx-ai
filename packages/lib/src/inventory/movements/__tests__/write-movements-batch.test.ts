// packages/lib/src/inventory/movements/__tests__/write-movements-batch.test.ts
//
// What `writeStockMovementsBatch` may skip, pinned: every hook a CRUD create runs for
// `stock_movement` today, and the inputs it refuses. A new hook fails here so the batch cannot
// silently bypass it (plans/mrp/10-batched-build-writes.md §2). Equivalence is the int suite's.

import { describe, expect, it } from 'vitest'
import { getEntityPreCreateHooks, hasFieldPreHooks } from '../../../field-hooks/registry'
import { quietSession, seedSession } from '../../../resources/crud/write-origin'
import { getCommonHooks, getSystemHooks } from '../../../resources/hooks'
import { STOCK_MOVEMENT_FIELDS } from '../../../resources/registry/resources/stock-movement-fields'
import { DISPLAY_FIELD_CONFIG, SYSTEM_ENTITIES } from '../../../seed/entity-seeder/constants'
import type { StockMovementInput, StockMovementsCtx } from '../types'
import { writeStockMovementsBatch } from '../write-movements-batch'

const SLUG = SYSTEM_ENTITIES.find((def) => def.entityType === 'stock_movement')?.apiSlug as string
const FIELDS = Object.values(STOCK_MOVEMENT_FIELDS)

describe('the hooks a stock_movement create runs', () => {
  it('has the slug the hook registries key on', () => {
    expect(SLUG).toBe('stock-movements')
  })

  // The batch runs these through `runSystemPreHooks` like the handler; a new one needs review.
  it('system pre-hooks: only the common created_by stamp', () => {
    expect(Object.keys(getSystemHooks('stock_movement'))).toEqual([])
    expect(Object.keys(getCommonHooks())).toEqual(['created_by_id'])
  })

  it('entity pre-create hooks: none', () => {
    expect(getEntityPreCreateHooks(SLUG)).toEqual([])
  })

  it('field pre-hooks: none on any stock_movement attribute', () => {
    const hooked = FIELDS.filter(
      (field) => field.systemAttribute && hasFieldPreHooks(SLUG, field.systemAttribute as never)
    ).map((field) => field.systemAttribute)
    expect(hooked).toEqual([])
  })

  // The batch refuses a unique field rather than checking it per row.
  it('unique fields: none', () => {
    expect(FIELDS.filter((field) => field.isUnique).map((field) => field.key)).toEqual([])
  })

  // Scalar display fields ride the instance insert; a relationship or NAME display would not.
  it('display fields: scalar, computed in memory', () => {
    const display = DISPLAY_FIELD_CONFIG.stock_movement
    expect(display).toEqual({ primaryDisplayField: 'type', secondaryDisplayField: 'quantity' })
    const types = [display?.primaryDisplayField, display?.secondaryDisplayField].map(
      (key) => FIELDS.find((field) => field.key === key)?.fieldType
    )
    expect(types).toEqual(['SINGLE_SELECT', 'NUMBER'])
  })
})

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
