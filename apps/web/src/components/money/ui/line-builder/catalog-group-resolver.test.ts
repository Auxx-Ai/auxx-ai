// apps/web/src/components/money/ui/line-builder/catalog-group-resolver.test.ts

import type { RecordId } from '@auxx/lib/resources/client'
import { describe, expect, it } from 'vitest'
import type { CatalogGroup } from '../../hooks/use-catalog-groups'
import type { CatalogPart } from '../../hooks/use-catalog-parts'
import {
  groupSellableParts,
  resolveCatalogGroup,
  resolvedCatalogGroupTotal,
} from './catalog-group-resolver'

function catalogPart(overrides: Partial<CatalogPart> = {}): CatalogPart {
  return {
    id: 'item-1',
    recordId: 'part-def:item-1' as RecordId,
    name: 'Service visit',
    description: 'Default description',
    sku: null,
    isService: true,
    sellPriceCents: 12500,
    unit: 'hour',
    taxable: true,
    sellable: true,
    ...overrides,
  }
}

function catalogGroup(overrides: Partial<CatalogGroup> = {}): CatalogGroup {
  return {
    id: 'group-1',
    recordId: 'catalog-group-def:group-1' as RecordId,
    name: 'Maintenance package',
    description: null,
    entries: [],
    taxRateId: 'tax-standard',
    discountType: 'percent',
    discountValue: 10,
    active: true,
    ...overrides,
  }
}

describe('resolveCatalogGroup', () => {
  it('snapshots item values and applies entry overrides in source order', () => {
    const second = catalogPart({
      id: 'item-2',
      recordId: 'part-def:item-2' as RecordId,
      name: 'Replacement filter',
      isService: false,
      sellable: false,
      sellPriceCents: 5000,
      unit: 'each',
    })
    const itemMap = new Map([
      ['item-1', catalogPart()],
      ['item-2', second],
    ])
    const group = catalogGroup({
      entries: [
        {
          id: 'entry-1',
          partId: 'item-1',
          qty: 2,
          description: 'Group description',
          taxable: false,
        },
        { id: 'entry-2', partId: 'item-2', qty: 1 },
      ],
    })

    const resolved = resolveCatalogGroup(group, itemMap)

    expect(resolved.lines).toHaveLength(2)
    expect(resolved.lines[0]).toMatchObject({
      name: 'Service visit',
      description: 'Group description',
      category: 'service',
      taxable: false,
      qty: 2,
      unit: 'hour',
      unitPriceCents: 12500,
      partRecordId: 'part-def:item-1',
    })
    expect(resolved.lines[1]).toMatchObject({
      name: 'Replacement filter',
      description: 'Default description',
      category: 'material',
      taxable: true,
      qty: 1,
    })
    expect(resolvedCatalogGroupTotal(resolved)).toBe(30000)
  })

  it('skips dangling item ids and reports one aggregate count', () => {
    const group = catalogGroup({
      entries: [
        { id: 'missing-1', partId: 'deleted-1', qty: 1 },
        { id: 'valid', partId: 'item-1', qty: 1 },
        { id: 'missing-2', partId: 'deleted-2', qty: 1 },
      ],
    })

    const resolved = resolveCatalogGroup(group, new Map([['item-1', catalogPart()]]))

    expect(resolved.lines.map((line) => line.name)).toEqual(['Service visit'])
    expect(resolved.skippedCount).toBe(2)
  })
})

describe('groupSellableParts', () => {
  it('lists only sellable parts, services before goods, matching name or SKU', () => {
    const parts = [
      catalogPart({ id: 'a', name: 'Visit' }),
      catalogPart({ id: 'b', name: 'Filter', isService: false, sku: 'FLT-1' }),
      catalogPart({ id: 'c', name: 'Bearing', isService: false, sellable: false }),
    ]

    expect(groupSellableParts(parts).map((s) => [s.key, s.rows.map((r) => r.id)])).toEqual([
      ['services', ['a']],
      ['goods', ['b']],
    ])
    expect(groupSellableParts(parts, 'flt').map((s) => s.key)).toEqual(['goods'])
  })
})
