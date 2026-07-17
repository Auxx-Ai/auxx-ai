// apps/web/src/components/money/ui/line-builder/catalog-group-resolver.test.ts

import type { RecordId } from '@auxx/lib/resources/client'
import { describe, expect, it } from 'vitest'
import type { CatalogGroup } from '../../hooks/use-catalog-groups'
import type { CatalogItem } from '../../hooks/use-catalog-items'
import { resolveCatalogGroup, resolvedCatalogGroupTotal } from './catalog-group-resolver'

function catalogItem(overrides: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id: 'item-1',
    recordId: 'catalog-def:item-1' as RecordId,
    name: 'Service visit',
    description: 'Default description',
    category: 'service',
    defaultUnitPriceCents: 12500,
    defaultUnit: 'hour',
    taxable: true,
    active: true,
    partRecordId: null,
    cost: null,
    markup: null,
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
    const second = catalogItem({
      id: 'item-2',
      recordId: 'catalog-def:item-2' as RecordId,
      name: 'Replacement filter',
      active: false,
      defaultUnitPriceCents: 5000,
      defaultUnit: 'each',
    })
    const itemMap = new Map([
      ['item-1', catalogItem()],
      ['item-2', second],
    ])
    const group = catalogGroup({
      entries: [
        {
          id: 'entry-1',
          catalogItemId: 'item-1',
          qty: 2,
          description: 'Group description',
          taxable: false,
        },
        { id: 'entry-2', catalogItemId: 'item-2', qty: 1 },
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
      catalogItemRecordId: 'catalog-def:item-1',
    })
    expect(resolved.lines[1]).toMatchObject({
      name: 'Replacement filter',
      description: 'Default description',
      taxable: true,
      qty: 1,
    })
    expect(resolvedCatalogGroupTotal(resolved)).toBe(30000)
  })

  it('skips dangling item ids and reports one aggregate count', () => {
    const group = catalogGroup({
      entries: [
        { id: 'missing-1', catalogItemId: 'deleted-1', qty: 1 },
        { id: 'valid', catalogItemId: 'item-1', qty: 1 },
        { id: 'missing-2', catalogItemId: 'deleted-2', qty: 1 },
      ],
    })

    const resolved = resolveCatalogGroup(group, new Map([['item-1', catalogItem()]]))

    expect(resolved.lines.map((line) => line.name)).toEqual(['Service visit'])
    expect(resolved.skippedCount).toBe(2)
  })
})
