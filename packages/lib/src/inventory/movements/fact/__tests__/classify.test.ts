// packages/lib/src/inventory/movements/fact/__tests__/classify.test.ts

import { describe, expect, it } from 'vitest'
import { classifyMovement } from '../classify'
import { classifyFacts } from '../rebuild'

// plans/mrp/01-consumption-from-the-ledger.md §2, one assertion per row.
describe('classifyMovement', () => {
  it('sale and ship are consumption', () => {
    expect(classifyMovement('sale')).toBe('consumption')
    expect(classifyMovement('ship')).toBe('consumption')
  })

  it('build_consume is consumption', () => {
    expect(classifyMovement('build_consume')).toBe('consumption')
  })

  it('scrap is scrap, reported apart from consumption', () => {
    expect(classifyMovement('scrap')).toBe('scrap')
  })

  it('return_in without reverses_movement is salvage, so supply', () => {
    expect(classifyMovement('return_in', { isSalvage: true })).toBe('supply')
  })

  it('adjust is an adjustment, not usage', () => {
    expect(classifyMovement('adjust')).toBe('adjustment')
  })

  it('receive, build_produce, initial and return_out are supply; revalue moves nothing', () => {
    expect(classifyMovement('receive')).toBe('supply')
    expect(classifyMovement('build_produce')).toBe('supply')
    expect(classifyMovement('initial')).toBe('supply')
    expect(classifyMovement('return_out')).toBe('supply')
    expect(classifyMovement('revalue')).toBe('none')
  })

  it('a reversal takes its original class, whatever its own type', () => {
    expect(classifyMovement('return_in', { reversesClass: 'consumption' })).toBe('consumption')
    expect(classifyMovement('return_out', { reversesClass: 'supply' })).toBe('supply')
  })

  it('a child of an exploded adjustment is an adjustment, whatever its type', () => {
    expect(classifyMovement('sale', { parentMovementId: 'mv_parent' })).toBe('adjustment')
  })
})

describe('classifyFacts', () => {
  const row = (id: string, type: string, reversesMovementId?: string) => ({
    id,
    partId: 'part_1',
    type,
    quantity: 1,
    occurredAt: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    reversesMovementId: reversesMovementId ?? null,
  })

  it('classifies a reversal through its original, even listed before it', () => {
    const facts = classifyFacts([row('rev', 'return_in', 'sale_1'), row('sale_1', 'sale')])
    expect(facts.map((f) => f.consumptionClass)).toEqual(['consumption', 'consumption'])
  })

  it('walks a reversal of a reversal back to the first original', () => {
    const facts = classifyFacts([
      row('a', 'build_consume'),
      row('b', 'return_in', 'a'),
      row('c', 'return_out', 'b'),
    ])
    expect(facts.map((f) => f.consumptionClass)).toEqual([
      'consumption',
      'consumption',
      'consumption',
    ])
  })

  it('a reversal whose original is not in the ledger is an adjustment, not salvage', () => {
    const [fact] = classifyFacts([row('rev', 'return_in', 'gone')])
    expect(fact?.consumptionClass).toBe('adjustment')
  })
})
