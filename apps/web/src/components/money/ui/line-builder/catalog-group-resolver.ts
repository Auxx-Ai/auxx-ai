// apps/web/src/components/money/ui/line-builder/catalog-group-resolver.ts

import type { CatalogGroup } from '../../hooks/use-catalog-groups'
import type { CatalogItem } from '../../hooks/use-catalog-items'
import { DEFAULT_LINE_VALUES, type LinePatch, type LineValues } from './line-values'

/** One selected group resolved entirely from the already-loaded catalog. */
export interface ResolvedCatalogGroup {
  name: string
  taxRateId: string | null
  discountType: 'percent' | 'amount' | null
  discountValue: number | null
  lines: LineValues[]
  skippedCount: number
}

/** Snapshot the values a direct catalog pick copies onto an existing line. */
export function catalogItemToLinePatch(item: CatalogItem): LinePatch {
  return {
    name: item.name,
    description: item.description,
    category: item.category,
    taxable: item.taxable,
    unitPriceCents: item.defaultUnitPriceCents,
    unit: item.defaultUnit,
    optional: false,
    optionalSelected: true,
    catalogItemRecordId: item.recordId,
  }
}

/** Resolve group entries against a preloaded catalog item map without fetching. */
export function resolveCatalogGroup(
  group: CatalogGroup,
  itemMap: Map<string, CatalogItem>
): ResolvedCatalogGroup {
  const lines: LineValues[] = []
  let skippedCount = 0

  for (const entry of group.entries) {
    const item = itemMap.get(entry.catalogItemId)
    if (!item) {
      skippedCount++
      continue
    }

    lines.push({
      ...DEFAULT_LINE_VALUES,
      ...catalogItemToLinePatch(item),
      description: entry.description ?? item.description,
      taxable: entry.taxable ?? item.taxable,
      qty: entry.qty,
    })
  }

  return {
    name: group.name,
    taxRateId: group.taxRateId,
    discountType: group.discountType,
    discountValue: group.discountValue,
    lines,
    skippedCount,
  }
}

/** Total preview for a resolved product group, in integer cents. */
export function resolvedCatalogGroupTotal(group: ResolvedCatalogGroup): number {
  return group.lines.reduce((sum, line) => sum + (line.unitPriceCents ?? 0) * line.qty, 0)
}
