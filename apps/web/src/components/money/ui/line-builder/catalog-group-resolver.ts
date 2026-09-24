// apps/web/src/components/money/ui/line-builder/catalog-group-resolver.ts

import type { CatalogGroup } from '../../hooks/use-catalog-groups'
import type { CatalogPart } from '../../hooks/use-catalog-parts'
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

/** Snapshot the values a part pick copies onto a sell-side line (107 D7). */
export function partToLinePatch(part: CatalogPart): LinePatch {
  return {
    name: part.name,
    description: part.description,
    category: part.isService ? 'service' : 'material',
    taxable: part.taxable,
    unitPriceCents: part.sellPriceCents,
    unit: part.unit,
    optional: false,
    optionalSelected: true,
    partRecordId: part.recordId,
  }
}

/** Resolve group entries against a preloaded part map without fetching. */
export function resolveCatalogGroup(
  group: CatalogGroup,
  partMap: Map<string, CatalogPart>
): ResolvedCatalogGroup {
  const lines: LineValues[] = []
  let skippedCount = 0

  for (const entry of group.entries) {
    const part = partMap.get(entry.partId)
    if (!part) {
      skippedCount++
      continue
    }

    lines.push({
      ...DEFAULT_LINE_VALUES,
      ...partToLinePatch(part),
      description: entry.description ?? part.description,
      taxable: entry.taxable ?? part.taxable,
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

/** Sellable parts split into the picker's two sections, each sorted by name. */
export function groupSellableParts(
  parts: CatalogPart[],
  query = ''
): { key: 'services' | 'goods'; label: string; rows: CatalogPart[] }[] {
  const q = query.trim().toLowerCase()
  const matches = parts.filter(
    (part) =>
      part.sellable &&
      (!q || part.name.toLowerCase().includes(q) || part.sku?.toLowerCase().includes(q))
  )
  const byName = (a: CatalogPart, b: CatalogPart) => a.name.localeCompare(b.name)
  return [
    {
      key: 'services' as const,
      label: 'Services',
      rows: matches.filter((p) => p.isService).sort(byName),
    },
    {
      key: 'goods' as const,
      label: 'Goods',
      rows: matches.filter((p) => !p.isService).sort(byName),
    },
  ].filter((section) => section.rows.length > 0)
}

/** Total preview for a resolved product group, in integer cents. */
export function resolvedCatalogGroupTotal(group: ResolvedCatalogGroup): number {
  return group.lines.reduce((sum, line) => sum + (line.unitPriceCents ?? 0) * line.qty, 0)
}
