// apps/web/src/components/accounting/ui/ledger/outbox/set-costs-rows.test.ts
import { describe, expect, it } from 'vitest'
import {
  buildSetCostsRows,
  parseUnitCost,
  type SetCostsPartState,
  type SetCostsRow,
  seedSuggestions,
  toSetCostsItems,
} from './set-costs-rows'

const row = (partId: string, over: Partial<SetCostsRow> = {}): SetCostsRow => ({
  partId,
  name: partId,
  waiting: 1,
  waitingLabel: '1 shipment',
  kind: null,
  hasBom: false,
  standardCost: null,
  uncostedLeafCount: 0,
  usedIn: 0,
  isLeaf: false,
  suggestion: null,
  purchaseCost: null,
  channelCost: null,
  ...over,
})

const state = (partId: string, over: Partial<SetCostsPartState> = {}): SetCostsPartState => ({
  partId,
  name: partId,
  kind: null,
  hasBom: false,
  standardCost: null,
  purchaseCost: null,
  channelCost: null,
  usedIn: 0,
  uncostedLeafCount: 0,
  isLeaf: false,
  ...over,
})

describe('set costs rows', () => {
  it('without a worklist, one plain row per blocked part, counting what waits by kind', () => {
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
      undefined
    )
    expect(rows.map((r) => [r.partId, r.name, r.waitingLabel])).toEqual([
      ['p1', 'Bolt', '3 shipments · 1 build'],
      ['p2', 'p2', '1 count'],
      // Mixed kinds with no per-kind split from the read: one figure.
      ['p3', 'Nut', '5 items'],
    ])
  })

  it('follows the worklist: BOM parents get no suggestion, leaves are not blocked', () => {
    const rows = buildSetCostsRows(
      [{ externalRef: 'fg', refLabel: 'Lamp', count: 2, sourceKinds: ['fulfillment'] }],
      [
        state('fg', { name: '', hasBom: true, purchaseCost: 900, uncostedLeafCount: 1 }),
        state('leaf', { isLeaf: true, usedIn: 3, purchaseCost: 120, channelCost: 150 }),
        state('gone', { channelCost: 0 }),
      ]
    )
    expect(rows[0]).toMatchObject({ name: 'Lamp', waiting: 2, hasBom: true, suggestion: null })
    expect(rows[1]).toMatchObject({
      waiting: 0,
      waitingLabel: 'Not blocked',
      suggestion: { unitCost: 120, source: 'supplier', other: { unitCost: 150 } },
    })
    // Priced since the dialog opened; a stored $0 is no suggestion.
    expect(rows[2]).toMatchObject({ waitingLabel: 'Nothing waiting', suggestion: null })
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

  it('seeds suggestions into untouched editable rows once, marked as suggested', () => {
    const suggestion = { unitCost: 1250, source: 'supplier' as const, other: null }
    const rows = [
      row('p1', { suggestion }),
      row('p2', { suggestion }),
      row('p3'),
      row('bom', { hasBom: true, suggestion }),
    ]
    const seeded = seedSuggestions(rows, { p2: { unitCost: '' } })
    expect(seeded).toEqual({ p1: { unitCost: '12.50', suggested: true }, p2: { unitCost: '' } })
    expect(seedSuggestions(rows, seeded)).toBe(seeded)
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
      row('bom', { hasBom: true }),
      row('instead', { hasBom: true }),
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
        bom: { unitCost: '9' },
        instead: { unitCost: '4', override: true },
      },
      { skip: new Set(['saved']) }
    )
    expect(result.items).toEqual([
      { partId: 'cost', unitCost: 100 },
      { partId: 'kind', unitCost: 200, kind: 'finished_good' },
      { partId: 'service', unitCost: 0, kind: 'service' },
      { partId: 'same', unitCost: 0 },
      { partId: 'instead', unitCost: 400, overrideBom: true },
    ])
    expect(Object.keys(result.errors).sort()).toEqual(['bad', 'kindOnly'])
  })
})
