// apps/web/src/components/accounting/ui/ledger/outbox/set-costs-rows.test.ts
import { describe, expect, it } from 'vitest'
import {
  buildSetCostsRows,
  fillChannelCosts,
  parseUnitCost,
  type SetCostsRow,
  seedChannelCosts,
  toSetCostsItems,
} from './set-costs-rows'

const row = (partId: string, over: Partial<SetCostsRow> = {}): SetCostsRow => ({
  partId,
  name: partId,
  waiting: 1,
  waitingLabel: '1 shipment',
  channelCost: null,
  kind: null,
  ...over,
})

describe('set costs rows', () => {
  it('builds one row per part from the groups and the fields, counting what waits by kind', () => {
    const rows = buildSetCostsRows(
      [
        {
          externalRef: 'p1',
          refLabel: 'Bolt',
          count: 4,
          sourceKinds: ['build', 'fulfillment'],
          sourceKindCounts: { fulfillment: 3, build: 1 },
        },
        { externalRef: 'p2', refLabel: null, count: 1, sourceKinds: ['stock_movement'] },
        { externalRef: null, refLabel: null, count: 2, sourceKinds: ['fulfillment'] },
        { externalRef: 'p1', refLabel: 'Bolt', count: 4, sourceKinds: ['fulfillment'] },
        { externalRef: 'p3', refLabel: 'Nut', count: 5, sourceKinds: ['fulfillment', 'build'] },
      ],
      {
        p1: { part_channel_cost: 1250, part_kind: ['subassembly'] },
        p2: { part_channel_cost: null },
      }
    )
    expect(rows).toEqual([
      {
        partId: 'p1',
        name: 'Bolt',
        waiting: 4,
        waitingLabel: '3 shipments · 1 build',
        channelCost: 1250,
        kind: 'subassembly',
      },
      {
        partId: 'p2',
        name: 'p2',
        waiting: 1,
        waitingLabel: '1 count',
        channelCost: null,
        kind: null,
      },
      // Mixed kinds with no per-kind split from the read: one figure.
      {
        partId: 'p3',
        name: 'Nut',
        waiting: 5,
        waitingLabel: '5 items',
        channelCost: null,
        kind: null,
      },
    ])
  })

  it('parses a typed cost to minor units at rate precision', () => {
    expect(parseUnitCost('12.50')).toEqual({ ok: true, value: 1250 })
    expect(parseUnitCost(' $1,234.5 ')).toEqual({ ok: true, value: 123450 })
    expect(parseUnitCost('0')).toEqual({ ok: true, value: 0 })
    expect(parseUnitCost('.5')).toEqual({ ok: true, value: 50 })
    expect(parseUnitCost('0.01594')).toEqual({ ok: true, value: 1.594 })
    expect(parseUnitCost('')).toEqual({ ok: true, value: null })
    expect(parseUnitCost(undefined)).toEqual({ ok: true, value: null })
    expect(parseUnitCost('-3').ok).toBe(false)
    expect(parseUnitCost('abc').ok).toBe(false)
    expect(parseUnitCost('1.2.3').ok).toBe(false)
  })

  it('seeds untouched rows once, and fills blank ones on demand', () => {
    const rows = [row('p1', { channelCost: 1250 }), row('p2', { channelCost: 99 }), row('p3')]
    const seeded = seedChannelCosts(rows, { p2: { unitCost: '' } })
    expect(seeded).toEqual({ p1: { unitCost: '12.50' }, p2: { unitCost: '' } })
    expect(seedChannelCosts(rows, seeded)).toBe(seeded)

    const filled = fillChannelCosts(rows, { ...seeded, p1: { unitCost: '3' } })
    expect(filled).toEqual({ p1: { unitCost: '3' }, p2: { unitCost: '0.99' } })
  })

  it('sends rows with a cost or a changed kind, and flags the rest', () => {
    const rows = [
      row('cost'),
      row('kind', { kind: 'component' }),
      row('service'),
      row('same', { kind: 'component' }),
      row('bad'),
      row('kindOnly'),
      row('blank'),
      row('saved'),
      row('stored', { kind: 'service' }),
    ]
    const result = toSetCostsItems(
      rows,
      {
        cost: { unitCost: '1.00' },
        kind: { unitCost: '2', kind: 'finished_good' },
        service: { unitCost: 'nonsense', kind: 'service' },
        same: { unitCost: '0', kind: 'component' },
        bad: { unitCost: 'x' },
        kindOnly: { kind: 'subassembly' },
        blank: { unitCost: ' ' },
        saved: { unitCost: '5' },
        stored: { unitCost: '7' },
      },
      { skip: new Set(['saved']) }
    )
    expect(result.items).toEqual([
      { partId: 'cost', unitCost: 100 },
      { partId: 'kind', unitCost: 200, kind: 'finished_good' },
      { partId: 'service', unitCost: 0, kind: 'service' },
      { partId: 'same', unitCost: 0 },
    ])
    expect(Object.keys(result.errors).sort()).toEqual(['bad', 'kindOnly'])
  })
})
