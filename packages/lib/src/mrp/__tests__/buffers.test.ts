// packages/lib/src/mrp/__tests__/buffers.test.ts

import { describe, expect, it } from 'vitest'
import {
  computeDecoupledLeadTimes,
  computeZones,
  demandVariabilityLevel,
  effectiveBuffered,
  leadTimeClass,
  type ProposalPartInput,
  proposeBuffers,
  resolveLeadTimeFactor,
  resolveVariabilityFactor,
  supplyVariabilityLevel,
  topDownOrder,
} from '../run/buffers'
import type { SubpartRow } from '../types'

/** 02 §4.1: Motor 400lb, ADU 2, lead time 40, MOQ 50, LTF 0.25, VF 0.5. */
const MOTOR = {
  adu: 2,
  decoupledLeadTimeDays: 40,
  leadTimeFactor: 0.25,
  variabilityFactor: 0.5,
  minOrderQty: 50,
  orderCycleDays: null,
}

function tops(params: Parameters<typeof computeZones>[0]) {
  const z = computeZones(params)
  return [z.topOfRed, z.topOfYellow, z.topOfGreen]
}

describe('computeZones: the 02 §4.1 worked example and variation table', () => {
  it('defaults: 30 / 110 / 160', () => {
    const z = computeZones(MOTOR)
    expect(z.redBase).toBe(20)
    expect(z.redSafety).toBe(10)
    expect(tops(MOTOR)).toEqual([30, 110, 160])
  })

  it('vendor lead time 40 → 60: 45 / 165 / 215', () => {
    expect(tops({ ...MOTOR, decoupledLeadTimeDays: 60 })).toEqual([45, 165, 215])
  })

  it('build cycle 30 days: 30 / 110 / 170', () => {
    expect(tops({ ...MOTOR, orderCycleDays: 30 })).toEqual([30, 110, 170])
  })

  it('LTF 0.25 → 0.5: 60 / 140 / 190', () => {
    expect(tops({ ...MOTOR, leadTimeFactor: 0.5 })).toEqual([60, 140, 190])
  })

  it('VF 0.5 → 1.0: 40 / 120 / 170', () => {
    expect(tops({ ...MOTOR, variabilityFactor: 1 })).toEqual([40, 120, 170])
  })

  it('takes a seasonal lead-time usage for yellow', () => {
    expect(tops({ ...MOTOR, leadTimeUsage: 100 })).toEqual([30, 130, 180])
  })
})

describe('computeDecoupledLeadTimes', () => {
  const edges: SubpartRow[] = [
    { parentPartId: 'assy', childPartId: 'motor', quantity: 1 },
    { parentPartId: 'assy', childPartId: 'bracket', quantity: 2 },
  ]
  const leadTimeDays = new Map<string, number | null>([
    ['assy', 2],
    ['motor', 40],
    ['bracket', 7],
  ])

  it('adds the longest unbuffered path: 2 + 7 = 9 (02 §4.1)', () => {
    const dlt = computeDecoupledLeadTimes({
      partIds: ['assy', 'motor', 'bracket'],
      edges,
      leadTimeDays,
      buffered: new Map([
        ['motor', true],
        ['bracket', false],
      ]),
    })
    expect(dlt.get('assy')).toBe(9)
    expect(dlt.get('motor')).toBe(40)
    expect(dlt.get('bracket')).toBe(7)
  })

  it('drops to 2 once the bracket is buffered', () => {
    const dlt = computeDecoupledLeadTimes({
      partIds: ['assy'],
      edges,
      leadTimeDays,
      buffered: new Map([
        ['motor', true],
        ['bracket', true],
      ]),
    })
    expect(dlt.get('assy')).toBe(2)
  })

  it('is the cumulative path when nothing below is buffered', () => {
    const dlt = computeDecoupledLeadTimes({
      partIds: ['assy'],
      edges,
      leadTimeDays,
      buffered: new Map(),
    })
    expect(dlt.get('assy')).toBe(42)
  })

  it('is null for a part without a stated lead time', () => {
    const dlt = computeDecoupledLeadTimes({
      partIds: ['assy'],
      edges,
      leadTimeDays: new Map([['assy', null]]),
      buffered: new Map(),
    })
    expect(dlt.get('assy')).toBeNull()
  })
})

describe('factors', () => {
  it('classes lead times short < 10 ≤ medium < 30 ≤ long', () => {
    expect(leadTimeClass(7)).toBe('short')
    expect(leadTimeClass(10)).toBe('medium')
    expect(leadTimeClass(40)).toBe('long')
  })

  it('resolves LTF: override, then org default, then class (long → 0.25)', () => {
    expect(
      resolveLeadTimeFactor({ override: 0.4, orgDefault: 0.6, decoupledLeadTimeDays: 40 })
    ).toEqual({
      value: 0.4,
      source: 'override',
    })
    expect(
      resolveLeadTimeFactor({ override: null, orgDefault: 0.6, decoupledLeadTimeDays: 40 }).value
    ).toBe(0.6)
    expect(
      resolveLeadTimeFactor({ override: null, orgDefault: null, decoupledLeadTimeDays: 40 })
    ).toEqual({
      value: 0.25,
      source: 'default',
    })
  })

  it('classes demand by CV, medium under 30 days', () => {
    expect(demandVariabilityLevel(0.3, 90)).toBe('low')
    expect(demandVariabilityLevel(0.8, 90)).toBe('medium')
    expect(demandVariabilityLevel(1.5, 90)).toBe('high')
    expect(demandVariabilityLevel(0.3, 29)).toBe('medium')
  })

  it('classes supply by spread, on-time and fill, medium under 3 receipts', () => {
    const steady = {
      count: 5,
      medianLeadTimeDays: 10,
      p90LeadTimeDays: 11,
      onTimeRate: 1,
      avgFill: 1,
    }
    expect(supplyVariabilityLevel(steady)).toBe('low')
    expect(supplyVariabilityLevel({ ...steady, p90LeadTimeDays: 20 })).toBe('high')
    expect(supplyVariabilityLevel({ ...steady, onTimeRate: 0.8 })).toBe('medium')
    expect(supplyVariabilityLevel({ ...steady, count: 2 })).toBe('medium')
    expect(supplyVariabilityLevel(null)).toBe('medium')
  })

  it('snaps VF to the higher of demand and supply (D15)', () => {
    const base = { override: null, orgDefault: null, observedDays: 90, supplyStats: null }
    // Low demand, but a bought part with no receipts is medium on supply.
    expect(resolveVariabilityFactor({ ...base, cv: 0.2, supplyType: 'bought' })).toEqual({
      value: 0.5,
      source: 'default',
      level: 'medium',
    })
    expect(resolveVariabilityFactor({ ...base, cv: 0.2, supplyType: 'made' }).value).toBe(0.3)
    expect(resolveVariabilityFactor({ ...base, cv: 2, supplyType: 'made' }).value).toBe(0.8)
    expect(resolveVariabilityFactor({ ...base, override: 1, cv: 0.2, supplyType: 'made' })).toEqual(
      {
        value: 1,
        source: 'override',
        level: null,
      }
    )
  })
})

describe('proposeBuffers (02 §8)', () => {
  function part(partial: Partial<ProposalPartInput> & { partId: string }): ProposalPartInput {
    return {
      supplyType: 'made',
      kind: 'subassembly',
      bufferMode: null,
      adu: 1,
      leadTimeClass: 'short',
      sold: false,
      soldFromShelf: false,
      batchBuilt: false,
      ...partial,
    }
  }

  it('buffers consumed bought parts, tagging long leads', () => {
    const p = proposeBuffers(
      [part({ partId: 'motor', supplyType: 'bought', kind: 'component', leadTimeClass: 'long' })],
      []
    )
    expect(p.get('motor')).toEqual({
      partId: 'motor',
      proposedBuffered: true,
      buffered: true,
      reasons: ['bought_consumed', 'long_lead'],
    })
  })

  it('does not buffer anything with no usage', () => {
    const p = proposeBuffers([part({ partId: 'x', supplyType: 'bought', adu: 0 })], [])
    expect(p.get('x')?.proposedBuffered).toBe(false)
    expect(p.get('x')?.reasons).toEqual(['no_usage'])
  })

  it('buffers a finished good sold from the shelf, not an assemble-to-order one', () => {
    const p = proposeBuffers(
      [
        part({ partId: 'shelf', kind: 'finished_good', sold: true, soldFromShelf: true }),
        part({ partId: 'ato', kind: 'finished_good', sold: true }),
      ],
      []
    )
    expect(p.get('shelf')?.reasons).toEqual(['sold_from_shelf'])
    expect(p.get('ato')).toMatchObject({ proposedBuffered: false, reasons: ['assemble_to_order'] })
  })

  it('buffers a subassembly shared by two sold parents, or built in batches', () => {
    const edges: SubpartRow[] = [
      { parentPartId: 'liftA', childPartId: 'assy', quantity: 1 },
      { parentPartId: 'liftB', childPartId: 'assy', quantity: 1 },
      { parentPartId: 'liftA', childPartId: 'frame', quantity: 1 },
    ]
    const p = proposeBuffers(
      [
        part({ partId: 'liftA', kind: 'finished_good', sold: true }),
        part({ partId: 'liftB', kind: 'finished_good', sold: true }),
        part({ partId: 'assy' }),
        part({ partId: 'frame', batchBuilt: true }),
      ],
      edges
    )
    expect(p.get('assy')).toMatchObject({ proposedBuffered: true, reasons: ['shared_by_2'] })
    expect(p.get('frame')).toMatchObject({ proposedBuffered: true, reasons: ['batch_built'] })
  })

  it('lets the override win, and a buffered override counts for the children', () => {
    const edges: SubpartRow[] = [
      { parentPartId: 'a', childPartId: 'sub', quantity: 1 },
      { parentPartId: 'b', childPartId: 'sub', quantity: 1 },
    ]
    const p = proposeBuffers(
      [
        part({ partId: 'a', bufferMode: 'buffered' }),
        part({ partId: 'b', bufferMode: 'buffered' }),
        part({ partId: 'sub', bufferMode: 'not_buffered' }),
      ],
      edges
    )
    expect(p.get('a')).toMatchObject({ proposedBuffered: false, buffered: true })
    expect(p.get('sub')).toMatchObject({ proposedBuffered: true, buffered: false })
    expect(effectiveBuffered(null, true)).toBe(true)
  })

  it('orders parents before children and survives a cycle', () => {
    const order = topDownOrder(
      ['c', 'b', 'a'],
      [
        { parentPartId: 'a', childPartId: 'b', quantity: 1 },
        { parentPartId: 'b', childPartId: 'c', quantity: 1 },
      ]
    )
    expect(order).toEqual(['a', 'b', 'c'])
    const cyclic = topDownOrder(
      ['x', 'y'],
      [
        { parentPartId: 'x', childPartId: 'y', quantity: 1 },
        { parentPartId: 'y', childPartId: 'x', quantity: 1 },
      ]
    )
    expect(cyclic.sort()).toEqual(['x', 'y'])
  })
})
